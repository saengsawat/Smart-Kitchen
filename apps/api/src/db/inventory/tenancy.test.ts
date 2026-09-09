/**
 * INV-TENANT-1 at the database boundary (M1-T2; NFR-1, data-model.md §5).
 *
 * "Household A can never read/write household B data." The endpoint-level half
 * of that invariant arrives with M2's authz matrix; this file is the half that
 * holds *even if the application layer is wrong* — row-level security keyed on
 * a per-request `app.household_id`, exercised as the real runtime role.
 *
 * This suite is the evidence for ADR-003's open RLS question.
 *
 * Every negative assertion is paired with a positive control. A test proving
 * "household A sees no rows" is worthless if the reason is a typo — so each one
 * first shows the owner *can* see both households' rows, and that A can see its
 * own.
 */

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
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

const SUITE = "INV-TENANT-1 — household isolation at the database";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let alpha: SeededHousehold;
  let beta: SeededHousehold;
  let alphaItem: SeededItem;
  let betaItem: SeededItem;

  /** Runs SQL as `sk_app` with household context established. */
  async function asHousehold<T extends QueryResultRow>(
    householdId: string | null,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return withHouseholdTransaction(
      db.pool,
      householdId,
      async (client) => {
        const result = await client.query<T>(sql, [...params]);
        return result.rows;
      },
      { assumeRole: APP_ROLE },
    );
  }

  beforeAll(async () => {
    db = await createTestDatabase("tenancy");
    alpha = await seedHousehold(db.pool, "Alpha");
    beta = await seedHousehold(db.pool, "Beta");
    alphaItem = await seedItem(db.pool, alpha.householdId);
    betaItem = await seedItem(db.pool, beta.householdId);
    await insertRawTransaction(db.pool, {
      householdId: alpha.householdId,
      itemId: alphaItem.itemId,
      lotId: alphaItem.lotId,
      userId: alpha.userId,
    });
    await insertRawTransaction(db.pool, {
      householdId: beta.householdId,
      itemId: betaItem.itemId,
      lotId: betaItem.lotId,
      userId: beta.userId,
    });
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  describe("positive controls", () => {
    it("the owner role sees both households (so the negatives below mean something)", async () => {
      const items = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_items`,
      );
      expect(items.rows[0]?.count).toBe("2");
      const transactions = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions`,
      );
      expect(transactions.rows[0]?.count).toBe("2");
    });

    it("household Alpha sees its own item", async () => {
      const rows = await asHousehold<{ id: string }>(
        alpha.householdId,
        `SELECT id FROM inventory_items`,
      );
      expect(rows.map((row) => row.id)).toEqual([alphaItem.itemId]);
    });
  });

  describe("reads", () => {
    it("cannot see another household's items", async () => {
      const rows = await asHousehold<{ id: string }>(
        alpha.householdId,
        `SELECT id FROM inventory_items WHERE id = $1`,
        [betaItem.itemId],
      );
      expect(rows).toEqual([]);
    });

    it("cannot see another household's lots", async () => {
      const rows = await asHousehold<{ id: string }>(
        alpha.householdId,
        `SELECT id FROM inventory_lots WHERE id = $1`,
        [betaItem.lotId],
      );
      expect(rows).toEqual([]);
    });

    it("cannot see another household's ledger rows", async () => {
      const rows = await asHousehold<{ id: string }>(
        alpha.householdId,
        `SELECT id FROM inventory_transactions WHERE item_id = $1`,
        [betaItem.itemId],
      );
      expect(rows).toEqual([]);
    });

    it("cannot see another household itself, or its memberships", async () => {
      const households = await asHousehold<{ id: string }>(
        alpha.householdId,
        `SELECT id FROM households`,
      );
      expect(households.map((row) => row.id)).toEqual([alpha.householdId]);

      const memberships = await asHousehold<{ user_id: string }>(
        alpha.householdId,
        `SELECT user_id FROM household_memberships`,
      );
      expect(memberships.map((row) => row.user_id)).toEqual([alpha.userId]);
    });

    it("cannot see users outside the current household", async () => {
      const users = await asHousehold<{ id: string }>(alpha.householdId, `SELECT id FROM users`);
      expect(users.map((row) => row.id)).toEqual([alpha.userId]);
    });

    it("cannot reach another household's rows through the reconciliation views", async () => {
      // A view runs as its *owner* unless created with security_invoker, which
      // would have made these views a clean read straight past every policy.
      const options = await db.pool.query<{ relname: string; reloptions: string[] | null }>(
        `SELECT relname, reloptions FROM pg_class
          WHERE relname IN ('inventory_reconciliation', 'inventory_lot_reconciliation')
          ORDER BY relname`,
      );
      for (const row of options.rows) {
        expect(row.reloptions, `${row.relname} must be security_invoker`).toContain(
          "security_invoker=true",
        );
      }

      const rows = await asHousehold<{ item_id: string }>(
        alpha.householdId,
        `SELECT item_id FROM inventory_reconciliation`,
      );
      expect(rows.map((row) => row.item_id)).toEqual([alphaItem.itemId]);

      const lotRows = await asHousehold<{ lot_id: string }>(
        alpha.householdId,
        `SELECT lot_id FROM inventory_lot_reconciliation`,
      );
      expect(lotRows.map((row) => row.lot_id)).toEqual([alphaItem.lotId]);
    });

    it("aggregate queries cannot count what they cannot see", async () => {
      // The subtle leak: `SELECT sum(...)` returns a number, not rows, so a
      // policy that only filtered `SELECT *` would leak totals.
      const totals = await asHousehold<{ total: string | null }>(
        alpha.householdId,
        `SELECT sum(qty_delta_micros)::text AS total FROM inventory_transactions`,
      );
      expect(totals[0]?.total).toBe("2000000");
    });
  });

  describe("writes", () => {
    it("cannot insert an item into another household", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asHousehold(
            alpha.householdId,
            `INSERT INTO inventory_items (id, household_id, unit) VALUES ($1, $2, 'lb')`,
            [randomUUID(), beta.householdId],
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(failure.message).toMatch(/row-level security policy/);
    });

    it("cannot insert a ledger row into another household", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            alpha.householdId,
            (client) =>
              insertRawTransaction(client, {
                householdId: beta.householdId,
                itemId: betaItem.itemId,
                lotId: betaItem.lotId,
                userId: beta.userId,
              }),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(failure.message).toMatch(/row-level security policy/);
    });

    it("cannot attach its own household id to another household's item", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            alpha.householdId,
            (client) =>
              insertRawTransaction(client, {
                householdId: alpha.householdId,
                itemId: betaItem.itemId,
                lotId: betaItem.lotId,
                userId: alpha.userId,
              }),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      // Relabelling the row to pass the policy does not help: the composite
      // foreign key requires the item to actually live in that household, and
      // it does not.
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_transactions_item_unit_fkey");
    });

    /**
     * Regression, reviewer finding F2. `UNIQUE(item_id, sequence)` was not
     * household-scoped, and unique indexes are checked before foreign keys and
     * AFTER-triggers — so walking the sequence number upward against another
     * household's item flipped from duplicate-key to foreign-key violation
     * exactly at that ledger's length, reporting how much history the other
     * household has. The key now leads with `household_id`, so a foreign
     * item's rows are uncollidable and every probe fails identically.
     */
    it("gives away nothing about another household's ledger length", async () => {
      const probe = async (itemId: string, lotId: string, sequence: number): Promise<string> => {
        const failure = pgFailure(
          await captureError(() =>
            withHouseholdTransaction(
              db.pool,
              alpha.householdId,
              (client) =>
                insertRawTransaction(
                  client,
                  {
                    householdId: alpha.householdId,
                    itemId,
                    lotId,
                    userId: alpha.userId,
                  },
                  { sequence, idempotency_key: `probe-${randomUUID()}` },
                ),
              { assumeRole: APP_ROLE },
            ),
          ),
        );
        return `${failure.code ?? "?"}/${failure.constraint ?? "?"}`;
      };

      // Beta's item has exactly one transaction, so a leak would show up as a
      // change in the answer somewhere around sequence 1–2.
      const againstBeta = await Promise.all(
        [1, 2, 3, 4].map((sequence) => probe(betaItem.itemId, betaItem.lotId, sequence)),
      );
      const againstNothing = await probe(randomUUID(), randomUUID(), 1);

      // Every probe answers the same way, and the same way as a UUID that
      // simply does not exist: the response distinguishes nothing.
      expect(new Set(againstBeta).size, `varied by sequence: ${againstBeta.join(", ")}`).toBe(1);
      expect(againstBeta[0]).toBe(againstNothing);
      expect(againstNothing).toBe("23503/inventory_transactions_item_unit_fkey");
    });

    it("cannot update another household's item metadata", async () => {
      await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        async (client) => {
          const result = await client.query(
            `UPDATE inventory_items SET display_name = 'stolen' WHERE id = $1`,
            [betaItem.itemId],
          );
          // Invisible rows are not "denied", they simply are not there.
          expect(result.rowCount).toBe(0);
        },
        { assumeRole: APP_ROLE },
      );

      const stored = await db.pool.query<{ display_name: string | null }>(
        `SELECT display_name FROM inventory_items WHERE id = $1`,
        [betaItem.itemId],
      );
      expect(stored.rows[0]?.display_name).toBeNull();
    });
  });

  describe("failing closed", () => {
    it("sees nothing at all when no household context is established", async () => {
      const items = await asHousehold<{ id: string }>(null, `SELECT id FROM inventory_items`);
      expect(items).toEqual([]);
      const transactions = await asHousehold<{ id: string }>(
        null,
        `SELECT id FROM inventory_transactions`,
      );
      expect(transactions).toEqual([]);
      const households = await asHousehold<{ id: string }>(null, `SELECT id FROM households`);
      expect(households).toEqual([]);
    });

    it("cannot write anything when no household context is established", async () => {
      const failure = pgFailure(
        await captureError(() =>
          asHousehold(
            null,
            `INSERT INTO inventory_items (id, household_id, unit) VALUES ($1, $2, 'lb')`,
            [randomUUID(), alpha.householdId],
          ),
        ),
      );
      expect(failure.code).toBe("42501");
    });

    it("does not leak context between pooled transactions", async () => {
      // `set_config(..., true)` is transaction-local; if it were session-level
      // the next borrower of this connection would inherit Alpha's household.
      await asHousehold(alpha.householdId, `SELECT 1`);
      const leaked = await withHouseholdTransaction(
        db.pool,
        null,
        async (client) => {
          const result = await client.query<{ household: string | null }>(
            `SELECT app_current_household()::text AS household`,
          );
          return result.rows[0]?.household;
        },
        { assumeRole: APP_ROLE },
      );
      expect(leaked).toBeNull();
    });
  });

  describe("policy coverage", () => {
    it("protects every household-scoped table", async () => {
      const protectedTables = await db.pool.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          ORDER BY c.relname`,
      );
      expect(protectedTables.rows.map((row) => row.relname)).toEqual([
        "household_memberships",
        "households",
        "inventory_items",
        "inventory_lots",
        "inventory_transactions",
        "users",
      ]);
    });
  });
});
