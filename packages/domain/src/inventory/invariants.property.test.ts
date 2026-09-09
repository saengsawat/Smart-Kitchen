/**
 * Permanent invariant tests for the inventory ledger (testing-strategy.md §2).
 *
 * These encode product non-negotiables and may not be deleted or weakened to
 * make a change pass (CLAUDE.md rule 13). Each `describe` is named for the
 * invariant it proves.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reconcile, sumDeltaMicros, sumLotDeltaMicros } from "./derive.js";
import {
  appendTransaction,
  createInventoryItem,
  CLAMP_KEY_SUFFIX,
  CLAMP_REASON,
  LEDGER_COMPONENT,
} from "./ledger.js";
import { microsToAmount } from "./quantity.js";
import { instantAt, serialize, TEST_HOUSEHOLD, TEST_ITEM, TEST_UNIT } from "./test-support.js";
import { TRANSACTION_TYPES, transactionDirection } from "./types.js";
import type {
  AppendResult,
  InventoryItem,
  RecordedTransaction,
  TransactionInput,
} from "./types.js";

const LOT_IDS = ["lot-1", "lot-2"] as const;

interface TransactionSpec {
  readonly lotIndex: number;
  readonly typeIndex: number;
  /** Magnitude in micro-units, so every generated amount is representable. */
  readonly magnitudeMicros: number;
  readonly negativeAdjustment: boolean;
  readonly keyIndex: number;
  readonly withCorrelation: boolean;
}

const specArb: fc.Arbitrary<TransactionSpec> = fc.record({
  lotIndex: fc.integer({ min: 0, max: LOT_IDS.length - 1 }),
  typeIndex: fc.integer({ min: 0, max: TRANSACTION_TYPES.length - 1 }),
  magnitudeMicros: fc.integer({ min: 1, max: 3_000_000 }),
  negativeAdjustment: fc.boolean(),
  keyIndex: fc.integer({ min: 0, max: 4 }),
  withCorrelation: fc.boolean(),
});

const sequenceArb = fc.array(specArb, { minLength: 1, maxLength: 25 });

function emptyItem(): InventoryItem {
  const created = createInventoryItem({
    itemId: TEST_ITEM,
    householdId: TEST_HOUSEHOLD,
    unit: TEST_UNIT,
    lots: LOT_IDS.map((lotId) => ({ lotId })),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/**
 * Turns a generated spec into a valid transaction input.
 * `uniqueKeys` controls whether keys collide: pooled keys exercise the
 * duplicate/conflict paths, unique keys maximise clamp coverage.
 */
function buildInput(spec: TransactionSpec, index: number, uniqueKeys: boolean): TransactionInput {
  const type = TRANSACTION_TYPES[spec.typeIndex] ?? "PURCHASE";
  const lotId = LOT_IDS[spec.lotIndex] ?? LOT_IDS[0];
  const magnitude = microsToAmount(BigInt(spec.magnitudeMicros));
  const direction = transactionDirection(type);
  const qtyDelta =
    direction === "decrease" || (direction === "signed" && spec.negativeAdjustment)
      ? -magnitude
      : magnitude;

  const base: TransactionInput = {
    lotId,
    type,
    qtyDelta,
    unit: TEST_UNIT,
    actor: { kind: "user", userId: "user-dean" },
    occurredAt: instantAt(index),
    recordedAt: instantAt(index),
    provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
    idempotencyKey: uniqueKeys ? `tx-${String(index)}` : `tx-${String(spec.keyIndex)}`,
  };
  return spec.withCorrelation
    ? { ...base, correlationRef: { kind: "meal-log", id: `meal-${String(index)}` } }
    : base;
}

function isClamp(row: RecordedTransaction): boolean {
  return row.systemFlag !== undefined;
}

function rowsAddedBy(result: AppendResult): number {
  if (result.status !== "appended") return 0;
  return result.clampAdjustment === undefined ? 1 : 2;
}

/** Deterministic shuffle (no I/O, no Math.random) for replay-order coverage. */
function shuffle<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  let state = seed >>> 0 || 1;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = state % (index + 1);
    const a = out[index];
    const b = out[target];
    if (a !== undefined && b !== undefined) {
      out[index] = b;
      out[target] = a;
    }
  }
  return out;
}

describe("INV-LEDGER-1 — inventory cannot silently disappear", () => {
  it("currentQty equals Σ deltas after any sequence, and every change is attributable", () => {
    fc.assert(
      fc.property(sequenceArb, (specs) => {
        let item = emptyItem();

        specs.forEach((spec, index) => {
          const before = item;
          const result = appendTransaction(before, buildInput(spec, index, false));
          item = result.item;

          if (result.status !== "appended") {
            // Rejections and replays write nothing at all.
            expect(item).toBe(before);
            return;
          }
          const added = item.transactions.length - before.transactions.length;
          expect(added).toBe(rowsAddedBy(result));
          const netOfRows =
            result.transaction.qtyDeltaMicros + (result.clampAdjustment?.qtyDeltaMicros ?? 0n);
          expect(item.currentQty.micros - before.currentQty.micros).toBe(netOfRows);
        });

        // Snapshot == Σ deltas, at item and lot level.
        expect(item.currentQty.micros).toBe(sumDeltaMicros(item.transactions));
        const lotTotal = item.lots.reduce((total, lot) => total + lot.currentQty.micros, 0n);
        expect(lotTotal).toBe(item.currentQty.micros);
        for (const lot of item.lots) {
          expect(lot.currentQty.micros).toBe(sumLotDeltaMicros(item.transactions, lot.lotId));
        }

        // Every row is attributable and positioned.
        item.transactions.forEach((row, index) => {
          expect(row.sequence).toBe(index + 1);
          expect(row.itemId).toBe(TEST_ITEM);
          expect(row.unit).toBe(TEST_UNIT);
          expect(row.idempotencyKey.length).toBeGreaterThan(0);
          expect(row.provenance.source.length).toBeGreaterThan(0);
          expect(row.actor.kind.length).toBeGreaterThan(0);
          expect(row.qtyDeltaMicros).not.toBe(0n);
        });

        // Keys are unique across the whole ledger.
        const keys = new Set(item.transactions.map((row) => row.idempotencyKey));
        expect(keys.size).toBe(item.transactions.length);

        expect(reconcile(item).ok).toBe(true);
      }),
    );
  });

  it("derivation is order-independent and exact (no float drift)", () => {
    fc.assert(
      fc.property(sequenceArb, fc.integer(), (specs, seed) => {
        let item = emptyItem();
        specs.forEach((spec, index) => {
          item = appendTransaction(item, buildInput(spec, index, true)).item;
        });
        const rows = item.transactions;
        expect(sumDeltaMicros(shuffle(rows, seed))).toBe(sumDeltaMicros(rows));
      }),
    );
  });
});

describe("INV-LEDGER-2 — ledger rows are immutable; corrections are new rows", () => {
  it("earlier rows are byte-identical after later appends", () => {
    fc.assert(
      fc.property(sequenceArb, sequenceArb, (firstBatch, secondBatch) => {
        let item = emptyItem();
        firstBatch.forEach((spec, index) => {
          item = appendTransaction(item, buildInput(spec, index, true)).item;
        });
        const prefixLength = item.transactions.length;
        const prefixBefore = serialize(item.transactions);
        const rowRefs = [...item.transactions];

        secondBatch.forEach((spec, index) => {
          item = appendTransaction(item, buildInput(spec, prefixLength + index + 100, true)).item;
        });

        expect(serialize(item.transactions.slice(0, prefixLength))).toBe(prefixBefore);
        // The very same frozen objects are still in place — not copies.
        rowRefs.forEach((row, index) => {
          expect(item.transactions[index]).toBe(row);
        });
        expect(item.transactions.length).toBeGreaterThanOrEqual(prefixLength);
      }),
    );
  });

  it("recorded rows and aggregates reject mutation at runtime", () => {
    fc.assert(
      fc.property(sequenceArb, (specs) => {
        let item = emptyItem();
        specs.forEach((spec, index) => {
          item = appendTransaction(item, buildInput(spec, index, true)).item;
        });
        for (const row of item.transactions) {
          expect(Object.isFrozen(row)).toBe(true);
          expect(() => {
            (row as { qtyDelta: number }).qtyDelta = 0;
          }).toThrow(TypeError);
        }
        expect(() => {
          (item.transactions as RecordedTransaction[]).length = 0;
        }).toThrow(TypeError);
      }),
    );
  });

  it("a correction is an appended ADJUSTMENT, never an edit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3_000_000 }),
        fc.integer({ min: 1, max: 3_000_000 }),
        (stockMicros, correctionMicros) => {
          let item = emptyItem();
          item = appendTransaction(item, {
            ...buildInput(
              {
                lotIndex: 0,
                typeIndex: TRANSACTION_TYPES.indexOf("PURCHASE"),
                magnitudeMicros: stockMicros,
                negativeAdjustment: false,
                keyIndex: 0,
                withCorrelation: false,
              },
              0,
              true,
            ),
          }).item;
          const original = item.transactions[0];
          expect(original).toBeDefined();
          if (original === undefined) return;
          const originalSerialized = serialize(original);

          const corrected = appendTransaction(item, {
            ...buildInput(
              {
                lotIndex: 0,
                typeIndex: TRANSACTION_TYPES.indexOf("ADJUSTMENT"),
                magnitudeMicros: correctionMicros,
                negativeAdjustment: true,
                keyIndex: 0,
                withCorrelation: false,
              },
              1,
              true,
            ),
            reason: "recount",
          });
          expect(corrected.status).toBe("appended");
          expect(serialize(corrected.item.transactions[0])).toBe(originalSerialized);
          expect(corrected.item.transactions[1]?.type).toBe("ADJUSTMENT");
        },
      ),
    );
  });
});

describe("INV-LEDGER-3 — replaying a write with the same idempotency key is a no-op", () => {
  it("replaying every input, in any order, changes nothing", () => {
    fc.assert(
      fc.property(sequenceArb, fc.integer(), (specs, seed) => {
        let item = emptyItem();
        const inputs = specs.map((spec, index) => buildInput(spec, index, true));
        for (const input of inputs) {
          item = appendTransaction(item, input).item;
        }
        const settled = item;
        const settledSerialized = serialize(settled);

        for (const input of shuffle(inputs, seed)) {
          // A retry legitimately arrives later; only recordedAt differs.
          const replay = appendTransaction(item, { ...input, recordedAt: instantAt(10_000) });
          expect(replay.status).toBe("duplicate");
          expect(replay.item).toBe(settled);
          if (replay.status === "duplicate") {
            expect(replay.transaction.idempotencyKey).toBe(input.idempotencyKey);
          }
          item = replay.item;
        }
        expect(serialize(item)).toBe(settledSerialized);
        expect(item.transactions.length).toBe(settled.transactions.length);
      }),
    );
  });

  it("a clamped write replays without generating a second clamp", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1_000_001, max: 3_000_000 }),
        (stockMicros, useMicros) => {
          let item = emptyItem();
          item = appendTransaction(item, {
            lotId: LOT_IDS[0],
            type: "PURCHASE",
            qtyDelta: microsToAmount(BigInt(stockMicros)),
            unit: TEST_UNIT,
            actor: { kind: "user", userId: "user-dean" },
            occurredAt: instantAt(0),
            recordedAt: instantAt(0),
            provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
            idempotencyKey: "stock",
          }).item;

          const overuse: TransactionInput = {
            lotId: LOT_IDS[0],
            type: "USE_IN_MEAL",
            qtyDelta: -microsToAmount(BigInt(useMicros)),
            unit: TEST_UNIT,
            actor: { kind: "user", userId: "user-dean" },
            occurredAt: instantAt(1),
            recordedAt: instantAt(1),
            provenance: { tier: "KNOWN_FACT", source: "meal-log" },
            idempotencyKey: "overuse",
          };
          const first = appendTransaction(item, overuse);
          expect(first.status).toBe("appended");
          const afterFirst = first.item;
          const replay = appendTransaction(afterFirst, overuse);
          expect(replay.status).toBe("duplicate");
          expect(replay.item).toBe(afterFirst);
          expect(
            afterFirst.transactions.filter((row) => row.idempotencyKey.endsWith(CLAMP_KEY_SUFFIX)),
          ).toHaveLength(1);
          expect(afterFirst.currentQty.micros).toBe(0n);
        },
      ),
    );
  });
});

describe("INV-LEDGER-4 — negative quantity is impossible without an explicit flagged adjustment", () => {
  it("no committed state is ever negative, and every shortfall is flagged and quantified", () => {
    // Guards against the property going vacuous: if a future change stopped
    // generating over-consumption, the assertions below would all pass trivially.
    let clampedRuns = 0;

    fc.assert(
      fc.property(sequenceArb, (specs) => {
        let item = emptyItem();

        specs.forEach((spec, index) => {
          const before = item;
          const input = buildInput(spec, index, true);
          const lotBefore =
            before.lots.find((lot) => lot.lotId === input.lotId)?.currentQty.micros ?? 0n;
          const result = appendTransaction(before, input);
          item = result.item;
          if (result.status !== "appended") return;

          const requested = result.transaction.qtyDeltaMicros;
          const projected = lotBefore + requested;
          const lotAfter =
            item.lots.find((lot) => lot.lotId === input.lotId)?.currentQty.micros ?? 0n;

          if (projected < 0n) {
            const clamp = result.clampAdjustment;
            expect(clamp).toBeDefined();
            if (clamp === undefined) return;
            // The requested decrease is recorded in full — never trimmed…
            expect(microsToAmount(result.transaction.qtyDeltaMicros)).toBe(input.qtyDelta);
            // …and the residual is explained by a flagged system row.
            expect(clamp.qtyDeltaMicros).toBe(-projected);
            expect(clamp.systemFlag?.kind).toBe("OVER_CONSUMPTION");
            expect(clamp.systemFlag?.residualMicros).toBe(-projected);
            expect(clamp.systemFlag?.causedByIdempotencyKey).toBe(input.idempotencyKey);
            expect(clamp.type).toBe("ADJUSTMENT");
            expect(clamp.actor).toEqual({ kind: "system", component: LEDGER_COMPONENT });
            expect(clamp.reason).toBe(CLAMP_REASON);
            expect(lotAfter).toBe(0n);
          } else {
            expect(result.clampAdjustment).toBeUndefined();
            expect(lotAfter).toBe(projected);
          }

          expect(item.currentQty.micros >= 0n).toBe(true);
          for (const lot of item.lots) {
            expect(lot.currentQty.micros >= 0n).toBe(true);
          }
        });

        // Only the ledger itself authors flagged rows.
        const clamps = item.transactions.filter(isClamp);
        if (clamps.length > 0) clampedRuns += 1;
        for (const row of clamps) {
          expect(row.actor).toEqual({ kind: "system", component: LEDGER_COMPONENT });
          expect(row.qtyDeltaMicros > 0n).toBe(true);
          expect(row.idempotencyKey.endsWith(CLAMP_KEY_SUFFIX)).toBe(true);
        }
        expect(reconcile(item).ok).toBe(true);
      }),
    );

    expect(clampedRuns).toBeGreaterThan(0);
  });

  it("running balances stay non-negative at every prefix of the ledger", () => {
    fc.assert(
      fc.property(sequenceArb, (specs) => {
        let item = emptyItem();
        specs.forEach((spec, index) => {
          item = appendTransaction(item, buildInput(spec, index, true)).item;
        });

        // Replaying the stored rows in order: the item balance may dip below zero
        // only *within* a clamped pair, and the very next row must be that clamp,
        // which restores it.
        let running = 0n;
        item.transactions.forEach((row, index) => {
          running += row.qtyDeltaMicros;
          if (running < 0n) {
            const next = item.transactions[index + 1];
            expect(next).toBeDefined();
            expect(next?.systemFlag?.causedBySequence).toBe(row.sequence);
            expect(running + (next?.qtyDeltaMicros ?? 0n) >= 0n).toBe(true);
          }
        });
        expect(running).toBe(item.currentQty.micros);
        expect(running >= 0n).toBe(true);
      }),
    );
  });
});
