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
 * M3-T3 adds the two types the item-detail screen (S5) needs:
 * {@link InventoryTransactionDto} (one ledger row) and
 * {@link InventoryItemDetailDto} (a summary plus its history), and removes the
 * M3-T1 placeholder client types these superseded (`InventoryItemSummary` and
 * friends) now that a real screen consumes the `…Dto` shapes end to end.
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
// M3-T3: item detail (S5) contracts — one ledger row, and a summary plus its
// history. `apps/mobile` never imports `@smart-kitchen/domain`, so these
// mirror the domain's `RecordedTransaction` shape (domain-model.md §2) in
// wire-safe form: micros as decimal text, actor reduced to the three kinds a
// screen renders plus the initials it needs for the ledger row's `mchip`,
// never a raw `userId`.
// ---------------------------------------------------------------------------

/**
 * The eight ledger transaction types the wire can report. Mirrors the
 * domain's `TRANSACTION_TYPES` (packages/domain/src/inventory/types.ts)
 * exactly, in the same order; `packages/adapters/src/contracts-consistency/`
 * carries the test that keeps the two lists equal (this package cannot import
 * domain, so it cannot check itself).
 */
export const TRANSACTION_TYPES_DTO = [
  "INITIAL_STOCK",
  "PURCHASE",
  "CONSUME",
  "USE_IN_MEAL",
  "DISCARD",
  "EXPIRE",
  "DONATE",
  "ADJUSTMENT",
] as const;

export type TransactionTypeDto = (typeof TRANSACTION_TYPES_DTO)[number];

/**
 * Who caused the transaction, reduced from the domain's `Actor` union
 * (`{kind, userId}` / `{kind, component}` / `{kind, userId, modelRef}`) to
 * what a ledger row renders: the kind, and the two-letter initials chip for a
 * `user`/`ai-confirmed` row (`displayInitials` is absent on a `system` row,
 * which is never attributed to a person, copy-deck.md §5 "The clamp").
 */
export interface TransactionActorDto {
  readonly kind: "user" | "system" | "ai-confirmed";
  readonly displayInitials?: string;
}

/** One ledger row (domain `RecordedTransaction`, wire-safe). */
export interface InventoryTransactionDto {
  readonly transactionId: string;
  readonly type: TransactionTypeDto;
  /** Exact signed delta in micro-units as decimal text. Parse with `BigInt`, never `Number`. */
  readonly deltaMicros: string;
  /** Exact signed decimal text of {@link deltaMicros}, six-place fraction (see {@link QuantityDto.amount}). */
  readonly amount: string;
  readonly recordedAt: string;
  readonly actor: TransactionActorDto;
  readonly provenance: FieldProvenanceDto;
  /**
   * Present only on the ledger's own system-generated correction row (the
   * clamp, domain-model.md §4 invariant 2). Unforgeable by a caller in the
   * domain; on the wire it is just a flag a screen renders distinctly and
   * never attributes to a person.
   */
  readonly systemFlag?: "OVER_CONSUMPTION";
  /** Human-readable link back to what produced the row, e.g. a recipe name. */
  readonly correlationLabel?: string;
}

/** S5's payload: the item summary plus its full ledger history, in sequence order. */
export interface InventoryItemDetailDto {
  readonly summary: InventoryItemSummaryDto;
  /** Ledger rows oldest first (`sequence` ascending), the ledger's authoritative order. */
  readonly history: readonly InventoryTransactionDto[];
}
