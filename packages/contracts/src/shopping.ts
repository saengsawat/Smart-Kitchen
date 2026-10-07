/**
 * Shopping-list read/write contracts (M3-T5).
 *
 * The wire shape S11 needs, shared by the API (M7-T1: `GET /v1/shopping`
 * and the three row writes below) and the M3 client so the two cannot drift.
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
   *
   * The convention, stated once (M7-T1): `haveTier: null` with a non-zero
   * `haveMicros` means "sufficient, do not quantify"; `haveTier: null` with
   * `haveMicros: "0"` means nothing on hand is counted against this row (no
   * item, or an item in a different unit, which is never converted). The
   * M7-T1 server always returns the item snapshot's own tier when it counts
   * an on-hand amount, so it never emits the "sufficient" form today; the
   * form stays reserved for rows whose source does not license a number.
   */
  readonly haveTier: ProvenanceTierDto | null;
  /**
   * Exact decimal-text micros in {@link unit}. Until the row's PURCHASE lands it is the amount to buy:
   * `max(needMicros - haveMicros, 0)`, the domain's `neededQuantity`. Once Add has landed a PURCHASE it is
   * the amount that PURCHASE appended, read from the ledger (BUG-006), and stays so after an undo on S5.
   * Never recomputed client-side.
   */
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

/** Response body of `GET /v1/shopping` ({@link SHOPPING_PATH}). */
export interface ShoppingListDto {
  readonly rows: readonly ShoppingRowDto[];
  readonly members: readonly ShoppingMemberDto[];
  /** ISO timestamp of the last successful sync (S11's offline banner references this once persistence lands in M7; not rendered by this ticket's in-session-only banner). */
  readonly syncedAt: string;
}

/** `GET /v1/shopping`: the household's one shopping list (M7-T1). */
export const SHOPPING_PATH = "/v1/shopping";

/** `POST`: set one row's checked state (M7-T1). Body {@link CheckShoppingRowRequestDto}, answer {@link ShoppingRowDto}. */
export const SHOPPING_ROW_CHECK_ROUTE = "/v1/shopping/rows/:rowId/check";

/**
 * `POST`: append the checked-off row's PURCHASE to its inventory item, once
 * per row and generation (M7-T1). Body
 * {@link AddShoppingRowToInventoryRequestDto}; answer the inventory write
 * response (`InventoryWriteResponseDto`) whose single transaction is that
 * PURCHASE, the same one on every later call for the row.
 */
export const SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE = "/v1/shopping/rows/:rowId/add-to-inventory";

/** `POST`, no body: take a member-origin row off the list (M7-T1). Answers 204. */
export const SHOPPING_ROW_REMOVE_ROUTE = "/v1/shopping/rows/:rowId/remove";

function shoppingRowPath(rowId: string): string {
  return `${SHOPPING_PATH}/rows/${encodeURIComponent(rowId)}`;
}

/** The URL a client sends for {@link SHOPPING_ROW_CHECK_ROUTE}. */
export function shoppingRowCheckPath(rowId: string): string {
  return `${shoppingRowPath(rowId)}/check`;
}

/** The URL a client sends for {@link SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE}. */
export function shoppingRowAddToInventoryPath(rowId: string): string {
  return `${shoppingRowPath(rowId)}/add-to-inventory`;
}

/** The URL a client sends for {@link SHOPPING_ROW_REMOVE_ROUTE}. */
export function shoppingRowRemovePath(rowId: string): string {
  return `${shoppingRowPath(rowId)}/remove`;
}

/**
 * Body of {@link SHOPPING_ROW_CHECK_ROUTE}.
 *
 * Set-state, not toggle: `checked` says what the row should be afterwards,
 * so checking a row that is already done is a no-op. The key is minted once
 * per tap by the client and reused on every retry and queue replay of that
 * tap; the same key with a different `checked`, row or caller is 409
 * `IDEMPOTENCY_KEY_CONFLICT`. Keys are 1 to 128 characters of letters,
 * digits, dot, underscore or hyphen, the M2-T2 convention.
 */
export interface CheckShoppingRowRequestDto {
  readonly checked: boolean;
  readonly idempotencyKey: string;
}

/**
 * Body of {@link SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE}.
 *
 * The key is for retry safety only. What makes the PURCHASE land once is the
 * row itself: a second call for the same row and generation answers the
 * original transaction whatever key it carries.
 */
export interface AddShoppingRowToInventoryRequestDto {
  readonly idempotencyKey: string;
}
