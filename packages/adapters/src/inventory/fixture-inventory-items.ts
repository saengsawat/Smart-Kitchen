/**
 * Fixture inventory items for the mobile client's fixture `ApiClient` (M3-T1).
 *
 * No pre-existing inventory item fixtures were found anywhere in the repo at
 * the time of writing (checked `tests/fixtures/**`: `inventories/` is listed
 * in testing-strategy.md §3 as a future subdirectory whose first fixtures had
 * not yet landed, and `packages/adapters/src/**`, which only had
 * `product-lookup` fixtures). M3-T1's own file scope says to export "the
 * existing inventory fixtures ... no new fixtures", which this repo state
 * cannot satisfy literally; see the M3-T1 worker report's "Deviations"
 * section for the full reasoning. The approach taken here, to stay as close
 * to that instruction as possible:
 *
 * - These items are built through the real domain ledger functions
 *   (`createInventoryItem` + `appendTransaction`, the same functions
 *   `apps/api` uses), not hand-typed as raw data, so they are ledger-valid by
 *   construction (INV-LEDGER-1) rather than a risk of silently-invented,
 *   invariant-breaking numbers.
 * - What's exported to the client is a projection onto
 *   `@smart-kitchen/contracts`' `InventoryItemSummary`, not the domain
 *   `InventoryItem` aggregate itself, so `apps/mobile` never touches a
 *   domain type (M3-T1 invariant).
 * - Household ids/members mirror M2-T1's planned fixture identity (Chen:
 *   owner Dean, member Maya; a second single-owner household), so the two
 *   fixture sets agree once M2-T1 lands.
 *
 * This is a stopgap for M3-T1 only. Flagged for the architect to decide
 * whether it becomes the real `tests/fixtures/inventories/` corpus (its own
 * ticket, matching how `tests/fixtures/products/` was built in M1-T5) or is
 * superseded by M2-T1's own fixture data.
 */

import { appendTransaction, createInventoryItem } from "@smart-kitchen/domain";
import type { InventoryItem, Provenance, TransactionInput } from "@smart-kitchen/domain";
import type { InventoryItemSummary } from "@smart-kitchen/contracts";

const CHEN_HOUSEHOLD = "hh-fixture-chen";
const OTHER_HOUSEHOLD = "hh-fixture-other";

const FIXTURE_PROVENANCE: Provenance = { tier: "KNOWN_FACT", source: "m3-t1-fixture" };

/** Deterministic ISO instant so fixture output never depends on wall-clock time. */
function at(step: number): string {
  return new Date(Date.UTC(2026, 8, 1, 12, 0, 0) + step * 1000).toISOString();
}

function buildItem(
  itemId: string,
  householdId: string,
  unit: string,
  name: string,
  initialQty: number,
): { item: InventoryItem; name: string } {
  const created = createInventoryItem({
    itemId,
    householdId,
    unit,
    lots: [{ lotId: `${itemId}-lot-1` }],
  });
  if (!created.ok) {
    throw new Error(
      `fixture-inventory-items: failed to create ${itemId}: ${created.error.message}`,
    );
  }

  const txInput: TransactionInput = {
    lotId: `${itemId}-lot-1`,
    type: "INITIAL_STOCK",
    qtyDelta: initialQty,
    unit,
    actor: { kind: "system", component: "m3-t1-fixture" },
    occurredAt: at(0),
    recordedAt: at(1),
    provenance: FIXTURE_PROVENANCE,
    idempotencyKey: `${itemId}-initial-stock`,
  };

  const result = appendTransaction(created.value, txInput);
  if (result.status === "rejected") {
    throw new Error(`fixture-inventory-items: failed to stock ${itemId}: ${result.error.message}`);
  }

  return { item: result.item, name };
}

function toSummary(built: { item: InventoryItem; name: string }): InventoryItemSummary {
  const { item, name } = built;
  return {
    itemId: item.itemId,
    householdId: item.householdId,
    name,
    currentQty: { amount: item.currentQty.amount, unit: item.currentQty.unit },
    storageLocation: item.storageLocation,
    quantityProvenanceTier: FIXTURE_PROVENANCE.tier,
  };
}

const CHEN_ITEMS = [
  buildItem("fixture-item-milk", CHEN_HOUSEHOLD, "count", "Whole milk", 2),
  buildItem("fixture-item-chicken", CHEN_HOUSEHOLD, "lb", "Chicken breast", 1.5),
  buildItem("fixture-item-rice", CHEN_HOUSEHOLD, "g", "Rice", 900),
];

const OTHER_HOUSEHOLD_ITEMS = [buildItem("fixture-item-eggs", OTHER_HOUSEHOLD, "count", "Eggs", 6)];

/**
 * The Chen household's (owner Dean, member Maya) fixture inventory, for the
 * mobile client's `FixtureApiClient.getInventoryItems()`.
 */
export const FIXTURE_INVENTORY_ITEMS_CHEN: readonly InventoryItemSummary[] =
  CHEN_ITEMS.map(toSummary);

/**
 * A second household's fixture inventory, kept separate so a future
 * tenancy-isolation test (M2-T1) has a fixture that must never appear
 * alongside the Chen household's rows.
 */
export const FIXTURE_INVENTORY_ITEMS_OTHER: readonly InventoryItemSummary[] =
  OTHER_HOUSEHOLD_ITEMS.map(toSummary);

export const FIXTURE_HOUSEHOLD_IDS = {
  chen: CHEN_HOUSEHOLD,
  other: OTHER_HOUSEHOLD,
} as const;
