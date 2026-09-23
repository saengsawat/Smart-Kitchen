import { describe, expect, it } from "vitest";
import { decimalAmountToMicros, packageQuantityMicros, wholeUnitQuantityMicros } from "./quantity";

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
