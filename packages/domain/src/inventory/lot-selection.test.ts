/**
 * Lot-selection planner tests (M1-T8).
 *
 * The planner decides which lot real food leaves from, so the suite is built
 * around three questions: does it pick the right lots (worked examples, ties,
 * undated lots), can a plan ever produce an `OVER_CONSUMPTION` clamp when
 * applied (properties 3 and 6 say no), and does it refuse rather than guess when
 * anything is off (the rejection table).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reconcile, sumLotDeltaMicros } from "./derive.js";
import { isDeeplyFrozen } from "./freeze.js";
import { appendTransaction, appendTransactions, createInventoryItem } from "./ledger.js";
import {
  consumptionInputsFromPlan,
  planLotConsumption,
  PLAN_KEY_INFIX,
  type ConsumptionInputBase,
  type ConsumptionPlan,
  type ConsumptionRequest,
  type LotSelectionPolicy,
} from "./lot-selection.js";
import { microsToAmount } from "./quantity.js";
import { serialize, TEST_HOUSEHOLD, TEST_ITEM, TEST_UNIT, TEST_USER } from "./test-support.js";
import type { InventoryItem, LotInput, TransactionInput } from "./types.js";

const SEP01 = "2026-09-01T00:00:00.000Z";
const SEP05 = "2026-09-05T00:00:00.000Z";
const SEP10 = "2026-09-10T00:00:00.000Z";
const SEP15 = "2026-09-15T00:00:00.000Z";
const SEP20 = "2026-09-20T00:00:00.000Z";

const OCCURRED_AT = "2026-09-14T12:00:00.000Z";

/** Base for derived consumption writes; every test that applies a plan uses it. */
const MEAL_BASE: ConsumptionInputBase = {
  type: "USE_IN_MEAL",
  unit: TEST_UNIT,
  reason: "dinner",
  actor: TEST_USER,
  occurredAt: OCCURRED_AT,
  recordedAt: OCCURRED_AT,
  provenance: { tier: "KNOWN_FACT", source: "meal-log" },
  idempotencyKey: "meal-42",
  correlationRef: { kind: "meal-log", id: "meal-42" },
};

type LotFixture = LotInput & { readonly stock: number };

/** The lot metadata of a fixture, without the fixture-only `stock` field. */
function lotOf(fixture: LotFixture): LotInput {
  return {
    lotId: fixture.lotId,
    ...(fixture.acquiredAt === undefined ? {} : { acquiredAt: fixture.acquiredAt }),
    ...(fixture.expiresAt === undefined ? {} : { expiresAt: fixture.expiresAt }),
    ...(fixture.expiryTier === undefined ? {} : { expiryTier: fixture.expiryTier }),
  };
}

/** Builds an item whose lots hold the given stock, via real ledger appends. */
function stockedItem(lots: readonly LotFixture[]): InventoryItem {
  const created = createInventoryItem({
    itemId: TEST_ITEM,
    householdId: TEST_HOUSEHOLD,
    unit: TEST_UNIT,
    lots: lots.map(lotOf),
  });
  if (!created.ok) throw new Error(`fixture item invalid: ${created.error.message}`);

  let item = created.value;
  for (const [index, lot] of lots.entries()) {
    if (lot.stock === 0) continue;
    const result = appendTransaction(item, {
      lotId: lot.lotId,
      type: "PURCHASE",
      qtyDelta: lot.stock,
      unit: TEST_UNIT,
      actor: TEST_USER,
      occurredAt: SEP01,
      recordedAt: SEP01,
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: `stock-${String(index)}`,
    });
    if (result.status !== "appended") throw new Error(`fixture stocking failed: ${result.status}`);
    item = result.item;
  }
  return item;
}

/** The worked example from the ticket: A 1.0 (exp 09-20), B 0.5 (exp 09-15), C 2.0 (undated). */
function workedExampleItem(): InventoryItem {
  return stockedItem([
    { lotId: "lot-a", acquiredAt: SEP01, expiresAt: SEP20, expiryTier: "KNOWN_FACT", stock: 1.0 },
    { lotId: "lot-b", acquiredAt: SEP05, expiresAt: SEP15, stock: 0.5 },
    { lotId: "lot-c", acquiredAt: SEP10, stock: 2.0 },
  ]);
}

function planOrThrow(item: InventoryItem, request: ConsumptionRequest): ConsumptionPlan {
  const outcome = planLotConsumption(item, request);
  if (!outcome.ok) throw new Error(`expected a plan, got ${outcome.error.code}`);
  return outcome.value;
}

function inputsOrThrow(
  plan: ConsumptionPlan,
  base: ConsumptionInputBase = MEAL_BASE,
): readonly TransactionInput[] {
  const outcome = consumptionInputsFromPlan(plan, base);
  if (!outcome.ok) throw new Error(`expected inputs, got ${outcome.error.code}`);
  return outcome.value;
}

/** `[lotId, qtyDeltaMicros]` pairs, the shape the examples are stated in. */
function shape(plan: ConsumptionPlan): [string, bigint][] {
  return plan.allocations.map((allocation) => [allocation.lotId, allocation.qtyDeltaMicros]);
}

function planRejection(item: InventoryItem, request: ConsumptionRequest): string {
  const outcome = planLotConsumption(item, request);
  return outcome.ok ? "unexpected:ok" : outcome.error.code;
}

function inputsRejection(plan: ConsumptionPlan, base: ConsumptionInputBase): string {
  const outcome = consumptionInputsFromPlan(plan, base);
  return outcome.ok ? "unexpected:ok" : outcome.error.code;
}

describe("planLotConsumption — the ticket's worked example", () => {
  it("FEFO 1.2 lb draws B 0.5 then A 0.7 and leaves C untouched", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 1.2, policy: "FEFO" });

    expect(shape(plan)).toEqual([
      ["lot-b", -500_000n],
      ["lot-a", -700_000n],
    ]);
    expect(plan.allocations.map((allocation) => allocation.lotId)).not.toContain("lot-c");
    expect(plan.requestedMicros).toBe(1_200_000n);
    expect(plan.allocatedMicros).toBe(1_200_000n);
    expect(plan.shortfallMicros).toBe(0n);
    expect(plan.policy).toBe("FEFO");
    // Lot metadata travels with the allocation so a caller can explain the pick.
    expect(plan.allocations[0]).toEqual({
      lotId: "lot-b",
      qtyDeltaMicros: -500_000n,
      lotBalanceBeforeMicros: 500_000n,
      expiresAt: SEP15,
      acquiredAt: SEP05,
    });
    expect(plan.allocations[1]?.expiryTier).toBe("KNOWN_FACT");
  });

  it("FIFO 1.2 lb draws A 1.0 (acquired first) then B 0.2", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 1.2, policy: "FIFO" });

    expect(shape(plan)).toEqual([
      ["lot-a", -1_000_000n],
      ["lot-b", -200_000n],
    ]);
    expect(plan.shortfallMicros).toBe(0n);
  });

  it("a 4.0 lb request drains all three lots and reports a 0.5 lb shortfall", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 4.0, policy: "FEFO" });

    expect(shape(plan)).toEqual([
      ["lot-b", -500_000n],
      ["lot-a", -1_000_000n],
      ["lot-c", -2_000_000n],
    ]);
    expect(plan.allocatedMicros).toBe(3_500_000n);
    expect(plan.shortfallMicros).toBe(500_000n);
    // Never a negative allocation, never invented stock.
    for (const allocation of plan.allocations) {
      expect(-allocation.qtyDeltaMicros).toBeLessThanOrEqual(allocation.lotBalanceBeforeMicros);
    }
  });

  it("qtyMicros and the equivalent amount produce the same plan", () => {
    const item = workedExampleItem();
    const byAmount = planOrThrow(item, { amount: 1.2, policy: "FEFO" });
    const byMicros = planOrThrow(item, { qtyMicros: 1_200_000n, policy: "FEFO" });
    expect(serialize(byMicros)).toBe(serialize(byAmount));
  });

  it("returns a deep-frozen plan and leaves the aggregate untouched", () => {
    const item = workedExampleItem();
    const before = serialize(item);
    const plan = planOrThrow(item, { amount: 1.2, policy: "FEFO" });

    expect(isDeeplyFrozen(plan)).toBe(true);
    expect(() => {
      (plan.allocations as { length: number }).length = 0;
    }).toThrow(TypeError);
    expect(serialize(item)).toBe(before);
  });
});

describe("planLotConsumption — ordering, ties and undated lots", () => {
  it("FEFO breaks an expiry tie by acquiredAt, then by lot order", () => {
    const item = stockedItem([
      { lotId: "lot-late-acquired", acquiredAt: SEP10, expiresAt: SEP15, stock: 1 },
      { lotId: "lot-no-acquired", expiresAt: SEP15, stock: 1 },
      { lotId: "lot-early-acquired", acquiredAt: SEP05, expiresAt: SEP15, stock: 1 },
    ]);
    const plan = planOrThrow(item, { amount: 3, policy: "FEFO" });
    expect(plan.allocations.map((allocation) => allocation.lotId)).toEqual([
      "lot-early-acquired",
      "lot-late-acquired",
      "lot-no-acquired",
    ]);
  });

  it("FEFO falls back to lot order when expiry and acquisition both tie", () => {
    const item = stockedItem([
      { lotId: "lot-second", acquiredAt: SEP05, expiresAt: SEP15, stock: 1 },
      { lotId: "lot-third", acquiredAt: SEP05, expiresAt: SEP15, stock: 1 },
      { lotId: "lot-fourth", acquiredAt: SEP05, expiresAt: SEP15, stock: 1 },
    ]);
    const plan = planOrThrow(item, { amount: 3, policy: "FEFO" });
    expect(plan.allocations.map((allocation) => allocation.lotId)).toEqual([
      "lot-second",
      "lot-third",
      "lot-fourth",
    ]);
  });

  it("FEFO puts undated lots last, ordered among themselves by acquiredAt", () => {
    const item = stockedItem([
      { lotId: "lot-undated-late", acquiredAt: SEP20, stock: 1 },
      { lotId: "lot-dated", expiresAt: SEP15, acquiredAt: SEP01, stock: 1 },
      { lotId: "lot-undated-never-dated", stock: 1 },
      { lotId: "lot-undated-early", acquiredAt: SEP05, stock: 1 },
    ]);
    const plan = planOrThrow(item, { amount: 4, policy: "FEFO" });
    expect(plan.allocations.map((allocation) => allocation.lotId)).toEqual([
      "lot-dated",
      "lot-undated-early",
      "lot-undated-late",
      "lot-undated-never-dated",
    ]);
  });

  it("FIFO ignores expiry entirely", () => {
    const item = stockedItem([
      { lotId: "lot-expires-later", acquiredAt: SEP01, expiresAt: SEP20, stock: 1 },
      { lotId: "lot-expires-sooner", acquiredAt: SEP10, expiresAt: SEP05, stock: 1 },
    ]);
    expect(
      planOrThrow(item, { amount: 2, policy: "FIFO" }).allocations.map(
        (allocation) => allocation.lotId,
      ),
    ).toEqual(["lot-expires-later", "lot-expires-sooner"]);
    expect(
      planOrThrow(item, { amount: 2, policy: "FEFO" }).allocations.map(
        (allocation) => allocation.lotId,
      ),
    ).toEqual(["lot-expires-sooner", "lot-expires-later"]);
  });

  it("FIFO puts lots with no acquiredAt last, then falls back to lot order", () => {
    const item = stockedItem([
      { lotId: "lot-undated-a", expiresAt: SEP05, stock: 1 },
      { lotId: "lot-undated-b", expiresAt: SEP01, stock: 1 },
      { lotId: "lot-acquired", acquiredAt: SEP20, stock: 1 },
    ]);
    const plan = planOrThrow(item, { amount: 3, policy: "FIFO" });
    expect(plan.allocations.map((allocation) => allocation.lotId)).toEqual([
      "lot-acquired",
      "lot-undated-a",
      "lot-undated-b",
    ]);
  });

  it("skips empty lots and reports them, and reports lots drained by earlier writes", () => {
    const item = stockedItem([
      { lotId: "lot-never-stocked", acquiredAt: SEP01, stock: 0 },
      { lotId: "lot-full", acquiredAt: SEP05, stock: 2 },
      { lotId: "lot-drained", acquiredAt: SEP10, stock: 1 },
    ]);
    const drained = appendTransaction(item, {
      lotId: "lot-drained",
      type: "CONSUME",
      qtyDelta: -1,
      unit: TEST_UNIT,
      actor: TEST_USER,
      occurredAt: SEP10,
      recordedAt: SEP10,
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: "drain",
    });
    expect(drained.status).toBe("appended");

    const plan = planOrThrow(drained.item, { amount: 2, policy: "FIFO" });
    expect(shape(plan)).toEqual([["lot-full", -2_000_000n]]);
    expect(plan.skippedLots).toEqual([
      { lotId: "lot-never-stocked", balanceMicros: 0n, reason: "ZERO_BALANCE" },
      { lotId: "lot-drained", balanceMicros: 0n, reason: "ZERO_BALANCE" },
    ]);
  });

  it("returns an empty plan (all shortfall) when nothing is on hand", () => {
    const item = stockedItem([{ lotId: "lot-a", stock: 0 }]);
    const plan = planOrThrow(item, { amount: 1, policy: "FEFO" });

    expect(plan.allocations).toEqual([]);
    expect(plan.allocatedMicros).toBe(0n);
    expect(plan.shortfallMicros).toBe(1_000_000n);
    expect(inputsOrThrow(plan)).toEqual([]);
    expect(appendTransactions(item, inputsOrThrow(plan)).item).toBe(item);
  });

  it("uses the ledger-derived balance, not a drifting snapshot", () => {
    const item = workedExampleItem();
    // A snapshot that disagrees with its rows is a corruption report, not a
    // number to plan with (this is the guard that lets the planner read derived
    // balances and still be safe).
    const tampered = {
      ...item,
      lots: item.lots.map((lot) =>
        lot.lotId === "lot-b"
          ? { ...lot, currentQty: { ...lot.currentQty, micros: 9_000_000n, amount: 9 } }
          : lot,
      ),
    } as unknown as InventoryItem;

    const outcome = planLotConsumption(tampered, { amount: 1, policy: "FEFO" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("CORRUPT_LEDGER");
  });
});

describe("planLotConsumption — rejections", () => {
  const item = workedExampleItem();

  it("rejects an unknown policy", () => {
    expect(
      planRejection(item, { amount: 1, policy: "LIFO" } as unknown as ConsumptionRequest),
    ).toBe("INVALID_FIELD");
    expect(planRejection(item, { amount: 1 } as unknown as ConsumptionRequest)).toBe(
      "INVALID_FIELD",
    );
  });

  it("rejects a non-positive or unrepresentable request", () => {
    expect(planRejection(item, { amount: 0, policy: "FEFO" })).toBe("ZERO_DELTA");
    expect(planRejection(item, { qtyMicros: 0n, policy: "FEFO" })).toBe("ZERO_DELTA");
    expect(planRejection(item, { amount: -1, policy: "FEFO" })).toBe("WRONG_SIGN");
    expect(planRejection(item, { qtyMicros: -1n, policy: "FEFO" })).toBe("WRONG_SIGN");
    expect(planRejection(item, { amount: 0.000_000_1, policy: "FEFO" })).toBe("PRECISION_EXCEEDED");
    expect(planRejection(item, { amount: Number.NaN, policy: "FEFO" })).toBe("NOT_FINITE");
    expect(planRejection(item, { qtyMicros: 100_000_000_000_001n, policy: "FEFO" })).toBe(
      "QUANTITY_OUT_OF_RANGE",
    );
    expect(planRejection(item, { amount: 1e9, policy: "FEFO" })).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("rejects a request that states both or neither quantity form", () => {
    expect(
      planRejection(item, {
        amount: 1,
        qtyMicros: 1_000_000n,
        policy: "FEFO",
      } as unknown as ConsumptionRequest),
    ).toBe("INVALID_FIELD");
    expect(planRejection(item, { policy: "FEFO" } as unknown as ConsumptionRequest)).toBe(
      "INVALID_FIELD",
    );
    expect(
      planRejection(item, { qtyMicros: 1, policy: "FEFO" } as unknown as ConsumptionRequest),
    ).toBe("INVALID_FIELD");
  });

  it("rejects a malformed aggregate or request object instead of throwing", () => {
    expect(planRejection(null as unknown as InventoryItem, { amount: 1, policy: "FEFO" })).toBe(
      "INVALID_FIELD",
    );
    expect(
      planRejection({ ...item, lots: "nope" } as unknown as InventoryItem, {
        amount: 1,
        policy: "FEFO",
      }),
    ).toBe("INVALID_FIELD");
    expect(planRejection(item, null as unknown as ConsumptionRequest)).toBe("INVALID_FIELD");
  });

  it("rejects a lot carrying an unparseable date rather than ordering on NaN", () => {
    const broken = {
      ...item,
      lots: item.lots.map((lot) =>
        lot.lotId === "lot-a" ? { ...lot, expiresAt: "next tuesday" } : lot,
      ),
    } as unknown as InventoryItem;
    const outcome = planLotConsumption(broken, { amount: 1, policy: "FEFO" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("INVALID_TIMESTAMP");
      expect(outcome.error.field).toBe("lot-a");
    }

    const brokenAcquired = {
      ...item,
      lots: item.lots.map((lot) =>
        lot.lotId === "lot-c" ? { ...lot, acquiredAt: "2026-13-45T99:99:99Z" } : lot,
      ),
    } as unknown as InventoryItem;
    expect(planRejection(brokenAcquired, { amount: 1, policy: "FIFO" })).toBe("INVALID_TIMESTAMP");
  });

  it("review F1: refuses an item carrying the same lotId twice instead of double-allocating", () => {
    // `sumLotDeltaMicros` sums by id, so both copies report the same balance and
    // a planner that trusted the list would allocate 1.0 lb of stock twice.
    const base = stockedItem([{ lotId: "L1", acquiredAt: SEP01, stock: 1.0 }]);
    const dup = {
      ...base,
      lots: [base.lots[0], { ...base.lots[0] }],
    } as unknown as InventoryItem;

    const outcome = planLotConsumption(dup, { qtyMicros: 2_000_000n, policy: "FIFO" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("DUPLICATE_LOT");
      expect(outcome.error.field).toBe("L1");
    }
    // The same item without the duplicate plans normally and can only take 1.0.
    expect(planOrThrow(base, { qtyMicros: 2_000_000n, policy: "FIFO" }).allocatedMicros).toBe(
      1_000_000n,
    );
    expect(planRejection(dup, { qtyMicros: 2_000_000n, policy: "FEFO" })).toBe("DUPLICATE_LOT");
  });

  it("review F4: reads each request field exactly once (a shifty getter cannot change it)", () => {
    let reads = 0;
    const shifty = {
      policy: "FEFO",
      get qtyMicros(): unknown {
        reads += 1;
        // bigint to the type check, number to anything that reads again.
        return reads === 1 ? 1_000_000n : 1_000_000;
      },
    } as unknown as ConsumptionRequest;

    const plan = planOrThrow(item, shifty);
    expect(reads).toBe(1);
    expect(typeof plan.requestedMicros).toBe("bigint");
    expect(plan.requestedMicros).toBe(1_000_000n);
    expect(typeof plan.allocatedMicros).toBe("bigint");
    expect(typeof plan.shortfallMicros).toBe("bigint");

    let amountReads = 0;
    const shiftyAmount = {
      policy: "FIFO",
      get amount(): unknown {
        amountReads += 1;
        return amountReads === 1 ? 1 : "1";
      },
    } as unknown as ConsumptionRequest;
    expect(planOrThrow(item, shiftyAmount).requestedMicros).toBe(1_000_000n);
    expect(amountReads).toBe(1);
  });
});

describe("consumptionInputsFromPlan — derived writes", () => {
  it("copies the base by explicit field list and derives per-lot keys", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 1.2, policy: "FEFO" });
    const inputs = inputsOrThrow(plan);

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toEqual({
      lotId: "lot-b",
      type: "USE_IN_MEAL",
      qtyDelta: -0.5,
      unit: TEST_UNIT,
      reason: "dinner",
      actor: TEST_USER,
      occurredAt: OCCURRED_AT,
      recordedAt: OCCURRED_AT,
      provenance: { tier: "KNOWN_FACT", source: "meal-log" },
      idempotencyKey: `meal-42${PLAN_KEY_INFIX}0`,
      correlationRef: { kind: "meal-log", id: "meal-42" },
    });
    expect(inputs[1]?.idempotencyKey).toBe(`meal-42${PLAN_KEY_INFIX}1`);
    expect(isDeeplyFrozen(inputs)).toBe(true);
  });

  it("drops undeclared fields and never carries the caller's own objects", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 0.1, policy: "FEFO" });
    const provenance = { tier: "KNOWN_FACT" as const, source: "meal-log" };
    const smuggled = {
      ...MEAL_BASE,
      provenance,
      systemFlag: { kind: "OVER_CONSUMPTION" },
      smuggledField: "nope",
    } as unknown as ConsumptionInputBase;

    const inputs = inputsOrThrow(plan, smuggled);
    expect(serialize(inputs)).not.toContain("OVER_CONSUMPTION");
    expect(serialize(inputs)).not.toContain("smuggledField");
    expect(inputs[0]?.provenance).not.toBe(provenance);
    expect(inputs[0]?.provenance).toEqual(provenance);
    // Freezing our copies must not freeze the caller's object.
    expect(Object.isFrozen(provenance)).toBe(false);
  });

  it("omits optional fields the base did not carry", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 0.1, policy: "FEFO" });
    const lean: ConsumptionInputBase = {
      type: "CONSUME",
      unit: TEST_UNIT,
      actor: TEST_USER,
      occurredAt: OCCURRED_AT,
      recordedAt: OCCURRED_AT,
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: "meal-lean",
    };
    const inputs = inputsOrThrow(plan, lean);
    expect(inputs[0]).not.toHaveProperty("reason");
    expect(inputs[0]).not.toHaveProperty("correlationRef");
  });

  it("rejects a base that is not a consuming transaction type", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 0.1, policy: "FEFO" });
    for (const type of ["PURCHASE", "INITIAL_STOCK", "ADJUSTMENT"] as const) {
      expect(inputsRejection(plan, { ...MEAL_BASE, type })).toBe("INVALID_FIELD");
    }
    for (const type of ["CONSUME", "USE_IN_MEAL", "DISCARD", "EXPIRE", "DONATE"] as const) {
      expect(consumptionInputsFromPlan(plan, { ...MEAL_BASE, type }).ok).toBe(true);
    }
    expect(
      inputsRejection(plan, { ...MEAL_BASE, type: "NOPE" } as unknown as ConsumptionInputBase),
    ).toBe("INVALID_FIELD");
  });

  it("rejects base keys that could collide with a reserved or derived namespace", () => {
    const plan = planOrThrow(workedExampleItem(), { amount: 0.1, policy: "FEFO" });
    expect(inputsRejection(plan, { ...MEAL_BASE, idempotencyKey: "meal::42" })).toBe(
      "INVALID_IDEMPOTENCY_KEY",
    );
    expect(inputsRejection(plan, { ...MEAL_BASE, idempotencyKey: `meal${PLAN_KEY_INFIX}0` })).toBe(
      "INVALID_IDEMPOTENCY_KEY",
    );
    expect(inputsRejection(plan, { ...MEAL_BASE, idempotencyKey: "  " })).toBe("INVALID_FIELD");
  });

  it("rejects a hand-built plan that would overdraw, invert or double-book a lot", () => {
    const template = planOrThrow(workedExampleItem(), { amount: 1.2, policy: "FEFO" });
    const withAllocations = (allocations: unknown): ConsumptionPlan =>
      ({ ...template, allocations }) as unknown as ConsumptionPlan;

    expect(
      inputsRejection(
        withAllocations([
          { lotId: "lot-b", qtyDeltaMicros: -900_000n, lotBalanceBeforeMicros: 500_000n },
        ]),
        MEAL_BASE,
      ),
    ).toBe("WRONG_SIGN");
    expect(
      inputsRejection(
        withAllocations([
          { lotId: "lot-b", qtyDeltaMicros: 500_000n, lotBalanceBeforeMicros: 500_000n },
        ]),
        MEAL_BASE,
      ),
    ).toBe("WRONG_SIGN");
    expect(
      inputsRejection(
        withAllocations([{ lotId: "lot-b", qtyDeltaMicros: 0n, lotBalanceBeforeMicros: 500_000n }]),
        MEAL_BASE,
      ),
    ).toBe("ZERO_DELTA");
    expect(
      inputsRejection(
        withAllocations([
          { lotId: "lot-b", qtyDeltaMicros: -100_000n, lotBalanceBeforeMicros: 500_000n },
          { lotId: "lot-b", qtyDeltaMicros: -100_000n, lotBalanceBeforeMicros: 500_000n },
        ]),
        MEAL_BASE,
      ),
    ).toBe("INVALID_FIELD");
    expect(
      inputsRejection(
        withAllocations([
          {
            lotId: "lot-b",
            qtyDeltaMicros: -100_000_000_000_001n,
            lotBalanceBeforeMicros: 900_000_000_000_000n,
          },
        ]),
        MEAL_BASE,
      ),
    ).toBe("QUANTITY_OUT_OF_RANGE");
    // Review F3: an allocation that does not state the balance it was capped
    // against cannot be checked, so it is refused rather than trusted — the
    // reviewer's repro applied cleanly and produced a real clamp before this.
    const unstatedBalance = {
      policy: "FEFO",
      requestedMicros: 9_000_000n,
      allocatedMicros: 9_000_000n,
      shortfallMicros: 0n,
      skippedLots: [],
      allocations: [{ lotId: "lot-b", qtyDeltaMicros: -9_000_000n }],
    } as unknown as ConsumptionPlan;
    expect(inputsRejection(unstatedBalance, MEAL_BASE)).toBe("INVALID_FIELD");
    expect(
      inputsRejection(
        withAllocations([
          { lotId: "lot-b", qtyDeltaMicros: -9_000_000n, lotBalanceBeforeMicros: 500000 },
        ]),
        MEAL_BASE,
      ),
    ).toBe("INVALID_FIELD");
    expect(inputsRejection(withAllocations("nope"), MEAL_BASE)).toBe("INVALID_FIELD");
    expect(inputsRejection(withAllocations([null]), MEAL_BASE)).toBe("INVALID_FIELD");
    expect(inputsRejection(template, null as unknown as ConsumptionInputBase)).toBe(
      "INVALID_FIELD",
    );
    expect(
      inputsRejection(template, {
        ...MEAL_BASE,
        actor: { kind: "nope" },
      } as unknown as ConsumptionInputBase),
    ).toBe("INVALID_FIELD");
    expect(
      inputsRejection(template, {
        ...MEAL_BASE,
        provenance: null,
      } as unknown as ConsumptionInputBase),
    ).toBe("INVALID_FIELD");
  });
});

describe("applying a plan through the ledger", () => {
  it("records the whole consumption with no clamp, and replays as duplicates", () => {
    const item = workedExampleItem();
    const beforeMicros = item.currentQty.micros;
    const plan = planOrThrow(item, { amount: 1.2, policy: "FEFO" });
    const inputs = inputsOrThrow(plan);

    const applied = appendTransactions(item, inputs);
    for (const result of applied.results) {
      expect(result.status).toBe("appended");
      if (result.status === "appended") expect(result.clampAdjustment).toBeUndefined();
    }
    expect(applied.item.currentQty.micros).toBe(beforeMicros - plan.allocatedMicros);
    expect(sumLotDeltaMicros(applied.item.transactions, "lot-b")).toBe(0n);
    expect(sumLotDeltaMicros(applied.item.transactions, "lot-a")).toBe(300_000n);
    expect(sumLotDeltaMicros(applied.item.transactions, "lot-c")).toBe(2_000_000n);
    expect(reconcile(applied.item).ok).toBe(true);

    // No derived key may enter the ledger's reserved namespace.
    for (const input of inputs) expect(input.idempotencyKey).not.toContain("::");

    const replay = appendTransactions(applied.item, inputs);
    for (const result of replay.results) expect(result.status).toBe("duplicate");
    expect(replay.item).toBe(applied.item);
  });

  it("an over-request drains the item to zero without a clamp", () => {
    const item = workedExampleItem();
    const plan = planOrThrow(item, { amount: 4, policy: "FEFO" });
    const applied = appendTransactions(item, inputsOrThrow(plan));

    for (const result of applied.results) {
      expect(result.status).toBe("appended");
      if (result.status === "appended") expect(result.clampAdjustment).toBeUndefined();
    }
    expect(applied.item.currentQty.micros).toBe(0n);
    expect(applied.item.transactions.some((row) => row.systemFlag !== undefined)).toBe(false);
    // The shortfall is the caller's to act on; the ledger was never overdrawn.
    expect(plan.shortfallMicros).toBe(500_000n);
  });

  it("a partial replay under a changed plan conflicts loudly instead of double-consuming", () => {
    const item = workedExampleItem();
    const first = appendTransactions(
      item,
      inputsOrThrow(planOrThrow(item, { amount: 1.2, policy: "FEFO" })),
    );
    // Same meal (same base key), a different quantity: index 0 now means a
    // different payload, so the ledger refuses rather than silently accepting.
    const second = appendTransactions(
      first.item,
      inputsOrThrow(planOrThrow(first.item, { amount: 0.3, policy: "FEFO" })),
    );
    const codes = second.results.map((result) =>
      result.status === "rejected" ? result.error.code : result.status,
    );
    expect(codes).toEqual(["IDEMPOTENCY_KEY_CONFLICT"]);
    expect(second.item).toBe(first.item);
  });
});

// --------------------------------------------------------------------------
// Properties
// --------------------------------------------------------------------------

const DATES = [SEP01, SEP05, SEP10, SEP15, SEP20] as const;

interface LotSpec {
  readonly expiryIndex: number | undefined;
  readonly acquiredIndex: number | undefined;
  readonly stockMicros: number;
}

const lotSpecArb: fc.Arbitrary<LotSpec> = fc.record({
  // A small date pool on purpose: ties are the interesting case.
  expiryIndex: fc.option(fc.integer({ min: 0, max: DATES.length - 1 }), { nil: undefined }),
  acquiredIndex: fc.option(fc.integer({ min: 0, max: DATES.length - 1 }), { nil: undefined }),
  stockMicros: fc.integer({ min: 0, max: 2_000_000 }),
});

interface Scenario {
  readonly lots: readonly LotSpec[];
  readonly requestMicros: number;
  readonly policy: LotSelectionPolicy;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  lots: fc.array(lotSpecArb, { minLength: 1, maxLength: 5 }),
  requestMicros: fc.integer({ min: 1, max: 9_000_000 }),
  policy: fc.constantFrom<LotSelectionPolicy>("FEFO", "FIFO"),
});

function scenarioItem(specs: readonly LotSpec[]): InventoryItem {
  return stockedItem(
    specs.map((spec, index) => {
      const expiresAt = spec.expiryIndex === undefined ? undefined : DATES[spec.expiryIndex];
      const acquiredAt = spec.acquiredIndex === undefined ? undefined : DATES[spec.acquiredIndex];
      return {
        lotId: `lot-${String(index)}`,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(acquiredAt === undefined ? {} : { acquiredAt }),
        stock: microsToAmount(BigInt(spec.stockMicros)),
      };
    }),
  );
}

/** On-hand total derived from the ledger, independent of the planner. */
function onHandMicros(item: InventoryItem): bigint {
  return item.lots.reduce(
    (total, lot) => total + sumLotDeltaMicros(item.transactions, lot.lotId),
    0n,
  );
}

/**
 * Ordering key re-derived from the spec (not from the implementation), so a
 * flipped comparator in `lot-selection.ts` shows up here.
 */
function orderKey(item: InventoryItem, lotId: string, policy: LotSelectionPolicy): number[] {
  const index = item.lots.findIndex((lot) => lot.lotId === lotId);
  const lot = item.lots[index];
  const expiry = lot?.expiresAt === undefined ? undefined : Date.parse(lot.expiresAt);
  const acquired = lot?.acquiredAt === undefined ? undefined : Date.parse(lot.acquiredAt);
  const expiryPart = policy === "FEFO" ? [expiry === undefined ? 1 : 0, expiry ?? 0] : [0, 0];
  return [...expiryPart, acquired === undefined ? 1 : 0, acquired ?? 0, index];
}

function keyBefore(left: readonly number[], right: readonly number[]): boolean {
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return value < other;
  }
  return false;
}

describe("properties — planner invariants", () => {
  it("P1: every allocation is bounded by its lot, and Σ = min(requested, on hand)", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const plan = planOrThrow(item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });

        const onHand = onHandMicros(item);
        const expected = onHand < plan.requestedMicros ? onHand : plan.requestedMicros;
        expect(plan.allocatedMicros).toBe(expected);
        expect(plan.allocatedMicros + plan.shortfallMicros).toBe(plan.requestedMicros);
        expect(plan.shortfallMicros >= 0n).toBe(true);

        let total = 0n;
        const seen = new Set<string>();
        for (const allocation of plan.allocations) {
          const balance = sumLotDeltaMicros(item.transactions, allocation.lotId);
          expect(allocation.lotBalanceBeforeMicros).toBe(balance);
          expect(allocation.qtyDeltaMicros < 0n).toBe(true);
          expect(-allocation.qtyDeltaMicros <= balance).toBe(true);
          expect(seen.has(allocation.lotId)).toBe(false);
          seen.add(allocation.lotId);
          total += -allocation.qtyDeltaMicros;
        }
        expect(total).toBe(plan.allocatedMicros);
      }),
    );
  });

  it("P2: allocations follow the policy order, and no unused lot could have come first", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const plan = planOrThrow(item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });
        const keys = plan.allocations.map((allocation) =>
          orderKey(item, allocation.lotId, scenario.policy),
        );
        for (let index = 1; index < keys.length; index += 1) {
          expect(keyBefore(keys[index] ?? [], keys[index - 1] ?? [])).toBe(false);
        }

        // Any positive-balance lot left out must sort after every allocated one.
        const used = new Set(plan.allocations.map((allocation) => allocation.lotId));
        const last = keys[keys.length - 1];
        for (const lot of item.lots) {
          if (used.has(lot.lotId)) continue;
          if (sumLotDeltaMicros(item.transactions, lot.lotId) <= 0n) continue;
          expect(plan.shortfallMicros).toBe(0n);
          if (last !== undefined) {
            expect(keyBefore(orderKey(item, lot.lotId, scenario.policy), last)).toBe(false);
          }
        }
      }),
    );
  });

  it("P3: applying a plan never clamps, and moves exactly the allocated quantity", () => {
    let appliedRuns = 0;
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const plan = planOrThrow(item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });
        const applied = appendTransactions(item, inputsOrThrow(plan));

        for (const result of applied.results) {
          expect(result.status).toBe("appended");
          if (result.status === "appended") {
            expect(result.clampAdjustment).toBeUndefined();
          }
        }
        expect(applied.item.transactions.some((row) => row.systemFlag !== undefined)).toBe(false);
        expect(applied.item.currentQty.micros).toBe(item.currentQty.micros - plan.allocatedMicros);
        expect(applied.item.currentQty.micros >= 0n).toBe(true);
        expect(reconcile(applied.item).ok).toBe(true);
        if (plan.allocations.length > 0) appliedRuns += 1;
      }),
    );
    expect(appliedRuns).toBeGreaterThan(0);
  });

  it("P4: the plan is deterministic and the aggregate is never mutated", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const before = serialize(item);
        const request: ConsumptionRequest = {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        };
        const first = planOrThrow(item, request);
        const second = planOrThrow(item, request);

        expect(second).toEqual(first);
        expect(serialize(second)).toBe(serialize(first));
        expect(isDeeplyFrozen(first)).toBe(true);
        expect(serialize(item)).toBe(before);
        expect(isDeeplyFrozen(item)).toBe(true);
      }),
    );
  });

  it("P5: derived keys are unique, outside the reserved namespace, and replay clean", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const plan = planOrThrow(item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });
        const inputs = inputsOrThrow(plan);

        const keys = inputs.map((input) => input.idempotencyKey);
        expect(new Set(keys).size).toBe(keys.length);
        for (const key of keys) {
          expect(key).not.toContain("::");
          expect(key.startsWith(`${MEAL_BASE.idempotencyKey}${PLAN_KEY_INFIX}`)).toBe(true);
        }

        const applied = appendTransactions(item, inputs);
        const replay = appendTransactions(applied.item, inputs);
        for (const result of replay.results) expect(result.status).toBe("duplicate");
        expect(replay.item).toBe(applied.item);
      }),
    );
  });

  it("P6: a second plan on the applied item still never clamps (drained lots are skipped)", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario: Scenario) => {
        const item = scenarioItem(scenario.lots);
        const firstPlan = planOrThrow(item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });
        const applied = appendTransactions(item, inputsOrThrow(firstPlan));

        const secondPlan = planOrThrow(applied.item, {
          qtyMicros: BigInt(scenario.requestMicros),
          policy: scenario.policy,
        });
        const inputs = inputsOrThrow(secondPlan, { ...MEAL_BASE, idempotencyKey: "meal-43" });
        const twice = appendTransactions(applied.item, inputs);

        for (const result of twice.results) {
          expect(result.status).toBe("appended");
          if (result.status === "appended") expect(result.clampAdjustment).toBeUndefined();
        }
        expect(twice.item.currentQty.micros >= 0n).toBe(true);
        for (const skipped of secondPlan.skippedLots) {
          expect(skipped.reason).toBe("ZERO_BALANCE");
        }
      }),
    );
  });
});
