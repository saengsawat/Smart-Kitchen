import { describe, expect, it } from "vitest";
import type { ShoppingListDto, ShoppingRowDto } from "@smart-kitchen/contracts";
import { buildShoppingListView } from "./list-view";

function row(overrides: Partial<ShoppingRowDto>): ShoppingRowDto {
  return {
    rowId: "row-x",
    name: "Item",
    group: "Produce",
    origin: { kind: "menu", label: "Tonight", recipeName: null },
    needMicros: "1000000",
    haveMicros: "0",
    haveTier: null,
    buyMicros: "1000000",
    unit: "each",
    itemId: null,
    status: "open",
    checkedOffBy: null,
    defaultLocation: "FRIDGE",
    ...overrides,
  };
}

function list(rows: readonly ShoppingRowDto[]): ShoppingListDto {
  return { rows, members: [], syncedAt: "2026-09-29T12:00:00.000Z" };
}

describe("buildShoppingListView", () => {
  it("groups consecutive same-group rows together, in DTO order", () => {
    const view = buildShoppingListView(
      list([
        row({ rowId: "a", group: "Meat & seafood" }),
        row({ rowId: "b", group: "Produce" }),
        row({ rowId: "c", group: "Produce" }),
        row({ rowId: "d", group: "Pantry" }),
      ]),
    );
    expect(view.groups.map((g) => g.group)).toEqual(["Meat & seafood", "Produce", "Pantry"]);
    expect(view.groups[1]?.rows.map((r) => r.rowId)).toEqual(["b", "c"]);
  });

  it("skipped rows never join a department group and stay in DTO order at the end", () => {
    const view = buildShoppingListView(
      list([
        row({ rowId: "a", group: "Pantry", status: "open" }),
        row({ rowId: "rice", group: "Pantry", status: "skipped" }),
        row({ rowId: "soy", group: "Pantry", status: "skipped" }),
      ]),
    );
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.rows.map((r) => r.rowId)).toEqual(["a"]);
    expect(view.skipped.map((r) => r.rowId)).toEqual(["rice", "soy"]);
  });

  it("buyCount counts only open rows, not done or skipped", () => {
    const view = buildShoppingListView(
      list([
        row({ rowId: "a", status: "open" }),
        row({ rowId: "b", status: "open" }),
        row({ rowId: "c", status: "done" }),
        row({ rowId: "d", status: "skipped" }),
      ]),
    );
    expect(view.buyCount).toBe(2);
  });

  it("a non-consecutive repeat of the same group name starts a new group header, not merged with an earlier one", () => {
    const view = buildShoppingListView(
      list([
        row({ rowId: "a", group: "Pantry" }),
        row({ rowId: "b", group: "Produce" }),
        row({ rowId: "c", group: "Pantry" }),
      ]),
    );
    expect(view.groups.map((g) => g.group)).toEqual(["Pantry", "Produce", "Pantry"]);
  });

  it("isEmpty is true only when there are no rows at all", () => {
    expect(buildShoppingListView(list([])).isEmpty).toBe(true);
    expect(buildShoppingListView(list([row({ rowId: "a" })])).isEmpty).toBe(false);
  });
});
