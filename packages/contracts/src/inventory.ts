/**
 * Inventory read contracts (M2-T1).
 *
 * The wire shape of `GET /v1/inventory/items`, shared by the API and the M3
 * client so the two cannot drift.
 *
 * Three rules shape everything here.
 *
 * 1. **No household identifier on the wire.** The response never names the
 *    household it belongs to and the request never asks for one. A household
 *    comes from the caller's session and nowhere else (INV-TENANT-1), and a
 *    `householdId` field in the contract would be an invitation to send one.
 * 2. **Exact quantities travel as text.** Inventory arithmetic is exact
 *    micro-unit integer arithmetic (ADR-008, CLAUDE.md rule 7) and JSON numbers
 *    are IEEE-754 doubles. Micros are therefore a decimal string parsed with
 *    `BigInt`, never `Number`, and the human-readable amount is the exact
 *    decimal text of those micros, not a re-derived float.
 * 3. **Every value that has a provenance tier carries it.** A screen may not
 *    present an estimate as if it were known (design principle P2, brief §14),
 *    so tier travels with the value rather than being looked up separately, and
 *    `null` means "this value has no recorded provenance", never "assume it is
 *    known".
 *
 * The bottom of this file also holds M3-T1's placeholder client types, which
 * these supersede. See the note there for what diverged and why they are still
 * exported.
 */

/** Confidence tier of a stored value (domain `ProvenanceTier`, migration 0003). */
export type ProvenanceTierDto = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/** Storage location of an item (domain `StorageLocation`, migration 0003). */
export type StorageLocationDto = "FRIDGE" | "FREEZER" | "PANTRY" | "OTHER";

/**
 * Where one field's current value came from.
 *
 * `source` is the stable origin identifier the ledger recorded (`manual-entry`,
 * `receipt:ocr-v2`, …), never free text a user typed. `confidence` is the
 * exact `numeric` text Postgres holds, or `null` where the source reported
 * none. `recordedAt` is when the system recorded the value, not when it
 * happened in the world.
 *
 * `source`, `confidence` and `recordedAt` are nullable because not every
 * stored value carries them yet: `inventory_transactions` records a full
 * provenance block, while `inventory_lots.expiry_tier` records a tier and
 * nothing else (migration 0003). `null` there means "not recorded", and a
 * screen must not fill the gap with a guess. Closing it is a schema question
 * for the architect, raised in the M2-T1 handoff.
 */
export interface FieldProvenanceDto {
  readonly tier: ProvenanceTierDto;
  readonly source: string | null;
  readonly confidence: string | null;
  readonly recordedAt: string | null;
}

/** An exact quantity in an item's single unit. */
export interface QuantityDto {
  /** The item's unit. One unit per item, never silently converted (domain-model.md §2). */
  readonly unit: string;
  /** Exact micro-units as decimal text. Parse with `BigInt`, never `Number`. */
  readonly micros: string;
  /**
   * Canonical exact decimal text of {@link micros}: `2000000` becomes `"2"`
   * and `5500000` becomes `"5.500000"` (a fraction is always written to six
   * places). It is the exact value, not a rounded
   * display string: trimming or rounding for presentation is the client's
   * decision, and it can only be made safely from a value nothing has already
   * lost precision from. Never re-derive it through a float.
   */
  readonly amount: string;
}

/** One acquisition of an item, with its own expiry and expiry provenance. */
export interface InventoryLotDto {
  readonly lotId: string;
  readonly label: string | null;
  readonly acquiredAt: string | null;
  readonly expiresAt: string | null;
  readonly quantity: QuantityDto;
  /** Tier of {@link expiresAt}: a printed best-by date is KNOWN_FACT, a shelf-life guess is ESTIMATED. */
  readonly expiresAtProvenance: FieldProvenanceDto | null;
}

/** Per-field provenance for the item-level values on a row. */
export interface InventoryItemProvenanceDto {
  /**
   * Provenance of {@link InventoryItemSummaryDto.quantity}: the tier and source
   * of the most recent ledger statement on the item. `null` when the item has
   * no ledger rows yet, which is the only way its quantity can be zero without
   * anybody having said so.
   */
  readonly quantity: FieldProvenanceDto | null;
  /**
   * Provenance of {@link InventoryItemSummaryDto.earliestExpiresAt}, copied
   * from the lot that expiry belongs to. `null` when no lot has an expiry.
   */
  readonly earliestExpiresAt: FieldProvenanceDto | null;
}

/** One row of the household's inventory snapshot. */
export interface InventoryItemSummaryDto {
  readonly itemId: string;
  readonly displayName: string | null;
  readonly productRef: string | null;
  readonly ingredientRef: string | null;
  readonly storageLocation: StorageLocationDto | null;
  /** Maintained snapshot; always equal to the sum of the item's ledger deltas (INV-LEDGER-1). */
  readonly quantity: QuantityDto;
  /** Soonest expiry across the item's lots, or `null` when none is known. */
  readonly earliestExpiresAt: string | null;
  readonly provenance: InventoryItemProvenanceDto;
  readonly lots: readonly InventoryLotDto[];
}

/** Response body of `GET /v1/inventory/items`. */
export interface InventoryItemsResponseDto {
  readonly items: readonly InventoryItemSummaryDto[];
}

/** Path of the inventory snapshot endpoint, shared so the client cannot mistype it. */
export const INVENTORY_ITEMS_PATH = "/v1/inventory/items";

// ---------------------------------------------------------------------------
// M3-T1's placeholder client types, superseded by the `…Dto` types above.
// ---------------------------------------------------------------------------
//
// M3-T1 needed something for its fixture `ApiClient` and its inventory fixtures
// to be typed against before this ticket landed, and said so: "a placeholder
// for that response until M2-T1 lands ... the architect reconciles the two at
// M2-T1 acceptance if they've diverged." They have diverged, in three ways that
// matter, and the `…Dto` types are the ones the endpoint actually returns:
//
//   * `InventoryItemSummary.householdId` does not exist on the wire. The
//     response never names a household and the request never asks for one: the
//     household comes from the session and nowhere else (INV-TENANT-1). A
//     `householdId` on a client type is a field somebody will eventually try to
//     send.
//   * `InventoryQuantitySummary.amount` is a `number`. Quantities are exact
//     micro-unit integers (ADR-008) and JSON numbers are doubles, so the wire
//     carries {@link QuantityDto}: micros as text plus the exact decimal.
//   * `quantityProvenanceTier` is one non-optional tier per row.
//     {@link InventoryItemProvenanceDto} carries a tier *per field*, nullable,
//     because an item with no ledger rows has no recorded provenance and a
//     screen must not read that absence as "known".
//
// The placeholder types stay exported, unchanged in shape, because
// `apps/mobile/src/api/client.ts` and
// `packages/adapters/src/inventory/fixture-inventory-items.ts` are built on
// them and are another ticket's accepted work. Migrating the client onto the
// `…Dto` types belongs to the M3 ticket that first calls the real endpoint
// (M3-T3); it is proposed as a follow-up in the M2-T1 handoff, for the
// architect to schedule. Until then this file holds both, and which one is
// authoritative is stated here rather than left to be guessed.
//
// The two enumerations are genuinely identical, so they are aliases rather than
// a second copy that can drift.

/** @deprecated M3-T1 placeholder. Use {@link ProvenanceTierDto}. */
export type InventoryProvenanceTier = ProvenanceTierDto;

/** @deprecated M3-T1 placeholder. Use {@link StorageLocationDto}. */
export type InventoryStorageLocation = StorageLocationDto;

/**
 * @deprecated M3-T1 placeholder. Use {@link QuantityDto}, which does not put an
 * exact ledger quantity through a double.
 */
export interface InventoryQuantitySummary {
  readonly amount: number;
  readonly unit: string;
}

/**
 * @deprecated M3-T1 placeholder. Use {@link InventoryItemSummaryDto}, which is
 * what `GET /v1/inventory/items` returns.
 */
export interface InventoryItemSummary {
  readonly itemId: string;
  readonly householdId: string;
  readonly name: string;
  readonly currentQty: InventoryQuantitySummary;
  readonly storageLocation?: InventoryStorageLocation;
  readonly quantityProvenanceTier: InventoryProvenanceTier;
}
