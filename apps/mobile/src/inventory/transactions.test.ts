import { describe, expect, it } from "vitest";
import { REMOVAL_REASON_CHIPS, rowIsRemoval } from "./transactions";

describe("REMOVAL_REASON_CHIPS (review F6, copy-deck.md §5 reason-chip mapping)", () => {
  it("maps the four chip labels to the exact TransactionType copy-deck.md §5 specifies", () => {
    expect(REMOVAL_REASON_CHIPS).toEqual([
      { label: "Consume", type: "CONSUME" },
      { label: "Discard", type: "DISCARD" },
      { label: "Mark expired", type: "EXPIRE" },
      { label: "Donate", type: "DONATE" },
    ]);
  });

  it("offers exactly four chips, no more, no fewer (USE_IN_MEAL and ADJUSTMENT are not manual reasons)", () => {
    expect(REMOVAL_REASON_CHIPS).toHaveLength(4);
  });
});

describe("rowIsRemoval", () => {
  it.each(["CONSUME", "DISCARD", "EXPIRE", "DONATE"] as const)("%s is a removal type", (type) => {
    expect(rowIsRemoval(type)).toBe(true);
  });

  it.each(["INITIAL_STOCK", "PURCHASE", "USE_IN_MEAL", "ADJUSTMENT"] as const)(
    "%s is not a removal type",
    (type) => {
      expect(rowIsRemoval(type)).toBe(false);
    },
  );
});
