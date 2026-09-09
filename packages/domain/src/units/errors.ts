/**
 * Typed failures for the units module.
 *
 * This module is deliberately self-contained (architect guidance, M1-T3): it
 * does not import `../inventory/errors.js`. The units layer sits *beside* the
 * ledger, not inside it, and the ledger's `LedgerErrorCode` is about ledger
 * concerns (mixed units, idempotency, timestamps) that have nothing to do
 * with unit conversion. The `Outcome<T>` shape mirrors the ledger's
 * total-function idiom (never throw for a domain-rule violation) so the two
 * modules read consistently, but the two error unions are independent types.
 */

/** Stable machine-readable reason a unit operation was rejected. */
export type UnitErrorCode =
  /** A unit string did not match any registered symbol or alias. */
  | "UNKNOWN_UNIT"
  /** `from`/`to` belong to different kinds and no conversion bridge was given. */
  | "INCOMPATIBLE_UNITS"
  /** A bridge was given, but its kind pair does not relate `from`'s and `to`'s kinds. */
  | "BRIDGE_KIND_MISMATCH"
  /** A bridge ratio was non-finite, zero, or negative. */
  | "INVALID_BRIDGE_RATIO"
  /** A caller-supplied decimal (e.g. a bridge ratio) was not a finite number. */
  | "NOT_FINITE";

/** A rejected unit operation, with enough context to explain it to a user or a log. */
export interface UnitError {
  readonly code: UnitErrorCode;
  readonly message: string;
  /** Field path or identifier the error is about, when one applies. */
  readonly field?: string;
}

/** Total-function result: either a value or a {@link UnitError}. Never throws. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: UnitError };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function err<T = never>(code: UnitErrorCode, message: string, field?: string): Outcome<T> {
  return {
    ok: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
}

export function isUnitError(value: unknown): value is UnitError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
