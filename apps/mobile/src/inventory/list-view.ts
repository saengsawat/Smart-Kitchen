/**
 * S4's pure list-derivation logic (M3-T3), kept out of the screen component
 * so it is unit-testable without mounting React Native (rule 21: components
 * stay thin, the pattern `src/onboarding/allergyGate.ts` already established).
 *
 * Location order and grouping match prototype v4's `#invList` (Fridge,
 * Freezer, Pantry, then anything else); "Sort · expiry" orders each group
 * soonest-first without moving a row between groups or stranding a header
 * with nothing under it (BACKLOG.md M3-T3 acceptance criterion).
 */

import type { InventoryItemSummaryDto, StorageLocationDto } from "@smart-kitchen/contracts";
import { daysUntil } from "./expiry";

export type LocationFilter = "all" | StorageLocationDto;

const LOCATION_ORDER: readonly StorageLocationDto[] = ["FRIDGE", "FREEZER", "PANTRY", "OTHER"];

/** Sentence-case display label (StorageLocation display strings are still an open naming question, BACKLOG.md). */
export const LOCATION_LABELS: Readonly<Record<StorageLocationDto, string>> = {
  FRIDGE: "Fridge",
  FREEZER: "Freezer",
  PANTRY: "Pantry",
  OTHER: "Other",
};

/** A row is AI-tier, and so needs confirmation, exactly when its quantity's provenance tier says so. */
export function needsConfirmation(item: InventoryItemSummaryDto): boolean {
  return item.provenance.quantity?.tier === "AI_INTERPRETATION";
}

export interface InventoryGroup {
  readonly location: StorageLocationDto;
  readonly items: readonly InventoryItemSummaryDto[];
}

/**
 * Why `groups` is empty despite the household having items (review F2):
 * `"location"` when the only active filter is the location tab (copy-deck.md
 * §7 S4 "Empty (a location has nothing in it)"), `"filtered"` when any other
 * filter (today, only `needsConfirmationOnly`) is in play, alone or combined
 * with a location, since that is the more specific "no items match" case.
 * `null` when there is at least one visible row.
 */
export type EmptyCause = "location" | "filtered" | null;

export interface InventoryListView {
  /** Groups with at least one visible row, in location order. Never a stranded empty header. */
  readonly groups: readonly InventoryGroup[];
  /** AI-tier rows for the "Needs your confirmation" tray, unaffected by the location/sort/confirm filters. */
  readonly needsConfirmationTray: readonly InventoryItemSummaryDto[];
  /** Total visible row count across every group. */
  readonly visibleCount: number;
  /** See {@link EmptyCause}. */
  readonly emptyCause: EmptyCause;
}

export interface InventoryListFilters {
  readonly location: LocationFilter;
  readonly sortByExpiry: boolean;
  readonly needsConfirmationOnly: boolean;
}

function expiryDays(nowIso: string, item: InventoryItemSummaryDto): number | null {
  return item.earliestExpiresAt === null ? null : daysUntil(nowIso, item.earliestExpiresAt);
}

/** Ascending by days-until-expiry; items with no known expiry sort last (prototype: pantry rows trail). */
function byExpiry(nowIso: string) {
  return (a: InventoryItemSummaryDto, b: InventoryItemSummaryDto): number => {
    const da = expiryDays(nowIso, a);
    const db = expiryDays(nowIso, b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  };
}

export function buildInventoryListView(
  items: readonly InventoryItemSummaryDto[],
  filters: InventoryListFilters,
  nowIso: string,
): InventoryListView {
  const needsConfirmationTray = items.filter(needsConfirmation);

  const filtered = items.filter((item) => {
    if (filters.location !== "all" && item.storageLocation !== filters.location) {
      return false;
    }
    if (filters.needsConfirmationOnly && !needsConfirmation(item)) {
      return false;
    }
    return true;
  });

  const byLocation = new Map<StorageLocationDto, InventoryItemSummaryDto[]>();
  for (const item of filtered) {
    const location = item.storageLocation ?? "OTHER";
    const bucket = byLocation.get(location);
    if (bucket) {
      bucket.push(item);
    } else {
      byLocation.set(location, [item]);
    }
  }

  const groups: InventoryGroup[] = [];
  for (const location of LOCATION_ORDER) {
    const bucket = byLocation.get(location);
    if (!bucket || bucket.length === 0) {
      continue; // never a stranded header
    }
    const ordered = filters.sortByExpiry ? [...bucket].sort(byExpiry(nowIso)) : bucket;
    groups.push({ location, items: ordered });
  }

  const emptyCause: EmptyCause =
    filtered.length > 0
      ? null
      : filters.location !== "all" && !filters.needsConfirmationOnly
        ? "location"
        : "filtered";

  return { groups, needsConfirmationTray, visibleCount: filtered.length, emptyCause };
}
