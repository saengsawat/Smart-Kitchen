/**
 * Append-only enforcement (M1-T2; INV-LEDGER-2, ADR-008, data-model.md §2).
 *
 * The ledger is the system's memory. A row that can be edited is not a fact,
 * and every explanation the product owes a user ("why does the app think you
 * have 1.25 lb of chicken?") is only as trustworthy as the impossibility of
 * quietly rewriting history.
 *
 * Two independent mechanisms are asserted here, because either one alone is a
 * single point of failure:
 *
 * 1. **Privileges.** `sk_app` is granted INSERT and SELECT and nothing else, so
 *    the runtime role cannot express an UPDATE or DELETE at all.
 * 2. **Triggers.** Even a role that *does* hold those privileges — the owner, a
 *    migration, a future maintenance job — is refused.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const SUITE = "inventory ledger is append-only";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;
  let item: SeededItem;

  beforeAll(async () => {
    db = await createTestDatabase("append_only");
    household = await seedHousehold(db.pool, "Append only");
    item = await seedItem(db.pool, household.householdId);
    await insertRawTransaction(db.pool, {
      householdId: household.householdId,
      itemId: item.itemId,
      lotId: item.lotId,
      userId: household.userId,
    });
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  describe("the runtime role has no way to express a mutation", () => {
    it("holds exactly INSERT and SELECT on inventory_transactions", async () => {
      const grants = await db.pool.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.role_table_grants
          WHERE grantee = $1 AND table_name = 'inventory_transactions'
          ORDER BY privilege_type`,
        [APP_ROLE],
      );
      expect(grants.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    });

    it("refuses an UPDATE as sk_app", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) =>
              client.query(
                `UPDATE inventory_transactions SET qty_delta_micros = 1 WHERE item_id = $1`,
                [item.itemId],
              ),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it("refuses a DELETE as sk_app", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) =>
              client.query(`DELETE FROM inventory_transactions WHERE item_id = $1`, [item.itemId]),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it("refuses a TRUNCATE as sk_app", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) => client.query(`TRUNCATE inventory_transactions`),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it("still allows the writes it is supposed to make", async () => {
      const rows = await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertRawTransaction(
            client,
            {
              householdId: household.householdId,
              itemId: item.itemId,
              lotId: item.lotId,
              userId: household.userId,
            },
            { sequence: 2, idempotency_key: "as-sk-app" },
          );
          const result = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
            [item.itemId],
          );
          return result.rows[0]?.count;
        },
        { assumeRole: APP_ROLE },
      );
      expect(rows).toBe("2");
    });
  });

  describe("even a privileged role is refused", () => {
    it("refuses an UPDATE as the owner", async () => {
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(`UPDATE inventory_transactions SET reason = 'edited' WHERE item_id = $1`, [
            item.itemId,
          ]),
        ),
      );
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/append-only \(INV-LEDGER-2/);
      expect(failure.message).toMatch(/UPDATE is not permitted/);
    });

    it("refuses a DELETE as the owner", async () => {
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(`DELETE FROM inventory_transactions WHERE item_id = $1`, [item.itemId]),
        ),
      );
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/DELETE is not permitted/);
    });

    it("refuses a TRUNCATE as the owner", async () => {
      const failure = pgFailure(
        await captureError(() => db.pool.query(`TRUNCATE inventory_transactions`)),
      );
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/TRUNCATE is not permitted/);
    });

    it("leaves the history untouched after every refused attempt", async () => {
      const stored = await db.pool.query<{ count: string; reason: string | null }>(
        `SELECT count(*)::text AS count, min(reason) AS reason
           FROM inventory_transactions WHERE item_id = $1`,
        [item.itemId],
      );
      expect(stored.rows[0]?.count).toBe("2");
      expect(stored.rows[0]?.reason).toBeNull();
    });
  });

  describe("snapshot columns are out of the runtime role's reach", () => {
    it("grants sk_app UPDATE only on item metadata columns", async () => {
      const grants = await db.pool.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.column_privileges
          WHERE grantee = $1 AND table_name = 'inventory_items' AND privilege_type = 'UPDATE'
          ORDER BY column_name`,
        [APP_ROLE],
      );
      expect(grants.rows.map((row) => row.column_name)).toEqual([
        "display_name",
        "ingredient_ref",
        "product_ref",
        "storage_location",
      ]);
    });

    it("refuses a snapshot edit as sk_app before any trigger is consulted", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) =>
              client.query(`UPDATE inventory_items SET current_qty_micros = 0 WHERE id = $1`, [
                item.itemId,
              ]),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(failure.message).toMatch(/permission denied/i);
    });
  });
});
