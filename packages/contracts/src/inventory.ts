/**
 * Client-facing inventory read DTOs (M3-T1).
 *
 * `packages/contracts` is the client/server seam (ARCHITECTURE.md §2): the
 * mobile client is only ever allowed to depend on shapes defined here, never
 * on `@smart-kitchen/domain` directly (M3-T1 invariant, enforced by the
 * `apps/mobile` eslint boundary rule). This file is deliberately a plain,
 * dependency-free projection of the domain's `InventoryItem` ledger aggregate
 * (packages/domain/src/inventory/types.ts): a list-view summary, not the
 * aggregate itself (no ledger transactions, no lot internals).
 *
 * M2-T1 (identity port + first read endpoint, in progress in parallel) is
 * expected to firm up the real `GET /v1/inventory/items` response shape; this
 * type is a placeholder for that response until M2-T1 lands, per M3-T1's
 * file-scope note ("client-facing DTOs only if M2-T1 has not defined them").
 * The architect reconciles the two at M2-T1 acceptance if they've diverged.
 */

/** Confidence tier of a recorded value (mirrors domain `ProvenanceTier`, kept as a plain string union here). */
export type InventoryProvenanceTier = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/** Storage location (mirrors domain `StorageLocation`). */
export type InventoryStorageLocation = "FRIDGE" | "FREEZER" | "PANTRY" | "OTHER";

/** A quantity with its unit, as the client needs to display it. Decimal, not micro-units (client is thin; it never does ledger arithmetic). */
export interface InventoryQuantitySummary {
  readonly amount: number;
  readonly unit: string;
}

/**
 * One row of a household's inventory list (S4 in ux-plan §7; built in M3-T3).
 * A read-only projection: no transaction history, no lot detail, no ledger
 * mutation affordance lives on this type.
 */
export interface InventoryItemSummary {
  readonly itemId: string;
  readonly householdId: string;
  readonly name: string;
  readonly currentQty: InventoryQuantitySummary;
  readonly storageLocation?: InventoryStorageLocation;
  readonly quantityProvenanceTier: InventoryProvenanceTier;
}
