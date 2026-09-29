/**
 * S11's pure list-derivation logic (M3-T5), kept out of the screen component
 * (same "components stay thin" rule `src/inventory/list-view.ts` follows).
 *
 * Grouping rule (BACKLOG.md M3-T5 Objective (b)): `open`/`done` rows are
 * grouped by `ShoppingRowDto.group`, **in the DTO's own row order** ("the
 * group label is data, not client categorisation" — this module never sorts
 * or re-labels a group, it only partitions consecutive/same-name rows).
 * `skipped` rows never join a department group: they always render in one
 * fixed "Already have · skipped" section at the end (Objective (e)), in the
 * DTO's own order, regardless of their own `group` field.
 */

import type { ShoppingListDto, ShoppingRowDto } from "@smart-kitchen/contracts";

export interface ShoppingGroup {
  readonly group: string;
  readonly rows: readonly ShoppingRowDto[];
}

export interface ShoppingListView {
  /** Department groups for every non-skipped row, in the DTO's own order. */
  readonly groups: readonly ShoppingGroup[];
  /** "Already have" rows, in the DTO's own order, never grouped by department. */
  readonly skipped: readonly ShoppingRowDto[];
  /** Count of rows still `open` (the header's "{n} to buy"; a `done` row does not count, matching prototype's `buyCount`). */
  readonly buyCount: number;
  /** True when there is nothing to show at all (copy-deck.md §7 S11 empty state). */
  readonly isEmpty: boolean;
}

export function buildShoppingListView(list: ShoppingListDto): ShoppingListView {
  const mutableGroups: { group: string; rows: ShoppingRowDto[] }[] = [];
  const skipped: ShoppingRowDto[] = [];
  let buyCount = 0;

  for (const row of list.rows) {
    if (row.status === "skipped") {
      skipped.push(row);
      continue;
    }
    if (row.status === "open") {
      buyCount += 1;
    }
    const lastGroup = mutableGroups[mutableGroups.length - 1];
    if (lastGroup && lastGroup.group === row.group) {
      lastGroup.rows.push(row);
    } else {
      mutableGroups.push({ group: row.group, rows: [row] });
    }
  }

  return {
    groups: mutableGroups,
    skipped,
    buyCount,
    isEmpty: list.rows.length === 0,
  };
}
