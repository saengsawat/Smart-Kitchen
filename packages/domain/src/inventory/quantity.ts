/**
 * Exact quantity arithmetic for the inventory ledger.
 *
 * Inventory math is safety-critical (CLAUDE.md rule 7) and INV-LEDGER-1 asserts
 * `currentQty == Σ deltas` for *any* transaction sequence. Binary floating point
 * cannot honour that: `0.1 + 0.2 !== 0.3`, and the drift depends on summation
 * order, so a snapshot maintained incrementally would diverge from a recomputed
 * sum. The ledger therefore stores every delta as an exact scaled integer
 * (`bigint` micro-units, 1e-6 of the item's unit) and does all addition on those.
 * `number` remains the boundary/display representation.
 */

import { err, ok, type Outcome } from "./errors.js";

/** Decimal places retained exactly by the ledger. */
export const QUANTITY_SCALE = 6;

/** Scaled-integer factor: one unit == 1_000_000 micro-units. */
export const MICROS_PER_UNIT = 1_000_000n;

/**
 * Largest representable magnitude for a **single delta**: 1e8 units
 * (1e14 micro-units).
 *
 * Chosen so any one accepted delta has at most 15 significant decimal digits
 * and therefore round-trips exactly through a `number`.
 *
 * **Scope of that guarantee.** It is per delta, not per balance. Balances are
 * summed in `bigint` and stay exact whatever their size, but the decimal
 * `amount` *view* of a balance is only lossless while the balance itself is
 * ≤ 1e14 micro-units. Nothing caps the accumulated total, so a balance can
 * cross that line — in the worst case after ~100 appends at the per-delta
 * maximum (1e14 × 100 = 1e16). Past it, `micros` remains authoritative and
 * exact while `amount` may round in its last digits. This is a deliberate
 * trade rather than an oversight: real household quantities sit ~10 orders of
 * magnitude below the line, and a balance cap would add a failure mode with no
 * product meaning. Never do ledger arithmetic on `amount`.
 */
export const MAX_QUANTITY_MICROS = 100_000_000_000_000n;

/**
 * Unit of measure — an opaque tag at this layer.
 *
 * M1-T1 is deliberately unit-agnostic: units are pass-through and compared for
 * exact equality (a single unit per item). Conversion, normalisation and
 * kind-compatibility are M1-T3's (`packages/domain/units`) responsibility and
 * will replace this alias.
 */
export type Unit = string;

/** A quantity of one unit, carrying both the exact value and a decimal view. */
export interface Quantity {
  readonly unit: Unit;
  /** Authoritative exact value in micro-units (1e-6 unit). */
  readonly micros: bigint;
  /** Convenience decimal view of {@link micros}; never used for arithmetic. */
  readonly amount: number;
}

/** Builds a frozen {@link Quantity} from an exact micro-unit value. */
export function makeQuantity(unit: Unit, micros: bigint): Quantity {
  return Object.freeze({ unit, micros, amount: microsToAmount(micros) });
}

/** The zero quantity for a unit. */
export function zeroQuantity(unit: Unit): Quantity {
  return makeQuantity(unit, 0n);
}

const NUMERIC_RE = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converts a decimal `number` to exact micro-units.
 *
 * Rejects (rather than rounds) anything the ledger cannot hold exactly, so a
 * quantity is never silently altered on the way in:
 * - non-finite values (`NOT_FINITE`),
 * - more than {@link QUANTITY_SCALE} decimal places (`PRECISION_EXCEEDED`),
 * - magnitudes above {@link MAX_QUANTITY_MICROS} (`QUANTITY_OUT_OF_RANGE`).
 *
 * The conversion reads `String(value)` — JavaScript's shortest round-tripping
 * decimal form — and scales it with integer arithmetic, so no intermediate
 * float multiplication can introduce error.
 */
export function amountToMicros(value: number, field = "qtyDelta"): Outcome<bigint> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err("NOT_FINITE", `${field} must be a finite number`, field);
  }
  // Normalises -0 to 0 so the sign checks downstream see a plain zero.
  const text = String(value === 0 ? 0 : value);
  const match = NUMERIC_RE.exec(text);
  if (match === null) {
    return err("NOT_FINITE", `${field} is not a decimal number`, field);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  const exponent = Number(match[4] ?? "0") - fracPart.length;

  const digits = BigInt(intPart + fracPart);
  const shift = exponent + QUANTITY_SCALE;
  let micros: bigint;
  if (shift >= 0) {
    micros = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) {
      return err(
        "PRECISION_EXCEEDED",
        `${field} carries more than ${String(QUANTITY_SCALE)} decimal places (${text})`,
        field,
      );
    }
    micros = digits / divisor;
  }
  micros *= sign;

  if (micros > MAX_QUANTITY_MICROS || micros < -MAX_QUANTITY_MICROS) {
    return err(
      "QUANTITY_OUT_OF_RANGE",
      `${field} magnitude exceeds the representable ledger range`,
      field,
    );
  }
  return ok(micros);
}

/** Exact micro-units → nearest `number` for the decimal value they represent. */
export function microsToAmount(micros: bigint): number {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const text =
    frac === 0n
      ? whole.toString()
      : `${whole.toString()}.${frac.toString().padStart(QUANTITY_SCALE, "0").replace(/0+$/, "")}`;
  const value = Number(text);
  return negative ? -value : value;
}

/** Human-readable exact decimal rendering, e.g. `1.25 lb`. */
export function formatQuantity(quantity: Quantity): string {
  const negative = quantity.micros < 0n;
  const abs = negative ? -quantity.micros : quantity.micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const trimmed = frac.toString().padStart(QUANTITY_SCALE, "0").replace(/0+$/, "");
  const digits = trimmed === "" ? whole.toString() : `${whole.toString()}.${trimmed}`;
  return `${negative ? "-" : ""}${digits} ${quantity.unit}`;
}
