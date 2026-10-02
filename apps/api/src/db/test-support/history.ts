/**
 * Test helper (M2-T6): an item's history is ledger rows plus `MOVED` entries
 * (`InventoryHistoryEntryDto`). Tests that assert on ledger-row fields
 * (`deltaMicros`, `provenance`, `transactionId`, ...) read through this, so a
 * move in the history can never be mistaken for a ledger row.
 */

import type { InventoryHistoryEntryDto, InventoryTransactionDto } from "@smart-kitchen/contracts";

export function ledgerRows(
  history: readonly InventoryHistoryEntryDto[],
): InventoryTransactionDto[] {
  return history.filter((entry): entry is InventoryTransactionDto => entry.type !== "MOVED");
}
