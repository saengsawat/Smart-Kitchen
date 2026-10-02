/**
 * How a confirmed AI proposal reads (M2-T5, D-028).
 *
 * The ledger row a member confirmed is never edited (INV-LEDGER-2): it still
 * says `AI_INTERPRETATION` and still carries the receipt read's source. The
 * confirmation is its own row in `inventory_confirmations` (migration 0010),
 * and the read paths (the summary in `snapshot.ts`, the history in
 * `detail.ts`) join it and present the pair through this one function, so the
 * list, the detail screen and the confirm endpoint's response cannot disagree
 * about what a confirmed row looks like.
 *
 * Two rules, both fail-closed:
 *
 * - **Only an AI_INTERPRETATION row is promoted.** Migration 0010's trigger
 *   already refuses a confirmation of any other row, but a read must not turn
 *   an ESTIMATED value into a known one even if a row it did not expect is
 *   there: a stored confirmation on another tier leaves the tier as stored.
 * - **The person is reduced to initials.** The confirmer's display name comes
 *   in and only {@link displayInitials} leaves. A confirmer the
 *   `users_shared_household` policy hides (a member who has since left) still
 *   reads as confirmed, just without a chip, rather than losing the
 *   confirmation or naming anyone.
 *
 * Nothing else about the provenance changes: `confidence` and `recordedAt`
 * describe the reading the member confirmed, and they stay as recorded.
 */

import type { FieldProvenanceDto } from "@smart-kitchen/contracts";
import { displayInitials } from "./initials.js";

/** Joins the original source and the confirmer: "receipt read “ORG STRWB 1LB” · confirmed by DC". */
export const CONFIRMED_BY_SEPARATOR = " · confirmed by ";

/** The suffix when the confirmer cannot be shown (no initials to render). */
export const CONFIRMED_SUFFIX = " · confirmed";

/** The source text a confirmed row presents. */
export function confirmedSource(
  originalSource: string | null,
  confirmerDisplayName: string | null,
): string {
  const base = originalSource ?? "";
  const initials = displayInitials(confirmerDisplayName);
  return initials === undefined
    ? `${base}${CONFIRMED_SUFFIX}`
    : `${base}${CONFIRMED_BY_SEPARATOR}${initials}`;
}

/**
 * The provenance a ledger row presents, given whether a confirmation of it
 * exists. Unconfirmed rows, and any row not stored as AI_INTERPRETATION, come
 * back exactly as stored.
 */
export function confirmedProvenance(
  stored: FieldProvenanceDto,
  confirmation: { readonly confirmed: boolean; readonly confirmerDisplayName: string | null },
): FieldProvenanceDto {
  if (!confirmation.confirmed || stored.tier !== "AI_INTERPRETATION") return stored;
  return {
    tier: "KNOWN_FACT",
    source: confirmedSource(stored.source, confirmation.confirmerDisplayName),
    confidence: stored.confidence,
    recordedAt: stored.recordedAt,
  };
}
