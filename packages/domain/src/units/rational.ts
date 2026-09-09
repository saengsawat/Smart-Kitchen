/**
 * Exact rational arithmetic (`bigint` numerator / `bigint` denominator).
 *
 * Unit conversion factors are exact fractions — 1 lb = 453.59237/1 g, 1 tsp =
 * 3785.411784/768 ml — and some of them (tsp among them) do not terminate as
 * decimals. Doing the arithmetic in `number` would reintroduce exactly the
 * float drift M1-T1's ledger was built to avoid (see quantity.ts). Every
 * conversion factor and every intermediate product/quotient in this module is
 * therefore kept as a `Rational` until the final step, where it is rounded to
 * the ledger's micro-unit scale by {@link roundHalfEven} — the *only* place
 * precision can be lost, and always explicitly.
 */

/** An exact fraction, always stored with `den > 0` and in lowest terms. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcdBigInt(a: bigint, b: bigint): bigint {
  let x = absBigInt(a);
  let y = absBigInt(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

/** Builds a {@link Rational} in lowest terms with a positive denominator. */
export function makeRational(num: bigint, den: bigint): Rational {
  if (den === 0n) {
    throw new RangeError("Rational denominator must not be zero");
  }
  const sign = den < 0n ? -1n : 1n;
  const n = num * sign;
  const d = den * sign;
  const g = gcdBigInt(n, d);
  return { num: n / g, den: d / g };
}

export function fromInt(value: bigint): Rational {
  return { num: value, den: 1n };
}

export const RATIONAL_ZERO: Rational = { num: 0n, den: 1n };
export const RATIONAL_ONE: Rational = { num: 1n, den: 1n };

export function isZero(value: Rational): boolean {
  return value.num === 0n;
}

export function isPositive(value: Rational): boolean {
  return value.num > 0n;
}

export function isNegative(value: Rational): boolean {
  return value.num < 0n;
}

export function negate(value: Rational): Rational {
  return { num: -value.num, den: value.den };
}

export function reciprocal(value: Rational): Rational {
  return makeRational(value.den, value.num);
}

export function multiply(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.num, a.den * b.den);
}

export function divide(a: Rational, b: Rational): Rational {
  return multiply(a, reciprocal(b));
}

export function add(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subtract(a: Rational, b: Rational): Rational {
  return add(a, negate(b));
}

/** `-1 | 0 | 1` per whether `a` is less than, equal to, or greater than `b`. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  // a.den and b.den are always > 0 (makeRational's invariant), so
  // cross-multiplying preserves the inequality's direction.
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function maxRational(a: Rational, b: Rational): Rational {
  return compare(a, b) >= 0 ? a : b;
}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converts a decimal `number` to an exact {@link Rational}.
 *
 * Every finite JS number has a shortest round-tripping decimal string
 * (`String(value)`), and every finite decimal is exactly rational — so unlike
 * the ledger's `amountToMicros`, this never rejects for precision; it just
 * keeps however many fractional digits `String(value)` produced. Only
 * non-finite input (`NaN`/`Infinity`) is rejected.
 */
export function decimalToRational(value: number): Rational | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const text = String(value === 0 ? 0 : value);
  const match = DECIMAL_RE.exec(text);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  const exponent = Number(match[4] ?? "0") - fracPart.length;
  const digits = BigInt(intPart + fracPart) * sign;
  if (exponent >= 0) {
    return makeRational(digits * 10n ** BigInt(exponent), 1n);
  }
  return makeRational(digits, 10n ** BigInt(-exponent));
}

/** Nearest `number` to a {@link Rational}, for decimal display only (never for arithmetic). */
export function rationalToNumber(value: Rational): number {
  return Number(value.num) / Number(value.den);
}

/** Result of rounding an exact rational to the nearest integer. */
export interface RoundedInt {
  /** The rounded integer. */
  readonly value: bigint;
  /** `true` iff `num / den` was already an integer — no information was lost. */
  readonly exact: boolean;
}

/**
 * Rounds `num / den` (`den > 0`) to the nearest `bigint` using round-half-even
 * ("banker's rounding" — ties round to the neighbour with an even final
 * digit, e.g. 0.5 → 0, 1.5 → 2, -0.5 → 0).
 *
 * Chosen over round-half-up because unit conversion is typically applied
 * repeatedly over a session (recipe scaling, running a shopping-gap
 * calculation across many ingredients); round-half-up biases every exact
 * tie the same direction and the bias accumulates, while round-half-even
 * does not, matching the tie-breaking rule most languages' default floating
 * point rounding (and IEEE 754) already use. It is a policy choice, not a
 * derived fact — see docs/handoff/M1-T3.worker.md for the alternatives
 * considered.
 */
export function roundHalfEven(num: bigint, den: bigint): RoundedInt {
  if (den <= 0n) {
    throw new RangeError("roundHalfEven denominator must be positive");
  }
  const q = num / den; // bigint division truncates toward zero
  const r = num % den; // same sign as num (or zero)
  if (r === 0n) return { value: q, exact: true };
  const twiceAbsR = 2n * absBigInt(r);
  if (twiceAbsR < den) return { value: q, exact: false };
  const awayFromZero = num < 0n ? q - 1n : q + 1n;
  if (twiceAbsR > den) return { value: awayFromZero, exact: false };
  // Exactly half: round to the even neighbour.
  const rounded = q % 2n === 0n ? q : awayFromZero;
  return { value: rounded, exact: false };
}
