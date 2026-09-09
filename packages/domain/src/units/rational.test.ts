import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  add,
  compare,
  decimalToRational,
  divide,
  fromInt,
  makeRational,
  multiply,
  negate,
  RATIONAL_ONE,
  RATIONAL_ZERO,
  rationalToNumber,
  reciprocal,
  roundHalfEven,
  subtract,
  type Rational,
} from "./rational.js";

describe("rational — exact fraction arithmetic", () => {
  it("reduces to lowest terms with a positive denominator", () => {
    expect(makeRational(4n, 8n)).toEqual({ num: 1n, den: 2n });
    expect(makeRational(-4n, 8n)).toEqual({ num: -1n, den: 2n });
    expect(makeRational(4n, -8n)).toEqual({ num: -1n, den: 2n });
    expect(makeRational(-4n, -8n)).toEqual({ num: 1n, den: 2n });
    expect(makeRational(0n, 5n)).toEqual({ num: 0n, den: 1n });
  });

  it("rejects a zero denominator", () => {
    expect(() => makeRational(1n, 0n)).toThrow(RangeError);
  });

  it("performs exact arithmetic", () => {
    const half = makeRational(1n, 2n);
    const third = makeRational(1n, 3n);
    expect(add(half, third)).toEqual(makeRational(5n, 6n));
    expect(subtract(half, third)).toEqual(makeRational(1n, 6n));
    expect(multiply(half, third)).toEqual(makeRational(1n, 6n));
    expect(divide(half, third)).toEqual(makeRational(3n, 2n));
    expect(reciprocal(third)).toEqual(fromInt(3n));
    expect(negate(half)).toEqual(makeRational(-1n, 2n));
  });

  it("compares exactly, including across different denominators", () => {
    expect(compare(makeRational(1n, 3n), makeRational(1n, 2n))).toBe(-1);
    expect(compare(makeRational(1n, 2n), makeRational(2n, 4n))).toBe(0);
    expect(compare(makeRational(2n, 3n), makeRational(1n, 2n))).toBe(1);
    expect(compare(RATIONAL_ZERO, RATIONAL_ONE)).toBe(-1);
  });

  it("converts finite decimals to exact rationals, including non-terminating-looking ones", () => {
    expect(decimalToRational(0.75)).toEqual(makeRational(3n, 4n));
    expect(decimalToRational(-0.75)).toEqual(makeRational(-3n, 4n));
    expect(decimalToRational(2)).toEqual(fromInt(2n));
    expect(decimalToRational(1.5e3)).toEqual(fromInt(1500n));
    expect(decimalToRational(0)).toEqual(RATIONAL_ZERO);
    expect(decimalToRational(-0)).toEqual(RATIONAL_ZERO);
  });

  it("rejects non-finite decimals", () => {
    expect(decimalToRational(Number.NaN)).toBeNull();
    expect(decimalToRational(Number.POSITIVE_INFINITY)).toBeNull();
    expect(decimalToRational(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("renders a decimal view for display", () => {
    expect(rationalToNumber(makeRational(1n, 4n))).toBe(0.25);
    expect(rationalToNumber(RATIONAL_ZERO)).toBe(0);
  });

  describe("roundHalfEven", () => {
    it("rounds ties to the even neighbour", () => {
      expect(roundHalfEven(1n, 2n)).toEqual({ value: 0n, exact: false }); // 0.5 -> 0
      expect(roundHalfEven(3n, 2n)).toEqual({ value: 2n, exact: false }); // 1.5 -> 2
      expect(roundHalfEven(5n, 2n)).toEqual({ value: 2n, exact: false }); // 2.5 -> 2
      expect(roundHalfEven(7n, 2n)).toEqual({ value: 4n, exact: false }); // 3.5 -> 4
      expect(roundHalfEven(-1n, 2n)).toEqual({ value: 0n, exact: false }); // -0.5 -> 0
      expect(roundHalfEven(-3n, 2n)).toEqual({ value: -2n, exact: false }); // -1.5 -> -2
      expect(roundHalfEven(-5n, 2n)).toEqual({ value: -2n, exact: false }); // -2.5 -> -2
      expect(roundHalfEven(-7n, 2n)).toEqual({ value: -4n, exact: false }); // -3.5 -> -4
    });

    it("rounds non-ties to the nearer integer", () => {
      expect(roundHalfEven(4n, 3n)).toEqual({ value: 1n, exact: false }); // 1.333 -> 1
      expect(roundHalfEven(5n, 3n)).toEqual({ value: 2n, exact: false }); // 1.666 -> 2
      expect(roundHalfEven(-4n, 3n)).toEqual({ value: -1n, exact: false });
      expect(roundHalfEven(-5n, 3n)).toEqual({ value: -2n, exact: false });
    });

    it("reports exact for integral fractions", () => {
      expect(roundHalfEven(6n, 3n)).toEqual({ value: 2n, exact: true });
      expect(roundHalfEven(0n, 5n)).toEqual({ value: 0n, exact: true });
      expect(roundHalfEven(-9n, 3n)).toEqual({ value: -3n, exact: true });
    });

    it("rejects a non-positive denominator", () => {
      expect(() => roundHalfEven(1n, 0n)).toThrow(RangeError);
      expect(() => roundHalfEven(1n, -2n)).toThrow(RangeError);
    });

    it("property: rounds within half of the true value, always", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }),
          fc.bigInt({ min: 1n, max: 1_000_000n }),
          (num, den) => {
            const { value } = roundHalfEven(num, den);
            // |value - num/den| <= 1/2  <=>  |2*value*den - 2*num| <= den
            const diff = 2n * value * den - 2n * num;
            const absDiff = diff < 0n ? -diff : diff;
            expect(absDiff <= den).toBe(true);
          },
        ),
      );
    });

    it("property: exact iff num is a multiple of den, and then value*den === num", () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }),
          fc.bigInt({ min: 1n, max: 1_000_000n }),
          (num, den) => {
            const { value, exact } = roundHalfEven(num, den);
            expect(exact).toBe(num % den === 0n);
            if (exact) expect(value * den).toBe(num);
          },
        ),
      );
    });

    it("property: rounding a value that is already an integer is a no-op", () => {
      fc.assert(
        fc.property(fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }), (n) => {
          expect(roundHalfEven(n, 1n)).toEqual({ value: n, exact: true });
        }),
      );
    });
  });

  it("property: decimalToRational round-trips through rationalToNumber for representable magnitudes", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (raw) => {
        const value = raw / 1000;
        const rational: Rational | null = decimalToRational(value);
        expect(rational).not.toBeNull();
        if (rational !== null) expect(rationalToNumber(rational)).toBeCloseTo(value, 9);
      }),
    );
  });
});
