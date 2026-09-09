/**
 * Typed failures for the allergen module (M1-T4).
 *
 * Self-contained by the same reasoning as `units/errors.ts` (M1-T3): the
 * allergen engine sits *beside* the ledger and the units registry, not inside
 * either, so it owns its own error union. The `Outcome<T>` shape mirrors the
 * ledger's and the units module's total-function idiom (never throw for a
 * domain-rule violation) so all three modules read consistently, but the error
 * unions are independent types.
 *
 * **Fail closed.** Every code here describes an input the engine refuses to
 * screen. Refusing is the safe direction: a caller that cannot construct a
 * valid restriction set gets an error, never a permissive verdict. There is
 * deliberately no "best effort" mode.
 */

/** Stable machine-readable reason an allergen operation was rejected. */
export type AllergenErrorCode =
  /** A value that had to be an object (member, restriction, subject) was not one. */
  | "NOT_AN_OBJECT"
  /** A member id was missing, empty, or not a string. */
  | "EMPTY_MEMBER_ID"
  /** Two members in one screening call carried the same id. */
  | "DUPLICATE_MEMBER_ID"
  /** A restriction id was missing, empty, or not a string. */
  | "EMPTY_RESTRICTION_ID"
  /** Two restrictions on one member carried the same id. */
  | "DUPLICATE_RESTRICTION_ID"
  /** A restriction's `kind` was neither `MAJOR` nor `USER_DEFINED`. */
  | "INVALID_RESTRICTION_KIND"
  /**
   * A *restriction* named an allergen code outside the taxonomy. This is an
   * error rather than an unknown: the household's own restriction list is our
   * data, and screening against a code we cannot interpret would silently fail
   * to protect that member.
   */
  | "UNKNOWN_ALLERGEN_CODE"
  /** A user-defined restriction term was empty after normalization. */
  | "EMPTY_TERM"
  /** A user-defined term normalized to fewer than {@link MIN_TERM_LENGTH} characters. */
  | "TERM_TOO_SHORT"
  /** A severity was neither `standard` nor `severe`. */
  | "INVALID_SEVERITY"
  /** A subject's `kind` was neither `RECIPE` nor `PRODUCT`. */
  | "INVALID_SUBJECT_KIND"
  /** A subject id was missing, empty, or not a string. */
  | "EMPTY_SUBJECT_ID"
  /**
   * A recipe subject carried no ingredients. Screening "nothing" would return
   * a vacuous no-known-match, so an empty recipe is refused outright.
   */
  | "EMPTY_RECIPE"
  /** A recipe ingredient's reference/name was empty. */
  | "EMPTY_INGREDIENT_REF";

/** Shortest user-defined term the engine will accept (normalized characters). */
export const MIN_TERM_LENGTH = 3;

/** A rejected allergen operation, with enough context to explain it to a user or a log. */
export interface AllergenError {
  readonly code: AllergenErrorCode;
  readonly message: string;
  /** Field path or identifier the error is about, when one applies. */
  readonly field?: string;
}

/** Total-function result: either a value or an {@link AllergenError}. Never throws. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AllergenError };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: AllergenErrorCode,
  message: string,
  field?: string,
): Outcome<T> {
  return {
    ok: false,
    error: field === undefined ? { code, message } : { code, message, field },
  };
}

export function isAllergenError(value: unknown): value is AllergenError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
