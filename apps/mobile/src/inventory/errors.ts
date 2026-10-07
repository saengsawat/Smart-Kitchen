/**
 * User-facing ledger error copy (M3-T3 review F3/F5, M3-T4a; copy-deck.md
 * §8).
 *
 * `ledgerErrorMessage` is the one place every M2-T2 refusal renders through
 * (BACKLOG.md M3-T4a Objective (c)): keyed off a `LedgerErrorCodeDto`, or off
 * one of the three API-level codes copy-deck.md §8's "API-level refusals"
 * paragraph adds (`IDEMPOTENCY_KEY_CONFLICT`, `UNDO_NOT_POSSIBLE`,
 * `NOT_FOUND`) — the API answers these without a `LedgerErrorCode` to key
 * off (an undo refusal, a hidden item) or with one that the ledger's own
 * table classifies internal-only but that this specific 409 path gives its
 * own sentence to (see the switch below). Every other code, and anything
 * unrecognised (a network hiccup, a malformed body), gets the generic
 * fallback — the domain's own `message` is never shown.
 */

import {
  API_ERROR_CODES,
  LEDGER_ERROR_CODES_DTO,
  type ApiErrorCode,
  type LedgerErrorCodeDto,
} from "@smart-kitchen/contracts";
import { ZeroDeltaError } from "./ledger";

/** copy-deck.md §8, `ZERO_DELTA` row, verbatim. */
export const ZERO_DELTA_MESSAGE = "Enter an amount to record a change.";

/** copy-deck.md §8's generic fallback, verbatim. */
export const GENERIC_LEDGER_ERROR_MESSAGE =
  "Something went wrong saving that. Try again, and tell us if it keeps happening.";

/**
 * A read-failure counterpart to {@link GENERIC_LEDGER_ERROR_MESSAGE} (review
 * round 1, F13): "saving that" is wrong copy for a load failure (S11's
 * `getShoppingList` rejecting, e.g. `HttpApiClient`'s M7 "not available yet"
 * path). PROPOSED, not yet in copy-deck.md §8 — the architect adds it there
 * at acceptance (this worker's report proposes the exact string).
 */
export const GENERIC_READ_ERROR_MESSAGE =
  "Something went wrong loading that. Try again, and tell us if it keeps happening.";

/**
 * copy-deck.md §8, `COUNT_NOT_WHOLE` row (M2-T8, D-029): a count unit (each,
 * can, pack) takes whole numbers only. The server's own refusal renders this.
 */
export const COUNT_NOT_WHOLE_MESSAGE = "Use a whole number for this item.";

/**
 * The three API-level codes copy-deck.md §8's "API-level refusals"
 * paragraph adds, none of which is a `LedgerErrorCodeDto`: `NOT_FOUND` and
 * `UNDO_NOT_POSSIBLE` are `ApiErrorCode`s the ledger never produces (an
 * authorization/visibility decision and the API's own undo refusal,
 * respectively); `IDEMPOTENCY_KEY_CONFLICT` **is** also a
 * `LedgerErrorCodeDto` (the ledger's own payload-mismatch rejection,
 * ledger-errors.ts), but every wire occurrence of it is the 409 conflict
 * path (a reused key with a different payload), which earns its own
 * sentence here rather than the ledger table's "internal-only, client bug"
 * classification (written for the code in the abstract, not for what a
 * caller can actually observe over HTTP).
 */
export type ApiLevelErrorCode = "IDEMPOTENCY_KEY_CONFLICT" | "UNDO_NOT_POSSIBLE" | "NOT_FOUND";

/** Every code `ledgerErrorMessage` recognises, user-facing and internal-only alike. */
export type KnownLedgerOrApiCode = LedgerErrorCodeDto | ApiLevelErrorCode;

/**
 * copy-deck.md §8's table plus its "API-level refusals" paragraph, verbatim,
 * keyed off the wire code (`ApiErrorBodyDto.error.ledgerCode` when present,
 * else `.error.code`). Every internal-only `LedgerErrorCodeDto` (the ledger
 * table's "No" column) and any code this function does not recognise falls
 * through to {@link GENERIC_LEDGER_ERROR_MESSAGE}.
 *
 * `WRONG_SIGN`'s copy-deck sentence carries a `{action}` placeholder
 * ("That doesn't match {action}."). Nothing in this ticket's screens can
 * trigger it (a correction never sends a signed amount; a removal never
 * sends a sign at all — reachable only "via manual entry, e.g. a negative
 * number typed into a purchase field", a screen this ticket does not build),
 * so there is no concrete action name to fill the placeholder with here.
 * `action` defaults to a neutral phrase rather than inventing a specific one
 * (rule 3/4: never resolve an open product question by assumption);
 * whichever screen first makes this code reachable should pass its own
 * action name.
 */
export function ledgerErrorMessage(
  code: string | null | undefined,
  options?: { readonly action?: string },
): string {
  switch (code as KnownLedgerOrApiCode | ApiClientErrorCode | undefined) {
    case "ZERO_DELTA":
      return ZERO_DELTA_MESSAGE;
    case "COUNT_NOT_WHOLE":
      return COUNT_NOT_WHOLE_MESSAGE;
    case "WRONG_SIGN":
      return `That doesn't match ${options?.action ?? "what you're doing"}. Check the amount and try again.`;
    case "QUANTITY_OUT_OF_RANGE":
      return "That amount looks too large. Double check it.";
    case "PRECISION_EXCEEDED":
      return "Enter the amount with fewer decimal places.";
    case "INVALID_TIMESTAMP":
      return "That date doesn't look right. Check it and try again.";
    case "TIMESTAMP_ORDER":
      return "That date is in the future. Enter when it actually happened.";
    case "UNKNOWN_LOT":
      return "This batch isn't available anymore. Refresh and try again.";
    case "IDEMPOTENCY_KEY_CONFLICT":
      return "That request was already used for a different change, so it was not applied again.";
    case "UNDO_NOT_POSSIBLE":
      return "That change can't be undone. The stock it added has already been used.";
    case "NOT_FOUND":
      return "Not found.";
    default:
      return GENERIC_LEDGER_ERROR_MESSAGE;
  }
}

/**
 * Codes only the client produces (M3-T12): never on the wire. Nothing throws
 * them yet; they are reserved so a screen's `switch` over `ApiClientErrorCode`
 * stays exhaustive when a transport failure becomes an `ApiError`.
 */
export const CLIENT_ONLY_ERROR_CODES = ["NETWORK", "UNEXPECTED_RESPONSE"] as const;

/** Every code an {@link ApiError} can carry: the contracts' codes plus the client-only ones. */
export type ApiClientErrorCode =
  ApiErrorCode | LedgerErrorCodeDto | (typeof CLIENT_ONLY_ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  ...API_ERROR_CODES,
  ...LEDGER_ERROR_CODES_DTO,
  ...CLIENT_ONLY_ERROR_CODES,
]);

/** A wire code the contracts do not list (a newer server, a proxy page) is `INTERNAL`: it renders the generic fallback either way. */
function toApiClientErrorCode(code: string): ApiClientErrorCode {
  return KNOWN_CODES.has(code) ? (code as ApiClientErrorCode) : "INTERNAL";
}

/**
 * The one typed error `HttpApiClient` throws for a non-2xx answer (M3-T12).
 * Carries only the wire code (`ledgerCode` when the body has one, else the
 * top-level `code`) and the HTTP status when there was a response; never the
 * domain's own `message` (copy-deck.md §8's rule; see this module's doc
 * comment). Screens render it through {@link messageForLedgerError}.
 */
export class ApiError extends Error {
  readonly code: ApiClientErrorCode;
  /** The HTTP status, absent for an error raised without a response (the fixture client). */
  readonly status: number | undefined;

  constructor(code: string, status?: number) {
    super(`api error: ${code}`);
    this.name = "ApiError";
    this.code = toApiClientErrorCode(code);
    this.status = status;
  }
}

/**
 * A coded write/undo/detail refusal. Kept as a subclass of {@link ApiError}
 * (the smaller diff: every `instanceof LedgerRefusedError` site keeps working)
 * so `instanceof ApiError` catches it too.
 */
export class LedgerRefusedError extends ApiError {
  constructor(code: string, status?: number) {
    super(code, status);
    this.name = "LedgerRefusedError";
    this.message = `ledger refused: ${code}`;
  }
}

/**
 * Picks the user-facing sentence for a rejected write (review F3, extended
 * M3-T4a): a `ZeroDeltaError` (the fixture's own zero-delta rejection) and a
 * `ApiError` (the real endpoint's coded refusal) each get their
 * copy-deck.md §8 sentence via {@link ledgerErrorMessage}; every other
 * rejection (an unknown item, a network hiccup, anything else) gets the
 * generic fallback, never a raw `Error.message`.
 */
export function messageForLedgerError(error: unknown): string {
  if (error instanceof ZeroDeltaError) {
    return ledgerErrorMessage("ZERO_DELTA");
  }
  if (error instanceof ApiError) {
    return ledgerErrorMessage(error.code);
  }
  return GENERIC_LEDGER_ERROR_MESSAGE;
}
