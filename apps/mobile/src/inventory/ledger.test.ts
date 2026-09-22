import { describe, expect, it } from "vitest";
import {
  appendCorrection,
  appendDecrease,
  appendRemoval,
  appendUndo,
  currentMicros,
  needsConfirmation,
  toDetailDto,
  toSummaryDto,
  ZeroDeltaError,
  type MutableItemFixture,
} from "./ledger";
import { buildChenInventory } from "./fixture-household";

const DEAN = { kind: "user" as const, displayInitials: "DC" };

function freshItem(): MutableItemFixture {
  return {
    itemId: "test-item",
    displayName: "Test item",
    storageLocation: "FRIDGE",
    unit: "lb",
    lots: [],
    history: [],
    confirmed: false,
    needsConfirmWhenUnconfirmed: false,
  };
}

describe("append-only: history only ever grows, nothing is edited or deleted", () => {
  it("appendCorrection adds exactly one row and leaves earlier rows untouched", () => {
    const item = freshItem();
    appendCorrection(item, 2_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    const firstRow = item.history[0];
    appendCorrection(item, 3_000_000n, "2026-09-02T00:00:00.000Z", DEAN);
    expect(item.history).toHaveLength(2);
    expect(item.history[0]).toBe(firstRow);
  });
});

describe("currentMicros: BigInt sum, never Number", () => {
  it("derives the balance as the sum of every row's deltaMicros", () => {
    const item = freshItem();
    appendCorrection(item, 2_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    appendCorrection(item, 5_000_000n, "2026-09-02T00:00:00.000Z", DEAN);
    expect(currentMicros(item.history)).toBe(5_000_000n);
  });
});

describe("appendCorrection", () => {
  it("appends an ADJUSTMENT carrying the signed delta to reach the target amount", () => {
    const item = freshItem();
    appendCorrection(item, 1_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    const row = appendCorrection(item, 1_500_000n, "2026-09-02T00:00:00.000Z", DEAN);
    expect(row.type).toBe("ADJUSTMENT");
    expect(row.deltaMicros).toBe("500000");
    expect(currentMicros(item.history)).toBe(1_500_000n);
  });

  it("rejects a zero-delta correction (copy-deck.md §8 ZERO_DELTA)", () => {
    const item = freshItem();
    appendCorrection(item, 1_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    expect(() => appendCorrection(item, 1_000_000n, "2026-09-02T00:00:00.000Z", DEAN)).toThrow(
      ZeroDeltaError,
    );
  });
});

describe("appendDecrease clamping (domain-model.md §4 invariant 2)", () => {
  it("a decrease within balance needs no clamp row", () => {
    const item = freshItem();
    appendCorrection(item, 2_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    appendDecrease(item, {
      type: "CONSUME",
      magnitudeMicros: 1_000_000n,
      recordedAt: "2026-09-02T00:00:00.000Z",
      actor: DEAN,
      provenance: {
        tier: "KNOWN_FACT",
        source: "manual-entry",
        confidence: null,
        recordedAt: null,
      },
    });
    expect(currentMicros(item.history)).toBe(1_000_000n);
    expect(item.history.some((tx) => tx.systemFlag === "OVER_CONSUMPTION")).toBe(false);
  });

  it("a decrease exceeding the balance records its full magnitude, then a system clamp row restores zero", () => {
    const item = freshItem();
    appendCorrection(item, 2_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    appendDecrease(item, {
      type: "CONSUME",
      magnitudeMicros: 2_250_000n,
      recordedAt: "2026-09-02T00:00:00.000Z",
      actor: DEAN,
      provenance: {
        tier: "KNOWN_FACT",
        source: "manual-entry",
        confidence: null,
        recordedAt: null,
      },
    });
    const decreaseRow = item.history[1]!;
    const clampRow = item.history[2]!;
    expect(decreaseRow.deltaMicros).toBe("-2250000"); // full stated magnitude, never shrunk
    expect(clampRow.systemFlag).toBe("OVER_CONSUMPTION");
    expect(clampRow.type).toBe("ADJUSTMENT");
    expect(clampRow.deltaMicros).toBe("250000");
    expect(clampRow.actor.kind).toBe("system");
    expect(clampRow.actor.displayInitials).toBeUndefined(); // never attributed to a person
    expect(currentMicros(item.history)).toBe(0n); // clamped exactly to zero
  });
});

describe("appendRemoval (removeQuantity): removes the full on-hand amount, mapped TransactionType", () => {
  it.each(["CONSUME", "DISCARD", "EXPIRE", "DONATE"] as const)(
    "maps to %s and zeroes the balance",
    (type) => {
      const item = freshItem();
      appendCorrection(item, 3_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
      appendRemoval(item, type, "2026-09-02T00:00:00.000Z", DEAN, "spoiled");
      const row = item.history.at(-1)!;
      expect(row.type).toBe(type);
      expect(currentMicros(item.history)).toBe(0n);
      // Review F4 ruling: the reason travels in provenance.source, never
      // correlationLabel (reserved for a recipe name), so a removal row is
      // never rendered as "{action} in {reason}".
      expect(row.provenance.source).toBe("spoiled");
      expect(row.correlationLabel).toBeUndefined();
    },
  );
});

describe("appendUndo: appends the exact compensating row, never deletes the original", () => {
  it("undoing a correction restores the prior balance via a new row", () => {
    const item = freshItem();
    appendCorrection(item, 1_000_000n, "2026-09-01T00:00:00.000Z", DEAN);
    const correction = appendCorrection(item, 1_500_000n, "2026-09-02T00:00:00.000Z", DEAN);
    const historyLengthBefore = item.history.length;
    const undoRow = appendUndo(item, correction.transactionId, "2026-09-03T00:00:00.000Z", DEAN);
    expect(item.history).toHaveLength(historyLengthBefore + 1); // appended, not replaced
    expect(undoRow.deltaMicros).toBe("-500000");
    expect(currentMicros(item.history)).toBe(1_000_000n);
    // The original correction row is still there, untouched.
    expect(item.history.find((tx) => tx.transactionId === correction.transactionId)).toBeDefined();
  });

  it("throws for an unknown transaction id", () => {
    const item = freshItem();
    expect(() => appendUndo(item, "not-a-real-id", "2026-09-01T00:00:00.000Z", DEAN)).toThrow();
  });
});

describe("confirmAiProposal equivalent (needsConfirmation / confirmed flag, fixture-only)", () => {
  it("an AI-tier item needs confirmation until confirmed is set", () => {
    const inventory = buildChenInventory();
    const strawberries = inventory.get("fixture-item-strawberries")!;
    expect(needsConfirmation(strawberries)).toBe(true);
    strawberries.confirmed = true;
    expect(needsConfirmation(strawberries)).toBe(false);
    expect(toSummaryDto(strawberries).provenance.quantity?.tier).toBe("KNOWN_FACT");
  });

  it("a Known Fact item never needs confirmation", () => {
    const inventory = buildChenInventory();
    const spinach = inventory.get("fixture-item-spinach")!;
    expect(needsConfirmation(spinach)).toBe(false);
  });
});

describe("the Chen household chicken-breast fixture reproduces the prototype ledger exactly", () => {
  it("+2.0, -2.25, clamp +0.25 system row, +1.25 = 1.25 lb (BACKLOG.md M3-T3 acceptance criterion)", () => {
    const inventory = buildChenInventory();
    const chicken = inventory.get("fixture-item-chicken")!;
    const detail = toDetailDto(chicken);

    expect(detail.history.map((tx) => tx.amount)).toEqual([
      "2", // whole micros render with no fraction (QuantityDto.amount contract)
      "-2.250000",
      "0.250000",
      "1.250000",
    ]);
    expect(detail.history[2]!.systemFlag).toBe("OVER_CONSUMPTION");
    expect(detail.history[2]!.actor.kind).toBe("system");
    expect(detail.summary.quantity.amount).toBe("1.250000");
    expect(currentMicros(chicken.history)).toBe(1_250_000n);
  });
});

describe("the fixture household's other rows are internally consistent", () => {
  it("every item's summary quantity matches the BigInt sum of its own history", () => {
    const inventory = buildChenInventory();
    for (const item of inventory.values()) {
      const summary = toSummaryDto(item);
      expect(summary.quantity.micros).toBe(currentMicros(item.history).toString());
    }
  });

  it("no history row's provenance.source is a code-internal token (review F11)", () => {
    const inventory = buildChenInventory();
    for (const item of inventory.values()) {
      for (const tx of item.history) {
        if (tx.provenance.source !== null) {
          expect(tx.provenance.source).not.toMatch(/fixture|seed|ledger-clamp/i);
        }
      }
    }
  });
});
