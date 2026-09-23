/**
 * Ledger failures as HTTP answers (M2-T2).
 *
 * The rule this module exists to enforce: **the API returns the code, never the
 * domain's message.** A `LedgerError.message` is written for a log. It quotes
 * stored values ("transaction unit \"oz\" differs from item unit \"lb\""), it
 * names internal fields, and it is not the sentence anybody decided to show a
 * person. copy-deck.md §8 is where that decision lives, keyed off the code, and
 * it classifies seven codes as user-facing and the rest as "show the generic
 * fallback". So the body carries `ledgerCode` plus one fixed sentence of ours,
 * and the client picks the string.
 *
 * Statuses:
 *
 * - `IDEMPOTENCY_KEY_CONFLICT` is **409**. It is not a malformed request; the
 *   request is well formed and collides with something already recorded, and a
 *   client retrying a queued write needs to tell the two apart to know whether
 *   to drop the write or fix it.
 * - every other refusal is **400**. The ledger refused a statement about the
 *   world; nothing was written.
 * - `ITEM_MISMATCH` never reaches here: an item the session cannot see is a
 *   **404** decided before the ledger is consulted, indistinguishable from an
 *   item that does not exist.
 */

import type { ApiErrorBodyDto, ApiErrorCode } from "@smart-kitchen/contracts";
import type { LedgerError } from "@smart-kitchen/domain";

/** Answer to a write the ledger refused. */
export interface LedgerErrorResponse {
  readonly statusCode: 400 | 409;
  readonly body: ApiErrorBodyDto;
}

const CONFLICT_MESSAGE =
  "That request was already used for a different change, so it was not applied again.";

const REFUSED_MESSAGE = "That change could not be recorded.";

export function ledgerErrorResponse(
  error: LedgerError,
  correlationId: string,
): LedgerErrorResponse {
  const conflict = error.code === "IDEMPOTENCY_KEY_CONFLICT";
  const statusCode: 400 | 409 = conflict ? 409 : 400;
  const code: ApiErrorCode = conflict ? "CONFLICT" : "BAD_REQUEST";
  return {
    statusCode,
    body: {
      error: {
        code,
        message: conflict ? CONFLICT_MESSAGE : REFUSED_MESSAGE,
        correlationId,
        // Assigned with no cast at all, which is itself the check: this
        // compiles only while every `LedgerErrorCode` is a `LedgerErrorCodeDto`.
        // The consistency suite in packages/adapters closes the other
        // direction and states the rule out loud.
        ledgerCode: error.code,
      },
    },
  };
}

/** The shared 404: an item (or a row) this session cannot see, or none at all. */
export function notVisibleResponse(correlationId: string): ApiErrorBodyDto {
  return { error: { code: "NOT_FOUND", message: "Not found.", correlationId } };
}

/**
 * 409 for an undo that arrived too late: the stock the transaction added has
 * already been used, so reversing it would drive the lot negative.
 *
 * A **409**, not a 400, for the same reason a reused idempotency key is: the
 * request is well formed and the world has moved on. The sentence is fixed here
 * rather than left to the client because this refusal has no `LedgerErrorCode`
 * to key off (the ledger would have accepted the row and clamped it); the
 * architect adds the string to copy-deck.md §8 at acceptance.
 */
export function undoNotPossibleResponse(correlationId: string): ApiErrorBodyDto {
  return {
    error: {
      code: "UNDO_NOT_POSSIBLE",
      message: "That change can't be undone. The stock it added has already been used.",
      correlationId,
    },
  };
}
