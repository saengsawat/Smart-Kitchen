/**
 * What the schema refuses on its own (M1-T2, testing-strategy.md §1
 * "Database tests: constraints").
 *
 * Every row here is written with raw SQL, bypassing the domain entirely. That
 * is the point: these assertions describe the guarantees that survive a bug in
 * the application, a hand-written backfill, or a future write path that has not
 * been invented yet.
 *
 * What stays application-enforced, and why, is asserted at the bottom of the
 * file so the boundary is written down rather than assumed.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
  seedLot,
  type RawTransactionContext,
  type SeededItem,
} from "../test-support/inventory-fixtures.js";

const SUITE = "inventory schema constraints";
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

  beforeAll(async () => {
    db = await createTestDatabase("constraints");
    household = await seedHousehold(db.pool, "Constraints");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  /** A fresh item + lot per test, so no test depends on another's balance. */
  async function context(unit = "lb"): Promise<RawTransactionContext & SeededItem> {
    const item = await seedItem(db.pool, household.householdId, unit);
    return { ...item, householdId: household.householdId, userId: household.userId, unit };
  }

  describe("quantity", () => {
    it("rejects a zero delta", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            type: "ADJUSTMENT",
            qty_delta: "0",
            qty_delta_micros: "0",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_qty_nonzero");
    });

    it("rejects the two delta representations disagreeing", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, { qty_delta: "2", qty_delta_micros: "3000000" }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_qty_forms_agree");
    });

    it("rejects a delta beyond the exactly-representable range", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            qty_delta: "100000000.000001",
            qty_delta_micros: "100000000000001",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_qty_range");
    });

    it("accepts the largest exactly-representable delta", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        qty_delta: "100000000",
        qty_delta_micros: "100000000000000",
      });
      const stored = await db.pool.query<{ qty_delta_micros: string }>(
        `SELECT qty_delta_micros FROM inventory_transactions WHERE item_id = $1`,
        [ctx.itemId],
      );
      expect(stored.rows[0]?.qty_delta_micros).toBe("100000000000000");
    });

    it("keeps six decimal places exactly", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        qty_delta: "0.000001",
        qty_delta_micros: "1",
      });
      const stored = await db.pool.query<{ qty_delta: string; current: string }>(
        `SELECT t.qty_delta, i.current_qty_micros AS current
           FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
          WHERE t.item_id = $1`,
        [ctx.itemId],
      );
      expect(stored.rows[0]?.qty_delta).toBe("0.000001");
      expect(stored.rows[0]?.current).toBe("1");
    });
  });

  describe("sign by transaction type", () => {
    it("rejects a PURCHASE that removes stock", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            type: "PURCHASE",
            qty_delta: "-1",
            qty_delta_micros: "-1000000",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_sign_by_type");
    });

    it("rejects a CONSUME that adds stock", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            type: "CONSUME",
            qty_delta: "1",
            qty_delta_micros: "1000000",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_sign_by_type");
    });

    it("allows ADJUSTMENT in either direction", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        type: "ADJUSTMENT",
        qty_delta: "3",
        qty_delta_micros: "3000000",
      });
      await insertRawTransaction(db.pool, ctx, {
        sequence: 2,
        type: "ADJUSTMENT",
        qty_delta: "-1",
        qty_delta_micros: "-1000000",
      });
      const item = await db.pool.query<{ current_qty_micros: string }>(
        `SELECT current_qty_micros FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.current_qty_micros).toBe("2000000");
    });
  });

  describe("units", () => {
    it("rejects a transaction in a unit other than its item's", async () => {
      const ctx = await context("lb");
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, ctx, { unit: "kg" })),
      );
      // The unit travels inside the item foreign key, so a mixed unit is not a
      // policy violation — the row has nothing to reference.
      expect(failure.constraint).toBe("inventory_transactions_item_unit_fkey");
      expect(failure.code).toBe("23503");
    });

    it("refuses to change an item's unit once it exists", async () => {
      const ctx = await context("lb");
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(`UPDATE inventory_items SET unit = 'kg' WHERE id = $1`, [ctx.itemId]),
        ),
      );
      expect(failure.message).toMatch(/immutable/);
    });
  });

  describe("sequence", () => {
    it("rejects a sequence that is not the item's next", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, ctx, { sequence: 2 })),
      );
      expect(failure.message).toMatch(/is not item .* next sequence/);
      // Retryable: a concurrent append is the expected cause.
      expect(failure.code).toBe("40001");
    });

    it("rejects a repeated sequence on the same item", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, { sequence: 1 });
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, ctx, { sequence: 1 })),
      );
      // The unique index catches a repeat at insert time; the trigger's
      // next-sequence check (tested above) catches gaps, which an index cannot.
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("inventory_transactions_item_sequence_key");
    });

    it("advances next_sequence with every append", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, { sequence: 1 });
      await insertRawTransaction(db.pool, ctx, { sequence: 2 });
      await insertRawTransaction(db.pool, ctx, { sequence: 3 });
      const item = await db.pool.query<{ next_sequence: number }>(
        `SELECT next_sequence FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.next_sequence).toBe(4);
    });
  });

  describe("actor and provenance shape", () => {
    it("rejects a user actor with no user id", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, { actor_kind: "user", actor_user_id: null }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_actor_shape");
    });

    it("rejects a system actor that also claims a user", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            actor_kind: "system",
            actor_component: "inventory-ledger",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_actor_shape");
    });

    it("rejects an unknown provenance tier", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, ctx, { provenance_tier: "VIBES" })),
      );
      expect(failure.constraint).toBe("inventory_transactions_provenance_tier_check");
    });

    it("rejects a confidence outside 0..1", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, { provenance_confidence: "1.5" }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_provenance_confidence_check");
    });

    it("rejects a half-populated correlation reference", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, { correlation_kind: "receipt-line" }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_correlation_pair");
    });
  });

  describe("timestamps", () => {
    it("rejects recordedAt before occurredAt", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            occurred_at: "2026-03-06T18:00:05.000Z",
            recorded_at: "2026-03-06T18:00:00.000Z",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_time_order");
    });
  });

  describe("the unforgeable system marker", () => {
    it("rejects a caller-supplied system flag on an ordinary row", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            system_flag_kind: "OVER_CONSUMPTION",
            system_flag_residual_micros: "2000000",
            system_flag_caused_by_sequence: 0,
            system_flag_caused_by_idempotency_key: "whatever",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_reserved_marker");
    });

    it("rejects a caller key using the reserved separator", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, { idempotency_key: "batch::line-1" }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_reserved_marker");
    });

    it("rejects a clamp-suffixed key that is not ledger-authored", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            idempotency_key: "mine::over-consumption-clamp",
            type: "ADJUSTMENT",
            qty_delta: "5",
            qty_delta_micros: "5000000",
            system_flag_kind: "OVER_CONSUMPTION",
            system_flag_residual_micros: "5000000",
            system_flag_caused_by_sequence: 0,
            system_flag_caused_by_idempotency_key: "mine",
          }),
        ),
      );
      // actor is still `user`, so the row cannot be a ledger-authored clamp.
      expect(failure.constraint).toBe("inventory_transactions_reserved_marker");
    });

    it("rejects a clamp whose residual disagrees with its own delta", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        type: "PURCHASE",
        qty_delta: "5",
        qty_delta_micros: "5000000",
        idempotency_key: "stock-5",
      });
      await insertRawTransaction(db.pool, ctx, {
        sequence: 2,
        type: "CONSUME",
        qty_delta: "-2",
        qty_delta_micros: "-2000000",
        idempotency_key: "consume-2",
      });
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            sequence: 3,
            type: "ADJUSTMENT",
            qty_delta: "1",
            qty_delta_micros: "1000000",
            actor_kind: "system",
            actor_user_id: null,
            actor_component: "inventory-ledger",
            provenance_tier: "ESTIMATED",
            provenance_source: "inventory-ledger:over-consumption-clamp",
            reason: "over-consumption-clamp",
            idempotency_key: "consume-2::over-consumption-clamp",
            system_flag_kind: "OVER_CONSUMPTION",
            system_flag_residual_micros: "999",
            system_flag_caused_by_sequence: 2,
            system_flag_caused_by_idempotency_key: "consume-2",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_reserved_marker");
    });

    it("rejects a clamp with no transaction to compensate", async () => {
      const ctx = await context();
      // Sequence 1 so the trigger is satisfied; the cause key does not exist.
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            sequence: 1,
            type: "ADJUSTMENT",
            qty_delta: "1",
            qty_delta_micros: "1000000",
            actor_kind: "system",
            actor_user_id: null,
            actor_component: "inventory-ledger",
            idempotency_key: "ghost::over-consumption-clamp",
            system_flag_kind: "OVER_CONSUMPTION",
            system_flag_residual_micros: "1000000",
            system_flag_caused_by_sequence: 0,
            system_flag_caused_by_idempotency_key: "ghost",
          }),
        ),
      );
      expect(failure.constraint).toBe("inventory_transactions_clamp_cause_fkey");
    });
  });

  describe("never negative (INV-LEDGER-4)", () => {
    it("refuses to commit a decrease with no compensating clamp", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        type: "PURCHASE",
        qty_delta: "1",
        qty_delta_micros: "1000000",
      });
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            sequence: 2,
            type: "CONSUME",
            qty_delta: "-3",
            qty_delta_micros: "-3000000",
          }),
        ),
      );
      expect(failure.message).toMatch(/INV-LEDGER-4/);
    });

    it("allows the overshoot when its clamp lands in the same transaction", async () => {
      const ctx = await context();
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await insertRawTransaction(client, ctx, {
          sequence: 1,
          type: "PURCHASE",
          qty_delta: "1",
          qty_delta_micros: "1000000",
          idempotency_key: "buy-1",
        });
        await insertRawTransaction(client, ctx, {
          sequence: 2,
          type: "CONSUME",
          qty_delta: "-3",
          qty_delta_micros: "-3000000",
          idempotency_key: "eat-3",
        });
        await insertRawTransaction(client, ctx, {
          sequence: 3,
          type: "ADJUSTMENT",
          qty_delta: "2",
          qty_delta_micros: "2000000",
          actor_kind: "system",
          actor_user_id: null,
          actor_component: "inventory-ledger",
          provenance_tier: "ESTIMATED",
          provenance_source: "inventory-ledger:over-consumption-clamp",
          reason: "over-consumption-clamp",
          idempotency_key: "eat-3::over-consumption-clamp",
          system_flag_kind: "OVER_CONSUMPTION",
          system_flag_residual_micros: "2000000",
          system_flag_caused_by_sequence: 2,
          system_flag_caused_by_idempotency_key: "eat-3",
        });
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      const item = await db.pool.query<{ current_qty_micros: string }>(
        `SELECT current_qty_micros FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.current_qty_micros).toBe("0");
    });

    /**
     * Runs the over-consumption repro as `sk_app`: append a decrease that
     * overshoots with no clamp, tamper with the request's household context,
     * then try to commit. Returns the error COMMIT raised, or `undefined` if
     * it succeeded — which would mean a negative balance is now committed.
     */
    async function commitOvershootWithContext(
      ctx: RawTransactionContext,
      tamper: string | null,
    ): Promise<unknown> {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE sk_app");
        await client.query("SELECT set_config('app.household_id', $1, true)", [ctx.householdId]);
        await insertRawTransaction(client, ctx, {
          sequence: 2,
          type: "CONSUME",
          qty_delta: "-50",
          qty_delta_micros: "-50000000",
          idempotency_key: `overshoot-${randomUUID()}`,
        });
        // The attack: make the row invisible to a check that runs at COMMIT.
        await client.query("SELECT set_config('app.household_id', $1, true)", [tamper ?? ""]);
        await client.query("COMMIT");
        return undefined;
      } catch (error) {
        return error;
      } finally {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* already rolled back by the failed COMMIT */
        }
        client.release();
      }
    }

    /**
     * Regression, reviewer finding F1. The deferred checks used to be
     * SECURITY INVOKER, so their verification SELECT was filtered by the
     * caller's own RLS context. Clearing `app.household_id` before COMMIT hid
     * the row from the check, `NOT FOUND` was treated as "nothing to complain
     * about", and a negative quantity committed — INV-LEDGER-4 failing *open*.
     * The functions are now SECURITY DEFINER and a missing row raises.
     */
    it("cannot be evaded by clearing the household context before COMMIT", async () => {
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        type: "PURCHASE",
        qty_delta: "10",
        qty_delta_micros: "10000000",
      });

      const failure = pgFailure(await commitOvershootWithContext(ctx, null));
      expect(failure.message, "a negative balance committed").toMatch(/INV-LEDGER-4/);

      const item = await db.pool.query<{ current_qty_micros: string }>(
        `SELECT current_qty_micros FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.current_qty_micros).toBe("10000000");
    });

    it("cannot be evaded by switching to another household's context before COMMIT", async () => {
      const elsewhere = await seedHousehold(db.pool, "Elsewhere");
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        type: "PURCHASE",
        qty_delta: "10",
        qty_delta_micros: "10000000",
      });

      const failure = pgFailure(await commitOvershootWithContext(ctx, elsewhere.householdId));
      expect(failure.message, "a negative balance committed").toMatch(/INV-LEDGER-4/);

      const item = await db.pool.query<{ current_qty_micros: string }>(
        `SELECT current_qty_micros FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.current_qty_micros).toBe("10000000");
    });

    it("clamps per lot: one lot may not borrow from another", async () => {
      const ctx = await context();
      const otherLot = await seedLot(db.pool, household.householdId, ctx.itemId);
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        type: "PURCHASE",
        qty_delta: "5",
        qty_delta_micros: "5000000",
      });
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, ctx, {
            sequence: 2,
            lot_id: otherLot,
            type: "CONSUME",
            qty_delta: "-1",
            qty_delta_micros: "-1000000",
          }),
        ),
      );
      // The item as a whole would still hold 4 lb; the empty lot may not go
      // negative to get there.
      expect(failure.message).toMatch(/INV-LEDGER-4: lot/);
    });
  });

  describe("referential integrity", () => {
    it("rejects a transaction for an item in another household", async () => {
      const other = await seedHousehold(db.pool, "Other");
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          insertRawTransaction(db.pool, { ...ctx, householdId: other.householdId }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_transactions_item_unit_fkey");
    });

    it("rejects a lot that belongs to a different item", async () => {
      const ctx = await context();
      const otherItem = await seedItem(db.pool, household.householdId);
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, { ...ctx, lotId: otherItem.lotId })),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_transactions_lot_fkey");
    });

    it("carries the household in every inventory foreign key", async () => {
      // The trigger reports cross-household and cross-item references first,
      // so the keys underneath it would not otherwise be observable. They are
      // the guarantee that survives the trigger, so assert they exist and that
      // household_id is part of each one.
      const keys = await db.pool.query<{ conname: string; definition: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid IN ('inventory_transactions'::regclass, 'inventory_lots'::regclass)
            AND contype = 'f'
          ORDER BY conname`,
      );
      const byName = new Map(keys.rows.map((row) => [row.conname, row.definition]));

      expect(byName.get("inventory_transactions_item_unit_fkey")).toBe(
        "FOREIGN KEY (household_id, item_id, unit) REFERENCES inventory_items(household_id, id, unit)",
      );
      expect(byName.get("inventory_transactions_lot_fkey")).toBe(
        "FOREIGN KEY (household_id, item_id, lot_id) REFERENCES inventory_lots(household_id, item_id, id)",
      );
      expect(byName.get("inventory_lots_item_fkey")).toBe(
        "FOREIGN KEY (household_id, item_id) REFERENCES inventory_items(household_id, id)",
      );
      expect(byName.get("inventory_transactions_clamp_cause_fkey")).toBe(
        "FOREIGN KEY (household_id, system_flag_caused_by_idempotency_key) " +
          "REFERENCES inventory_transactions(household_id, idempotency_key)",
      );
    });

    it("rejects an unknown item outright", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() => insertRawTransaction(db.pool, { ...ctx, itemId: randomUUID() })),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_transactions_item_unit_fkey");
    });
  });

  describe("snapshot columns are not writable by hand", () => {
    it("refuses a direct item quantity edit", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(
            `UPDATE inventory_items SET current_qty_micros = 999, current_qty = 0.000999 WHERE id = $1`,
            [ctx.itemId],
          ),
        ),
      );
      expect(failure.message).toMatch(/maintained by the ledger/);
    });

    it("refuses a direct lot quantity edit", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(
            `UPDATE inventory_lots SET current_qty_micros = 5, current_qty = 0.000005 WHERE id = $1`,
            [ctx.lotId],
          ),
        ),
      );
      expect(failure.message).toMatch(/maintained by the ledger/);
    });

    it("refuses a direct next_sequence edit", async () => {
      const ctx = await context();
      const failure = pgFailure(
        await captureError(() =>
          db.pool.query(`UPDATE inventory_items SET next_sequence = 42 WHERE id = $1`, [
            ctx.itemId,
          ]),
        ),
      );
      expect(failure.message).toMatch(/maintained by the ledger/);
    });

    it("still allows editing an item's own metadata", async () => {
      const ctx = await context();
      await db.pool.query(
        `UPDATE inventory_items SET display_name = 'Chicken breast', storage_location = 'FREEZER'
          WHERE id = $1`,
        [ctx.itemId],
      );
      const item = await db.pool.query<{ display_name: string; storage_location: string }>(
        `SELECT display_name, storage_location FROM inventory_items WHERE id = $1`,
        [ctx.itemId],
      );
      expect(item.rows[0]?.display_name).toBe("Chicken breast");
      expect(item.rows[0]?.storage_location).toBe("FREEZER");
    });
  });

  describe("what the schema deliberately leaves to the application", () => {
    it("does not check that the actor is a member of the household", async () => {
      // A membership foreign key would make leaving a household either
      // impossible or history-rewriting, so authorship is authorised in the
      // service layer (M2's authz matrix) and only referential existence is
      // enforced here. Documented rather than silently absent.
      const outsider = await seedHousehold(db.pool, "Outsider");
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, { actor_user_id: outsider.userId });
      const stored = await db.pool.query<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM inventory_transactions WHERE item_id = $1`,
        [ctx.itemId],
      );
      expect(stored.rows[0]?.actor_user_id).toBe(outsider.userId);
    });

    it("does not gate an AI_INTERPRETATION row on a confirmation", async () => {
      // INV-CONF-1 is enforced at the AIObservation boundary (M1-T1 §8.2,
      // ai-architecture.md §2), not by this table. If that ruling changes it
      // becomes a CHECK here plus a migration.
      const ctx = await context();
      await insertRawTransaction(db.pool, ctx, {
        provenance_tier: "AI_INTERPRETATION",
        provenance_source: "vision:model@v1",
        provenance_confidence: "0.8",
      });
      const stored = await db.pool.query<{ provenance_tier: string }>(
        `SELECT provenance_tier FROM inventory_transactions WHERE item_id = $1`,
        [ctx.itemId],
      );
      expect(stored.rows[0]?.provenance_tier).toBe("AI_INTERPRETATION");
    });
  });
});
