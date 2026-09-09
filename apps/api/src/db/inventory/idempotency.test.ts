/**
 * Idempotency and concurrency at the database boundary (M1-T2; INV-LEDGER-3,
 * data-model.md §6).
 *
 * The scope of the unique index is an architect ruling (M1-T1 §8.1):
 * **`(household_id, idempotency_key)`**, deliberately stronger than the
 * domain's per-item uniqueness. A receipt or meal batch fans out across many
 * items, and a key that is only unique per item cannot stop the same receipt
 * line being applied to two of them. Batch writers suffix per line; the price
 * is that a caller reusing a key across items is rejected rather than accepted,
 * which is the safe direction for a rule whose whole job is "a retried command
 * must not double-consume".
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TransactionInput } from "@smart-kitchen/domain";
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
} from "../test-support/inventory-fixtures.js";
import { appendTransactionToDb, insertInventoryItem, loadInventoryItem } from "./repository.js";

const SUITE = "INV-LEDGER-3 — idempotency keys at the database";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let alpha: SeededHousehold;
  let beta: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("idempotency");
    alpha = await seedHousehold(db.pool, "Alpha");
    beta = await seedHousehold(db.pool, "Beta");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  function purchase(lotId: string, key: string, qty = 1): TransactionInput {
    return {
      lotId,
      type: "PURCHASE",
      qtyDelta: qty,
      unit: UNIT,
      actor: { kind: "user", userId: alpha.userId },
      occurredAt: "2026-03-06T18:00:00.000Z",
      recordedAt: "2026-03-06T18:00:01.000Z",
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: key,
    };
  }

  /** Creates an item with one lot through the repository, as `sk_app`. */
  async function newItem(household: SeededHousehold): Promise<{ itemId: string; lotId: string }> {
    const itemId = randomUUID();
    const lotId = randomUUID();
    await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        const created = await insertInventoryItem(client, {
          itemId,
          householdId: household.householdId,
          unit: UNIT,
          lots: [{ lotId }],
        });
        expect(created.ok).toBe(true);
      },
      { assumeRole: APP_ROLE },
    );
    return { itemId, lotId };
  }

  describe("the unique index", () => {
    it("is scoped to (household_id, idempotency_key)", async () => {
      const index = await db.pool.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conname = 'inventory_transactions_idempotency_key'`,
      );
      expect(index.rows[0]?.definition).toBe("UNIQUE (household_id, idempotency_key)");
    });

    it("rejects the same key on two different items in one household", async () => {
      const first = await seedItem(db.pool, alpha.householdId);
      const second = await seedItem(db.pool, alpha.householdId);
      const key = `shared-${randomUUID()}`;

      await insertRawTransaction(
        db.pool,
        {
          householdId: alpha.householdId,
          itemId: first.itemId,
          lotId: first.lotId,
          userId: alpha.userId,
        },
        { idempotency_key: key },
      );

      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(
            db.pool,
            {
              householdId: alpha.householdId,
              itemId: second.itemId,
              lotId: second.lotId,
              userId: alpha.userId,
            },
            { idempotency_key: key },
          ),
        ),
      );
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("inventory_transactions_idempotency_key");
    });

    it("allows the same key in two different households", async () => {
      const key = `same-key-${randomUUID()}`;
      const alphaItem = await seedItem(db.pool, alpha.householdId);
      const betaItem = await seedItem(db.pool, beta.householdId);

      await insertRawTransaction(
        db.pool,
        {
          householdId: alpha.householdId,
          itemId: alphaItem.itemId,
          lotId: alphaItem.lotId,
          userId: alpha.userId,
        },
        { idempotency_key: key },
      );
      await insertRawTransaction(
        db.pool,
        {
          householdId: beta.householdId,
          itemId: betaItem.itemId,
          lotId: betaItem.lotId,
          userId: beta.userId,
        },
        { idempotency_key: key },
      );

      const rows = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions WHERE idempotency_key = $1`,
        [key],
      );
      expect(rows.rows[0]?.count).toBe("2");
    });
  });

  describe("through the write path", () => {
    it("replays an identical payload as a no-op", async () => {
      const { itemId, lotId } = await newItem(alpha);
      const key = `replay-${randomUUID()}`;

      for (const attempt of [1, 2, 3]) {
        const status = await withHouseholdTransaction(
          db.pool,
          alpha.householdId,
          async (client) => {
            const result = await appendTransactionToDb(
              client,
              alpha.householdId,
              itemId,
              purchase(lotId, key, 2),
            );
            expect(result.ok).toBe(true);
            return result.ok ? result.value.status : "error";
          },
          { assumeRole: APP_ROLE },
        );
        expect(status, `attempt ${String(attempt)}`).toBe(attempt === 1 ? "appended" : "duplicate");
      }

      const stored = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        (client) => loadInventoryItem(client, alpha.householdId, itemId),
        { assumeRole: APP_ROLE },
      );
      expect(stored.ok).toBe(true);
      if (stored.ok) {
        expect(stored.value.transactions).toHaveLength(1);
        expect(stored.value.currentQty.micros).toBe(2_000_000n);
      }
    });

    it("rejects a key reused for a materially different payload", async () => {
      const { itemId, lotId } = await newItem(alpha);
      const key = `conflict-${randomUUID()}`;

      await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        (client) =>
          appendTransactionToDb(client, alpha.householdId, itemId, purchase(lotId, key, 1)),
        { assumeRole: APP_ROLE },
      );

      const verdict = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        async (client) => {
          const result = await appendTransactionToDb(
            client,
            alpha.householdId,
            itemId,
            purchase(lotId, key, 5),
          );
          expect(result.ok).toBe(true);
          return result.ok ? result.value : undefined;
        },
        { assumeRole: APP_ROLE },
      );
      expect(verdict?.status).toBe("rejected");
      if (verdict?.status === "rejected") {
        expect(verdict.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      }
    });

    it("surfaces the database's stronger scope as the same typed conflict", async () => {
      // The domain would accept this — the key is unused on *this* item — and
      // the household-scoped index refuses it. The write path must translate
      // that into the domain's own error rather than leaking a driver failure.
      const first = await newItem(alpha);
      const second = await newItem(alpha);
      const key = `cross-item-${randomUUID()}`;

      await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        (client) =>
          appendTransactionToDb(
            client,
            alpha.householdId,
            first.itemId,
            purchase(first.lotId, key),
          ),
        { assumeRole: APP_ROLE },
      );

      const verdict = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        async (client) => {
          const result = await appendTransactionToDb(
            client,
            alpha.householdId,
            second.itemId,
            purchase(second.lotId, key),
          );
          expect(result.ok).toBe(true);
          return result.ok ? result.value : undefined;
        },
        { assumeRole: APP_ROLE },
      );
      expect(verdict?.status).toBe("rejected");
      if (verdict?.status === "rejected") {
        expect(verdict.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      }

      const stored = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
        [second.itemId],
      );
      expect(stored.rows[0]?.count).toBe("0");
    });
  });

  describe("concurrent appends to one item", () => {
    it("serialise on the item lock and both land, in order", async () => {
      const { itemId, lotId } = await newItem(alpha);
      const keyA = `race-a-${randomUUID()}`;
      const keyB = `race-b-${randomUUID()}`;

      const append = (key: string): Promise<string> =>
        withHouseholdTransaction(
          db.pool,
          alpha.householdId,
          async (client) => {
            const result = await appendTransactionToDb(
              client,
              alpha.householdId,
              itemId,
              purchase(lotId, key, 1),
            );
            expect(result.ok).toBe(true);
            return result.ok ? result.value.status : "error";
          },
          { assumeRole: APP_ROLE },
        );

      // Both compute against the same "before" state unless the SELECT … FOR
      // UPDATE in the write path actually serialises them.
      const [statusA, statusB] = await Promise.all([append(keyA), append(keyB)]);
      expect([statusA, statusB]).toEqual(["appended", "appended"]);

      const stored = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        (client) => loadInventoryItem(client, alpha.householdId, itemId),
        { assumeRole: APP_ROLE },
      );
      expect(stored.ok).toBe(true);
      if (stored.ok) {
        expect(stored.value.transactions.map((row) => row.sequence)).toEqual([1, 2]);
        expect(stored.value.currentQty.micros).toBe(2_000_000n);
        expect(stored.value.nextSequence).toBe(3);
      }
    });
  });
});
