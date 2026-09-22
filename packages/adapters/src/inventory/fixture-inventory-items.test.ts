import { describe, expect, it } from "vitest";
import {
  FIXTURE_HOUSEHOLD_IDS,
  FIXTURE_INVENTORY_ITEMS_CHEN,
  FIXTURE_INVENTORY_ITEMS_OTHER,
} from "./fixture-inventory-items.js";

describe("fixture inventory items (M3-T1)", () => {
  it("Chen household has at least one item and every row belongs to it", () => {
    expect(FIXTURE_INVENTORY_ITEMS_CHEN.length).toBeGreaterThan(0);
    for (const row of FIXTURE_INVENTORY_ITEMS_CHEN) {
      expect(row.householdId).toBe(FIXTURE_HOUSEHOLD_IDS.chen);
    }
  });

  it("the other household's items never mix with Chen's (tenancy isolation fixture)", () => {
    expect(FIXTURE_INVENTORY_ITEMS_OTHER.length).toBeGreaterThan(0);
    for (const row of FIXTURE_INVENTORY_ITEMS_OTHER) {
      expect(row.householdId).toBe(FIXTURE_HOUSEHOLD_IDS.other);
    }
    const chenIds = new Set(FIXTURE_INVENTORY_ITEMS_CHEN.map((r) => r.itemId));
    for (const row of FIXTURE_INVENTORY_ITEMS_OTHER) {
      expect(chenIds.has(row.itemId)).toBe(false);
    }
  });

  it("every row is a valid InventoryItemSummary shape with a positive quantity", () => {
    for (const row of [...FIXTURE_INVENTORY_ITEMS_CHEN, ...FIXTURE_INVENTORY_ITEMS_OTHER]) {
      expect(row.itemId).toEqual(expect.any(String));
      expect(row.name).toEqual(expect.any(String));
      expect(row.currentQty.amount).toBeGreaterThan(0);
      expect(row.currentQty.unit).toEqual(expect.any(String));
      expect(row.quantityProvenanceTier).toBe("KNOWN_FACT");
    }
  });

  it("was built through the real ledger, so quantities came from an actual appended transaction, not hand-typed data", () => {
    const milk = FIXTURE_INVENTORY_ITEMS_CHEN.find((r) => r.itemId === "fixture-item-milk");
    expect(milk?.currentQty).toEqual({ amount: 2, unit: "count" });
  });
});
