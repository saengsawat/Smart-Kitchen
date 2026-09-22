import { describe, expect, it } from "vitest";
import type { InventoryItemSummaryDto } from "@smart-kitchen/contracts";
import { buildInventoryListView, needsConfirmation } from "./list-view";

const NOW = "2026-09-22T12:00:00.000Z";

function item(params: {
  itemId: string;
  storageLocation: InventoryItemSummaryDto["storageLocation"];
  tier: "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";
  expiresInDays?: number;
}): InventoryItemSummaryDto {
  return {
    itemId: params.itemId,
    displayName: params.itemId,
    productRef: null,
    ingredientRef: null,
    storageLocation: params.storageLocation,
    quantity: { unit: "lb", micros: "1000000", amount: "1" },
    earliestExpiresAt:
      params.expiresInDays === undefined
        ? null
        : new Date(new Date(NOW).getTime() + params.expiresInDays * 86_400_000).toISOString(),
    provenance: {
      quantity: { tier: params.tier, source: "fixture", confidence: null, recordedAt: null },
      earliestExpiresAt: null,
    },
    lots: [],
  };
}

describe("needsConfirmation", () => {
  it("is true only for an AI-tier quantity", () => {
    expect(
      needsConfirmation(
        item({ itemId: "a", storageLocation: "FRIDGE", tier: "AI_INTERPRETATION" }),
      ),
    ).toBe(true);
    expect(
      needsConfirmation(item({ itemId: "b", storageLocation: "FRIDGE", tier: "KNOWN_FACT" })),
    ).toBe(false);
  });
});

describe("buildInventoryListView", () => {
  const items = [
    item({
      itemId: "strawberries",
      storageLocation: "FRIDGE",
      tier: "AI_INTERPRETATION",
      expiresInDays: 1,
    }),
    item({ itemId: "chicken", storageLocation: "FRIDGE", tier: "KNOWN_FACT", expiresInDays: 2 }),
    item({ itemId: "salmon", storageLocation: "FREEZER", tier: "KNOWN_FACT", expiresInDays: 60 }),
    item({ itemId: "rice", storageLocation: "PANTRY", tier: "ESTIMATED" }),
  ];
  const noFilters = { location: "all" as const, sortByExpiry: false, needsConfirmationOnly: false };

  it("groups by location in Fridge, Freezer, Pantry order, skipping empty groups", () => {
    const view = buildInventoryListView(items, noFilters, NOW);
    expect(view.groups.map((g) => g.location)).toEqual(["FRIDGE", "FREEZER", "PANTRY"]);
  });

  it("never renders a stranded header for an empty group", () => {
    const fridgeOnly = items.filter((i) => i.storageLocation === "FRIDGE");
    const view = buildInventoryListView(fridgeOnly, noFilters, NOW);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.location).toBe("FRIDGE");
  });

  it("the location filter keeps only that location's group", () => {
    const view = buildInventoryListView(items, { ...noFilters, location: "FREEZER" }, NOW);
    expect(view.groups.map((g) => g.location)).toEqual(["FREEZER"]);
    expect(view.visibleCount).toBe(1);
  });

  it("sortByExpiry orders each group soonest-first without moving rows between groups", () => {
    const reordered = [items[1]!, items[0]!, items[2]!, items[3]!]; // chicken (2d) before strawberries (1d)
    const view = buildInventoryListView(reordered, { ...noFilters, sortByExpiry: true }, NOW);
    const fridgeGroup = view.groups.find((g) => g.location === "FRIDGE")!;
    expect(fridgeGroup.items.map((i) => i.itemId)).toEqual(["strawberries", "chicken"]); // 1d before 2d
  });

  it("an item with no known expiry sorts last under sortByExpiry", () => {
    const pantryTwo = [
      item({ itemId: "olive-oil", storageLocation: "PANTRY", tier: "KNOWN_FACT" }),
      item({
        itemId: "canned-beans",
        storageLocation: "PANTRY",
        tier: "KNOWN_FACT",
        expiresInDays: 200,
      }),
    ];
    const view = buildInventoryListView(pantryTwo, { ...noFilters, sortByExpiry: true }, NOW);
    expect(view.groups[0]!.items.map((i) => i.itemId)).toEqual(["canned-beans", "olive-oil"]);
  });

  it("needsConfirmationOnly filters to AI-tier rows only, and can leave a whole group empty", () => {
    const view = buildInventoryListView(items, { ...noFilters, needsConfirmationOnly: true }, NOW);
    expect(view.groups.map((g) => g.location)).toEqual(["FRIDGE"]);
    expect(view.groups[0]!.items.map((i) => i.itemId)).toEqual(["strawberries"]);
  });

  it("the confirmation tray is independent of the location/sort/confirm filters", () => {
    const view = buildInventoryListView(items, { ...noFilters, location: "PANTRY" }, NOW);
    expect(view.needsConfirmationTray.map((i) => i.itemId)).toEqual(["strawberries"]);
  });

  describe("emptyCause (review F2: location-empty vs filtered-empty)", () => {
    it("a non-empty view has no empty cause", () => {
      const view = buildInventoryListView(items, noFilters, NOW);
      expect(view.emptyCause).toBeNull();
    });

    it("only the location filter active, and it matches nothing -> 'location'", () => {
      const view = buildInventoryListView(items, { ...noFilters, location: "OTHER" }, NOW);
      expect(view.groups).toEqual([]);
      expect(view.emptyCause).toBe("location");
    });

    it("needsConfirmationOnly active (location left at 'all') and it matches nothing -> 'filtered'", () => {
      const noAiItems = items.filter((i) => i.itemId !== "strawberries");
      const view = buildInventoryListView(
        noAiItems,
        { ...noFilters, needsConfirmationOnly: true },
        NOW,
      );
      expect(view.groups).toEqual([]);
      expect(view.emptyCause).toBe("filtered");
    });

    it("location and needsConfirmationOnly both active -> 'filtered' (the more specific cause)", () => {
      const view = buildInventoryListView(
        items,
        { ...noFilters, location: "PANTRY", needsConfirmationOnly: true },
        NOW,
      );
      expect(view.groups).toEqual([]);
      expect(view.emptyCause).toBe("filtered");
    });
  });
});
