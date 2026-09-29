import { describe, expect, it } from "vitest";
import {
  decimalAmountToMicros,
  isCreateItemUnit,
  packageQuantityMicros,
  planScanQuantity,
  wholeUnitQuantityMicros,
} from "./quantity";

describe("decimalAmountToMicros", () => {
  it("parses a whole number", () => {
    expect(decimalAmountToMicros("16")).toBe(16_000_000n);
  });

  it("parses a fraction", () => {
    expect(decimalAmountToMicros("0.5")).toBe(500_000n);
  });

  it("parses a negative amount", () => {
    expect(decimalAmountToMicros("-2.25")).toBe(-2_250_000n);
  });

  it("pads a short fraction to six places", () => {
    expect(decimalAmountToMicros("1.1")).toBe(1_100_000n);
  });

  it("throws on more than six fractional digits rather than silently truncating", () => {
    expect(() => decimalAmountToMicros("1.1234567")).toThrow(RangeError);
  });

  it("parses a value a float-based path would get wrong (review round 3 R1(a))", () => {
    // Review R1: the previously-pinned "8.675309" turned out to be exactly
    // representable through `Number("8.675309") * 1e6` (519_354_398.99999994
    // is not; 8_675_309 is), so that pin proved nothing about avoiding float
    // arithmetic. "519.354399" is the genuinely divergent case:
    // `Number("519.354399") * 1_000_000 === 519354398.99999994` — a
    // *truncating* float path (e.g. `Math.trunc`/`| 0` instead of
    // `Math.round`) would read that as `519_354_398`, one micro short.
    // `decimalAmountToMicros` never constructs a `Number` at all (it splits
    // on "." and builds the result digit-by-digit in `bigint`), so it gets
    // the exact value regardless — pinned here, and structurally guarded
    // against ever regressing to a float parse by
    // `src/lint-rules/no-float-in-quantity-math.test.ts`.
    expect(decimalAmountToMicros("519.354399")).toBe(519_354_399n);
  });

  it("throws on a non-decimal string rather than coercing through Number", () => {
    expect(() => decimalAmountToMicros("16 oz")).toThrow(RangeError);
    expect(() => decimalAmountToMicros("1.2.3")).toThrow(RangeError);
  });
});

describe("packageQuantityMicros (S8: count x package size, exact micros)", () => {
  it("multiplies an integer count by an exact package size with no float involved", () => {
    // 2 x 16 oz packages = 32 oz, exactly — the classic 0.1 * 3 float trap
    // would show up here first if this routed through Number arithmetic.
    expect(packageQuantityMicros(2, "16")).toBe(32_000_000n);
  });

  it("handles a fractional package size exactly", () => {
    expect(packageQuantityMicros(3, "0.1")).toBe(300_000n);
  });

  it("rejects a non-positive or non-integer count", () => {
    expect(() => packageQuantityMicros(0, "16")).toThrow(RangeError);
    expect(() => packageQuantityMicros(-1, "16")).toThrow(RangeError);
    expect(() => packageQuantityMicros(1.5, "16")).toThrow(RangeError);
  });
});

describe("wholeUnitQuantityMicros (S9: a plain whole-unit count)", () => {
  it("converts a count into exact micros", () => {
    expect(wholeUnitQuantityMicros(3)).toBe(3_000_000n);
  });

  it("allows zero", () => {
    expect(wholeUnitQuantityMicros(0)).toBe(0n);
  });

  it("rejects a negative or non-integer count", () => {
    expect(() => wholeUnitQuantityMicros(-1)).toThrow(RangeError);
    expect(() => wholeUnitQuantityMicros(1.5)).toThrow(RangeError);
  });
});

describe("isCreateItemUnit (M3-T4e Objective (e))", () => {
  it("accepts every unit the household-facing whitelist lists", () => {
    for (const unit of ["g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "each"]) {
      expect(isCreateItemUnit(unit)).toBe(true);
    }
  });

  it("refuses pt/qt/gal even though the domain registry resolves them, and fl oz which resolves nowhere", () => {
    for (const unit of ["pt", "qt", "gal", "fl oz"]) {
      expect(isCreateItemUnit(unit)).toBe(false);
    }
  });

  it("refuses an unparsed/unknown unit", () => {
    expect(isCreateItemUnit("bunch")).toBe(false);
    expect(isCreateItemUnit("")).toBe(false);
  });
});

describe("planScanQuantity (M3-T4e Objectives (d)/(e), review round 1 F1/F3 rulings)", () => {
  it("a Known Fact package size (the fixture corpus) in a supported unit stays Known Fact, source from the size", () => {
    const plan = planScanQuantity(
      { qty: "16", unit: "oz", tier: "KNOWN_FACT", source: "manufacturer-label" },
      2,
    );
    expect(plan).toEqual({
      amountMicros: 32_000_000n,
      unit: "oz",
      tier: "KNOWN_FACT",
      source: "manufacturer-label",
    });
  });

  it("an Estimated package size (Open Food Facts, D-025) in a supported unit gives an Estimated quantity, source open-food-facts", () => {
    const plan = planScanQuantity(
      { qty: "793.8", unit: "g", tier: "ESTIMATED", source: "open-food-facts" },
      1,
    );
    expect(plan).toEqual({
      amountMicros: 793_800_000n,
      unit: "g",
      tier: "ESTIMATED",
      source: "open-food-facts",
    });
  });

  it("no package size at all: the chosen count in each, Known Fact, source scanned barcode (the user physically counted)", () => {
    const plan = planScanQuantity(undefined, 3);
    expect(plan).toEqual({
      amountMicros: 3_000_000n,
      unit: "each",
      tier: "KNOWN_FACT",
      source: "scanned barcode",
    });
  });

  it('F3 ruling: a package unit the ledger cannot accept (qt) still counts as Known Fact "N each", never invented, source scanned barcode', () => {
    // Reversed from this function's first draft: an unparsed/unsupported
    // size does not make the *count* the user entered any less certain -
    // "1 each" is their own fact regardless of what the label's size says,
    // and the amount never used the size to build itself, so it is not the
    // size's source either.
    const plan = planScanQuantity(
      { qty: "1", unit: "qt", tier: "ESTIMATED", source: "open-food-facts" },
      1,
    );
    expect(plan).toEqual({
      amountMicros: 1_000_000n,
      unit: "each",
      tier: "KNOWN_FACT",
      source: "scanned barcode",
    });
  });

  it("the unsupported-unit fallback is Known Fact even when the size record itself is Known Fact (the count, not the size, decides)", () => {
    const plan = planScanQuantity(
      { qty: "2", unit: "gal", tier: "KNOWN_FACT", source: "manufacturer-label" },
      1,
    );
    expect(plan.tier).toBe("KNOWN_FACT");
    expect(plan.unit).toBe("each");
    expect(plan.source).toBe("scanned barcode");
  });

  it("multiple packages of an unsupported unit still multiply the count, not the size", () => {
    const plan = planScanQuantity(
      { qty: "48", unit: "fl oz", tier: "ESTIMATED", source: "open-food-facts" },
      4,
    );
    expect(plan).toEqual({
      amountMicros: 4_000_000n,
      unit: "each",
      tier: "KNOWN_FACT",
      source: "scanned barcode",
    });
  });
});
