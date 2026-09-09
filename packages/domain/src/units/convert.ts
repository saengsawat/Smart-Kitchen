/**
 * Conversion, comparison and addition over registered units.
 *
 * Quantities in and out of this module are **micro-units** (`bigint`,
 * 1e-6 of the named unit) — the same representation `packages/domain/inventory`
 * uses for ledger deltas (see quantity.ts), chosen so a caller can pass a
 * `Quantity.micros` straight in without a lossy round-trip through `number`.
 * This module does not import from `../inventory/**`; the two stay
 * independent (architect guidance, M1-T3) and happen to agree on scale
 * because 1e-6 is a reasonable exactness floor for either one, not because
 * one depends on the other.
 *
 * Every conversion is computed as an exact {@link Rational} all the way
 * through and rounded to the nearest micro-unit only at the very end, via
 * {@link roundHalfEven} (see rational.ts for why round-half-even). The
 * `exact` flag on {@link ConversionResult} tells a caller whether that final
 * rounding actually discarded anything — same-kind conversions among the
 * units this module ships with are exact far more often than not (most
 * factors share a common power-of-two/five denominator with 1e-6), but nothing
 * here *guarantees* exactness in general, so no caller may assume it silently.
 */

import {
  compare as compareRational,
  decimalToRational,
  divide,
  isPositive,
  makeRational,
  multiply,
  reciprocal,
  roundHalfEven,
  type Rational,
} from "./rational.js";
import { lookupUnit, type UnitKind } from "./registry.js";
import { err, ok, type Outcome } from "./errors.js";

const MICROS_PER_UNIT = 1_000_000n;

/** Result of a conversion or a same-kind arithmetic operation. */
export interface ConversionResult {
  /** Exact-or-rounded result, in micro-units of `unit`. */
  readonly micros: bigint;
  /** The unit `micros` is expressed in (its canonical symbol). */
  readonly unit: string;
  /** Convenience decimal view of `micros`; never for further arithmetic. */
  readonly amount: number;
  /** `true` iff `micros` is the exact result — no rounding occurred. */
  readonly exact: boolean;
}

/**
 * Exact micro-units -> nearest `number` decimal view, built from digit
 * strings (not `Number(bigint) / Number(bigint)`) so a large balance's
 * *display* value degrades the same graceful way quantity.ts's
 * `microsToAmount` does, rather than losing precision earlier through an
 * extra float division. Still never used for arithmetic — only `micros` is.
 */
function microsToAmount(micros: bigint): number {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const text =
    frac === 0n
      ? whole.toString()
      : `${whole.toString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  const value = Number(text);
  return negative ? -value : value;
}

function buildResult(unit: string, micros: bigint, exact: boolean): ConversionResult {
  return { micros, unit, amount: microsToAmount(micros), exact };
}

/** Rounds an exact rational amount of micro-units to a {@link ConversionResult}. */
function roundToResult(unit: string, exactMicros: Rational): ConversionResult {
  const rounded = roundHalfEven(exactMicros.num, exactMicros.den);
  return buildResult(unit, rounded.value, rounded.exact);
}

/**
 * Converts `amountMicros` (micro-units of `from`) into micro-units of `to`.
 *
 * Fails with `UNKNOWN_UNIT` if either string is not registered, or
 * `INCOMPATIBLE_UNITS` if `from` and `to` belong to different kinds — this
 * function never guesses a cross-kind ratio; see {@link convertWithBridge}
 * for the only sanctioned way to cross kinds.
 */
export function convert(amountMicros: bigint, from: string, to: string): Outcome<ConversionResult> {
  const fromEntry = lookupUnit(from);
  if (!fromEntry.ok) return fromEntry;
  const toEntry = lookupUnit(to);
  if (!toEntry.ok) return toEntry;

  if (fromEntry.value.kind !== toEntry.value.kind) {
    return err(
      "INCOMPATIBLE_UNITS",
      `"${from}" (${fromEntry.value.kind}) and "${to}" (${toEntry.value.kind}) are different kinds; ` +
        "a conversion bridge with explicit product data is required (see convertWithBridge)",
      "unit",
    );
  }

  if (fromEntry.value.symbol === toEntry.value.symbol) {
    return ok(buildResult(toEntry.value.symbol, amountMicros, true));
  }

  const factor = divide(fromEntry.value.factorToBase, toEntry.value.factorToBase);
  const exactMicros = multiply(makeRational(amountMicros, 1n), factor);
  return ok(roundToResult(toEntry.value.symbol, exactMicros));
}

/**
 * An explicit, caller-supplied relationship between two *different* kinds'
 * base units — e.g. a product's density (MASS per VOLUME) or per-item weight
 * (MASS per COUNT). Never built into the registry (CLAUDE.md: no default
 * densities); the caller vouches for `ratio` and states which kinds it
 * relates.
 */
export interface ConversionBridge {
  readonly fromKind: UnitKind;
  readonly toKind: UnitKind;
  /** Exact amount of one `toKind` base unit per one `fromKind` base unit. */
  readonly ratio: Rational;
}

/**
 * Builds a {@link ConversionBridge} from a caller-supplied decimal ratio.
 *
 * Rejects a ratio that is non-finite, zero, or negative — a conversion
 * bridge with a zero or negative ratio is not a physical density/per-item
 * weight, so refusing it here is cheaper than a caller diagnosing garbage
 * downstream.
 *
 * Delegates the decimal→exact-rational parsing to rational.ts's
 * `decimalToRational`, which reads `String(value)` through the same
 * regex-based parser used elsewhere in this module — including its
 * exponent group, so `1e-7`/`1e21`-shaped ratios parse correctly instead of
 * reaching a bare `BigInt("1e-7")` (which throws). This module's own
 * total-function contract (never throw for a domain-rule violation) covers
 * caller *input*, and a bridge ratio is caller input like any other.
 */
export function makeBridge(
  fromKind: UnitKind,
  toKind: UnitKind,
  ratio: number,
): Outcome<ConversionBridge> {
  const rational = decimalToRational(ratio);
  if (rational === null) {
    return err("NOT_FINITE", "bridge ratio must be a finite number", "ratio");
  }
  if (!isPositive(rational)) {
    return err("INVALID_BRIDGE_RATIO", "bridge ratio must be positive", "ratio");
  }
  return ok({ fromKind, toKind, ratio: rational });
}

/**
 * Converts `amountMicros` (micro-units of `from`) into micro-units of `to`,
 * where `from` and `to` may belong to different kinds, using `bridge` to
 * relate them. `bridge`'s kind pair must match (in either order) `from`'s and
 * `to`'s kinds, or this fails `BRIDGE_KIND_MISMATCH` — a bridge for
 * MASS↔VOLUME cannot silently be reused for MASS↔COUNT.
 */
export function convertWithBridge(
  amountMicros: bigint,
  from: string,
  to: string,
  bridge: ConversionBridge,
): Outcome<ConversionResult> {
  const fromEntry = lookupUnit(from);
  if (!fromEntry.ok) return fromEntry;
  const toEntry = lookupUnit(to);
  if (!toEntry.ok) return toEntry;

  if (fromEntry.value.kind === toEntry.value.kind) {
    return convert(amountMicros, from, to);
  }

  let baseRatio: Rational; // to-base units per one from-base unit
  if (bridge.fromKind === fromEntry.value.kind && bridge.toKind === toEntry.value.kind) {
    baseRatio = bridge.ratio;
  } else if (bridge.fromKind === toEntry.value.kind && bridge.toKind === fromEntry.value.kind) {
    baseRatio = reciprocal(bridge.ratio);
  } else {
    return err(
      "BRIDGE_KIND_MISMATCH",
      `bridge relates ${bridge.fromKind}<->${bridge.toKind}, not ${fromEntry.value.kind}<->${toEntry.value.kind}`,
      "bridge",
    );
  }

  // amount(from) -> base(from) -> base(to) -> amount(to), all exact until the
  // final rounding step.
  const amountBaseFrom = multiply(makeRational(amountMicros, 1n), fromEntry.value.factorToBase);
  const amountBaseTo = multiply(amountBaseFrom, baseRatio);
  const exactMicros = divide(amountBaseTo, toEntry.value.factorToBase);
  return ok(roundToResult(toEntry.value.symbol, exactMicros));
}

/**
 * Compares two quantities that may be in different (but compatible) units.
 * `-1` if `a < b`, `0` if equal, `1` if `a > b`. Fails the same way
 * {@link convert} does for unknown/incompatible units.
 *
 * Compares the two quantities' exact rational values in their kind's base
 * unit directly (via rational.ts's `compare`, i.e. cross-multiplication) —
 * it never rounds either side to the other's unit first. Rounding one side
 * before comparing would make this non-antisymmetric: converting `b` into
 * `a`'s unit and rounding can land the rounded value on either side of the
 * true value depending on which unit was picked as the target, so
 * `compareQuantities(a, b)` and the sign-flipped `compareQuantities(b, a)`
 * could disagree near a half-micro-unit boundary. Comparing exact rationals
 * has no such boundary — there is nothing to round.
 */
export function compareQuantities(
  aMicros: bigint,
  aUnit: string,
  bMicros: bigint,
  bUnit: string,
): Outcome<-1 | 0 | 1> {
  const aEntry = lookupUnit(aUnit);
  if (!aEntry.ok) return aEntry;
  const bEntry = lookupUnit(bUnit);
  if (!bEntry.ok) return bEntry;

  if (aEntry.value.kind !== bEntry.value.kind) {
    return err(
      "INCOMPATIBLE_UNITS",
      `"${aUnit}" (${aEntry.value.kind}) and "${bUnit}" (${bEntry.value.kind}) are different kinds`,
      "unit",
    );
  }

  const aBase = multiply(makeRational(aMicros, 1n), aEntry.value.factorToBase);
  const bBase = multiply(makeRational(bMicros, 1n), bEntry.value.factorToBase);
  return ok(compareRational(aBase, bBase));
}

/**
 * Adds two quantities that may be in different (but compatible) units,
 * expressed in `resultUnit` (defaults to `aUnit`).
 */
export function addQuantities(
  aMicros: bigint,
  aUnit: string,
  bMicros: bigint,
  bUnit: string,
  resultUnit: string = aUnit,
): Outcome<ConversionResult> {
  const aInResult = convert(aMicros, aUnit, resultUnit);
  if (!aInResult.ok) return aInResult;
  const bInResult = convert(bMicros, bUnit, resultUnit);
  if (!bInResult.ok) return bInResult;
  const exact = aInResult.value.exact && bInResult.value.exact;
  // Use the conversion's own canonical unit, not the caller's raw `resultUnit`
  // string (which may be an alias, or differently-cased, e.g. "pounds"/"POUNDS")
  // — downstream (the ledger) compares units by exact string equality, so a
  // non-canonical unit here would cause spurious MIXED_UNITS or a balance that
  // silently stops matching this one.
  return ok(
    buildResult(aInResult.value.unit, aInResult.value.micros + bInResult.value.micros, exact),
  );
}

/**
 * INV-SHOP-1's `neededQty = max(0, required − usableOnHand)`, expressed in
 * `requiredUnit`. `onHand` may be in any unit compatible with `required`;
 * incompatible units fail typed (`UNKNOWN_UNIT`/`INCOMPATIBLE_UNITS`) rather
 * than ever being silently treated as zero or as a compatible match.
 */
export function neededQuantity(
  requiredMicros: bigint,
  requiredUnit: string,
  onHandMicros: bigint,
  onHandUnit: string,
): Outcome<ConversionResult> {
  const onHandInRequired = convert(onHandMicros, onHandUnit, requiredUnit);
  if (!onHandInRequired.ok) return onHandInRequired;
  const gapMicros = requiredMicros - onHandInRequired.value.micros;
  const clamped = gapMicros > 0n ? gapMicros : 0n;
  // Canonical unit from the conversion result, not the caller's raw
  // `requiredUnit` string — same reasoning as addQuantities above.
  return ok(buildResult(onHandInRequired.value.unit, clamped, onHandInRequired.value.exact));
}
