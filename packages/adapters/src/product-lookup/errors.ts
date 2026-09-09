/**
 * Typed failures for the product-lookup module.
 *
 * Self-contained (mirrors the `Outcome<T>`/`ok`/`err` idiom used by
 * `packages/domain/src/units` and `.../inventory` — never throw for a
 * rejected-but-expected condition), but this module does not import from
 * `packages/domain`: adapters is its own package and M1-T5 has no dependency
 * on domain code landing first.
 */

/** Stable machine-readable reason a product-lookup/nutrition-source call was rejected. */
export type AdapterErrorCode =
  /** A code string did not match any supported `CodeType` format. */
  | "INVALID_CODE"
  /** A fixture file's JSON did not conform to the expected fixture schema. */
  | "FIXTURE_SCHEMA_INVALID"
  /** A fixture path could not be read (missing directory, unreadable file). */
  | "FIXTURE_NOT_READABLE"
  /** A barcode manifest entry referenced a `productId` with no matching fixture. */
  | "FIXTURE_REFERENCE_NOT_FOUND"
  /** An ingredient search query was empty/whitespace-only. */
  | "INVALID_QUERY";

/** A rejected adapter operation, with enough context to explain it to a caller or a log. */
export interface AdapterError {
  readonly code: AdapterErrorCode;
  readonly message: string;
  /** Field path, file name, or code the error is about, when one applies. */
  readonly field?: string;
}

/** Total-function result: either a value or an {@link AdapterError}. Adapters never throw. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdapterError };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: AdapterErrorCode,
  message: string,
  field?: string,
): Outcome<T> {
  return {
    ok: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
}

export function isAdapterError(value: unknown): value is AdapterError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
