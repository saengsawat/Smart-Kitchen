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
  /**
   * 404 from `POST /v1/households/join` (M2-T3). One code, one message, for a
   * code that never existed, one that was rotated away, and one that is not
   * even well formed: telling them apart would tell a guesser which guesses
   * were close.
   */
  "JOIN_CODE_INVALID",
  /** 429: too many attempts in the window (M2-T3: 10 join attempts per user per 10 minutes). */
  "RATE_LIMITED",
  /** 403 from an owner-only household action attempted by a member (M2-T3: rotating the join code). */
  "NOT_OWNER",
  /**
   * 400 from `GET /v1/products/{code}` for a 4 or 5 digit produce code
   * (M2-T4a). A PLU is never sent through a barcode lookup: a PLU queried as
   * a barcode comes back as a wrong-but-found product more often than as a
   * clean miss (ADR-006, R-1). Produce gets its own curated table in M4.
   */
  "PLU_NOT_SUPPORTED",
  /**
   * 409 from `POST /v1/shopping/rows/{rowId}/add-to-inventory` for a row
   * that names no inventory item (M7-T1). There is nothing to append a
   * PURCHASE to; the client hands such a row to S9's manual add instead.
   */
  "ROW_HAS_NO_ITEM",
  /**
   * 409 from `POST /v1/inventory/items/{itemId}/confirm` for an item with no
   * AI-interpreted ledger row at all (M2-T5, D-028): there is no proposal to
   * confirm. An item whose AI rows are all confirmed already is not this
   * refusal; it answers the same idempotent 200.
   */
  "NOT_A_PROPOSAL",
  /**
   * 409 from `POST /v1/inventory/items/{itemId}/move` when `toLocation` is
   * the item's current location (M2-T6, D-024 row 1). Nothing is recorded.
   * A retry of an applied move (same key) is not this refusal: it answers the
   * same 200.
   */
  "SAME_LOCATION",
  /**
   * 400 from a write that would put a fraction into a count unit (M2-T8,
   * D-029): any unit the registry files under COUNT (count, each, ct, unit,
   * piece and their spellings). Refused on create (`amount`), on an
   * `ADJUSTMENT` whose `targetAmount` is a fraction or whose `deltaAmount`
   * would leave a fractional balance, and on a removal whose `amount` is
   * neither the item's full current balance nor a whole amount that leaves a
   * whole balance (so from 12.5, removing 1 or 13 is refused and removing
   * 12.5, or omitting `amount`, is not). Nothing is recorded. Not a `LedgerErrorCode`: the ledger itself holds any exact
   * decimal, and fractional history already written stays readable. Undo is
   * never refused for this reason, and a retry of an already accepted write
   * (same key, same body) still answers its 200.
   */
  "COUNT_NOT_WHOLE",
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
