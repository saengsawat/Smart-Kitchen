import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  amountToMicros,
  formatQuantity,
  makeQuantity,
  microsToAmount,
  MAX_QUANTITY_MICROS,
  QUANTITY_SCALE,
  zeroQuantity,
} from "./quantity.js";

function micros(value: number): bigint {
  const result = amountToMicros(value);
  if (!result.ok) throw new Error(`expected ${String(value)} to convert: ${result.error.code}`);
  return result.value;
}

describe("quantity — exact scaled-integer arithmetic", () => {
  it("converts decimals to exact micro-units", () => {
    expect(micros(2)).toBe(2_000_000n);
    expect(micros(0.75)).toBe(750_000n);
    expect(micros(-0.75)).toBe(-750_000n);
    expect(micros(1.25)).toBe(1_250_000n);
    expect(micros(0.000001)).toBe(1n);
    expect(micros(1e-6)).toBe(1n);
    expect(micros(1.5e3)).toBe(1_500_000_000n);
  });

  it("is immune to the float drift a naive sum would show", () => {
    // The reason the ledger does not add `number`s: this assertion fails for
    // 0.1 + 0.2 in binary floating point.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(micros(0.1) + micros(0.2)).toBe(micros(0.3));
  });

  it("rejects values it cannot represent exactly rather than rounding them", () => {
    const tooPrecise = amountToMicros(0.0000001);
    expect(tooPrecise.ok).toBe(false);
    expect(tooPrecise.ok ? null : tooPrecise.error.code).toBe("PRECISION_EXCEEDED");

    const notFinite = amountToMicros(Number.NaN);
    expect(notFinite.ok ? null : notFinite.error.code).toBe("NOT_FINITE");

    const infinite = amountToMicros(Number.POSITIVE_INFINITY);
    expect(infinite.ok ? null : infinite.error.code).toBe("NOT_FINITE");

    const tooLarge = amountToMicros(2_000_000_000);
    expect(tooLarge.ok ? null : tooLarge.error.code).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("treats -0 as 0", () => {
    expect(micros(-0)).toBe(0n);
  });

  it("round-trips micro-units through the decimal view", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_QUANTITY_MICROS, max: MAX_QUANTITY_MICROS }), (value) => {
        expect(micros(microsToAmount(value))).toBe(value);
      }),
    );
  });

  it("round-trips decimals with at most the ledger scale", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5_000_000, max: 5_000_000 }), (raw) => {
        const amount = raw / 10 ** QUANTITY_SCALE;
        expect(microsToAmount(micros(amount))).toBe(amount);
      }),
    );
  });

  it("formats exact decimals", () => {
    expect(formatQuantity(makeQuantity("lb", 1_250_000n))).toBe("1.25 lb");
    expect(formatQuantity(zeroQuantity("lb"))).toBe("0 lb");
    expect(formatQuantity(makeQuantity("lb", -250_000n))).toBe("-0.25 lb");
    expect(formatQuantity(makeQuantity("g", 1n))).toBe("0.000001 g");
  });

  it("freezes the quantities it builds", () => {
    const quantity = makeQuantity("lb", 1_250_000n);
    expect(Object.isFrozen(quantity)).toBe(true);
    expect(() => {
      (quantity as { micros: bigint }).micros = 0n;
    }).toThrow(TypeError);
  });
});
