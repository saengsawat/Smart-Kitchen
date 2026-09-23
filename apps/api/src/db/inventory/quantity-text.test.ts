/**
 * Boundary quantity parsing (M2-T2).
 *
 * Two things have to hold for `decimalTextToMicros` to be safe to put in front
 * of the ledger:
 *
 * 1. it is the exact inverse of `microsToDecimalText`, in both directions, for
 *    every representable value (property-tested, not spot-checked); and
 * 2. it agrees with the domain's own `amountToMicros` wherever both accept the
 *    value, so the API and the ledger never disagree about what a quantity is.
 */

import fc from "fast-check";
import { amountToMicros, microsToAmount, MAX_QUANTITY_MICROS } from "@smart-kitchen/domain";
import { describe, expect, it } from "vitest";
import { decimalTextToMicros } from "./quantity-text.js";
import { microsToDecimalText } from "./repository.js";

function parsed(value: string): bigint {
  const result = decimalTextToMicros(value, "amount");
  if (!result.ok) throw new Error(`expected ${value} to parse, got ${result.error.code}`);
  return result.value;
}

function refusal(value: string): string {
  const result = decimalTextToMicros(value, "amount");
  if (result.ok) throw new Error(`expected ${value} to be refused, got ${result.value.toString()}`);
  return result.error.code;
}

describe("decimalTextToMicros", () => {
  it.each([
    ["1", 1_000_000n],
    ["0", 0n],
    ["-0", 0n],
    ["1.25", 1_250_000n],
    ["1.250000", 1_250_000n],
    ["-0.25", -250_000n],
    ["0.000001", 1n],
    ["-0.000001", -1n],
    ["007.5", 7_500_000n],
    ["100000000", MAX_QUANTITY_MICROS],
  ])("reads %s as %s micros", (text, micros) => {
    expect(parsed(text)).toBe(micros);
  });

  it.each([
    ["", "INVALID_FIELD"],
    [" 1", "INVALID_FIELD"],
    ["1 ", "INVALID_FIELD"],
    ["1,25", "INVALID_FIELD"],
    [".5", "INVALID_FIELD"],
    ["1.", "INVALID_FIELD"],
    ["-", "INVALID_FIELD"],
    ["+1", "INVALID_FIELD"],
    ["1e6", "INVALID_FIELD"],
    ["Infinity", "INVALID_FIELD"],
    ["NaN", "INVALID_FIELD"],
    ["0x10", "INVALID_FIELD"],
    ["1.2345678", "PRECISION_EXCEEDED"],
    ["100000000.000001", "QUANTITY_OUT_OF_RANGE"],
    ["-100000001", "QUANTITY_OUT_OF_RANGE"],
  ])("refuses %s with %s", (text, code) => {
    expect(refusal(text)).toBe(code);
  });

  it("names the field it was given, so a client can point at what it sent", () => {
    const result = decimalTextToMicros("nope", "targetAmount");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("targetAmount");
  });

  it("is the exact inverse of microsToDecimalText, for every representable value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_QUANTITY_MICROS, max: MAX_QUANTITY_MICROS }), (micros) => {
        expect(parsed(microsToDecimalText(micros))).toBe(micros);
      }),
      { numRuns: 500 },
    );
  });

  it("agrees with the domain's amountToMicros on the value it produces", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_QUANTITY_MICROS, max: MAX_QUANTITY_MICROS }), (micros) => {
        const text = microsToDecimalText(micros);
        const here = parsed(text);
        // The round trip the write path actually performs: text -> micros ->
        // the number the ledger is handed -> the ledger's own micros.
        const throughDomain = amountToMicros(microsToAmount(here));
        expect(throughDomain.ok).toBe(true);
        if (throughDomain.ok) expect(throughDomain.value).toBe(micros);
      }),
      { numRuns: 500 },
    );
  });

  it("refuses the precision the domain refuses, at the same threshold", () => {
    // Seven decimal places is beyond the ledger scale in both implementations.
    expect(refusal("0.0000001")).toBe("PRECISION_EXCEEDED");
    const domain = amountToMicros(0.0000001);
    expect(domain.ok).toBe(false);
    if (!domain.ok) expect(domain.error.code).toBe("PRECISION_EXCEEDED");
  });
});
