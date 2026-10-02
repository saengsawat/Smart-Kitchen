/**
 * Moving an item between storage locations (M2-T6, D-024 row 1).
 *
 * A member says "this is in the Pantry, not the Fridge". One request becomes
 * one database transaction:
 *
 *   validate the key -> lock the item and read its location -> if the key was
 *   already used on this item, replay (same destination) or refuse (a
 *   different one) -> refuse a move to where the item already is -> insert the
 *   move row and set the item's location -> read the item back
 *
 * What it never does: touch the ledger, or any quantity. A move is a fact
 * about where an item is, not how much of it there is (ADR-008, INV-LEDGER-2):
 * it writes one `inventory_item_moves` row and one column of one
 * `inventory_items` row, and nothing else. No arithmetic and no model is
 * consulted anywhere on this path (CLAUDE.md rule 7).
 *
 * Idempotent on `(item, key)`. The replay check runs before the same-location
 * check, because after the first move the item IS at the destination and the
 * retry must still answer 200, not 409.
 */

import type { InventoryItemDetailDto, StorageLocationDto } from "@smart-kitchen/contracts";
import { ledgerError } from "@smart-kitchen/domain";
import type { ClientBase } from "pg";
import { CLIENT_KEY } from "../db/inventory/client-key.js";
import { readInventoryItemDetail } from "../db/inventory/detail.js";
import {
  findMoveByKey,
  insertMove,
  lockItemForMove,
  setItemLocation,
} from "../db/inventory/moves.js";
import {
  InventoryItemNotVisibleError,
  LedgerWriteRejectedError,
} from "../db/inventory/write-service.js";

/** What the caller asked for, with identity already resolved from the session. */
export interface MoveItemCommand {
  readonly toLocation: StorageLocationDto;
  readonly idempotencyKey: string;
  /** The session's user. Never a request field (INV-TENANT-1). */
  readonly actorUserId: string;
}

export interface MoveItemResult {
  readonly detail: InventoryItemDetailDto;
  /** `true` when this call recorded a move, `false` on an idempotent replay. For the log line only. */
  readonly moved: boolean;
}

/** The item is already at `toLocation` and the key is new (409 `SAME_LOCATION`). */
export class SameLocationError extends Error {
  constructor() {
    super("the item is already at that location");
    this.name = "SameLocationError";
  }
}

/**
 * Moves the item, or replays an earlier identical move.
 *
 * `client` must already be inside the caller's tenant write transaction for
 * `householdId`. Every refusal throws, so the transaction rolls back and a
 * refused move leaves nothing behind.
 */
export async function moveItem(
  client: ClientBase,
  householdId: string,
  itemId: string,
  command: MoveItemCommand,
): Promise<MoveItemResult> {
  if (!CLIENT_KEY.test(command.idempotencyKey)) {
    throw new LedgerWriteRejectedError(
      ledgerError(
        "INVALID_IDEMPOTENCY_KEY",
        "idempotencyKey must be 1 to 128 characters of letters, digits, dot, underscore or hyphen",
        "idempotencyKey",
      ),
    );
  }

  const locked = await lockItemForMove(client, householdId, itemId);
  if (locked === undefined) throw new InventoryItemNotVisibleError();

  const replay = await findMoveByKey(client, householdId, itemId, command.idempotencyKey);
  if (replay !== undefined) {
    if (replay.toLocation !== command.toLocation || replay.movedBy !== command.actorUserId) {
      throw new LedgerWriteRejectedError(
        ledgerError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "idempotencyKey was already used for a different move of this item",
          "idempotencyKey",
        ),
      );
    }
    return { detail: await readBack(client, householdId, itemId), moved: false };
  }

  if (locked.storageLocation === command.toLocation) throw new SameLocationError();

  await insertMove(client, householdId, itemId, {
    fromLocation: locked.storageLocation,
    toLocation: command.toLocation,
    movedBy: command.actorUserId,
    clientKey: command.idempotencyKey,
  });
  await setItemLocation(client, householdId, itemId, command.toLocation);

  return { detail: await readBack(client, householdId, itemId), moved: true };
}

async function readBack(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<InventoryItemDetailDto> {
  const read = await readInventoryItemDetail(client, householdId, itemId);
  // Locked a moment ago in this same transaction, so it cannot have vanished.
  if (read === undefined) throw new InventoryItemNotVisibleError();
  return read.detail;
}
