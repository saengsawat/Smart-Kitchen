/**
 * Example-based coverage of every transaction type, plus the product brief's
 * worked example (§7), which is the canonical statement of what the ledger owes
 * the user.
 */

import { describe, expect, it } from "vitest";
import { reconcile } from "./derive.js";
import { appendTransaction, appendTransactions, createInventoryItem } from "./ledger.js";
import { formatQuantity } from "./quantity.js";
import { instantAt, itemInput, txInput, TEST_LOT } from "./test-support.js";
import { TRANSACTION_TYPES, transactionDirection } from "./types.js";
import type { InventoryItem, TransactionType } from "./types.js";

function emptyItem(): InventoryItem {
  const created = createInventoryItem(itemInput());
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** Item holding `stock` units on the default lot, via INITIAL_STOCK. */
function stockedItem(stock: number): InventoryItem {
  const result = appendTransaction(
    emptyItem(),
    txInput("INITIAL_STOCK", stock, { idempotencyKey: "seed" }),
  );
  if (result.status !== "appended") throw new Error("seeding failed");
  return result.item;
}

describe("brief §7 — worked example", () => {
  it("chicken breast 2.0 lb, a meal using 0.75 lb, leaves 1.25 lb", () => {
    const created = createInventoryItem({
      itemId: "item-chicken-breast",
      householdId: "hh-001",
      unit: "lb",
      ingredientRef: "ingredient:chicken-breast",
      storageLocation: "FRIDGE",
      lots: [{ lotId: "lot-1", acquiredAt: instantAt(0) }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const purchase = appendTransaction(created.value, {
      lotId: "lot-1",
      type: "PURCHASE",
      qtyDelta: 2.0,
      unit: "lb",
      actor: { kind: "user", userId: "user-dean" },
      occurredAt: instantAt(0),
      recordedAt: instantAt(0),
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: "buy-1",
    });
    expect(purchase.status).toBe("appended");
    if (purchase.status !== "appended") return;
    expect(purchase.item.currentQty.amount).toBe(2.0);

    const meal = appendTransaction(purchase.item, {
      lotId: "lot-1",
      type: "USE_IN_MEAL",
      qtyDelta: -0.75,
      unit: "lb",
      reason: "cooked recipe",
      actor: { kind: "user", userId: "user-dean" },
      occurredAt: instantAt(3600),
      recordedAt: instantAt(3600),
      provenance: { tier: "KNOWN_FACT", source: "meal-log" },
      idempotencyKey: "meal-7",
      correlationRef: { kind: "meal-log", id: "meal-7" },
    });
    expect(meal.status).toBe("appended");
    if (meal.status !== "appended") return;

    // The brief's assertion, exactly:
    expect(meal.item.currentQty.amount).toBe(1.25);
    expect(meal.item.currentQty.micros).toBe(1_250_000n);
    expect(formatQuantity(meal.item.currentQty)).toBe("1.25 lb");

    // …and it is explainable: two rows, no clamp, snapshot reconciles.
    expect(meal.clampAdjustment).toBeUndefined();
    expect(meal.item.transactions.map((row) => [row.type, row.qtyDelta])).toEqual([
      ["PURCHASE", 2.0],
      ["USE_IN_MEAL", -0.75],
    ]);
    expect(reconcile(meal.item).ok).toBe(true);
  });

  it("retrying the same meal log does not decrement twice (brief §7 + INV-MEAL-1 precursor)", () => {
    const stocked = stockedItem(2);
    const mealInput = txInput("USE_IN_MEAL", 0.75, {
      idempotencyKey: "meal-7",
      correlationRef: { kind: "meal-log", id: "meal-7" },
    });
    const first = appendTransaction(stocked, mealInput);
    if (first.status !== "appended") throw new Error("expected append");
    const retry = appendTransaction(first.item, mealInput);

    expect(retry.status).toBe("duplicate");
    expect(retry.item.currentQty.amount).toBe(1.25);
    expect(retry.item.transactions).toHaveLength(2);
  });
});

describe("every transaction type", () => {
  const cases: readonly { type: TransactionType; magnitude: number; expected: number }[] = [
    { type: "INITIAL_STOCK", magnitude: 3, expected: 13 },
    { type: "PURCHASE", magnitude: 2.5, expected: 12.5 },
    { type: "CONSUME", magnitude: 1.5, expected: 8.5 },
    { type: "USE_IN_MEAL", magnitude: 0.75, expected: 9.25 },
    { type: "DISCARD", magnitude: 2, expected: 8 },
    { type: "EXPIRE", magnitude: 0.25, expected: 9.75 },
    { type: "DONATE", magnitude: 4, expected: 6 },
    { type: "ADJUSTMENT", magnitude: 0.1, expected: 10.1 },
  ];

  it.each(cases)("$type moves the balance the way its direction says", (testCase) => {
    const item = stockedItem(10);
    const result = appendTransaction(
      item,
      txInput(testCase.type, testCase.magnitude, { idempotencyKey: `tx-${testCase.type}` }),
    );
    expect(result.status).toBe("appended");
    if (result.status !== "appended") return;

    expect(result.item.currentQty.amount).toBe(testCase.expected);
    expect(result.item.transactions).toHaveLength(2);
    expect(result.clampAdjustment).toBeUndefined();
    expect(reconcile(result.item).ok).toBe(true);

    const direction = transactionDirection(testCase.type);
    const delta = result.transaction.qtyDeltaMicros;
    if (direction === "increase") expect(delta > 0n).toBe(true);
    if (direction === "decrease") expect(delta < 0n).toBe(true);
  });

  it("covers the full documented type list", () => {
    expect(cases.map((testCase) => testCase.type).sort()).toEqual([...TRANSACTION_TYPES].sort());
  });

  it("records a negative ADJUSTMENT as a correction, not a mutation", () => {
    const item = stockedItem(10);
    const result = appendTransaction(
      item,
      txInput("ADJUSTMENT", 0.4, {
        qtyDelta: -0.4,
        idempotencyKey: "fix-1",
        reason: "recount: found less than recorded",
      }),
    );
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.item.currentQty.amount).toBe(9.6);
    expect(result.item.transactions[0]?.qtyDelta).toBe(10);
    expect(result.item.transactions[1]?.reason).toBe("recount: found less than recorded");
  });

  it("keeps waste analytics answerable from the reasons alone (brief §7 reason list)", () => {
    const { item } = appendTransactions(stockedItem(10), [
      txInput("USE_IN_MEAL", 2, { idempotencyKey: "w1" }),
      txInput("DISCARD", 1, { idempotencyKey: "w2", reason: "spoiled" }),
      txInput("EXPIRE", 0.5, { idempotencyKey: "w3" }),
      txInput("DONATE", 1.5, { idempotencyKey: "w4" }),
    ]);

    const wasted = item.transactions
      .filter((row) => row.type === "DISCARD" || row.type === "EXPIRE")
      .reduce((total, row) => total + row.qtyDeltaMicros, 0n);
    expect(wasted).toBe(-1_500_000n);
    expect(item.currentQty.amount).toBe(5);
    expect(item.transactions.every((row) => row.lotId === TEST_LOT)).toBe(true);
  });
});
