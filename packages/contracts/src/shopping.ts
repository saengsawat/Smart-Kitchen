/**
 * Shopping-list read/write contracts (M3-T5).
 *
 * The wire shape S11 needs, shared by the API (M7, not built yet) and the
 * M3 client so the two cannot drift once the real endpoint lands.
 *
 * Three rules carried over from `inventory.ts` (same reasoning, restated
 * here rather than assumed):
 *
 * 1. **Exact quantities travel as text.** `needMicros`/`haveMicros`/
 *    `buyMicros` are decimal-text micros, parsed with `BigInt`, never
 *    `Number` (ADR-008, CLAUDE.md rule 7). `buyMicros` is the domain's
 *    `neededQuantity` output, computed server-side (or, until M7, by the
 *    fixture generator against the real domain function — see
 *    `packages/adapters/src/contracts-consistency/shopping-gap-drift.test.ts`);
 *    **the client never recomputes it.**
 * 2. **Every value that has a provenance tier carries it.** `haveTier` is
 *    `null` for a value the DTO does not license a tier for (a "sufficient,
 *    no need to quantify" skip row) rather than the client assuming a tier.
 * 3. **No household identifier on the wire** (INV-TENANT-1): a household
 *    comes from the caller's session, never a field here.
 *
 * `unit` is restricted to a symbol `packages/contracts/src/units.ts` also
 * lists (proved by
 * `packages/adapters/src/contracts-consistency/shopping-units-consistency.test.ts`),
 * the same restriction `apps/mobile`'s S9 manual-add picker already carries.
 */

import type { ProvenanceTierDto, StorageLocationDto } from "./inventory.js";

/** Where one row came from — a menu gap, an AI suggestion, or a member's own add. */
export type ShoppingRowOriginDto =
  | { readonly kind: "menu"; readonly label: string; readonly recipeName: string | null }
  | { readonly kind: "ai"; readonly recipeName: string }
  | {
      readonly kind: "member";
      readonly memberId: string;
      readonly initials: string;
      readonly displayName: string;
    };

/** `open`: still to buy. `done`: checked off this session or earlier. `skipped`: already have enough. */
export type ShoppingRowStatusDto = "open" | "done" | "skipped";

/** One row: a gap to buy, a checked-off row, or an "already have" skip row. */
export interface ShoppingRowDto {
  readonly rowId: string;
  readonly name: string;
  /** Department label, e.g. "Produce". Data from the server/fixture, never client-derived categorisation. */
  readonly group: string;
  readonly origin: ShoppingRowOriginDto;
  /** Exact decimal-text micros of what the recipe/manual add needs. */
  readonly needMicros: string;
  /** Exact decimal-text micros of what is already on hand, in {@link unit}. */
  readonly haveMicros: string;
  /**
   * Confidence tier of {@link haveMicros}, or `null` when the row is a
   * "sufficient" skip row that does not license quantifying the on-hand
   * amount at all (copy-deck.md §7 S11: "sufficient", no number shown).
   */
  readonly haveTier: ProvenanceTierDto | null;
  /** Exact decimal-text micros to buy: `max(needMicros - haveMicros, 0)` in {@link unit}, the domain's `neededQuantity`. Never recomputed client-side. */
  readonly buyMicros: string;
  /** A symbol `UNITS_BY_KIND_DTO` (units.ts) also lists. */
  readonly unit: string;
  /** The inventory item this row's Add should PURCHASE into, or `null` when Add must create a new item via S9. */
  readonly itemId: string | null;
  readonly status: ShoppingRowStatusDto;
  /** Initials of whoever checked this row off, or `null` while it is still open. */
  readonly checkedOffBy: string | null;
  /** Where S9's manual-add prefill should default to when {@link itemId} is `null`. */
  readonly defaultLocation: StorageLocationDto;
}

/** One household member, for the header's initials stack and origin/checked-off attribution. */
export interface ShoppingMemberDto {
  readonly memberId: string;
  readonly initials: string;
  readonly displayName: string;
}

/** Response body of the (M7) shopping-list read. */
export interface ShoppingListDto {
  readonly rows: readonly ShoppingRowDto[];
  readonly members: readonly ShoppingMemberDto[];
  /** ISO timestamp of the last successful sync (S11's offline banner references this once persistence lands in M7; not rendered by this ticket's in-session-only banner). */
  readonly syncedAt: string;
}
