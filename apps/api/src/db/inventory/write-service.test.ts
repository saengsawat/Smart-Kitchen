/**
 * The write path's two pure decisions (M2-T2, review F6).
 *
 * `planWrite` and `increaseLot` are functions of an aggregate and a command, so
 * they are tested as such: in memory, with items built by the domain's own
 * `createInventoryItem` and `appendTransaction`, no database, no HTTP. The
 * end-to-end behaviour is proved in `http/inventory-writes.db.test.ts`; what is
 * covered here is the fan-out of refusals and the lot-choice ordering, where
 * reaching every branch through a database round trip would cost a second per
 * assertion and prove no more.
 *
 * `increaseLot`'s ordering rule is worth stating: an increase lands on the most
 * recently acquired lot that still holds something, falling back to the most
 * recently acquired lot of any balance; a dated lot always beats an undated one
 * (an unknown date is not a claim of recency), and a tie falls to the later lot
 * in the item's own order.
 */

import {
  appendTransaction,
  createInventoryItem,
  type InventoryItem,
  type LotInput,
} from "@smart-kitchen/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertWholeCount,
  CountNotWholeError,
  increaseLot,
  isCountUnit,
  isWholeMicros,
  planWrite,
  LedgerWriteRejectedError,
  type InventoryWriteCommand,
} from "./write-service.js";

const HOUSEHOLD = "f1c70000-0000-4000-8000-000000000001";
const ITEM = "11111111-1111-4111-8111-111111111111";
const USER = "f1c70001-0000-4000-8000-000000000001";
const AT = "2026-09-22T12:00:00.000Z";

/** An item with the given lots and, optionally, an opening quantity per lot. */
function itemWith(
  lots: readonly LotInput[],
  stock: Readonly<Record<string, number>> = {},
  unit = "lb",
): InventoryItem {
  const created = createInventoryItem({
    itemId: ITEM,
    householdId: HOUSEHOLD,
    unit,
    lots,
  });
  if (!created.ok) throw new Error(`fixture item was refused: ${created.error.message}`);

  let item = created.value;
  let index = 0;
  for (const [lotId, amount] of Object.entries(stock)) {
    const result = appendTransaction(item, {
      lotId,
      type: "PURCHASE",
      qtyDelta: amount,
      unit,
      actor: { kind: "user", userId: USER },
      occurredAt: AT,
      recordedAt: AT,
      provenance: { tier: "KNOWN_FACT", source: "test-fixture" },
      idempotencyKey: `stock-${String(index)}`,
    });
    index += 1;
    if (result.status !== "appended") throw new Error(`fixture stock was refused for ${lotId}`);
    item = result.item;
  }
  return item;
}

function command(overrides: Partial<InventoryWriteCommand>): InventoryWriteCommand {
  return {
    idempotencyKey: "key-1",
    type: "ADJUSTMENT",
    occurredAt: AT,
    recordedAt: AT,
    actorUserId: USER,
    ...overrides,
  };
}

/** The code `planWrite` refused with, or a failure if it did not refuse. */
function refusal(item: InventoryItem, overrides: Partial<InventoryWriteCommand>): string {
  try {
    planWrite(item, command(overrides));
  } catch (error) {
    if (error instanceof LedgerWriteRejectedError) return error.ledgerError.code;
    throw error;
  }
  throw new Error("expected the command to be refused, but it planned successfully");
}

describe("increaseLot", () => {
  it("prefers a lot that still holds something", () => {
    const item = itemWith(
      [
        { lotId: "lot-a", acquiredAt: "2026-09-01T00:00:00.000Z" },
        { lotId: "lot-b", acquiredAt: "2026-09-20T00:00:00.000Z" },
      ],
      { "lot-a": 1 },
    );
    // lot-b was acquired later but is empty, so the open lot wins.
    expect(increaseLot(item)?.lotId).toBe("lot-a");
  });

  it("takes the most recently acquired of the open lots", () => {
    const item = itemWith(
      [
        { lotId: "lot-a", acquiredAt: "2026-09-01T00:00:00.000Z" },
        { lotId: "lot-b", acquiredAt: "2026-09-20T00:00:00.000Z" },
      ],
      { "lot-a": 1, "lot-b": 1 },
    );
    expect(increaseLot(item)?.lotId).toBe("lot-b");
  });

  it("lets a dated lot beat an undated one, whatever the order", () => {
    const datedFirst = itemWith(
      [{ lotId: "dated", acquiredAt: "2026-09-01T00:00:00.000Z" }, { lotId: "undated" }],
      { dated: 1, undated: 1 },
    );
    const undatedFirst = itemWith(
      [{ lotId: "undated" }, { lotId: "dated", acquiredAt: "2026-09-01T00:00:00.000Z" }],
      { dated: 1, undated: 1 },
    );

    expect(increaseLot(datedFirst)?.lotId).toBe("dated");
    expect(increaseLot(undatedFirst)?.lotId).toBe("dated");
  });

  it("breaks a tie on the later lot in the item's own order", () => {
    const item = itemWith(
      [
        { lotId: "lot-a", acquiredAt: "2026-09-10T00:00:00.000Z" },
        { lotId: "lot-b", acquiredAt: "2026-09-10T00:00:00.000Z" },
      ],
      { "lot-a": 1, "lot-b": 1 },
    );
    expect(increaseLot(item)?.lotId).toBe("lot-b");
  });

  it("falls back to the later of two undated lots", () => {
    const item = itemWith([{ lotId: "lot-a" }, { lotId: "lot-b" }], { "lot-a": 1, "lot-b": 1 });
    expect(increaseLot(item)?.lotId).toBe("lot-b");
  });

  it("falls back to the closed lots when nothing is open", () => {
    const item = itemWith([
      { lotId: "lot-a", acquiredAt: "2026-09-01T00:00:00.000Z" },
      { lotId: "lot-b", acquiredAt: "2026-09-20T00:00:00.000Z" },
    ]);
    expect(increaseLot(item)?.lotId).toBe("lot-b");
  });

  it("has nothing to choose on an item with no lots", () => {
    expect(increaseLot(itemWith([]))).toBeUndefined();
  });

  it("ignores an unparseable acquiredAt rather than ranking on NaN", () => {
    // The domain refuses an unparseable `acquiredAt` when a lot is opened, so
    // a stored item cannot carry one and this input has to be hand built. The
    // guard stays because the alternative is a comparison against NaN, which
    // is false in both directions and would make the choice depend on
    // iteration order (the M1-T8 hand-built-input hardening, same reasoning).
    const item = {
      itemId: ITEM,
      householdId: HOUSEHOLD,
      unit: "lb",
      lots: [
        { lotId: "broken", acquiredAt: "not-a-date", currentQty: { unit: "lb", micros: 1n } },
        { lotId: "fine", currentQty: { unit: "lb", micros: 1n } },
      ],
      transactions: [],
      currentQty: { unit: "lb", micros: 2n },
      nextSequence: 1,
    } as unknown as InventoryItem;

    // Neither lot has a usable date, so the rule falls to lot order.
    expect(increaseLot(item)?.lotId).toBe("fine");
  });
});

describe("planWrite validation", () => {
  const stocked = (): InventoryItem => itemWith([{ lotId: "lot-a" }], { "lot-a": 8 });

  it.each([
    ["neither targetAmount nor deltaAmount", {}, "INVALID_FIELD"],
    ["both targetAmount and deltaAmount", { targetAmount: "1", deltaAmount: "1" }, "INVALID_FIELD"],
    ["amount on an ADJUSTMENT", { amount: "1" }, "INVALID_FIELD"],
    ["a target equal to the balance", { targetAmount: "8" }, "ZERO_DELTA"],
    ["a delta of zero", { deltaAmount: "0" }, "ZERO_DELTA"],
    ["a negative target", { targetAmount: "-5" }, "QUANTITY_OUT_OF_RANGE"],
    ["a target with too much precision", { targetAmount: "1.2345678" }, "PRECISION_EXCEEDED"],
    ["a target outside the ledger range", { targetAmount: "100000001" }, "QUANTITY_OUT_OF_RANGE"],
    ["a target that is not a decimal", { targetAmount: "eight" }, "INVALID_FIELD"],
  ])("refuses an ADJUSTMENT with %s", (_case, overrides, code) => {
    expect(refusal(stocked(), overrides)).toBe(code);
  });

  it.each([
    ["targetAmount", { type: "CONSUME" as const, targetAmount: "1" }, "INVALID_FIELD"],
    ["deltaAmount", { type: "CONSUME" as const, deltaAmount: "-1" }, "INVALID_FIELD"],
    ["a negative amount", { type: "DISCARD" as const, amount: "-1" }, "WRONG_SIGN"],
    ["a zero amount", { type: "EXPIRE" as const, amount: "0" }, "ZERO_DELTA"],
  ])("refuses a removal with %s", (_case, overrides, code) => {
    expect(refusal(stocked(), overrides)).toBe(code);
  });

  it("refuses a full removal of an item with nothing on hand", () => {
    const empty = itemWith([{ lotId: "lot-a" }]);
    expect(refusal(empty, { type: "CONSUME" })).toBe("ZERO_DELTA");
  });

  it("refuses a removal on an item with no lot to record it against", () => {
    expect(refusal(itemWith([]), { type: "CONSUME", amount: "1" })).toBe("UNKNOWN_LOT");
  });

  /**
   * The specific hole review F2 found: `targetAmount: "-5"` on an item holding
   * 8 used to become a decrease of 13, which drained every lot and left the
   * ledger minting an OVER_CONSUMPTION clamp for a malformed request. A clamp
   * is evidence that our record was wrong, and the correction-rate KPI counts
   * it, so a client bug must never be able to manufacture one.
   */
  it("plans no overshoot for a negative target, so no clamp can be minted", () => {
    expect(refusal(stocked(), { targetAmount: "-5" })).toBe("QUANTITY_OUT_OF_RANGE");
  });
});

describe("planWrite output", () => {
  it("plans one row on the open lot for an increase", () => {
    const item = itemWith([{ lotId: "lot-a" }], { "lot-a": 1 });
    const planned = planWrite(item, command({ targetAmount: "1.5" }));

    expect(planned.inputs).toHaveLength(1);
    expect(planned.inputs[0]?.lotId).toBe("lot-a");
    expect(planned.inputs[0]?.qtyDelta).toBe(0.5);
    expect(planned.inputs[0]?.idempotencyKey).toBe("key-1/lot/0");
    expect(planned.newLot).toBeUndefined();
  });

  it("opens a lot when the item has none and the change is an increase", () => {
    const planned = planWrite(itemWith([]), command({ targetAmount: "2" }));

    expect(planned.newLot?.acquiredAt).toBe(AT);
    expect(planned.inputs[0]?.lotId).toBe(planned.newLot?.lotId);
  });

  it("splits a removal across lots by expiry, keeping the derived keys in order", () => {
    const item = itemWith(
      [
        { lotId: "lot-late", expiresAt: "2026-12-01T00:00:00.000Z" },
        { lotId: "lot-soon", expiresAt: "2026-10-01T00:00:00.000Z" },
      ],
      { "lot-late": 5, "lot-soon": 2 },
    );
    const planned = planWrite(item, command({ type: "CONSUME", amount: "4" }));

    expect(planned.inputs.map((input) => [input.lotId, input.qtyDelta])).toEqual([
      ["lot-soon", -2],
      ["lot-late", -2],
    ]);
    expect(planned.inputs.map((input) => input.idempotencyKey)).toEqual([
      "key-1/lot/0",
      "key-1/lot/1",
    ]);
  });

  it("records an overshoot as its own row against the last lot the plan touched", () => {
    const item = itemWith([{ lotId: "lot-a" }], { "lot-a": 2 });
    const planned = planWrite(item, command({ type: "CONSUME", amount: "3" }));

    // The planner's own rows never overdraw a lot; the uncovered part is this
    // extra row, and the ledger is what turns it into a clamp.
    expect(planned.inputs.map((input) => input.qtyDelta)).toEqual([-2, -1]);
    expect(planned.inputs.every((input) => input.lotId === "lot-a")).toBe(true);
    expect(planned.inputs[1]?.idempotencyKey).toBe("key-1/lot/1");
  });

  it("carries the actor from the command and never from a lot or a request field", () => {
    const item = itemWith([{ lotId: "lot-a" }], { "lot-a": 2 });
    const planned = planWrite(item, command({ type: "CONSUME", amount: "1", reason: "Spoiled" }));

    expect(planned.inputs[0]?.actor).toEqual({ kind: "user", userId: USER });
    expect(planned.inputs[0]?.reason).toBe("Spoiled");
    expect(planned.inputs[0]?.provenance).toEqual({
      tier: "KNOWN_FACT",
      source: "manual-entry",
    });
  });
});

/**
 * D-029 (M2-T8): count units take whole numbers on every new write. The
 * end-to-end answer (400 `COUNT_NOT_WHOLE`) is proved over HTTP in
 * `http/inventory-writes.db.test.ts`; here every branch of the rule is hit
 * through the pure planner, against items whose balance is built by the
 * domain's own ledger (so a fractional balance is real history, the way an
 * item written before D-029 holds it).
 */
describe("D-029 whole-count helpers", () => {
  it.each([
    "count",
    "counts",
    "ct",
    "each",
    "ea",
    "unit",
    "units",
    "pc",
    "pcs",
    "piece",
    "pieces",
    "EACH",
    " Count ",
  ])("treats %j as a count unit", (unit) => {
    expect(isCountUnit(unit)).toBe(true);
  });

  it.each(["lb", "oz", "g", "kg", "ml", "l", "cup", "tsp", "tbsp", "bottle", "", "dozen"])(
    "does not treat %j as a count unit (mass, volume, or not in the registry)",
    (unit) => {
      expect(isCountUnit(unit)).toBe(false);
    },
  );

  it.each([
    [0n, true],
    [1_000_000n, true],
    [12_000_000n, true],
    [-3_000_000n, true],
    [12_500_000n, false],
    [1n, false],
    [999_999n, false],
    [-500_000n, false],
  ])("isWholeMicros(%s) is %s", (micros, whole) => {
    expect(isWholeMicros(micros)).toBe(whole);
  });

  it("assertWholeCount refuses a fraction only in a count unit", () => {
    expect(() => assertWholeCount("each", 2_500_000n, "amount")).toThrow(CountNotWholeError);
    expect(() => assertWholeCount("each", 2_000_000n, "amount")).not.toThrow();
    expect(() => assertWholeCount("lb", 2_500_000n, "amount")).not.toThrow();
  });
});

describe("planWrite: count units take whole numbers (D-029)", () => {
  /** A count item holding exactly `balance` (12.5 is history written before D-029). */
  const countItem = (balance: number, unit = "count"): InventoryItem =>
    itemWith([{ lotId: "lot-a" }], balance === 0 ? {} : { "lot-a": balance }, unit);

  /** The field a `CountNotWholeError` named, a ledger code, or "planned". */
  function countVerdict(
    item: InventoryItem,
    overrides: Partial<InventoryWriteCommand>,
    options?: { readonly wholeCountRule: boolean },
  ): string {
    try {
      planWrite(item, command(overrides), options);
    } catch (error) {
      if (error instanceof CountNotWholeError) return `refused:${error.field}`;
      if (error instanceof LedgerWriteRejectedError) return `ledger:${error.ledgerError.code}`;
      throw error;
    }
    return "planned";
  }

  describe("rule 2, ADJUSTMENT", () => {
    it.each([
      ["a fractional target", 8, { targetAmount: "8.5" }, "refused:targetAmount"],
      ["a fractional target from 12.5", 12.5, { targetAmount: "12.25" }, "refused:targetAmount"],
      ["a whole target", 8, { targetAmount: "9" }, "planned"],
      ["a whole target with zero decimals", 8, { targetAmount: "9.000000" }, "planned"],
      ["a whole target down from 12.5", 12.5, { targetAmount: "12" }, "planned"],
      ["a whole target up from 12.5", 12.5, { targetAmount: "13" }, "planned"],
      ["a target of zero from 12.5", 12.5, { targetAmount: "0" }, "planned"],
      ["a whole delta from a whole balance", 8, { deltaAmount: "-2" }, "planned"],
      ["a fractional delta from a whole balance", 8, { deltaAmount: "0.5" }, "refused:deltaAmount"],
      ["a delta of -0.5 from 12.5 (lands on 12)", 12.5, { deltaAmount: "-0.5" }, "planned"],
      ["a delta of 0.5 from 12.5 (lands on 13)", 12.5, { deltaAmount: "0.5" }, "planned"],
      [
        "a delta of -1 from 12.5 (lands on 11.5)",
        12.5,
        { deltaAmount: "-1" },
        "refused:deltaAmount",
      ],
    ])("%s", (_case, balance, overrides, verdict) => {
      expect(countVerdict(countItem(balance), overrides)).toBe(verdict);
    });

    it("keeps the existing refusals ahead of the count rule", () => {
      expect(countVerdict(countItem(8), { targetAmount: "-0.5" })).toBe(
        "ledger:QUANTITY_OUT_OF_RANGE",
      );
      expect(countVerdict(countItem(12.5), { deltaAmount: "0" })).toBe("ledger:ZERO_DELTA");
      expect(countVerdict(countItem(8), { targetAmount: "1.2345678" })).toBe(
        "ledger:PRECISION_EXCEEDED",
      );
    });

    it("applies to every alias of the count unit", () => {
      for (const unit of ["each", "ct", "ea", "pcs", "Piece"]) {
        expect(countVerdict(countItem(8, unit), { targetAmount: "8.5" })).toBe(
          "refused:targetAmount",
        );
      }
    });
  });

  describe("rule 3, removals", () => {
    it.each(["CONSUME", "DISCARD", "EXPIRE", "DONATE"] as const)(
      "%s: whole from whole is fine, a fraction is refused, the full fractional balance is fine",
      (type) => {
        expect(countVerdict(countItem(8), { type, amount: "3" })).toBe("planned");
        expect(countVerdict(countItem(8), { type, amount: "0.5" })).toBe("refused:amount");
        expect(countVerdict(countItem(12.5), { type, amount: "1" })).toBe("refused:amount");
        expect(countVerdict(countItem(12.5), { type, amount: "1.5" })).toBe("refused:amount");
        expect(countVerdict(countItem(12.5), { type, amount: "12.5" })).toBe("planned");
        expect(countVerdict(countItem(12.5), { type, amount: "12.500000" })).toBe("planned");
        expect(countVerdict(countItem(12.5), { type })).toBe("planned");
      },
    );

    it("an overshooting whole removal from a whole balance is still planned (the ledger clamps it, as for any unit)", () => {
      expect(countVerdict(countItem(2), { type: "CONSUME", amount: "5" })).toBe("planned");
    });

    it("an overshooting removal from a fractional balance is refused (remove all instead)", () => {
      expect(countVerdict(countItem(12.5), { type: "CONSUME", amount: "13" })).toBe(
        "refused:amount",
      );
    });
  });

  it("mass and volume keep decimals", () => {
    const lb = itemWith([{ lotId: "lot-a" }], { "lot-a": 8 }, "lb");
    expect(countVerdict(lb, { targetAmount: "8.25" })).toBe("planned");
    expect(countVerdict(lb, { deltaAmount: "-0.5" })).toBe("planned");
    expect(countVerdict(lb, { type: "CONSUME", amount: "0.25" })).toBe("planned");
    const cup = itemWith([{ lotId: "lot-a" }], { "lot-a": 3 }, "cup");
    expect(countVerdict(cup, { targetAmount: "2.5" })).toBe("planned");
    expect(countVerdict(cup, { type: "DISCARD", amount: "0.5" })).toBe("planned");
  });

  it("is off for a replay, so the ledger alone decides duplicate or conflict", () => {
    expect(countVerdict(countItem(8), { targetAmount: "8.5" }, { wholeCountRule: false })).toBe(
      "planned",
    );
  });

  it("property: no write that states and lands on whole numbers is refused for being fractional", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.constantFrom("count", "each", "ct", "piece"),
        (balance, target, delta, amount, unit) => {
          const item = countItem(balance, unit);
          const writes: Partial<InventoryWriteCommand>[] = [
            { targetAmount: String(target) },
            { deltaAmount: String(delta) },
            { type: "CONSUME", amount: String(amount) },
            { type: "DISCARD" },
          ];
          for (const overrides of writes) {
            expect(countVerdict(item, overrides)).not.toMatch(/^refused:/);
          }
        },
      ),
    );
  });

  it("property: from any balance, a whole target and a full removal are never refused for it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (balanceMicros, target) => {
          const item = countItem(balanceMicros / 1_000_000, "each");
          expect(countVerdict(item, { targetAmount: String(target) })).not.toMatch(/^refused:/);
          expect(countVerdict(item, { type: "EXPIRE" })).not.toMatch(/^refused:/);
          expect(
            countVerdict(item, { type: "EXPIRE", amount: microsText(item.currentQty.micros) }),
          ).not.toMatch(/^refused:/);
        },
      ),
    );
  });
});

/** Exact decimal text of positive micros, for building a request from a stored balance. */
function microsText(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toString()}.${fraction}`;
}
