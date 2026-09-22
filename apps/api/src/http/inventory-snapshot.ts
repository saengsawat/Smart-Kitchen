/**
 * Read model behind `GET /v1/inventory/items` (M2-T1).
 *
 * The household's inventory as the list screen needs it: one row per item, its
 * maintained quantity, its lots, and the provenance tier of every value that
 * has one (design principle P2: an estimate may never be presented as a known
 * fact).
 *
 * Three deliberate choices.
 *
 * - **Two statements, both household-filtered, both inside the caller's
 *   transaction.** `WHERE household_id = $1` is the app-layer mandatory context
 *   data-model.md §5 requires; the migration-0006 policies are the independent
 *   second layer. Neither is treated as making the other unnecessary, and the
 *   tenancy suite removes the second to prove the first is not the only thing
 *   holding (and vice versa).
 * - **No arithmetic here.** Quantities are read as the exact `bigint` snapshots
 *   the ledger trigger maintains and rendered as exact decimal text. Nothing in
 *   this module adds, converts or rounds a quantity: that is the domain's job
 *   and it is safety-critical (CLAUDE.md rule 7).
 * - **Unknown enum values are a failure, not a pass-through.** A
 *   `storage_location` or `provenance_tier` outside the union means the database
 *   holds something this build does not understand, and quietly forwarding it to
 *   a client that will render it as a chip is how a tier stops meaning anything.
 *
 * This read path deliberately does *not* replay the ledger through
 * `rehydrateInventoryItem` the way `loadInventoryItem` does. Rehydrating every
 * item's full history to draw a list is the wrong shape, and the snapshots it
 * would validate are already trigger-maintained and independently checked by
 * the reconciliation views (migration 0005). Single-item reads, where drift
 * detection is affordable and valuable, keep using the repository.
 */

import type {
  FieldProvenanceDto,
  InventoryItemSummaryDto,
  InventoryLotDto,
  ProvenanceTierDto,
  QuantityDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import type { ClientBase } from "pg";
import { microsToDecimalText } from "../db/inventory/repository.js";

/** Raised when a stored enum value is outside the union this build knows. */
export class UnknownStoredValueError extends Error {
  constructor(column: string, value: string) {
    super(
      `inventory read: column ${column} holds "${value}", which is not a value this build ` +
        `understands. Refusing to forward it rather than rendering an unknown tier or location.`,
    );
    this.name = "UnknownStoredValueError";
  }
}

const STORAGE_LOCATIONS: ReadonlySet<string> = new Set([
  "FRIDGE",
  "FREEZER",
  "PANTRY",
  "OTHER",
] satisfies StorageLocationDto[]);

const PROVENANCE_TIERS: ReadonlySet<string> = new Set([
  "KNOWN_FACT",
  "ESTIMATED",
  "AI_INTERPRETATION",
] satisfies ProvenanceTierDto[]);

function toStorageLocation(value: string | null): StorageLocationDto | null {
  if (value === null) return null;
  if (!STORAGE_LOCATIONS.has(value)) throw new UnknownStoredValueError("storage_location", value);
  return value as StorageLocationDto;
}

function toProvenanceTier(value: string, column: string): ProvenanceTierDto {
  if (!PROVENANCE_TIERS.has(value)) throw new UnknownStoredValueError(column, value);
  return value as ProvenanceTierDto;
}

function quantity(unit: string, micros: string): QuantityDto {
  return { unit, micros, amount: microsToDecimalText(BigInt(micros)) };
}

interface ItemRow {
  readonly item_id: string;
  readonly unit: string;
  readonly display_name: string | null;
  readonly product_ref: string | null;
  readonly ingredient_ref: string | null;
  readonly storage_location: string | null;
  readonly current_qty_micros: string;
  readonly qty_tier: string | null;
  readonly qty_source: string | null;
  readonly qty_confidence: string | null;
  readonly qty_recorded_at: Date | null;
}

interface LotRow {
  readonly item_id: string;
  readonly lot_id: string;
  readonly label: string | null;
  readonly acquired_at: Date | null;
  readonly expires_at: Date | null;
  readonly expiry_tier: string | null;
  readonly current_qty_micros: string;
}

/**
 * One row per item, with the provenance of the most recent ledger statement on
 * it joined on.
 *
 * The lateral join orders by `sequence`, the ledger's authoritative order, not
 * by `recorded_at`: two rows can share a timestamp, and the sequence is the
 * only total order the ledger guarantees (domain-model.md §2).
 */
const ITEMS_SQL = `
  SELECT i.id                          AS item_id,
         i.unit                        AS unit,
         i.display_name                AS display_name,
         i.product_ref                 AS product_ref,
         i.ingredient_ref              AS ingredient_ref,
         i.storage_location            AS storage_location,
         i.current_qty_micros::text    AS current_qty_micros,
         q.provenance_tier             AS qty_tier,
         q.provenance_source           AS qty_source,
         q.provenance_confidence::text AS qty_confidence,
         q.recorded_at                 AS qty_recorded_at
    FROM inventory_items AS i
    LEFT JOIN LATERAL (
      SELECT t.provenance_tier, t.provenance_source, t.provenance_confidence, t.recorded_at
        FROM inventory_transactions AS t
       WHERE t.household_id = i.household_id
         AND t.item_id = i.id
       ORDER BY t.sequence DESC
       LIMIT 1
    ) AS q ON true
   WHERE i.household_id = $1
   ORDER BY i.created_at, i.id`;

/** Lots, soonest expiry first within an item so the head of the list is the one that matters. */
const LOTS_SQL = `
  SELECT l.item_id                     AS item_id,
         l.id                          AS lot_id,
         l.label                       AS label,
         l.acquired_at                 AS acquired_at,
         l.expires_at                  AS expires_at,
         l.expiry_tier                 AS expiry_tier,
         l.current_qty_micros::text    AS current_qty_micros
    FROM inventory_lots AS l
   WHERE l.household_id = $1
   ORDER BY l.item_id, l.expires_at ASC NULLS LAST, l.created_at, l.id`;

function quantityProvenance(row: ItemRow): FieldProvenanceDto | null {
  if (row.qty_tier === null) return null;
  return {
    tier: toProvenanceTier(row.qty_tier, "inventory_transactions.provenance_tier"),
    source: row.qty_source,
    confidence: row.qty_confidence,
    recordedAt: row.qty_recorded_at === null ? null : row.qty_recorded_at.toISOString(),
  };
}

function expiryProvenance(row: LotRow): FieldProvenanceDto | null {
  if (row.expiry_tier === null) return null;
  return {
    tier: toProvenanceTier(row.expiry_tier, "inventory_lots.expiry_tier"),
    // `inventory_lots` stores a tier and no source, confidence or timestamp
    // (migration 0003). Nulls, not invented values.
    source: null,
    confidence: null,
    recordedAt: null,
  };
}

function toLotDto(row: LotRow, unit: string): InventoryLotDto {
  return {
    lotId: row.lot_id,
    label: row.label,
    acquiredAt: row.acquired_at === null ? null : row.acquired_at.toISOString(),
    expiresAt: row.expires_at === null ? null : row.expires_at.toISOString(),
    quantity: quantity(unit, row.current_qty_micros),
    expiresAtProvenance: expiryProvenance(row),
  };
}

/**
 * Reads the household's inventory snapshot.
 *
 * `client` must already be inside `withHouseholdTransaction` for
 * `householdId`, the caller's tenant session. This function does no session
 * setup of its own, exactly like every other read in `src/db`.
 */
export async function readInventorySnapshot(
  client: ClientBase,
  householdId: string,
): Promise<InventoryItemSummaryDto[]> {
  const items = await client.query<ItemRow>(ITEMS_SQL, [householdId]);
  const lots = await client.query<LotRow>(LOTS_SQL, [householdId]);

  const lotsByItem = new Map<string, LotRow[]>();
  for (const lot of lots.rows) {
    const bucket = lotsByItem.get(lot.item_id);
    if (bucket === undefined) lotsByItem.set(lot.item_id, [lot]);
    else bucket.push(lot);
  }

  return items.rows.map((row) => {
    const itemLots = lotsByItem.get(row.item_id) ?? [];
    // Already ordered soonest-expiry-first by LOTS_SQL, nulls last, so the
    // first lot with an expiry is the earliest one.
    const earliest = itemLots.find((lot) => lot.expires_at !== null);
    return {
      itemId: row.item_id,
      displayName: row.display_name,
      productRef: row.product_ref,
      ingredientRef: row.ingredient_ref,
      storageLocation: toStorageLocation(row.storage_location),
      quantity: quantity(row.unit, row.current_qty_micros),
      earliestExpiresAt: earliest?.expires_at?.toISOString() ?? null,
      provenance: {
        quantity: quantityProvenance(row),
        earliestExpiresAt: earliest === undefined ? null : expiryProvenance(earliest),
      },
      lots: itemLots.map((lot) => toLotDto(lot, row.unit)),
    };
  });
}
