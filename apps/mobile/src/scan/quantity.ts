/**
 * S8/S9 quantity math (M3-T4b, CLAUDE.md rule 7): every quantity is exact
 * `bigint` micros, never a `number` carrying a fraction. `count` (the number
 * of packages on S8, or the whole-unit stepper value on S9) is always a
 * plain non-negative integer, so converting it with `BigInt(count)` loses
 * nothing; the only place a fraction can appear is a package's printed size
 * (`ScannedProductDto.packageSize.value.qty`), which arrives as exact
 * decimal text (`packages/contracts/src/products.ts`'s own rule, mirroring
 * `QuantityDto.amount`) and is parsed digit-by-digit into micros here, the
 * same discipline `src/inventory/quantity.ts`'s `parseMicros` uses for
 * already-micros text.
 */

import { MICROS_PER_UNIT } from "../inventory/quantity";

/**
 * Parses exact decimal text (e.g. `"16"`, `"0.5"`, `"-2.250000"`) into
 * micro-units. The sanctioned way to turn a printed amount into a `bigint`
 * without ever routing through `Number`/`parseFloat`. Throws on more than
 * six fractional digits (this app's micros resolution) rather than
 * silently truncating precision it was not asked to drop.
 */
export function decimalAmountToMicros(text: string): bigint {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  const wholePart = parts[0] ?? "";
  const fracPart = parts[1] ?? "";
  if (parts.length > 2 || !/^\d*$/.test(wholePart) || !/^\d*$/.test(fracPart)) {
    throw new RangeError(`decimalAmountToMicros: "${text}" is not a plain decimal amount`);
  }
  if (fracPart.length > 6) {
    throw new RangeError(
      `decimalAmountToMicros: "${text}" has more than 6 fractional digits, exceeding micro-unit precision`,
    );
  }
  const whole = wholePart === "" ? 0n : BigInt(wholePart);
  const frac = fracPart === "" ? 0n : BigInt(fracPart.padEnd(6, "0"));
  const micros = whole * MICROS_PER_UNIT + frac;
  return negative ? -micros : micros;
}

/**
 * S8's item quantity: `count` whole packages of `packageSizeQty` each, in
 * exact micros. `count` must be a positive integer (S8's stepper never lets
 * it reach zero — "Add {n} to {location}" implies at least one package).
 */
export function packageQuantityMicros(count: number, packageSizeQty: string): bigint {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `packageQuantityMicros: count must be a positive integer, got ${String(count)}`,
    );
  }
  return decimalAmountToMicros(packageSizeQty) * BigInt(count);
}

/** S9's item quantity: a plain whole-unit count in the chosen unit, in exact micros. */
export function wholeUnitQuantityMicros(count: number): bigint {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `wholeUnitQuantityMicros: count must be a non-negative integer, got ${String(count)}`,
    );
  }
  return BigInt(count) * MICROS_PER_UNIT;
}
