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
      // M2-T5 (migration 0010): `inventory_confirmations` now references this
      // table, so a plain TRUNCATE is refused by the foreign-key check before
      // the trigger is reached. Still refused, same code. `CASCADE` is the
      // form that gets past that check, so it is the one that proves the
      // ledger's own trigger still holds; both are asserted.
      const plain = pgFailure(
        await captureError(() => db.pool.query(`TRUNCATE inventory_transactions`)),
      );
      expect(plain.code).toBe("0A000");

      const failure = pgFailure(
        await captureError(() => db.pool.query(`TRUNCATE inventory_transactions CASCADE`)),
      );
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/inventory_transactions is append-only \(INV-LEDGER-2/);
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

  /**
   * M2-T5 (D-028): a confirmation is a fact about a ledger row, so it gets the
   * ledger's own two layers. The table holds one row confirming an
   * AI-interpreted transaction written for this block alone.
   */
  describe("inventory_confirmations is append-only too (D-028)", () => {
    let aiItem: SeededItem;

    beforeAll(async () => {
      aiItem = await seedItem(db.pool, household.householdId);
      await insertRawTransaction(
        db.pool,
        {
          householdId: household.householdId,
          itemId: aiItem.itemId,
          lotId: aiItem.lotId,
          userId: household.userId,
        },
        { provenance_tier: "AI_INTERPRETATION", provenance_source: "receipt read" },
      );
      await db.pool.query(
        `INSERT INTO inventory_confirmations
                (household_id, item_id, transaction_id, confirmed_by, client_key)
         SELECT household_id, item_id, id, $2, 'append-only-probe'
           FROM inventory_transactions WHERE item_id = $1`,
        [aiItem.itemId, household.userId],
      );
    });

    it("holds exactly INSERT and SELECT on inventory_confirmations", async () => {
      const grants = await db.pool.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.role_table_grants
          WHERE grantee = $1 AND table_name = 'inventory_confirmations'
          ORDER BY privilege_type`,
        [APP_ROLE],
      );
      expect(grants.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    });

    it.each([
      ["UPDATE", `UPDATE inventory_confirmations SET client_key = 'edited' WHERE item_id = $1`],
      ["DELETE", `DELETE FROM inventory_confirmations WHERE item_id = $1`],
    ])("refuses a %s as sk_app", async (_op, sql) => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) => client.query(sql, [aiItem.itemId]),
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
            (client) => client.query(`TRUNCATE inventory_confirmations`),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it.each([
      [
        "UPDATE",
        `UPDATE inventory_confirmations SET client_key = 'edited' WHERE item_id = $1`,
        [] as string[],
      ],
      ["DELETE", `DELETE FROM inventory_confirmations WHERE item_id = $1`, [] as string[]],
    ])("refuses a %s as the owner", async (op, sql) => {
      const failure = pgFailure(await captureError(() => db.pool.query(sql, [aiItem.itemId])));
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/inventory_confirmations is append-only/);
      expect(failure.message).toContain(`${op} is not permitted`);
    });

    it("refuses a TRUNCATE as the owner", async () => {
      const failure = pgFailure(
        await captureError(() => db.pool.query(`TRUNCATE inventory_confirmations`)),
      );
      expect(failure.code).toBe("0A000");
      expect(failure.message).toMatch(/TRUNCATE is not permitted/);
    });

    it("leaves the confirmation untouched after every refused attempt", async () => {
      const stored = await db.pool.query<{ count: string; client_key: string }>(
        `SELECT count(*)::text AS count, min(client_key) AS client_key
           FROM inventory_confirmations WHERE item_id = $1`,
        [aiItem.itemId],
      );
      expect(stored.rows[0]).toEqual({ count: "1", client_key: "append-only-probe" });
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
