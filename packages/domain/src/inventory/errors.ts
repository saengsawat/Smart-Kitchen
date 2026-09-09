/**
 * Typed ledger failures.
 *
 * The ledger never throws for domain-rule violations: every operation returns
 * a discriminated {@link Outcome} (or an {@link AppendResult}) so callers must
 * handle rejection explicitly. Runtime `TypeError`s are still possible — and
 * intended — when someone attempts to mutate a frozen recorded transaction
 * (INV-LEDGER-2's runtime guard).
 */

/** Stable machine-readable reason a ledger operation was rejected. */
export type LedgerErrorCode =
  /** Transaction/lot unit differs from the item's declared unit (M1-T1: one unit per item). */
  | "MIXED_UNITS"
  /** Transaction targets a lot that has not been opened on this item. */
  | "UNKNOWN_LOT"
  /** A lot with this id already exists on the item. */
  | "DUPLICATE_LOT"
  /** `qtyDelta` is 0 — a transaction that changes nothing does not belong in the ledger. */
  | "ZERO_DELTA"
  /** `qtyDelta` sign contradicts the transaction type (e.g. a CONSUME that adds stock). */
  | "WRONG_SIGN"
  /** `qtyDelta` is NaN/Infinity. */
  | "NOT_FINITE"
  /** `qtyDelta` carries more precision than the ledger scale (1e-6) can represent exactly. */
  | "PRECISION_EXCEEDED"
  /** `qtyDelta` magnitude exceeds the representable ledger range. */
  | "QUANTITY_OUT_OF_RANGE"
  /** A timestamp is not a parseable ISO-8601 instant. */
  | "INVALID_TIMESTAMP"
  /** `recordedAt` precedes `occurredAt`. */
  | "TIMESTAMP_ORDER"
  /** Idempotency key is empty or uses the reserved system separator. */
  | "INVALID_IDEMPOTENCY_KEY"
  /** Idempotency key was already used by a materially different write. */
  | "IDEMPOTENCY_KEY_CONFLICT"
  /** A required string/enum field is missing, empty, or out of range. */
  | "INVALID_FIELD"
  /** Stored transactions do not belong to the item being rehydrated. */
  | "ITEM_MISMATCH"
  /** Stored ledger rows are internally inconsistent (sequence gaps/duplicates). */
  | "CORRUPT_LEDGER";

/** A rejected ledger operation, with enough context to explain it to a user or a log. */
export interface LedgerError {
  readonly code: LedgerErrorCode;
  readonly message: string;
  /** Field path or identifier the error is about, when one applies. */
  readonly field?: string;
}

/** Total-function result: either a value or a {@link LedgerError}. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: LedgerError };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function err<T = never>(code: LedgerErrorCode, message: string, field?: string): Outcome<T> {
  return {
    ok: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
}

export function ledgerError(code: LedgerErrorCode, message: string, field?: string): LedgerError {
  return field === undefined ? { code, message } : { code, message, field };
}

export function isLedgerError(value: unknown): value is LedgerError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
