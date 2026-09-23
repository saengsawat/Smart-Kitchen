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

import type { LedgerErrorCodeDto } from "@smart-kitchen/contracts";
import { ZeroDeltaError } from "./ledger";

/** copy-deck.md §8, `ZERO_DELTA` row, verbatim. */
export const ZERO_DELTA_MESSAGE = "Enter an amount to record a change.";

/** copy-deck.md §8's generic fallback, verbatim. */
export const GENERIC_LEDGER_ERROR_MESSAGE =
  "Something went wrong saving that. Try again, and tell us if it keeps happening.";

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
  switch (code as KnownLedgerOrApiCode | undefined) {
    case "ZERO_DELTA":
      return ZERO_DELTA_MESSAGE;
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
 * Thrown by `HttpApiClient` (src/api/client.ts) for a write/undo/detail
 * request the server answered with a non-2xx `ApiErrorBodyDto`. Carries only
 * the wire code (`ledgerCode` when the body has one, else the top-level
 * `code`) — never the domain's own `message` (copy-deck.md §8's rule; see
 * this module's doc comment).
 */
export class LedgerRefusedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`ledger refused: ${code}`);
    this.name = "LedgerRefusedError";
    this.code = code;
  }
}

/**
 * Picks the user-facing sentence for a rejected write (review F3, extended
 * M3-T4a): a `ZeroDeltaError` (the fixture's own zero-delta rejection) and a
 * `LedgerRefusedError` (the real endpoint's coded refusal) each get their
 * copy-deck.md §8 sentence via {@link ledgerErrorMessage}; every other
 * rejection (an unknown item, a network hiccup, anything else) gets the
 * generic fallback, never a raw `Error.message`.
 */
export function messageForLedgerError(error: unknown): string {
  if (error instanceof ZeroDeltaError) {
    return ledgerErrorMessage("ZERO_DELTA");
  }
  if (error instanceof LedgerRefusedError) {
    return ledgerErrorMessage(error.code);
  }
  return GENERIC_LEDGER_ERROR_MESSAGE;
}
