/**
 * INV-LEDGER-1 at the database boundary (M1-T2's key integration test).
 *
 * The domain proved in M1-T1 that `currentQty == Σ deltas` for any transaction
 * sequence *in memory*. That guarantee is worth nothing if the trip through
 * Postgres loses, rounds or reorders anything. This file closes the loop:
 *
 *   generate a sequence → persist it through the real write path (as `sk_app`,
 *   under RLS) → read the rows back → rehydrate → the aggregate must reconcile,
 *   and the SQL reconciliation query must agree with the domain's `reconcile()`
 *   on the same data.
 *
 * `rehydrateInventoryItem` is used as the architect specified: as the
 * corruption detector. It recomputes every snapshot from the rows and refuses
 * anything `appendTransaction` could not have written, so "it rehydrated" is a
 * much stronger statement than "the rows came back".
 */

import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type { PoolClient } from "pg";
import {
  appendTransactions,
  createInventoryItem,
  reconcile,
  sumDeltaMicros,
  type CreateInventoryItemInput,
  type InventoryItem,
  type RecordedTransaction,
  type TransactionInput,
  type TransactionType,
} from "@smart-kitchen/domain";
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
  appendTransactionToDb,
  insertInventoryItem,
  loadInventoryItem,
  reconcileItemInDb,
} from "./repository.js";

const SUITE = "INV-LEDGER-1 — ledger round-trip through Postgres";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";
const BASE_EPOCH_MS = Date.UTC(2026, 2, 6, 18, 0, 0);

/** Canonical UTC instant `step` seconds after the base epoch. */
function instantAt(step: number): string {
  return new Date(BASE_EPOCH_MS + step * 1000).toISOString();
}

const INCREASING: readonly TransactionType[] = ["INITIAL_STOCK", "PURCHASE"];
const DECREASING: readonly TransactionType[] = [
  "CONSUME",
  "USE_IN_MEAL",
  "DISCARD",
  "EXPIRE",
  "DONATE",
];

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("roundtrip");
    household = await seedHousehold(db.pool, "Round trip");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  /** Creates the item, then applies every input through the real write path. */
  async function persist(
    shell: CreateInventoryItemInput,
    inputs: readonly TransactionInput[],
  ): Promise<void> {
    await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        const created = await insertInventoryItem(client, shell);
        expect(created.ok).toBe(true);
      },
      { assumeRole: APP_ROLE },
    );

    for (const input of inputs) {
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          const result = await appendTransactionToDb(
            client,
            household.householdId,
            shell.itemId,
            input,
          );
          expect(result.ok, result.ok ? "" : `${result.error.code}: ${result.error.message}`).toBe(
            true,
          );
          // Not merely "the call returned": a `rejected` or `duplicate` verdict
          // writes nothing, and asserting only on `ok` would let a silently
          // empty ledger pass every later assertion.
          if (result.ok) {
            expect(
              result.value.status,
              result.value.status === "rejected"
                ? `${result.value.error.code}: ${result.value.error.message}`
                : "",
            ).toBe("appended");
          }
        },
        { assumeRole: APP_ROLE },
      );
    }
  }

  /** Reads the item back and rehydrates it, as the runtime role. */
  async function readBack(itemId: string): Promise<InventoryItem> {
    const loaded = await withHouseholdTransaction(
      db.pool,
      household.householdId,
      (client) => loadInventoryItem(client, household.householdId, itemId),
      { assumeRole: APP_ROLE },
    );
    if (!loaded.ok) {
      throw new Error(
        `rehydration refused the stored ledger: ${loaded.error.code} — ${loaded.error.message}`,
      );
    }
    return loaded.value;
  }

  /** The same inputs folded by the domain alone, with no database involved. */
  function inMemory(
    shell: CreateInventoryItemInput,
    inputs: readonly TransactionInput[],
  ): InventoryItem {
    const created = createInventoryItem(shell);
    if (!created.ok) throw new Error(created.error.message);
    return appendTransactions(created.value, inputs).item;
  }

  function sortedByLot(item: InventoryItem): readonly { lotId: string; micros: bigint }[] {
    return [...item.lots]
      .map((lot) => ({ lotId: lot.lotId, micros: lot.currentQty.micros }))
      .sort((a, b) => a.lotId.localeCompare(b.lotId));
  }

  describe("worked examples", () => {
    it("stores the brief's chicken example exactly (2.0 − 0.75 = 1.25 lb)", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      const shell: CreateInventoryItemInput = {
        itemId,
        householdId: household.householdId,
        unit: UNIT,
        storageLocation: "FRIDGE",
        lots: [{ lotId, acquiredAt: instantAt(0) }],
      };
      const inputs: TransactionInput[] = [
        {
          lotId,
          type: "PURCHASE",
          qtyDelta: 2.0,
          unit: UNIT,
          actor: { kind: "user", userId: household.userId },
          occurredAt: instantAt(0),
          recordedAt: instantAt(1),
          provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
          idempotencyKey: "chicken-purchase",
        },
        {
          lotId,
          type: "USE_IN_MEAL",
          qtyDelta: -0.75,
          unit: UNIT,
          reason: "dinner",
          actor: { kind: "user", userId: household.userId },
          occurredAt: instantAt(60),
          recordedAt: instantAt(61),
          provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
          idempotencyKey: "chicken-dinner",
          correlationRef: { kind: "meal-log", id: randomUUID() },
        },
      ];

      await persist(shell, inputs);
      const stored = await readBack(itemId);

      expect(stored.currentQty.micros).toBe(1_250_000n);
      expect(stored.currentQty.amount).toBe(1.25);
      expect(stored.transactions).toHaveLength(2);
      expect(reconcile(stored).ok).toBe(true);

      // And the decimal column carries the same value, not a rounded float.
      const row = await db.pool.query<{ current_qty: string }>(
        `SELECT current_qty FROM inventory_items WHERE id = $1`,
        [itemId],
      );
      expect(row.rows[0]?.current_qty).toBe("1.250000");
    });

    it("persists an over-consumption clamp as an unforgeable ledger-authored row", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      const shell: CreateInventoryItemInput = {
        itemId,
        householdId: household.householdId,
        unit: UNIT,
        lots: [{ lotId }],
      };
      const inputs: TransactionInput[] = [
        {
          lotId,
          type: "PURCHASE",
          qtyDelta: 0.75,
          unit: UNIT,
          actor: { kind: "user", userId: household.userId },
          occurredAt: instantAt(0),
          recordedAt: instantAt(1),
          provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
          idempotencyKey: "buy-075",
        },
        {
          lotId,
          type: "CONSUME",
          qtyDelta: -1.0,
          unit: UNIT,
          actor: { kind: "user", userId: household.userId },
          occurredAt: instantAt(60),
          recordedAt: instantAt(61),
          provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
          idempotencyKey: "eat-1",
        },
      ];

      await persist(shell, inputs);
      const stored = await readBack(itemId);

      // The user's statement is recorded at full magnitude, and the shortfall
      // is explicit — the balance is exactly zero, never negative.
      expect(stored.transactions).toHaveLength(3);
      expect(stored.currentQty.micros).toBe(0n);

      const clamp = stored.transactions[2] as RecordedTransaction;
      expect(clamp.type).toBe("ADJUSTMENT");
      expect(clamp.actor).toEqual({ kind: "system", component: "inventory-ledger" });
      expect(clamp.qtyDeltaMicros).toBe(250_000n);
      expect(clamp.systemFlag).toEqual({
        kind: "OVER_CONSUMPTION",
        residualMicros: 250_000n,
        residual: 0.25,
        causedBySequence: 2,
        causedByIdempotencyKey: "eat-1",
      });
      expect(clamp.idempotencyKey).toBe("eat-1::over-consumption-clamp");
      expect(reconcile(stored).ok).toBe(true);
    });

    it("is a no-op when the same write is replayed", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      const shell: CreateInventoryItemInput = {
        itemId,
        householdId: household.householdId,
        unit: UNIT,
        lots: [{ lotId }],
      };
      const input: TransactionInput = {
        lotId,
        type: "PURCHASE",
        qtyDelta: 3,
        unit: UNIT,
        actor: { kind: "user", userId: household.userId },
        occurredAt: instantAt(0),
        recordedAt: instantAt(1),
        provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
        idempotencyKey: "replayed-purchase",
      };

      await persist(shell, [input]);
      // Same key, same payload, later retry — INV-LEDGER-3.
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          const replay = await appendTransactionToDb(client, household.householdId, itemId, {
            ...input,
            recordedAt: instantAt(900),
          });
          expect(replay.ok).toBe(true);
          if (replay.ok) expect(replay.value.status).toBe("duplicate");
        },
        { assumeRole: APP_ROLE },
      );

      const stored = await readBack(itemId);
      expect(stored.transactions).toHaveLength(1);
      expect(stored.currentQty.micros).toBe(3_000_000n);
    });

    it("normalises instants once, on the way in, so a reload is byte-identical", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await persist({ itemId, householdId: household.householdId, unit: UNIT, lots: [{ lotId }] }, [
        {
          lotId,
          type: "PURCHASE",
          qtyDelta: 1,
          unit: UNIT,
          actor: { kind: "user", userId: household.userId },
          // Deliberately not canonical: an offset, and no milliseconds.
          occurredAt: "2026-03-06T20:00:00+02:00",
          recordedAt: "2026-03-06T18:30:00Z",
          provenance: {
            tier: "AI_INTERPRETATION",
            source: "receipt:ocr-v2",
            confidence: 0.87,
            modelRef: "ocr@2026-01",
            observedAt: "2026-03-06T18:29:00Z",
            confirmedBy: household.userId,
          },
          idempotencyKey: "offset-instant",
        },
      ]);

      const stored = await readBack(itemId);
      const row = stored.transactions[0] as RecordedTransaction;
      expect(row.occurredAt).toBe("2026-03-06T18:00:00.000Z");
      expect(row.recordedAt).toBe("2026-03-06T18:30:00.000Z");
      expect(row.provenance).toEqual({
        tier: "AI_INTERPRETATION",
        source: "receipt:ocr-v2",
        confidence: 0.87,
        modelRef: "ocr@2026-01",
        observedAt: "2026-03-06T18:29:00.000Z",
        confirmedBy: household.userId,
      });
    });
  });

  /**
   * The read path is the corruption detector, so it needs corrupt rows to
   * refuse (reviewer findings F4/F5).
   *
   * Every row here has to be written past a guard that exists precisely to
   * stop it, so each test drops the blocking constraint or disables the
   * blocking trigger **inside a transaction that is always rolled back**.
   * Postgres DDL is transactional, so the schema and the corrupt row both
   * vanish; nothing leaks into the next test. Reaching for that hammer is
   * itself the evidence that the write path cannot produce these rows.
   */
  describe("the read path refuses corruption", () => {
    /** Applies `ddl`, runs `fn`, and rolls the whole thing back. */
    async function inRolledBackTransaction<T>(
      ddl: readonly string[],
      fn: (client: PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        for (const statement of ddl) await client.query(statement);
        return await fn(client);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }

    /** An item with one lot and one honest PURCHASE of 2 lb, committed. */
    async function seededItem(): Promise<{ itemId: string; lotId: string }> {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertInventoryItem(client, {
            itemId,
            householdId: household.householdId,
            unit: UNIT,
            lots: [{ lotId }],
          });
          await appendTransactionToDb(client, household.householdId, itemId, {
            lotId,
            type: "PURCHASE",
            qtyDelta: 2,
            unit: UNIT,
            actor: { kind: "user", userId: household.userId },
            occurredAt: instantAt(0),
            recordedAt: instantAt(1),
            provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
            idempotencyKey: `seed-${randomUUID()}`,
          });
        },
        { assumeRole: APP_ROLE },
      );
      return { itemId, lotId };
    }

    function rawRow(
      itemId: string,
      lotId: string,
      overrides: Readonly<Record<string, unknown>>,
    ): Readonly<Record<string, unknown>> {
      return {
        household_id: household.householdId,
        item_id: itemId,
        lot_id: lotId,
        unit: UNIT,
        actor_kind: "user",
        actor_user_id: household.userId,
        occurred_at: instantAt(0),
        recorded_at: instantAt(1),
        provenance_tier: "KNOWN_FACT",
        provenance_source: "manual-entry",
        ...overrides,
      };
    }

    async function insertRaw(
      client: PoolClient,
      row: Readonly<Record<string, unknown>>,
    ): Promise<void> {
      const columns = Object.keys(row);
      const placeholders = columns.map((_column, index) => `$${String(index + 1)}`);
      await client.query(
        `INSERT INTO inventory_transactions (${columns.join(", ")})
         VALUES (${placeholders.join(", ")})`,
        Object.values(row),
      );
    }

    // --- F5: rows rehydrateInventoryItem must refuse -----------------------

    it("refuses a row whose two delta representations disagree", async () => {
      const { itemId, lotId } = await seededItem();
      const outcome = await inRolledBackTransaction(
        [
          `ALTER TABLE inventory_transactions
             DROP CONSTRAINT inventory_transactions_qty_forms_agree`,
        ],
        async (client) => {
          await insertRaw(
            client,
            rawRow(itemId, lotId, {
              sequence: 2,
              type: "PURCHASE",
              qty_delta: "2",
              qty_delta_micros: "3000000",
              idempotency_key: `disagree-${randomUUID()}`,
            }),
          );
          return loadInventoryItem(client, household.householdId, itemId);
        },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("CORRUPT_LEDGER");
        expect(outcome.error.message).toMatch(/disagrees with qtyDeltaMicros/);
      }
    });

    it("refuses a user row wearing the ledger's reserved clamp key", async () => {
      const { itemId, lotId } = await seededItem();
      const outcome = await inRolledBackTransaction(
        [
          `ALTER TABLE inventory_transactions
             DROP CONSTRAINT inventory_transactions_reserved_marker`,
        ],
        async (client) => {
          await insertRaw(
            client,
            rawRow(itemId, lotId, {
              sequence: 2,
              type: "ADJUSTMENT",
              qty_delta: "1",
              qty_delta_micros: "1000000",
              idempotency_key: `forged-${randomUUID()}::over-consumption-clamp`,
            }),
          );
          return loadInventoryItem(client, household.householdId, itemId);
        },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("CORRUPT_LEDGER");
        expect(outcome.error.message).toMatch(/not attributed to the ledger/);
      }
    });

    it("refuses a ledger with a gap in its sequence", async () => {
      const { itemId, lotId } = await seededItem();
      const outcome = await inRolledBackTransaction(
        [
          `ALTER TABLE inventory_transactions
             DISABLE TRIGGER inventory_transactions_apply`,
        ],
        async (client) => {
          // Sequence 2 is skipped entirely.
          await insertRaw(
            client,
            rawRow(itemId, lotId, {
              sequence: 3,
              type: "PURCHASE",
              qty_delta: "1",
              qty_delta_micros: "1000000",
              idempotency_key: `gap-${randomUUID()}`,
            }),
          );
          return loadInventoryItem(client, household.householdId, itemId);
        },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("CORRUPT_LEDGER");
        expect(outcome.error.message).toMatch(/contiguous 1\.\.n sequence/);
      }
    });

    // --- F4: stored snapshots are checked, not merely read -----------------

    it("refuses an item snapshot that drifted from its ledger", async () => {
      const { itemId } = await seededItem();
      const outcome = await inRolledBackTransaction(
        [`ALTER TABLE inventory_items DISABLE TRIGGER inventory_items_guard`],
        async (client) => {
          await client.query(
            `UPDATE inventory_items
                SET current_qty_micros = 9000000, current_qty = 9.0
              WHERE id = $1`,
            [itemId],
          );
          return loadInventoryItem(client, household.householdId, itemId);
        },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("CORRUPT_LEDGER");
        expect(outcome.error.message).toMatch(/stored item snapshot 9000000 != Σ deltas 2000000/);
      }
    });

    it("refuses a lot snapshot that drifted from its ledger", async () => {
      const { itemId, lotId } = await seededItem();
      const outcome = await inRolledBackTransaction(
        [`ALTER TABLE inventory_lots DISABLE TRIGGER inventory_lots_guard`],
        async (client) => {
          await client.query(
            `UPDATE inventory_lots
                SET current_qty_micros = 5000000, current_qty = 5.0
              WHERE id = $1`,
            [lotId],
          );
          return loadInventoryItem(client, household.householdId, itemId);
        },
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("CORRUPT_LEDGER");
        expect(outcome.error.message).toMatch(/stored lot snapshot/);
      }
    });

    it("still accepts the honest item it was given", async () => {
      // The control: none of the above passes because loadInventoryItem simply
      // refuses everything.
      const { itemId } = await seededItem();
      const stored = await readBack(itemId);
      expect(stored.currentQty.micros).toBe(2_000_000n);
    });
  });

  describe("generated ledgers", () => {
    it("round-trip exactly and reconcile in SQL and in the domain", async () => {
      const magnitudeMicros = fc.integer({ min: 1, max: 4_000_000 });

      const arbitrary = fc
        .record({
          lotCount: fc.integer({ min: 1, max: 3 }),
          steps: fc.array(
            fc.record({
              lotIndex: fc.nat({ max: 2 }),
              kind: fc.constantFrom<"increase" | "decrease" | "adjust">(
                "increase",
                "decrease",
                "adjust",
              ),
              typePick: fc.nat({ max: 4 }),
              micros: magnitudeMicros,
              negativeAdjust: fc.boolean(),
              actorPick: fc.nat({ max: 2 }),
              withReason: fc.boolean(),
              withCorrelation: fc.boolean(),
            }),
            { minLength: 1, maxLength: 10 },
          ),
        })
        .map(({ lotCount, steps }) => {
          const lotIds = Array.from({ length: lotCount }, () => randomUUID());
          // Idempotency keys are unique per (household, key) by index — every
          // run shares one household, so a fixed `gen-0` would be rejected as a
          // conflict by the second run rather than appended.
          const run = randomUUID();
          const inputs: TransactionInput[] = steps.map((step, index) => {
            const lotId = lotIds[step.lotIndex % lotCount] as string;
            const type: TransactionType =
              step.kind === "increase"
                ? (INCREASING[step.typePick % INCREASING.length] as TransactionType)
                : step.kind === "decrease"
                  ? (DECREASING[step.typePick % DECREASING.length] as TransactionType)
                  : "ADJUSTMENT";
            const magnitude = step.micros / 1_000_000;
            const signed =
              step.kind === "increase"
                ? magnitude
                : step.kind === "decrease"
                  ? -magnitude
                  : step.negativeAdjust
                    ? -magnitude
                    : magnitude;
            const actor =
              step.actorPick === 0
                ? ({ kind: "user", userId: household.userId } as const)
                : step.actorPick === 1
                  ? ({ kind: "system", component: "receipt-importer" } as const)
                  : ({
                      kind: "ai-confirmed",
                      userId: household.userId,
                      modelRef: "vision@2026-02",
                    } as const);
            return {
              lotId,
              type,
              qtyDelta: signed,
              unit: UNIT,
              actor,
              occurredAt: instantAt(index * 60),
              recordedAt: instantAt(index * 60 + 1),
              provenance: { tier: "KNOWN_FACT", source: "generated" },
              idempotencyKey: `gen-${run}-${String(index)}`,
              ...(step.withReason ? { reason: `reason-${String(index)}` } : {}),
              ...(step.withCorrelation
                ? { correlationRef: { kind: "meal-log" as const, id: randomUUID() } }
                : {}),
            };
          });
          return { lotIds, inputs };
        });

      await fc.assert(
        fc.asyncProperty(arbitrary, async ({ lotIds, inputs }) => {
          const itemId = randomUUID();
          const shell: CreateInventoryItemInput = {
            itemId,
            householdId: household.householdId,
            unit: UNIT,
            storageLocation: "PANTRY",
            lots: lotIds.map((lotId) => ({ lotId })),
          };

          await persist(shell, inputs);

          const expected = inMemory(shell, inputs);
          const stored = await readBack(itemId);

          // 1. The rows themselves survived unchanged — including sequence,
          //    both delta forms, provenance, correlation and system flags.
          expect(stored.transactions).toStrictEqual(expected.transactions);

          // 2. Snapshots, recomputed from the stored rows, match the domain's.
          expect(stored.currentQty.micros).toBe(expected.currentQty.micros);
          expect(sortedByLot(stored)).toStrictEqual(sortedByLot(expected));
          expect(stored.nextSequence).toBe(expected.nextSequence);

          // 3. The domain's own reconciliation passes on what came back.
          const report = reconcile(stored);
          expect(report.problems).toEqual([]);
          expect(report.ok).toBe(true);

          // 4. The SQL reconciliation query agrees with it, independently.
          const sql = await withHouseholdTransaction(
            db.pool,
            household.householdId,
            (client) => reconcileItemInDb(client, household.householdId, itemId),
            { assumeRole: APP_ROLE },
          );
          expect(sql).toBeDefined();
          expect(sql?.ok).toBe(true);
          expect(sql?.drift_micros).toBe("0");
          expect(BigInt(sql?.derived_micros ?? "x")).toBe(sumDeltaMicros(stored.transactions));
          expect(BigInt(sql?.snapshot_micros ?? "x")).toBe(expected.currentQty.micros);
          expect(sql?.next_sequence).toBe(expected.nextSequence);
        }),
        { numRuns: 20 },
      );
    }, 180_000);
  });
});
