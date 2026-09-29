/**
 * S7/S8 product-lookup error copy (M3-T4e, copy-deck.md §8 "Product lookup
 * refusals", added at M2-T4a acceptance, 2026-09-29). Three strings, keyed
 * off the wire code the server answers with, rendered verbatim and **never**
 * the server's own `message` (CLAUDE.md invariant: no server message ever
 * reaches a screen).
 *
 * `HttpApiClient.lookupProduct` (src/api/client.ts) throws a
 * {@link ProductLookupRefusedError} for a 400 `PLU_NOT_SUPPORTED`, a 400
 * `BAD_REQUEST` on the lookup route, or any other non-2xx (401/403/5xx);
 * {@link messageForLookupError} maps it (and any other thrown error, e.g. a
 * plain network failure) to what S7 shows. A 200 `error` outcome (the source
 * itself could not answer) is not an exception — `ProductLookupResultDto`
 * already models it as a typed result — so its string is exported separately
 * for the screen's own `result.status === "error"` branch.
 */

import { GENERIC_READ_ERROR_MESSAGE } from "../inventory/errors";

/** copy-deck.md §8, `PLU_NOT_SUPPORTED` row, verbatim. */
export const PLU_NOT_SUPPORTED_MESSAGE =
  "Produce codes can't be looked up by barcode yet. Add this item by hand.";

/** copy-deck.md §8, `BAD_REQUEST` (lookup route) row, verbatim. */
export const NOT_A_BARCODE_MESSAGE = "That isn't a barcode number we can look up.";

/** copy-deck.md §8, lookup `error` outcome row, verbatim (BACKLOG.md M3-T4e Objective (a)). */
export const LOOKUP_UPSTREAM_ERROR_MESSAGE =
  "The product database didn't answer. Try again in a moment, or add the item by hand.";

/**
 * Thrown by `HttpApiClient.lookupProduct` for a lookup the server refused
 * outright (never for a `hit`/`not-found`/`error` outcome, which are typed
 * results, not exceptions). Carries only the wire code, same discipline as
 * `LedgerRefusedError` (src/inventory/errors.ts): never the server's own
 * `message`.
 */
export class ProductLookupRefusedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`product lookup refused: ${code}`);
    this.name = "ProductLookupRefusedError";
    this.code = code;
  }
}

/**
 * Picks S7's sentence for a rejected `lookupProduct` call (BACKLOG.md
 * M3-T4e Objective (a), review round 1 F2/R2 ruling): `PLU_NOT_SUPPORTED`
 * and `BAD_REQUEST` get their own copy-deck.md §8 string; every other
 * {@link ProductLookupRefusedError} code (401/403, an unrecognised code,
 * `INTERNAL`) and anything that is not one of these errors at all (a plain
 * network failure, an unexpected-body `Error`) falls through to
 * {@link GENERIC_READ_ERROR_MESSAGE} — a lookup is a *read*, never a save,
 * so it gets the read fallback ("Something went wrong loading that...")
 * rather than the ledger's save-failure sentence.
 */
export function messageForLookupError(error: unknown): string {
  if (error instanceof ProductLookupRefusedError) {
    switch (error.code) {
      case "PLU_NOT_SUPPORTED":
        return PLU_NOT_SUPPORTED_MESSAGE;
      case "BAD_REQUEST":
        return NOT_A_BARCODE_MESSAGE;
      default:
        return GENERIC_READ_ERROR_MESSAGE;
    }
  }
  return GENERIC_READ_ERROR_MESSAGE;
}
