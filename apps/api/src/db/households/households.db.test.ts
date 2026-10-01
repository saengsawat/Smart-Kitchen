/**
 * Migration 0008 at the database (M2-T3 (f)): join-code isolation, the
 * membership doors, and the migration round trip.
 *
 * Every statement here runs as `sk_app` with the policies in force (the pool
 * connects as the owner, and each transaction assumes the runtime role), and
 * every negative assertion has a positive control beside it, as in
 * `db/inventory/tenancy.test.ts`.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`test-support/harness.ts`).
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDown, migrateUp } from "../migrate.js";
import { withHouseholdTransaction } from "../session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type SeededHousehold,
  type TestDatabase,
} from "../test-support/harness.js";
import { captureError, pgFailure } from "../test-support/inventory-fixtures.js";
import { migrationsAfter } from "../test-support/migration-list.js";
import { createJoinCodeHasher, DEVELOPMENT_JOIN_CODE_PEPPER } from "./join-code.js";
import {
  createHousehold,
  issueJoinCode,
  listMembershipsForUser,
  redeemJoinCode,
  rotateJoinCode,
} from "./repository.js";

const SUITE = "M2-T3: household join codes and membership doors (migration 0008)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const hasher = createJoinCodeHasher(DEVELOPMENT_JOIN_CODE_PEPPER);

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let alpha: SeededHousehold;
  let beta: SeededHousehold;
  let alphaCode: string;
  let betaCode: string;

  function asApp<T>(
    householdId: string | null,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return withHouseholdTransaction(db.pool, householdId, fn, { assumeRole: APP_ROLE });
  }

  async function newUser(): Promise<string> {
    const userId = randomUUID();
    await db.pool.query(
      `INSERT INTO users (id, auth_provider_subject, display_name) VALUES ($1, $2, 'Test Person')`,
      [userId, `test|${userId}`],
    );
    return userId;
  }

  async function membershipCount(householdId: string, userId: string): Promise<number> {
    const result = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM household_memberships
        WHERE household_id = $1 AND user_id = $2`,
      [householdId, userId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  beforeAll(async () => {
    db = await createTestDatabase("m2t3-join-codes");
    alpha = await seedHousehold(db.pool, "alpha");
    beta = await seedHousehold(db.pool, "beta");
    alphaCode = (
      await asApp(alpha.householdId, (client) =>
        issueJoinCode(client, alpha.householdId, alpha.userId, hasher),
      )
    ).code;
    betaCode = (
      await asApp(beta.householdId, (client) =>
        issueJoinCode(client, beta.householdId, beta.userId, hasher),
      )
    ).code;
  }, 90_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("household_join_codes isolation", () => {
    it("positive control: a household reads its own code row", async () => {
      const rows = await asApp(alpha.householdId, (client) =>
        client.query<{ household_id: string }>("SELECT household_id FROM household_join_codes"),
      );
      expect(rows.rows.map((row) => row.household_id)).toEqual([alpha.householdId]);
    });

    it("never reads another household's code row, even by its exact hash", async () => {
      const rows = await asApp(alpha.householdId, (client) =>
        client.query("SELECT 1 FROM household_join_codes WHERE code_hash = $1", [
          hasher.hash(betaCode),
        ]),
      );
      expect(rows.rowCount).toBe(0);
    });

    it("reads nothing with no household context (fails closed)", async () => {
      const rows = await asApp(null, (client) =>
        client.query("SELECT 1 FROM household_join_codes"),
      );
      expect(rows.rowCount).toBe(0);
    });

    it("cannot insert a code for another household", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            client.query(
              `INSERT INTO household_join_codes (code_hash, household_id, created_by)
               VALUES ($1, $2, $3)`,
              [hasher.hash("ZZZZ-999"), beta.householdId, alpha.userId],
            ),
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(failure.message).toMatch(/row-level security policy/);
    });

    it("cannot revoke another household's code (the update matches nothing)", async () => {
      const updated = await asApp(alpha.householdId, (client) =>
        client.query("UPDATE household_join_codes SET revoked_at = now() WHERE household_id = $1", [
          beta.householdId,
        ]),
      );
      expect(updated.rowCount).toBe(0);
      const stillLive = await db.pool.query(
        "SELECT 1 FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
        [beta.householdId],
      );
      expect(stillLive.rowCount).toBe(1);
    });

    it("cannot delete a code row at all", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) => client.query("DELETE FROM household_join_codes")),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(failure.message).toMatch(/permission denied/);
    });

    it("cannot change anything but revoked_at (column grant)", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            client.query("UPDATE household_join_codes SET household_id = $1", [beta.householdId]),
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it("cannot un-revoke a code (the trigger holds revocation one-way)", async () => {
      const issued = await asApp(alpha.householdId, (client) =>
        rotateJoinCode(client, alpha.householdId, alpha.userId, hasher),
      );
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            client.query("UPDATE household_join_codes SET revoked_at = NULL WHERE code_hash = $1", [
              hasher.hash(alphaCode),
            ]),
          ),
        ),
      );
      expect(failure.code).toBe("23514");
      alphaCode = issued.code;
    });

    it("allows at most one live code per household", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            client.query(
              `INSERT INTO household_join_codes (code_hash, household_id, created_by)
               VALUES ($1, $2, $3)`,
              [hasher.hash("YYYY-888"), alpha.householdId, alpha.userId],
            ),
          ),
        ),
      );
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("household_join_codes_one_live");
    });

    it("stores only a 64-hex hash: the plaintext appears in no column", async () => {
      const rows = await db.pool.query<{ row: string }>(
        "SELECT row_to_json(c)::text AS row FROM household_join_codes AS c",
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      for (const { row } of rows.rows) {
        expect(row).not.toContain(alphaCode);
        expect(row).not.toContain(betaCode);
      }
      const shape = pgFailure(
        await captureError(() =>
          db.pool.query(
            `INSERT INTO household_join_codes (code_hash, household_id, created_by)
             VALUES ('CHEN-482', $1, $2)`,
            [beta.householdId, beta.userId],
          ),
        ),
      );
      expect(shape.code).toBe("23514");
    });
  });

  describe("membership doors", () => {
    it("sk_app cannot insert a membership or a household directly", async () => {
      const outsider = await newUser();
      const membership = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            client.query(
              `INSERT INTO household_memberships (id, household_id, user_id, role)
               VALUES ($1, $2, $3, 'owner')`,
              [randomUUID(), alpha.householdId, outsider],
            ),
          ),
        ),
      );
      expect(membership.code).toBe("42501");
      const id = randomUUID();
      const household = pgFailure(
        await captureError(() =>
          asApp(id, (client) =>
            client.query("INSERT INTO households (id, name) VALUES ($1, 'x')", [id]),
          ),
        ),
      );
      expect(household.code).toBe("42501");
    });

    it("the functions are not executable by PUBLIC", async () => {
      const result = await db.pool.query<{ name: string; public_can: boolean; app_can: boolean }>(
        `SELECT p.proname AS name,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_can,
                has_function_privilege('sk_app', p.oid, 'EXECUTE') AS app_can
           FROM pg_proc AS p
          WHERE p.proname IN ('app_create_household', 'app_redeem_join_code', 'app_user_memberships')
          ORDER BY p.proname`,
      );
      expect(result.rows).toEqual([
        { name: "app_create_household", public_can: false, app_can: true },
        { name: "app_redeem_join_code", public_can: false, app_can: true },
        { name: "app_user_memberships", public_can: false, app_can: true },
      ]);
    });

    it("a live code adds exactly one member membership for the given user, once", async () => {
      const joiner = await newUser();
      const first = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(betaCode), joiner, randomUUID()),
      );
      expect(first).toEqual({ householdId: beta.householdId, joined: true, role: "member" });
      const second = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(betaCode), joiner, randomUUID()),
      );
      expect(second).toEqual({ householdId: beta.householdId, joined: false, role: "member" });
      expect(await membershipCount(beta.householdId, joiner)).toBe(1);
    });

    it("an owner redeeming their own code keeps the owner role and gains nothing", async () => {
      const again = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(betaCode), beta.userId, randomUUID()),
      );
      expect(again).toEqual({ householdId: beta.householdId, joined: false, role: "owner" });
      expect(await membershipCount(beta.householdId, beta.userId)).toBe(1);
    });

    it("an unknown code and a revoked code are both simply no row", async () => {
      const joiner = await newUser();
      const unknown = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash("QQQQ-222"), joiner, randomUUID()),
      );
      const oldBeta = betaCode;
      betaCode = (
        await asApp(beta.householdId, (client) =>
          rotateJoinCode(client, beta.householdId, beta.userId, hasher),
        )
      ).code;
      const revoked = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(oldBeta), joiner, randomUUID()),
      );
      expect(unknown).toBeUndefined();
      expect(revoked).toBeUndefined();
      expect(await membershipCount(beta.householdId, joiner)).toBe(0);
    });

    it("app_create_household refuses to run outside the new household's own context", async () => {
      const owner = await newUser();
      const id = randomUUID();
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            createHousehold(
              client,
              { householdId: id, membershipId: randomUUID(), name: "Sneaky", ownerUserId: owner },
              hasher,
            ),
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      const none = await asApp(null, (client) => listMembershipsForUser(client, owner));
      expect(none).toEqual([]);
    });

    it("app_create_household cannot be aimed at an existing household", async () => {
      const intruder = await newUser();
      const failure = pgFailure(
        await captureError(() =>
          asApp(alpha.householdId, (client) =>
            createHousehold(
              client,
              {
                householdId: alpha.householdId,
                membershipId: randomUUID(),
                name: "Takeover",
                ownerUserId: intruder,
              },
              hasher,
            ),
          ),
        ),
      );
      expect(failure.code).toBe("23505");
      expect(await membershipCount(alpha.householdId, intruder)).toBe(0);
    });

    it("creates a household with its owner and a live code, and lists it for the owner only", async () => {
      const owner = await newUser();
      const id = randomUUID();
      const issued = await asApp(id, (client) =>
        createHousehold(
          client,
          { householdId: id, membershipId: randomUUID(), name: "Fresh", ownerUserId: owner },
          hasher,
        ),
      );
      const listed = await asApp(null, (client) => listMembershipsForUser(client, owner));
      expect(listed).toMatchObject([{ householdId: id, role: "owner", householdName: "Fresh" }]);
      const joiner = await newUser();
      const joined = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(issued.code), joiner, randomUUID()),
      );
      expect(joined?.householdId).toBe(id);
      const others = await asApp(null, (client) => listMembershipsForUser(client, alpha.userId));
      expect(others.map((entry) => entry.householdId)).toEqual([alpha.householdId]);
    });

    it("lists several memberships most recently joined first", async () => {
      const person = await newUser();
      await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(alphaCode), person, randomUUID()),
      );
      await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(betaCode), person, randomUUID()),
      );
      const listed = await asApp(null, (client) => listMembershipsForUser(client, person));
      expect(listed.map((entry) => entry.householdId)).toEqual([
        beta.householdId,
        alpha.householdId,
      ]);
    });

    it("two concurrent rotations leave exactly one live code", async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          asApp(alpha.householdId, (client) =>
            rotateJoinCode(client, alpha.householdId, alpha.userId, hasher),
          ),
        ),
      );
      const live = await db.pool.query(
        "SELECT 1 FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
        [alpha.householdId],
      );
      expect(live.rowCount).toBe(1);
    });
  });

  describe("rotation clock (M2-T3a)", () => {
    /**
     * The CI failure on main, made deterministic. Transaction B begins and
     * freezes its `now()` first; transaction A then rotates and commits, so the
     * live code's `created_at` is later than B's start; only then does B take
     * the advisory lock and rotate. With `revoked_at = now()` B would stamp its
     * own start time onto a row created after it, and
     * `household_join_codes_revoked_after_created` would reject the update.
     * B is driven on a raw pool client, mirroring `session.ts` (BEGIN, SET LOCAL
     * ROLE, set_config), because `withHouseholdTransaction` cannot hold a
     * transaction open across an await from the test.
     */
    it("a rotation whose transaction began before the previous rotation committed still succeeds (two connections)", async () => {
      const gamma = await seedHousehold(db.pool, "gamma");
      await asApp(gamma.householdId, (client) =>
        issueJoinCode(client, gamma.householdId, gamma.userId, hasher),
      );

      const b = await db.pool.connect();
      let committed = false;
      try {
        await b.query("BEGIN");
        await b.query(`SET LOCAL ROLE ${APP_ROLE}`);
        await b.query("SELECT set_config('app.household_id', $1, true)", [gamma.householdId]);
        const bStart = (await b.query<{ started: Date }>("SELECT now() AS started")).rows[0]
          ?.started;
        if (bStart === undefined) throw new Error("no transaction start time");
        await new Promise((resolve) => setTimeout(resolve, 20));

        const a = await asApp(gamma.householdId, (client) =>
          rotateJoinCode(client, gamma.householdId, gamma.userId, hasher),
        );
        // The ordering the bug needs: B's transaction started before A's code existed.
        expect(bStart.getTime()).toBeLessThan(Date.parse(a.issuedAt));

        await rotateJoinCode(b, gamma.householdId, gamma.userId, hasher);
        await b.query("COMMIT");
        committed = true;
      } finally {
        if (!committed) await b.query("ROLLBACK").catch(() => undefined);
        b.release();
      }

      const rows = await db.pool.query<{ ok: boolean; live: boolean }>(
        `SELECT (revoked_at IS NULL OR revoked_at >= created_at) AS ok, revoked_at IS NULL AS live
           FROM household_join_codes WHERE household_id = $1`,
        [gamma.householdId],
      );
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows.every((row) => row.ok)).toBe(true);
      expect(rows.rows.filter((row) => row.live)).toHaveLength(1);
    });

    it("after many rotations every row satisfies the constraint and created_at strictly increases", async () => {
      const delta = await seedHousehold(db.pool, "delta");
      const issued = [
        await asApp(delta.householdId, (client) =>
          issueJoinCode(client, delta.householdId, delta.userId, hasher),
        ),
      ];
      for (let rotation = 0; rotation < 8; rotation += 1) {
        issued.push(
          await asApp(delta.householdId, (client) =>
            rotateJoinCode(client, delta.householdId, delta.userId, hasher),
          ),
        );
      }
      expect(issued).toHaveLength(9);

      // Strictly increasing created_at, compared inside Postgres at its own
      // microsecond precision (node-pg truncates timestamps to milliseconds, so
      // two rotations under 1 ms apart would have compared equal in JS; M9-T0 e).
      const ordering = await db.pool.query<{ total: string; not_increasing: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE previous IS NOT NULL AND created_at <= previous)::text
                  AS not_increasing
           FROM (SELECT created_at,
                        lag(created_at) OVER (ORDER BY created_at) AS previous
                   FROM household_join_codes WHERE household_id = $1) AS ordered`,
        [delta.householdId],
      );
      expect(ordering.rows[0]).toEqual({ total: "9", not_increasing: "0" });

      const rows = await db.pool.query<{ created_at: Date; revoked_at: Date | null }>(
        `SELECT created_at, revoked_at FROM household_join_codes
          WHERE household_id = $1 ORDER BY created_at`,
        [delta.householdId],
      );
      expect(rows.rows).toHaveLength(9);
      expect(rows.rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
      for (const [index, row] of rows.rows.entries()) {
        if (row.revoked_at !== null) {
          expect(row.revoked_at.getTime()).toBeGreaterThanOrEqual(row.created_at.getTime());
          // Revoked before (or as) its successor was created.
          const next = rows.rows[index + 1];
          if (next !== undefined) {
            expect(row.revoked_at.getTime()).toBeLessThanOrEqual(next.created_at.getTime());
          }
        }
      }
    });
  });

  describe("redeem versus rotation (M9-T0 d, FOR SHARE in app_redeem_join_code)", () => {
    /** A raw transaction mirroring session.ts, held open across awaits. */
    async function openTransaction(householdId: string | null): Promise<PoolClient> {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
        if (householdId !== null) {
          await client.query("SELECT set_config('app.household_id', $1, true)", [householdId]);
        }
        return client;
      } catch (error) {
        client.release();
        throw error;
      }
    }

    async function pidOf(client: PoolClient): Promise<number> {
      const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const pid = result.rows[0]?.pid;
      if (pid === undefined) throw new Error("no backend pid");
      return pid;
    }

    /** Waits until the backend `pid` is blocked behind another transaction's lock. */
    async function waitUntilBlocked(pid: number): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await db.pool.query<{ blocked: boolean }>(
          "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
          [pid],
        );
        if (result.rows[0]?.blocked === true) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`backend ${pid} never blocked`);
    }

    it("a redeem that starts while a rotation is uncommitted waits, then finds the code revoked and joins nobody", async () => {
      const house = await seedHousehold(db.pool, "race-redeem-second");
      const oldCode = (
        await asApp(house.householdId, (client) =>
          issueJoinCode(client, house.householdId, house.userId, hasher),
        )
      ).code;
      const joiner = await newUser();

      const a = await openTransaction(house.householdId);
      const b = await openTransaction(null);
      let aOpen = true;
      try {
        // A rotates and holds the revoke uncommitted.
        await rotateJoinCode(a, house.householdId, house.userId, hasher);

        // B reads the old code: still live in B's snapshot, locked by A's revoke.
        const bPid = await pidOf(b);
        const redeeming = redeemJoinCode(b, hasher.hash(oldCode), joiner, randomUUID());
        await waitUntilBlocked(bPid);

        await a.query("COMMIT");
        aOpen = false;

        // After A commits, FOR SHARE re-checks revoked_at IS NULL on the updated
        // row and drops it. A plain SELECT would have joined on the revoked code.
        expect(await redeeming).toBeUndefined();
        await b.query("COMMIT");
      } finally {
        if (aOpen) await a.query("ROLLBACK").catch(() => undefined);
        await b.query("ROLLBACK").catch(() => undefined);
        a.release();
        b.release();
      }
      expect(await membershipCount(house.householdId, joiner)).toBe(0);
    });

    it("a rotation that starts while a redeem is uncommitted waits for it, so the join stands and the old code is then revoked", async () => {
      const house = await seedHousehold(db.pool, "race-rotate-second");
      const oldCode = (
        await asApp(house.householdId, (client) =>
          issueJoinCode(client, house.householdId, house.userId, hasher),
        )
      ).code;
      const joiner = await newUser();

      const b = await openTransaction(null);
      const a = await openTransaction(house.householdId);
      let bOpen = true;
      try {
        // B redeems first and holds the share lock on the live code, uncommitted.
        const joined = await redeemJoinCode(b, hasher.hash(oldCode), joiner, randomUUID());
        expect(joined?.joined).toBe(true);

        const aPid = await pidOf(a);
        const rotating = rotateJoinCode(a, house.householdId, house.userId, hasher);
        await waitUntilBlocked(aPid);

        await b.query("COMMIT");
        bOpen = false;
        await rotating;
        await a.query("COMMIT");
      } finally {
        if (bOpen) await b.query("ROLLBACK").catch(() => undefined);
        await a.query("ROLLBACK").catch(() => undefined);
        a.release();
        b.release();
      }
      expect(await membershipCount(house.householdId, joiner)).toBe(1);
      const live = await db.pool.query(
        "SELECT 1 FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
        [house.householdId],
      );
      expect(live.rowCount).toBe(1);
      const afterRotation = await asApp(null, (client) =>
        redeemJoinCode(client, hasher.hash(oldCode), joiner, randomUUID()),
      );
      expect(afterRotation).toBeUndefined();
    });
  });

  describe("migration 0008 round trip", () => {
    it("down removes the table and the functions; up restores them", async () => {
      const scratch = await createTestDatabase("m2t3-migration");
      try {
        const objects = async (): Promise<{ table: number; functions: number }> => {
          const result = await scratch.pool.query<{ tables: string; functions: string }>(
            `SELECT (SELECT count(*)::text FROM pg_class WHERE relname = 'household_join_codes') AS tables,
                    (SELECT count(*)::text FROM pg_proc WHERE proname IN
                       ('app_create_household', 'app_redeem_join_code', 'app_user_memberships',
                        'household_join_codes_revoke_only')) AS functions`,
          );
          return {
            table: Number(result.rows[0]?.tables ?? "0"),
            functions: Number(result.rows[0]?.functions ?? "0"),
          };
        };
        expect(await objects()).toEqual({ table: 1, functions: 4 });

        // Every later migration is rolled back first (read from the
        // migrations directory, M9-T0 b), so 0008 is the last one reverted.
        const after = migrationsAfter(8);
        const reverted = await migrateDown(scratch.url, after.length + 1);
        expect(reverted).toEqual([...after].reverse().concat("0008_household_join_codes"));
        expect(await objects()).toEqual({ table: 0, functions: 0 });
        const households = await scratch.pool.query(
          "SELECT 1 FROM pg_class WHERE relname = 'household_memberships'",
        );
        expect(households.rowCount).toBe(1);

        const applied = await migrateUp(scratch.url);
        expect(applied).toEqual(["0008_household_join_codes", ...after]);
        expect(await objects()).toEqual({ table: 1, functions: 4 });
      } finally {
        await scratch.drop();
      }
    }, 60_000);
  });
});
