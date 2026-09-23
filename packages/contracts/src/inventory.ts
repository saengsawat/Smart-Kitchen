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
   * The row's recorded reason (the domain's `TransactionInput.reason`, e.g. a
   * removal's "Spoiled", or `undo:<transactionId>` on a compensating row).
   * `null` where the row carries none.
   *
   * Optional rather than required (M2-T2 deviation, declared in the worker
   * report): `apps/mobile`'s fixture ledger builds these rows too and the
   * ticket puts the client out of scope, so a required field would have meant
   * editing it. Every row the API produces carries the field explicitly;
   * `undefined` means "this producer does not record reasons", which a reader
   * should treat exactly like `null`. M3-T4 wires the client and can tighten
   * it to required.
   */
  readonly reason?: string | null;
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

// ---------------------------------------------------------------------------
// M2-T2: inventory writes.
//
// Four rules on top of the three in this file's header.
//
// 4. **The caller never names a lot.** Which lot a decrease comes out of is a
//    domain decision (the FEFO planner, M1-T8), taken against the balance read
//    under the item's lock. A `lotId` on the wire would be a stale guess at
//    best and a way to overdraw one lot while another is full at worst.
// 5. **The caller never names an actor.** The person who wrote a row is the
//    session that sent the request (INV-TENANT-1, ARCHITECTURE.md §7.1).
// 6. **Quantities in, like quantities out, are exact decimal text** in the
//    item's own unit, the same form as {@link QuantityDto.amount}. A JSON
//    number would be an IEEE-754 double, and inventory arithmetic is exact
//    (ADR-008, CLAUDE.md rule 7).
// 7. **The client chooses the idempotency key**, and a replay of the same key
//    with the same payload returns the same rows without appending anything
//    (INV-LEDGER-3). That is what makes a retry over a flaky connection safe.
// ---------------------------------------------------------------------------

/**
 * The transaction types a person may write through this endpoint.
 *
 * A subset of {@link TRANSACTION_TYPES_DTO} on purpose: `INITIAL_STOCK` and
 * `PURCHASE` belong to the add-food and receipt flows (M3-T4, M5) which carry
 * their own lot and provenance data, and `USE_IN_MEAL` is written by the
 * cook-confirm flow (M6/M8) with a correlation reference to the meal. What is
 * left is the four manual removal reasons plus `ADJUSTMENT`, the only
 * correction instrument (domain-model.md §2).
 */
export const INVENTORY_WRITE_TYPES_DTO = [
  "ADJUSTMENT",
  "CONSUME",
  "DISCARD",
  "EXPIRE",
  "DONATE",
] as const;

export type InventoryWriteTypeDto = (typeof INVENTORY_WRITE_TYPES_DTO)[number];

/**
 * Body of `POST /v1/inventory/items/{itemId}/transactions`.
 *
 * Exactly one quantity field is meaningful per `type`:
 *
 * - `ADJUSTMENT`: exactly one of {@link targetAmount} (what the item should
 *   hold after the write; the server computes the signed delta from the
 *   balance it reads under the lock) or {@link deltaAmount} (the signed change
 *   itself). `targetAmount` is what a correction screen has: a stepper shows a
 *   number and the user changes it.
 * - a removal (`CONSUME`/`DISCARD`/`EXPIRE`/`DONATE`): {@link amount}, a
 *   positive magnitude, or omitted to mean the whole on-hand quantity. The
 *   sign is implied by the type and must not be sent; a removal is always
 *   stock leaving.
 */
export interface InventoryWriteRequestDto {
  /**
   * Client-generated key. Replaying it with the same payload is a no-op that
   * returns the same rows; reusing it for a different write is refused with
   * 409 and `IDEMPOTENCY_KEY_CONFLICT`. May not contain `::` (the ledger's own
   * reserved namespace) or `/lot/` (the per-lot key namespace).
   */
  readonly idempotencyKey: string;
  readonly type: InventoryWriteTypeDto;
  /** When it happened in the world, ISO-8601. Not when the server recorded it. */
  readonly occurredAt: string;
  /** `ADJUSTMENT` only: the exact quantity the item should hold afterwards. */
  readonly targetAmount?: string;
  /** `ADJUSTMENT` only: the exact signed change, e.g. `"-0.25"`. */
  readonly deltaAmount?: string;
  /** Removals only: the exact positive magnitude to remove. Omitted means all of it. */
  readonly amount?: string;
  /**
   * Why, in the user's words or from a reason chip ("Spoiled", "Wrong item").
   * Recorded on every row the write appends. May not start with `undo:`, which
   * is reserved for the rows the undo endpoint writes.
   */
  readonly reason?: string;
}

/** Body of `POST /v1/inventory/items/{itemId}/transactions/{transactionId}/undo`. */
export interface UndoRequestDto {
  /** The undo's own client key. Its rows are separate facts with their own idempotency. */
  readonly idempotencyKey: string;
  /** When the undo happened in the world, ISO-8601. */
  readonly occurredAt: string;
}

/** Response of both write endpoints. */
export interface InventoryWriteResponseDto {
  /**
   * Every row the write is responsible for, in `sequence` order, including any
   * system clamp row the ledger appended of its own accord (INV-LEDGER-4).
   */
  readonly transactions: readonly InventoryTransactionDto[];
  /** The item as it stands after the write, so a screen needs no second request. */
  readonly item: InventoryItemDetailDto;
  /**
   * `true` when every row in {@link transactions} was already recorded under
   * this idempotency key and nothing was appended. The response body is
   * otherwise identical to the original one, which is the point: a client that
   * ignores this field still behaves correctly.
   */
  readonly replayed: boolean;
}

/**
 * Route patterns, in the server's `:param` form, shared so the client and the
 * route registration cannot drift. The `…Path` helpers below build the URLs a
 * client actually sends.
 */
export const INVENTORY_ITEM_ROUTE = "/v1/inventory/items/:itemId";
export const INVENTORY_ITEM_TRANSACTIONS_ROUTE = "/v1/inventory/items/:itemId/transactions";
export const INVENTORY_TRANSACTION_UNDO_ROUTE =
  "/v1/inventory/items/:itemId/transactions/:transactionId/undo";

/** `GET`/`POST` paths for one item, with the ids encoded. */
export function inventoryItemPath(itemId: string): string {
  return `${INVENTORY_ITEMS_PATH}/${encodeURIComponent(itemId)}`;
}

export function inventoryItemTransactionsPath(itemId: string): string {
  return `${inventoryItemPath(itemId)}/transactions`;
}

export function inventoryTransactionUndoPath(itemId: string, transactionId: string): string {
  return `${inventoryItemTransactionsPath(itemId)}/${encodeURIComponent(transactionId)}/undo`;
}
