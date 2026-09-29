/**
 * The Chen fixture household's shopping list (M3-T5), reproducing prototype
 * v4's `#scr-shopping` exactly (docs/design/mockups/smart-kitchen-prototype.html
 * lines 899-927): chicken breast (menu gap, partial stock), broccoli (menu
 * gap, none on hand), garlic (AI suggestion), granola and paper towels
 * (member adds), olive oil (already checked off by Dean), rice and soy sauce
 * (already have, skipped).
 *
 * Plain JSON, read directly by both sides that need it (same one-source-of-
 * truth reasoning as `src/household/fixture-restrictions.ts`):
 *
 * - `src/api/client.ts`'s `FixtureApiClient`, which serves it as
 *   `ShoppingListDto` and mutates its own in-memory copy on check-off/
 *   remove/Add.
 * - `packages/adapters/src/contracts-consistency/shopping-gap-drift.test.ts`,
 *   which reads this file directly (`node:fs`, no TypeScript compile step
 *   needed) and recomputes every row's `buyMicros` with the domain's real
 *   `neededQuantity`, so this fixture can never carry a hand-invented gap
 *   (BACKLOG.md M3-T5 Objective (j)).
 *
 * `itemId` references the exact fixture item ids `src/inventory/
 * fixture-household.ts` already seeds (`fixture-item-chicken`,
 * `fixture-item-rice`, `fixture-item-olive-oil`), so a chicken-breast Add
 * lands a PURCHASE on the same item S4/S5 show (BACKLOG.md M3-T5 Objective
 * (h): "the same item ids S4 shows so the PURCHASE lands on the real
 * fixture item").
 *
 * **Deviation, flagged in the worker report:** `row-olive-oil`'s `unit` is
 * `"each"`, not the real `fixture-item-olive-oil`'s `"bottle"` (a unit the
 * M1-T3 domain registry does not resolve at all — `lookupUnit("bottle")`
 * fails, which would break the gap-drift test's `neededQuantity` call for
 * every row, since a registry-resolvable unit is required there). This is
 * safe only because the row arrives `status: "done"` and this ticket never
 * offers Add for a row that starts already checked off (see
 * `apps/mobile/app/shopping.tsx`'s doc comment on the close-the-loop prompt),
 * so no code path ever calls `addCheckedOffToInventory("row-olive-oil", ...)`
 * with this row's unit. If a later ticket makes Add reachable for a
 * pre-done row, this must change to `"bottle"` plus a registry follow-up
 * (or the row must stop naming a real `itemId`).
 */

import type { ShoppingListDto, ShoppingMemberDto, ShoppingRowDto } from "@smart-kitchen/contracts";
import raw from "./fixture-shopping-list.json";

interface RawShoppingList {
  readonly syncedAt: string;
  readonly members: readonly ShoppingMemberDto[];
  readonly rows: readonly ShoppingRowDto[];
}

const data = raw as unknown as RawShoppingList;

/**
 * A fresh, independent copy of the fixture list: every `FixtureApiClient`
 * instance gets its own rows so one test's check-off/remove never leaks
 * into another's (same "built fresh per instance" rule
 * `buildChenInventory()` follows).
 */
export function buildFixtureShoppingRows(): Map<string, ShoppingRowDto> {
  return new Map(data.rows.map((row) => [row.rowId, { ...row }]));
}

export function fixtureShoppingMembers(): readonly ShoppingMemberDto[] {
  return data.members.map((m) => ({ ...m }));
}

export function fixtureShoppingSyncedAt(): string {
  return data.syncedAt;
}

/** Assembles the DTO from a live rows map, in the map's own iteration order (insertion order, i.e. the fixture's authored order). */
export function toShoppingListDto(
  rows: ReadonlyMap<string, ShoppingRowDto>,
  members: readonly ShoppingMemberDto[],
  syncedAt: string,
): ShoppingListDto {
  return { rows: [...rows.values()], members, syncedAt };
}
