/**
 * Error envelope shared by every API response that is not a 2xx (M2-T1).
 *
 * The body says three things and nothing else: a stable machine code, a
 * sentence safe to show a person, and the correlation id of the request. It
 * deliberately carries no detail about *why* an authorization decision went the
 * way it did: "no session" and "that household is not yours" answer
 * identically shaped bodies, because the difference is itself information about
 * another household (the same reasoning as the tenant-inference oracle closed in
 * migration 0003).
 *
 * M2-T2 adds a fourth, optional field, {@link ApiErrorBodyDto.error.ledgerCode},
 * on exactly one class of failure: a write the inventory ledger refused. The
 * transport code ("this was a bad request") does not say which rule was broken,
 * and the screen needs to know, because copy-deck.md §8 keys its sentence off
 * the code. What still never travels is the domain's own `message`: it is
 * written for a log, it quotes stored values, and a client that rendered it
 * would be rendering an internal string to a person.
 */

/** Stable, machine-readable failure codes. */
export const API_ERROR_CODES = [
  /** No bearer token, a malformed Authorization header, or a token the identity port refused. */
  "UNAUTHENTICATED",
  /** Authenticated, but this session may not perform this operation. */
  "FORBIDDEN",
  /** No route matched, or the addressed row is not visible to this session. */
  "NOT_FOUND",
  /** The request itself was malformed, or the ledger refused it (see `ledgerCode`). */
  "BAD_REQUEST",
  /** The request collides with something already recorded (M2-T2: a reused idempotency key). */
  "CONFLICT",
  /**
   * The named transaction cannot be undone, because the stock it added has
   * since been used (M2-T2). Not a `LedgerErrorCode`: the ledger would have
   * accepted the compensating row and clamped it. This is the API's own
   * refusal, because silently clamping an undo would invent an
   * over-consumption event nobody caused and would inflate the correction-rate
   * metric with it (ARCHITECTURE.md §8).
   */
  "UNDO_NOT_POSSIBLE",
  /** Anything else. Never carries internal detail. */
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The ledger's own refusal reasons (`LedgerErrorCode` in
 * `packages/domain/src/inventory/errors.ts`), mirrored here so `apps/mobile`
 * can map a refusal to its copy-deck §8 string without importing
 * `@smart-kitchen/domain` (contracts stays dependency-free, M3-T1 invariant).
 *
 * The list is hand-written, which leaves it free to drift from the domain's;
 * `packages/adapters/src/contracts-consistency/ledger-error-codes.test.ts`
 * is what closes that, at compile time and at run time.
 */
export const LEDGER_ERROR_CODES_DTO = [
  "MIXED_UNITS",
  "UNKNOWN_LOT",
  "DUPLICATE_LOT",
  "ZERO_DELTA",
  "WRONG_SIGN",
  "NOT_FINITE",
  "PRECISION_EXCEEDED",
  "QUANTITY_OUT_OF_RANGE",
  "INVALID_TIMESTAMP",
  "TIMESTAMP_ORDER",
  "INVALID_IDEMPOTENCY_KEY",
  "IDEMPOTENCY_KEY_CONFLICT",
  "INVALID_FIELD",
  "ITEM_MISMATCH",
  "CORRUPT_LEDGER",
] as const;

export type LedgerErrorCodeDto = (typeof LEDGER_ERROR_CODES_DTO)[number];

export interface ApiErrorBodyDto {
  readonly error: {
    readonly code: ApiErrorCode;
    /** One sentence, safe to display. Never contains personal data or internal detail. */
    readonly message: string;
    /** Echo of the request's correlation id, so a user-reported failure can be found in the logs. */
    readonly correlationId: string;
    /**
     * Present only when the inventory ledger refused a write. Copy-deck.md §8
     * maps each code to its user-facing sentence, or to the generic fallback
     * for the codes classified internal-only there.
     */
    readonly ledgerCode?: LedgerErrorCodeDto;
  };
}

/** Response header carrying the correlation id on every response, success or failure. */
export const CORRELATION_ID_HEADER = "x-correlation-id";
