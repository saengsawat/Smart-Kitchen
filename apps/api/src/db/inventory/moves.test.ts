/**
 * Moving an item between locations at the database (M2-T6, D-024 row 1;
 * INV-LEDGER-2, INV-TENANT-1).
 *
 * Four things are pinned here, below the HTTP layer:
 *
 * 1. **What a move writes.** One `inventory_item_moves` row and the
 *    `storage_location` column of one `inventory_items` row, and nothing else
 *    anywhere: every `inventory_transactions` and `inventory_lots` row is
 *    byte-identical before and after, and so is every `inventory_items` column
 *    except `storage_location` (full-row comparison through `to_jsonb`, plus
 *    row counts).
 * 2. **What the schema refuses on its own** (migration 0011), whatever the
 *    service does: a move to the same place, to a value outside the enum, by a
 *    non-member, on another household's item, twice under one key, with a
 *    malformed key; and the row-level security policy.
 * 3. **How the history merges the moves in**, over real rows with controlled
 *    timestamps (the pure rule is in `history-merge.test.ts`).
 * 4. **Concurrency and creation replay**: two moves racing for one item
 *    serialise on the item lock, and a retried item-create still recognises
 *    itself after the item has moved.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build in CI.
 */

import { randomUUID } from "node:crypto";
import type { InventoryMoveEntryDto } from "@smart-kitchen/contracts";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moveItem, SameLocationError } from "../../inventory/move-service.js";
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
import {
  captureError,
  insertRawTransaction,
  pgFailure,
  seedItem,
  type SeededItem,
} from "../test-support/inventory-fixtures.js";
import { migrationsAfter } from "../test-support/migration-list.js";
import { createInventoryItemWithStock } from "./create-service.js";
import { readInventoryItemDetail } from "./detail.js";
import { InventoryItemNotVisibleError, LedgerWriteRejectedError } from "./write-service.js";

const SUITE = "M2-T6: item moves at the database";
it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

type Location = "FRIDGE" | "FREEZER" | "PANTRY" | "OTHER";

/** The whole-table image a move must leave untouched (items without the one column a move writes). */
interface TableImage {
  readonly transactions: readonly string[];
  readonly lots: readonly string[];
  readonly itemsWithoutLocation: readonly string[];
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let home: SeededHousehold;
  let away: SeededHousehold;
  let secondMemberId: string;

  function asTenant<T>(
    householdId: string | null,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return withHouseholdTransaction(db.pool, householdId, fn, { assumeRole: APP_ROLE });
  }

  /** An item with one ledger row (2 lb), in `location`. */
  async function itemIn(
    household: SeededHousehold,
    location: Location | null,
  ): Promise<SeededItem> {
    const item = await seedItem(db.pool, household.householdId, "lb", location);
    await insertRawTransaction(db.pool, {
      householdId: household.householdId,
      itemId: item.itemId,
      lotId: item.lotId,
      userId: household.userId,
    });
    return item;
  }

  async function move(
    household: SeededHousehold,
    itemId: string,
    toLocation: Location,
    idempotencyKey: string = randomUUID(),
    actorUserId: string = household.userId,
  ): Promise<Awaited<ReturnType<typeof moveItem>>> {
    return asTenant(household.householdId, (client) =>
      moveItem(client, household.householdId, itemId, { toLocation, idempotencyKey, actorUserId }),
    );
  }

  async function movesOf(itemId: string): Promise<
    readonly {
      from_location: string | null;
      to_location: string;
      moved_by: string;
      client_key: string;
      occurred_at: Date;
    }[]
  > {
    const rows = await db.pool.query<{
      from_location: string | null;
      to_location: string;
      moved_by: string;
      client_key: string;
      occurred_at: Date;
    }>(
      `SELECT from_location, to_location, moved_by, client_key, occurred_at
         FROM inventory_item_moves WHERE item_id = $1 ORDER BY occurred_at, id`,
      [itemId],
    );
    return rows.rows;
  }

  async function locationOf(itemId: string): Promise<string | null> {
    const row = await db.pool.query<{ storage_location: string | null }>(
      `SELECT storage_location FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    return row.rows[0]?.storage_location ?? null;
  }

  async function image(): Promise<TableImage> {
    const read = async (select: string, table: string): Promise<string[]> => {
      // `select` and `table` are literals below, never test input.
      const rows = await db.pool.query<{ json: string }>(
        `SELECT (${select})::text AS json FROM ${table} AS r ORDER BY r.id`,
      );
      return rows.rows.map((row) => row.json);
    };
    return {
      // ctid and xmin as well as content: a no-op UPDATE rewrites the tuple, so
      // it would change both while leaving to_jsonb identical (the M2-T5 precedent).
      transactions: await read(
        "r.ctid::text || '|' || r.xmin::text || '|' || to_jsonb(r)::text",
        "inventory_transactions",
      ),
      lots: await read(
        "r.ctid::text || '|' || r.xmin::text || '|' || to_jsonb(r)::text",
        "inventory_lots",
      ),
      // Content only: a move legitimately rewrites the item tuple (storage_location).
      itemsWithoutLocation: await read("to_jsonb(r) - 'storage_location'", "inventory_items"),
    };
  }

  beforeAll(async () => {
    db = await createTestDatabase("m2t6-moves");
    home = await seedHousehold(db.pool, "Moves");
    away = await seedHousehold(db.pool, "Elsewhere");
    secondMemberId = randomUUID();
    await db.pool.query(
      `INSERT INTO users (id, auth_provider_subject, email, display_name)
       VALUES ($1, $2, 'second@example.test', 'Second member')`,
      [secondMemberId, `test|${secondMemberId}`],
    );
    await db.pool.query(
      `INSERT INTO household_memberships (id, household_id, user_id, role)
       VALUES ($1, $2, $3, 'member')`,
      [randomUUID(), home.householdId, secondMemberId],
    );
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("what a move writes", () => {
    it("writes the move row and the location column and nothing else: every ledger table is byte-identical", async () => {
      const item = await itemIn(home, "FRIDGE");
      // Some other rows in every table, so the comparison is not of a single row.
      const other = await itemIn(home, "PANTRY");
      await move(home, other.itemId, "FREEZER");

      const before = await image();
      const movesBefore = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_item_moves`,
      );

      const result = await move(home, item.itemId, "PANTRY", "repo-key-1");

      expect(result.moved).toBe(true);
      const after = await image();
      expect(after.transactions).toHaveLength(before.transactions.length);
      expect(after.transactions).toEqual(before.transactions);
      expect(after.lots).toEqual(before.lots);
      expect(after.itemsWithoutLocation).toEqual(before.itemsWithoutLocation);

      // The one column that changed, on the one row, and the one move row.
      expect(await locationOf(item.itemId)).toBe("PANTRY");
      expect(await locationOf(other.itemId)).toBe("FREEZER");
      const movesAfter = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_item_moves`,
      );
      expect(Number(movesAfter.rows[0]?.count)).toBe(Number(movesBefore.rows[0]?.count) + 1);
      expect(await movesOf(item.itemId)).toMatchObject([
        {
          from_location: "FRIDGE",
          to_location: "PANTRY",
          moved_by: home.userId,
          client_key: "repo-key-1",
        },
      ]);
    });

    it("an idempotent replay and every refusal leave every table exactly as it was", async () => {
      const item = await itemIn(home, "FRIDGE");
      await move(home, item.itemId, "PANTRY", "replay-key");
      const before = await image();
      const movesBefore = await movesOf(item.itemId);

      const replay = await move(home, item.itemId, "PANTRY", "replay-key");
      expect(replay.moved).toBe(false);

      const sameLocation = await captureError(() => move(home, item.itemId, "PANTRY", "other-key"));
      expect(sameLocation).toBeInstanceOf(SameLocationError);

      const conflict = await captureError(() => move(home, item.itemId, "FREEZER", "replay-key"));
      expect(conflict).toBeInstanceOf(LedgerWriteRejectedError);
      expect((conflict as LedgerWriteRejectedError).ledgerError.code).toBe(
        "IDEMPOTENCY_KEY_CONFLICT",
      );

      const badKey = await captureError(() => move(home, item.itemId, "OTHER", "has space"));
      expect((badKey as LedgerWriteRejectedError).ledgerError.code).toBe("INVALID_IDEMPOTENCY_KEY");

      const after = await image();
      expect(after).toEqual(before);
      expect(await movesOf(item.itemId)).toEqual(movesBefore);
      expect(await locationOf(item.itemId)).toBe("PANTRY");
    });

    it("the same key by a different member is a conflict, not a replay", async () => {
      const item = await itemIn(home, "FRIDGE");
      await move(home, item.itemId, "PANTRY", "shared-key");
      const error = await captureError(() =>
        move(home, item.itemId, "PANTRY", "shared-key", secondMemberId),
      );
      expect((error as LedgerWriteRejectedError).ledgerError.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect(await movesOf(item.itemId)).toHaveLength(1);
    });

    it("the same key on two different items is two independent moves", async () => {
      const a = await itemIn(home, "FRIDGE");
      const b = await itemIn(home, "FRIDGE");
      expect((await move(home, a.itemId, "PANTRY", "twin-key")).moved).toBe(true);
      expect((await move(home, b.itemId, "PANTRY", "twin-key")).moved).toBe(true);
    });

    it("an item with no location moves out of 'unassigned' recording a null source", async () => {
      const item = await itemIn(home, null);
      await move(home, item.itemId, "OTHER");
      expect(await movesOf(item.itemId)).toMatchObject([
        { from_location: null, to_location: "OTHER" },
      ]);
      expect(await locationOf(item.itemId)).toBe("OTHER");
    });

    it("occurred_at comes from clock_timestamp(): successive moves are stamped in order", async () => {
      const item = await itemIn(home, "FRIDGE");
      await move(home, item.itemId, "PANTRY");
      await move(home, item.itemId, "FREEZER");
      await move(home, item.itemId, "OTHER");
      const rows = await movesOf(item.itemId);
      const times = rows.map((row) => row.occurred_at.getTime());
      expect([...times].sort((x, y) => x - y)).toEqual(times);
      expect(rows.map((row) => [row.from_location, row.to_location])).toEqual([
        ["FRIDGE", "PANTRY"],
        ["PANTRY", "FREEZER"],
        ["FREEZER", "OTHER"],
      ]);
    });

    it("an item that is not visible to the session is refused before anything is written", async () => {
      const theirs = await itemIn(away, "FRIDGE");
      const error = await captureError(() => move(home, theirs.itemId, "PANTRY"));
      expect(error).toBeInstanceOf(InventoryItemNotVisibleError);
      expect(await movesOf(theirs.itemId)).toEqual([]);
      expect(await locationOf(theirs.itemId)).toBe("FRIDGE");
    });
  });

  describe("how the detail read merges the moves into the history", () => {
    it("places each move among the ledger rows by time, with ledger rows in sequence order", async () => {
      const item = await seedItem(db.pool, home.householdId, "lb", "FRIDGE");
      const context = {
        householdId: home.householdId,
        itemId: item.itemId,
        lotId: item.lotId,
        userId: home.userId,
      };
      // Three ledger rows at :01, :03.000900 and :05, each 1 lb.
      for (const [sequence, stamp] of [
        [1, "01.000000"],
        [2, "03.000900"],
        [3, "05.000000"],
      ] as const) {
        await insertRawTransaction(db.pool, context, {
          sequence,
          qty_delta: "1",
          qty_delta_micros: "1000000",
          recorded_at: `2026-03-06T18:00:${stamp}Z`,
          occurred_at: `2026-03-06T18:00:${stamp}Z`,
          idempotency_key: `merge-${String(sequence)}`,
        });
      }
      // Moves as the owner, with chosen instants: between rows 1 and 2, in the
      // same millisecond as row 2 but 800 microseconds before it (so before it,
      // though a JS Date could not tell them apart), and after all.
      const insertMoveAt = async (from: Location, to: Location, at: string): Promise<void> => {
        await db.pool.query(
          `INSERT INTO inventory_item_moves
                  (household_id, item_id, from_location, to_location, moved_by, client_key, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [home.householdId, item.itemId, from, to, home.userId, `at-${randomUUID()}`, at],
        );
      };
      await insertMoveAt("FRIDGE", "FREEZER", "2026-03-06T18:00:02.000000Z");
      await insertMoveAt("FREEZER", "PANTRY", "2026-03-06T18:00:03.000100Z");
      await insertMoveAt("PANTRY", "OTHER", "2026-03-06T18:00:09.000000Z");

      const read = await asTenant(home.householdId, (client) =>
        readInventoryItemDetail(client, home.householdId, item.itemId),
      );
      const history = read?.detail.history ?? [];
      expect(
        history.map((entry) => (entry.type === "MOVED" ? `MOVED:${entry.toLocation}` : entry.type)),
      ).toEqual([
        "PURCHASE",
        "MOVED:FREEZER",
        "MOVED:PANTRY",
        "PURCHASE",
        "PURCHASE",
        "MOVED:OTHER",
      ]);
      // The ledger-only list the write path uses is unchanged by moves.
      expect(read?.history).toHaveLength(3);
      // A move entry names the actor by initials and never by name.
      const moved = history.find((entry) => entry.type === "MOVED") as InventoryMoveEntryDto;
      expect(moved.actor).toEqual({ kind: "user", displayInitials: "MO" });
      expect(JSON.stringify(history)).not.toContain("Moves owner");
    });

    it("is deterministic: reading twice gives the same order", async () => {
      const item = await itemIn(home, "FRIDGE");
      await move(home, item.itemId, "PANTRY");
      await move(home, item.itemId, "FREEZER");
      const read = (): Promise<string> =>
        asTenant(home.householdId, async (client) =>
          JSON.stringify(
            (await readInventoryItemDetail(client, home.householdId, item.itemId))?.detail,
          ),
        );
      expect(await read()).toBe(await read());
    });
  });

  describe("what migration 0011 refuses on its own", () => {
    async function insertMove(
      executor: { query: PoolClient["query"] },
      values: {
        readonly householdId: string;
        readonly itemId: string;
        readonly from?: string | null;
        readonly to?: string;
        readonly movedBy: string;
        readonly clientKey?: string;
      },
    ): Promise<void> {
      await executor.query(
        `INSERT INTO inventory_item_moves
                (household_id, item_id, from_location, to_location, moved_by, client_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          values.householdId,
          values.itemId,
          values.from === undefined ? "FRIDGE" : values.from,
          values.to ?? "PANTRY",
          values.movedBy,
          values.clientKey ?? `raw-${randomUUID()}`,
        ],
      );
    }

    it("refuses a move to the place it came from, even as the owner", async () => {
      const item = await itemIn(home, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          insertMove(db.pool, {
            householdId: home.householdId,
            itemId: item.itemId,
            from: "PANTRY",
            to: "PANTRY",
            movedBy: home.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23514");
      expect(failure.constraint).toBe("inventory_item_moves_goes_somewhere");
    });

    it.each([
      ["a destination outside the enum", { to: "GARAGE" }],
      ["a source outside the enum", { from: "GARAGE" }],
      ["a lower-case destination", { to: "pantry" }],
      ["a malformed client key", { clientKey: "has space" }],
      ["an empty client key", { clientKey: "" }],
    ])("refuses %s", async (_case, override) => {
      const item = await itemIn(home, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          insertMove(db.pool, {
            householdId: home.householdId,
            itemId: item.itemId,
            movedBy: home.userId,
            ...override,
          }),
        ),
      );
      expect(failure.code).toBe("23514");
    });

    it("refuses a NULL destination", async () => {
      const item = await itemIn(home, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(
            `INSERT INTO inventory_item_moves
                    (household_id, item_id, from_location, to_location, moved_by, client_key)
             VALUES ($1, $2, 'FRIDGE', NULL, $3, 'null-to')`,
            [home.householdId, item.itemId, home.userId],
          ),
        ),
      );
      expect(failure.code).toBe("23502");
    });

    it("refuses a mover who is not a member of the item's household", async () => {
      const item = await itemIn(home, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          insertMove(db.pool, {
            householdId: home.householdId,
            itemId: item.itemId,
            movedBy: away.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_item_moves_moved_by_fkey");
    });

    it("refuses a move that names another household's item under this household", async () => {
      const theirs = await itemIn(away, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          insertMove(db.pool, {
            householdId: home.householdId,
            itemId: theirs.itemId,
            movedBy: home.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_item_moves_item_fkey");
    });

    it("refuses a second move under the same key on one item", async () => {
      const item = await itemIn(home, "FRIDGE");
      await insertMove(db.pool, {
        householdId: home.householdId,
        itemId: item.itemId,
        movedBy: home.userId,
        clientKey: "dup",
      });
      const failure = pgFailure(
        await captureError(() =>
          insertMove(db.pool, {
            householdId: home.householdId,
            itemId: item.itemId,
            from: "PANTRY",
            to: "FREEZER",
            movedBy: home.userId,
            clientKey: "dup",
          }),
        ),
      );
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("inventory_item_moves_client_key_key");
    });
  });

  describe("tenancy (INV-TENANT-1) on the new table", () => {
    it("a household sees its own moves and none of another's (positive control first)", async () => {
      const mine = await itemIn(home, "FRIDGE");
      const theirs = await itemIn(away, "FRIDGE");
      await move(home, mine.itemId, "PANTRY");
      await move(away, theirs.itemId, "PANTRY");

      const owner = await db.pool.query<{ item_id: string }>(
        `SELECT item_id FROM inventory_item_moves WHERE item_id = ANY($1::uuid[])`,
        [[mine.itemId, theirs.itemId]],
      );
      expect(owner.rows).toHaveLength(2);

      const seen = await asTenant(home.householdId, async (client) => {
        const rows = await client.query<{ item_id: string; household_id: string }>(
          `SELECT item_id, household_id FROM inventory_item_moves`,
        );
        return rows.rows;
      });
      expect(seen.map((row) => row.item_id)).toContain(mine.itemId);
      expect(seen.map((row) => row.item_id)).not.toContain(theirs.itemId);
      expect(new Set(seen.map((row) => row.household_id))).toEqual(new Set([home.householdId]));
    });

    it("cannot insert a move into another household as sk_app", async () => {
      const theirs = await itemIn(away, "FRIDGE");
      const failure = pgFailure(
        await captureError(() =>
          asTenant(home.householdId, (client) =>
            client.query(
              `INSERT INTO inventory_item_moves
                      (household_id, item_id, from_location, to_location, moved_by, client_key)
               VALUES ($1, $2, 'FRIDGE', 'PANTRY', $3, 'tenant-probe')`,
              [away.householdId, theirs.itemId, away.userId],
            ),
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(await movesOf(theirs.itemId)).toEqual([]);
    });

    it("cannot change another household's item location as sk_app (the 0006 policy, now carrying a move)", async () => {
      const theirs = await itemIn(away, "FRIDGE");
      const updated = await asTenant(home.householdId, async (client) => {
        const result = await client.query(
          `UPDATE inventory_items SET storage_location = 'PANTRY' WHERE id = $1`,
          [theirs.itemId],
        );
        return result.rowCount;
      });
      expect(updated).toBe(0);
      expect(await locationOf(theirs.itemId)).toBe("FRIDGE");
    });

    it("sees nothing and moves nothing when no household context is established", async () => {
      const mine = await itemIn(home, "FRIDGE");
      const rows = await asTenant(null, async (client) => {
        const result = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM inventory_item_moves`,
        );
        return result.rows;
      });
      expect(rows).toEqual([]);

      const error = await captureError(() =>
        asTenant(null, (client) =>
          moveItem(client, home.householdId, mine.itemId, {
            toLocation: "PANTRY",
            idempotencyKey: "no-context",
            actorUserId: home.userId,
          }),
        ),
      );
      expect(error).toBeInstanceOf(InventoryItemNotVisibleError);
      expect(await movesOf(mine.itemId)).toEqual([]);
      expect(await locationOf(mine.itemId)).toBe("FRIDGE");
    });
  });

  describe("concurrency", () => {
    it("a move that waited on the item lock is stamped after the move it waited for (clock_timestamp, not now)", async () => {
      // E begins its transaction first, then F moves the item and holds the
      // lock, then E tries to move the same item and blocks until F commits.
      // With DEFAULT now() E would carry its earlier transaction start and sort
      // before F: the history would list the chain out of order and the
      // create-replay LATERAL would pick the wrong "first move".
      const item = await itemIn(home, "FRIDGE");
      let eReady: () => void = () => {};
      let fHolds: () => void = () => {};
      const eReadyP = new Promise<void>((resolve) => (eReady = resolve));
      const fHoldsP = new Promise<void>((resolve) => (fHolds = resolve));
      const sleep = (ms: number): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, ms));

      const e = asTenant(home.householdId, async (client) => {
        await client.query("SELECT 1");
        eReady();
        await fHoldsP;
        return moveItem(client, home.householdId, item.itemId, {
          toLocation: "FREEZER",
          idempotencyKey: "order-e",
          actorUserId: home.userId,
        });
      });
      const f = asTenant(home.householdId, async (client) => {
        await eReadyP;
        const result = await moveItem(client, home.householdId, item.itemId, {
          toLocation: "PANTRY",
          idempotencyKey: "order-f",
          actorUserId: home.userId,
        });
        fHolds();
        // Hold the lock until E is well into its blocked move.
        await sleep(600);
        return result;
      });
      await Promise.all([e, f]);

      const rows = await movesOf(item.itemId);
      expect(rows.map((row) => [row.client_key, row.from_location, row.to_location])).toEqual([
        ["order-f", "FRIDGE", "PANTRY"],
        ["order-e", "PANTRY", "FREEZER"],
      ]);
      const times = rows.map((row) => row.occurred_at.getTime());
      expect(times[0]).toBeLessThanOrEqual(times[1] ?? 0);
    });

    it("two different moves of one item serialise on the item lock: one wins, the other reads the new location", async () => {
      const item = await itemIn(home, "FRIDGE");
      const results = await Promise.allSettled([
        move(home, item.itemId, "PANTRY", "race-a"),
        move(home, item.itemId, "PANTRY", "race-b"),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SameLocationError);
      expect(await movesOf(item.itemId)).toHaveLength(1);
    });

    it("two retries of one move under one key record exactly one row and both succeed", async () => {
      const item = await itemIn(home, "FRIDGE");
      const results = await Promise.all([
        move(home, item.itemId, "PANTRY", "retry-key"),
        move(home, item.itemId, "PANTRY", "retry-key"),
      ]);
      expect(results.map((result) => result.moved).sort()).toEqual([false, true]);
      expect(await movesOf(item.itemId)).toHaveLength(1);
      expect(results[0]?.detail).toEqual(results[1]?.detail);
    });
  });

  describe("a retried item create still recognises itself after the item has moved", () => {
    it("replays the create (no new item, no refusal) once the item lives somewhere else", async () => {
      const command = {
        idempotencyKey: "create-then-move",
        source: "MANUAL" as const,
        displayName: "Corn",
        storageLocation: "FRIDGE" as const,
        unit: "each",
        amount: "3",
        quantityProvenance: {
          tier: "KNOWN_FACT" as const,
          source: null,
          confidence: null,
          recordedAt: null,
        },
        recordedAt: "2026-10-01T12:00:00.000Z",
        actorUserId: home.userId,
      };
      const ids = { itemId: randomUUID(), lotId: randomUUID() };
      const created = await asTenant(home.householdId, (client) =>
        createInventoryItemWithStock(client, home.householdId, command, ids),
      );
      expect(created.replayed).toBe(false);

      await move(home, ids.itemId, "PANTRY");
      await move(home, ids.itemId, "FREEZER");

      const replay = await asTenant(home.householdId, (client) =>
        createInventoryItemWithStock(client, home.householdId, command, {
          itemId: randomUUID(),
          lotId: randomUUID(),
        }),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.summary.itemId).toBe(ids.itemId);
      // The replay reports the item as it is now.
      expect(replay.summary.storageLocation).toBe("FREEZER");

      // A create with the same key but a different location is still a conflict.
      const conflict = await captureError(() =>
        asTenant(home.householdId, (client) =>
          createInventoryItemWithStock(
            client,
            home.householdId,
            { ...command, storageLocation: "PANTRY" },
            { itemId: randomUUID(), lotId: randomUUID() },
          ),
        ),
      );
      expect((conflict as LedgerWriteRejectedError).ledgerError.code).toBe(
        "IDEMPOTENCY_KEY_CONFLICT",
      );
    });
  });

  describe("migration 0011 rolls back and forward with moves present", () => {
    it("drops the table, leaves the ledger and the item locations as they were, and comes back empty", async () => {
      const scratch = await createTestDatabase("m2t6-moves-migration");
      try {
        const household = await seedHousehold(scratch.pool, "Scratch");
        const item = await seedItem(scratch.pool, household.householdId, "lb", "FRIDGE");
        await insertRawTransaction(scratch.pool, {
          householdId: household.householdId,
          itemId: item.itemId,
          lotId: item.lotId,
          userId: household.userId,
        });
        await withHouseholdTransaction(
          scratch.pool,
          household.householdId,
          (client) =>
            moveItem(client, household.householdId, item.itemId, {
              toLocation: "PANTRY",
              idempotencyKey: "before-rollback",
              actorUserId: household.userId,
            }),
          { assumeRole: APP_ROLE },
        );
        const ledgerBefore = await scratch.pool.query<{ json: string }>(
          `SELECT row_to_json(t)::text AS json FROM inventory_transactions AS t ORDER BY id`,
        );

        const tables = async (): Promise<number> => {
          const result = await scratch.pool.query<{ tables: string }>(
            `SELECT count(*)::text AS tables FROM pg_class WHERE relname = 'inventory_item_moves'`,
          );
          return Number(result.rows[0]?.tables ?? "0");
        };
        expect(await tables()).toBe(1);

        const after = migrationsAfter(11);
        const reverted = await migrateDown(scratch.url, after.length + 1);
        expect(reverted).toEqual([...after].reverse().concat("0011_inventory_item_moves"));
        expect(await tables()).toBe(0);
        const ledgerDown = await scratch.pool.query<{ json: string }>(
          `SELECT row_to_json(t)::text AS json FROM inventory_transactions AS t ORDER BY id`,
        );
        expect(ledgerDown.rows).toEqual(ledgerBefore.rows);
        // The move's effect on the item stays; only its record is gone.
        const location = await scratch.pool.query<{ storage_location: string }>(
          `SELECT storage_location FROM inventory_items WHERE id = $1`,
          [item.itemId],
        );
        expect(location.rows[0]?.storage_location).toBe("PANTRY");

        const applied = await migrateUp(scratch.url);
        expect(applied).toEqual(["0011_inventory_item_moves", ...after]);
        expect(await tables()).toBe(1);
        const moves = await scratch.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM inventory_item_moves`,
        );
        expect(moves.rows[0]?.count).toBe("0");
      } finally {
        await scratch.drop();
      }
    });
  });
});
