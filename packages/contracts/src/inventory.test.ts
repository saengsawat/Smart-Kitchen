import { describe, expect, it } from "vitest";
import type { InventoryItemSummary } from "./inventory.js";

describe("InventoryItemSummary (M3-T1 placeholder DTO)", () => {
  it("accepts a plain client-facing row with no domain/ledger fields", () => {
    const row: InventoryItemSummary = {
      itemId: "item-1",
      householdId: "hh-1",
      name: "Whole milk",
      currentQty: { amount: 2, unit: "count" },
      storageLocation: "FRIDGE",
      quantityProvenanceTier: "KNOWN_FACT",
    };

    expect(row.currentQty.amount).toBe(2);
    expect(row.quantityProvenanceTier).toBe("KNOWN_FACT");
  });

  it("storageLocation is optional", () => {
    const row: InventoryItemSummary = {
      itemId: "item-2",
      householdId: "hh-1",
      name: "Rice",
      currentQty: { amount: 900, unit: "g" },
      quantityProvenanceTier: "ESTIMATED",
    };

    expect(row.storageLocation).toBeUndefined();
  });
});
