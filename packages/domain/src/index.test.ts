import { describe, expect, it } from "vitest";
import {
  appendTransaction,
  createInventoryItem,
  formatQuantity,
  reconcile,
  DOMAIN_PACKAGE_NAME,
  TRANSACTION_TYPES,
} from "./index.js";

describe("@smart-kitchen/domain public API", () => {
  it("names the package", () => {
    expect(DOMAIN_PACKAGE_NAME).toBe("@smart-kitchen/domain");
  });

  it("exposes the inventory ledger from the package entry point", () => {
    expect(TRANSACTION_TYPES).toContain("USE_IN_MEAL");

    const created = createInventoryItem({
      itemId: "item-1",
      householdId: "hh-1",
      unit: "lb",
      lots: [{ lotId: "lot-1" }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const purchase = appendTransaction(created.value, {
      lotId: "lot-1",
      type: "PURCHASE",
      qtyDelta: 2,
      unit: "lb",
      actor: { kind: "user", userId: "user-1" },
      occurredAt: "2026-03-06T18:00:00.000Z",
      recordedAt: "2026-03-06T18:00:00.000Z",
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: "p1",
    });
    expect(purchase.status).toBe("appended");
    if (purchase.status !== "appended") return;

    expect(formatQuantity(purchase.item.currentQty)).toBe("2 lb");
    expect(reconcile(purchase.item).ok).toBe(true);
  });
});
