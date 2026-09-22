/**
 * User-facing ledger error copy (M3-T3 review F3/F5, copy-deck.md §8).
 *
 * Only `ZERO_DELTA` is reachable from this ticket's screens (a correction
 * whose stepper draft equals the current amount) and gets its own sentence;
 * everything else (a network failure on first load, an unexpected rejection)
 * falls back to the generic string copy-deck.md §8 specifies for exactly
 * that case: "used for every internal-only code, if one ever reaches a
 * screen."
 */

import { ZeroDeltaError } from "./ledger";

/** copy-deck.md §8, `ZERO_DELTA` row, verbatim. */
export const ZERO_DELTA_MESSAGE = "Enter an amount to record a change.";

/** copy-deck.md §8's generic fallback, verbatim. */
export const GENERIC_LEDGER_ERROR_MESSAGE =
  "Something went wrong saving that. Try again, and tell us if it keeps happening.";

/**
 * Picks the user-facing sentence for a rejected write (review F3): a
 * zero-delta correction gets its own copy-deck.md §8 row; every other
 * rejection (an unknown item, a network hiccup, anything else) gets the
 * generic fallback, never a raw `Error.message` (copy-deck.md §8's own
 * rule: internal-only codes never reach the screen as their own text).
 */
export function messageForLedgerError(error: unknown): string {
  return error instanceof ZeroDeltaError ? ZERO_DELTA_MESSAGE : GENERIC_LEDGER_ERROR_MESSAGE;
}
