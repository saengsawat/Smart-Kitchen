/**
 * The development seed's M2-T3 additions against a real database: the Chen
 * household's `CHEN-482` (hash only), the household-less `fixture.new.user`,
 * and idempotency across runs, through the real `runFixtureSeed` entry point.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHEN_FIXTURE_JOIN_CODE,
  createJoinCodeHasher,
  DEVELOPMENT_JOIN_CODE_PEPPER,
  JOIN_CODE_PEPPER_ENV_VAR,
} from "../db/households/join-code.js";
import {
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { seedChenJoinCode } from "./fixture-join-code.js";
import { runFixtureSeed, type SeedIo } from "./seed-fixture.js";

const SUITE = "M2-T3: development seed join code and household-less user";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const CHEN = "f1c70000-0000-4000-8000-000000000001";
const NEW_USER = "f1c70001-0000-4000-8000-000000000004";

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  const out: string[] = [];
  const errors: string[] = [];
  const io: SeedIo = {
    out: (line) => out.push(line),
    error: (line) => errors.push(line),
  };

  async function liveHashes(): Promise<string[]> {
    const rows = await db.pool.query<{ code_hash: string }>(
      "SELECT code_hash FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
      [CHEN],
    );
    return rows.rows.map((row) => row.code_hash);
  }

  beforeAll(async () => {
    db = await createTestDatabase("m2t3-seed");
  }, 90_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("issues CHEN-482 as a hash under the development pepper, and never prints it", async () => {
    expect(await runFixtureSeed({ DATABASE_URL: db.url, NODE_ENV: "test" }, io)).toBe(0);
    expect(errors).toEqual([]);
    const hasher = createJoinCodeHasher(DEVELOPMENT_JOIN_CODE_PEPPER);
    expect(await liveHashes()).toEqual([hasher.hash(CHEN_FIXTURE_JOIN_CODE)]);
    expect(out.join("\n")).toContain("join code issued");
    expect(out.join("\n")).not.toContain(CHEN_FIXTURE_JOIN_CODE);
  });

  it("seeds fixture.new.user as a user with no household", async () => {
    const users = await db.pool.query("SELECT 1 FROM users WHERE id = $1", [NEW_USER]);
    const memberships = await db.pool.query(
      "SELECT 1 FROM household_memberships WHERE user_id = $1",
      [NEW_USER],
    );
    expect(users.rowCount).toBe(1);
    expect(memberships.rowCount).toBe(0);
  });

  it("changes nothing on a second run", async () => {
    const before = await db.pool.query("SELECT * FROM household_join_codes ORDER BY code_hash");
    expect(await runFixtureSeed({ DATABASE_URL: db.url, NODE_ENV: "test" }, io)).toBe(0);
    const after = await db.pool.query("SELECT * FROM household_join_codes ORDER BY code_hash");
    expect(after.rows).toEqual(before.rows);
    expect(out[out.length - 1]).toContain("join code already present or rotated");
  });

  it("stamps created_at with clock_timestamp() like the runtime paths, not the transaction's now() (M9-T0 j)", async () => {
    const house = await seedHousehold(db.pool, "seed-stamp");
    const hasher = createJoinCodeHasher("p".repeat(40));
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const started = await client.query<{ started: Date }>("SELECT now() AS started");
      await client.query("SELECT pg_sleep(0.05)");
      const result = await seedChenJoinCode(
        client as unknown as Parameters<typeof seedChenJoinCode>[0],
        house.householdId,
        house.userId,
        hasher,
      );
      await client.query("COMMIT");
      expect(result.issued).toBe(true);
      const row = await db.pool.query<{ created_at: Date }>(
        "SELECT created_at FROM household_join_codes WHERE household_id = $1",
        [house.householdId],
      );
      const startedAt = started.rows[0]?.started;
      const createdAt = row.rows[0]?.created_at;
      if (startedAt === undefined || createdAt === undefined) throw new Error("no timestamps");
      // With the DEFAULT now() these would be equal.
      expect(createdAt.getTime() - startedAt.getTime()).toBeGreaterThanOrEqual(40);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("refuses a short configured pepper before connecting", async () => {
    const refusals: string[] = [];
    const code = await runFixtureSeed(
      { DATABASE_URL: db.url, NODE_ENV: "test", [JOIN_CODE_PEPPER_ENV_VAR]: "too-short" },
      { out: () => undefined, error: (line) => refusals.push(line) },
    );
    expect(code).toBe(1);
    expect(refusals.join("\n")).toContain(JOIN_CODE_PEPPER_ENV_VAR);
    expect(refusals.join("\n")).not.toContain("too-short");
  });
});
