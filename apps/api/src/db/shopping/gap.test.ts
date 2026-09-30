/**
 * The shopping gap against the domain (M7-T1 tests: "gap math against the
 * domain for each row shape").
 *
 * Every expectation is computed twice: once as the literal the acceptance
 * criteria name, and once by calling the domain's `neededQuantity` directly,
 * so a server-side subtraction that happened to agree on one literal would
 * still have to agree with the domain everywhere else (the property test).
 */

import { neededQuantity } from "@smart-kitchen/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeRowGap, ShoppingGapIntegrityError } from "./gap.js";

function domainBuy(need: bigint, have: bigint, unit: string): bigint {
  const result = neededQuantity(need, unit, have, unit);
  if (!result.ok) throw new Error(result.error.code);
  return result.value.micros;
}

describe("computeRowGap (M7-T1 (b))", () => {
  it("item present, same unit: have and tier from the snapshot, buy is the domain's gap (chicken: 2 lb need, 1.25 held, 0.75 to buy)", () => {
    const gap = computeRowGap(
      { needMicros: 2_000_000n, unit: "lb" },
      { unit: "lb", currentMicros: 1_250_000n, quantityTier: "KNOWN_FACT" },
    );
    expect(gap).toEqual({ haveMicros: 1_250_000n, haveTier: "KNOWN_FACT", buyMicros: 750_000n });
    expect(gap.buyMicros).toBe(domainBuy(2_000_000n, 1_250_000n, "lb"));
  });

  it("passes the snapshot's tier through unchanged, whatever it is", () => {
    for (const tier of ["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION", null] as const) {
      const gap = computeRowGap(
        { needMicros: 3_000_000n, unit: "cup" },
        { unit: "cup", currentMicros: 1_000_000n, quantityTier: tier },
      );
      expect(gap.haveTier).toBe(tier);
    }
  });

  it("unit mismatch: nothing on hand, no tier, buy = need, never a conversion (2 lb need over an item held in oz)", () => {
    // 40 oz is 2.5 lb: a converting implementation would answer buy 0.
    const gap = computeRowGap(
      { needMicros: 2_000_000n, unit: "lb" },
      { unit: "oz", currentMicros: 40_000_000n, quantityTier: "KNOWN_FACT" },
    );
    expect(gap).toEqual({ haveMicros: 0n, haveTier: null, buyMicros: 2_000_000n });
  });

  it("treats a registry alias as a mismatch too (row in each, item in count), because the ledger would refuse that PURCHASE", () => {
    const gap = computeRowGap(
      { needMicros: 6_000_000n, unit: "each" },
      { unit: "count", currentMicros: 12_000_000n, quantityTier: "KNOWN_FACT" },
    );
    expect(gap).toEqual({ haveMicros: 0n, haveTier: null, buyMicros: 6_000_000n });
  });

  it("no item: have zero with no tier, buy = need", () => {
    const gap = computeRowGap({ needMicros: 1_000_000n, unit: "each" }, undefined);
    expect(gap).toEqual({ haveMicros: 0n, haveTier: null, buyMicros: 1_000_000n });
  });

  it("buy 0 when the item already holds enough, with the real on-hand amount and its tier", () => {
    const gap = computeRowGap(
      { needMicros: 3_000_000n, unit: "cup" },
      { unit: "cup", currentMicros: 4_000_000n, quantityTier: "ESTIMATED" },
    );
    expect(gap).toEqual({ haveMicros: 4_000_000n, haveTier: "ESTIMATED", buyMicros: 0n });
  });

  it("buy 0 at exactly the need", () => {
    const gap = computeRowGap(
      { needMicros: 2_000_000n, unit: "lb" },
      { unit: "lb", currentMicros: 2_000_000n, quantityTier: "KNOWN_FACT" },
    );
    expect(gap.buyMicros).toBe(0n);
  });

  it("an item held at zero still counts (have 0 with the snapshot's tier), buy = need", () => {
    const gap = computeRowGap(
      { needMicros: 2_000_000n, unit: "lb" },
      { unit: "lb", currentMicros: 0n, quantityTier: "KNOWN_FACT" },
    );
    expect(gap).toEqual({ haveMicros: 0n, haveTier: "KNOWN_FACT", buyMicros: 2_000_000n });
  });

  it("agrees with neededQuantity for every same-unit need and have", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.constantFrom("g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "each"),
        (need, have, unit) => {
          const gap = computeRowGap(
            { needMicros: need, unit },
            { unit, currentMicros: have, quantityTier: "KNOWN_FACT" },
          );
          expect(gap.buyMicros).toBe(domainBuy(need, have, unit));
          expect(gap.haveMicros).toBe(have);
        },
      ),
    );
  });

  it("fails loudly on a unit the domain registry does not know, rather than guessing a gap", () => {
    expect(() => computeRowGap({ needMicros: 1_000_000n, unit: "smidgen" }, undefined)).toThrow(
      ShoppingGapIntegrityError,
    );
  });
});
