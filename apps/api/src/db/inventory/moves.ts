/**
 * The statements behind moving an item between locations (M2-T6, D-024 row 1).
 *
 * Exactly what a move writes, and nothing else:
 *
 * - **one row in `inventory_item_moves`**: `household_id` and `item_id` the
 *   request's, `from_location` the item's location as read under the lock,
 *   `to_location` the request's, `moved_by` the session's user, `client_key`
 *   the request's key, `id` and `occurred_at` from their defaults;
 * - **one column of one row in `inventory_items`**: `storage_location`, the
 *   column the app role already holds UPDATE on (0006), set in the same
 *   database transaction as the move row;
 * - **no ledger table at all**: no `inventory_transactions`, no
 *   `inventory_lots`, no quantity. A move is a fact about where an item is, not
 *   how much of it there is (ADR-008). The item lock below is a
 *   `SELECT ... FOR UPDATE`, which writes nothing.
 *
 * Every statement is household-filtered in the SQL, inside the caller's tenant
 * transaction, with the 0011 and 0006 policies as the independent second layer,
 * the same two-layer rule as every other module under `src/db`.
 */

import type { StorageLocationDto } from "@smart-kitchen/contracts";
import type { ClientBase } from "pg";
import { UnknownStoredValueError } from "./snapshot.js";

/**
 * The four locations, as the 0003 and 0011 CHECK constraints spell them. The
 * consistency suite in `packages/adapters` pins this list to the domain's
 * `STORAGE_LOCATIONS` and to both migrations.
 */
export const STORAGE_LOCATIONS_DB: readonly StorageLocationDto[] = [
  "FRIDGE",
  "FREEZER",
  "PANTRY",
  "OTHER",
];

/** Decodes a stored location, refusing anything outside the enum (corrupt data is an error, never a guess). */
export function parseStoredLocation(
  column: string,
  value: string | null,
): StorageLocationDto | null {
  if (value === null) return null;
  const found = STORAGE_LOCATIONS_DB.find((location) => location === value);
  if (found === undefined) throw new UnknownStoredValueError(column, value);
  return found;
}

/** What the item lock saw: the location right now. */
export interface LockedItemLocation {
  /** `null` for an item stored with no location. */
  readonly storageLocation: StorageLocationDto | null;
}

/**
 * Takes the item's write lock and reads its location. `undefined` when the item
 * is not visible to this session (no such item, or another household's:
 * deliberately the same answer).
 *
 * The same lock every ledger write takes first (`write-service.ts`), so a move
 * and a concurrent write to the same item are serialised, and two concurrent
 * moves of one item cannot both decide the same location is "current".
 */
export async function lockItemForMove(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<LockedItemLocation | undefined> {
  const locked = await client.query<{ storage_location: string | null }>(
    `SELECT storage_location FROM inventory_items WHERE id = $1 AND household_id = $2 FOR UPDATE`,
    [itemId, householdId],
  );
  const row = locked.rows[0];
  if (row === undefined) return undefined;
  return {
    storageLocation: parseStoredLocation("inventory_items.storage_location", row.storage_location),
  };
}

/** A stored move, as the idempotency check needs it. */
export interface StoredMove {
  readonly toLocation: StorageLocationDto;
  readonly movedBy: string;
}

/** The move already recorded under `(item, key)`, if any. */
export async function findMoveByKey(
  client: ClientBase,
  householdId: string,
  itemId: string,
  clientKey: string,
): Promise<StoredMove | undefined> {
  const found = await client.query<{ to_location: string; moved_by: string }>(
    `SELECT to_location, moved_by
       FROM inventory_item_moves
      WHERE household_id = $1 AND item_id = $2 AND client_key = $3`,
    [householdId, itemId, clientKey],
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const toLocation = parseStoredLocation("inventory_item_moves.to_location", row.to_location);
  if (toLocation === null) {
    throw new UnknownStoredValueError("inventory_item_moves.to_location", row.to_location);
  }
  return { toLocation, movedBy: row.moved_by };
}

/** Appends the move row. The only INSERT a move performs. */
export async function insertMove(
  client: ClientBase,
  householdId: string,
  itemId: string,
  move: {
    readonly fromLocation: StorageLocationDto | null;
    readonly toLocation: StorageLocationDto;
    readonly movedBy: string;
    readonly clientKey: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_item_moves
            (household_id, item_id, from_location, to_location, moved_by, client_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [householdId, itemId, move.fromLocation, move.toLocation, move.movedBy, move.clientKey],
  );
}

/** Sets the item's location. The only UPDATE a move performs, and on one column. */
export async function setItemLocation(
  client: ClientBase,
  householdId: string,
  itemId: string,
  toLocation: StorageLocationDto,
): Promise<void> {
  await client.query(
    `UPDATE inventory_items SET storage_location = $3 WHERE id = $2 AND household_id = $1`,
    [householdId, itemId, toLocation],
  );
}

/** One stored move, as the detail read needs it. */
export interface MoveRow {
  readonly id: string;
  readonly from_location: string | null;
  readonly to_location: string;
  readonly actor_display_name: string | null;
  /** `occurred_at` at its stored microsecond precision, ISO 8601 UTC, fixed width (sorts as text). */
  readonly occurred_at_us: string;
  readonly occurred_at: Date;
}

/**
 * The item's moves, in no promised order (the merge sorts them). A `LEFT JOIN`
 * to `users` for the same reason the ledger read has one: a user the
 * `users_shared_household` policy hides must make the row render without a
 * chip, never make the row vanish.
 */
export async function readMoveRows(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<MoveRow[]> {
  const result = await client.query<MoveRow>(
    `SELECT m.id,
            m.from_location,
            m.to_location,
            u.display_name AS actor_display_name,
            to_char(m.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at_us,
            m.occurred_at
       FROM inventory_item_moves AS m
       LEFT JOIN users AS u ON u.id = m.moved_by
      WHERE m.household_id = $1 AND m.item_id = $2`,
    [householdId, itemId],
  );
  return result.rows;
}
