/**
 * S6's "Recently added" list (M3-T4b, BACKLOG.md Objective (a): "lists items
 * created this session"). A plain in-memory, session-scoped module list —
 * the same "no persistence across app restarts" convention
 * `FixtureApiClient` itself already follows (its own doc comment) — not a
 * ledger read, so S6 does not need to re-derive "which items are new" from
 * timestamps or provenance.
 */

import type { InventoryItemSummaryDto } from "@smart-kitchen/contracts";

let items: readonly InventoryItemSummaryDto[] = [];

/** Newest first, matching S5's history ordering convention. */
export function recordRecentlyAdded(item: InventoryItemSummaryDto): void {
  items = [item, ...items];
}

export function getRecentlyAdded(): readonly InventoryItemSummaryDto[] {
  return items;
}

/** Test-only: clears the session list between test cases. */
export function __resetRecentlyAddedForTests(): void {
  items = [];
}
