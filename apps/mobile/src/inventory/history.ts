/**
 * S5's history view model (M2-T6, D-024 row 1).
 *
 * An item's history is its ledger rows plus its moves between locations
 * (`InventoryHistoryEntryDto`). A move is not a ledger row: it has no amount,
 * so everything that does arithmetic or narrates quantity (the on-hand sum, the
 * "Why {qty}?" line) must see {@link ledgerRowsOf} only.
 */

import type {
  InventoryHistoryEntryDto,
  InventoryMoveEntryDto,
  InventoryTransactionDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import { LOCATION_LABELS } from "./list-view";

/** Narrows a history entry to a move. The discriminant is `type`; `"MOVED"` is not a ledger type. */
export function isMoveEntry(entry: InventoryHistoryEntryDto): entry is InventoryMoveEntryDto {
  return entry.type === "MOVED";
}

/** The ledger rows of a history, in their given order. */
export function ledgerRowsOf(
  history: readonly InventoryHistoryEntryDto[],
): readonly InventoryTransactionDto[] {
  return history.filter((entry): entry is InventoryTransactionDto => !isMoveEntry(entry));
}

/** The row's own caption: "Moved to Pantry" (copy proposed for copy-deck §7 S5). */
export function movedRowTitle(entry: InventoryMoveEntryDto): string {
  return `Moved to ${LOCATION_LABELS[entry.toLocation]}`;
}

/** "from Fridge", or `null` when the item had no location before (nothing honest to say). */
export function movedRowCaption(entry: InventoryMoveEntryDto): string | null {
  return entry.fromLocation === null ? null : `from ${LOCATION_LABELS[entry.fromLocation]}`;
}

/** The three locations other than `current`, in the enum order (the "Move to" chip row). */
export function otherLocations(current: StorageLocationDto | null): StorageLocationDto[] {
  return (["FRIDGE", "FREEZER", "PANTRY", "OTHER"] as const).filter(
    (location) => location !== current,
  );
}

/**
 * Merges moves into ledger history, oldest first: the same rule as the API's
 * `history-merge.ts`, here at the millisecond precision the fixture clock has.
 * Ledger rows keep their given (sequence) order; a move goes before the first
 * ledger row recorded after it; a tie puts the ledger row first; moves among
 * themselves go by time, then id.
 */
export function mergeMovesIntoDetailHistory(
  ledger: readonly InventoryTransactionDto[],
  moves: readonly InventoryMoveEntryDto[],
): InventoryHistoryEntryDto[] {
  const orderedMoves = [...moves].sort((a, b) =>
    a.recordedAt < b.recordedAt
      ? -1
      : a.recordedAt > b.recordedAt
        ? 1
        : a.moveId < b.moveId
          ? -1
          : a.moveId > b.moveId
            ? 1
            : 0,
  );
  const merged: InventoryHistoryEntryDto[] = [];
  let l = 0;
  let m = 0;
  while (l < ledger.length || m < orderedMoves.length) {
    const nextLedger = ledger[l];
    const nextMove = orderedMoves[m];
    if (
      nextMove !== undefined &&
      (nextLedger === undefined || nextMove.recordedAt < nextLedger.recordedAt)
    ) {
      merged.push(nextMove);
      m += 1;
    } else if (nextLedger !== undefined) {
      merged.push(nextLedger);
      l += 1;
    }
  }
  return merged;
}
