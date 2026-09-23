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
import { describe, expect, it } from "vitest";
import {
  increaseLot,
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
): InventoryItem {
  const created = createInventoryItem({
    itemId: ITEM,
    householdId: HOUSEHOLD,
    unit: "lb",
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
      unit: "lb",
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
