import { describe, expect, it } from "vitest";
import {
  INVENTORY_ITEM_CONFIRM_ROUTE,
  INVENTORY_ITEM_MOVE_ROUTE,
  TRANSACTION_TYPES_DTO,
  inventoryItemConfirmPath,
  inventoryItemMovePath,
} from "./inventory.js";
import type {
  ConfirmAiProposalRequestDto,
  ConfirmAiProposalResponseDto,
  InventoryItemDetailDto,
  InventoryItemSummaryDto,
  InventoryMoveEntryDto,
  InventoryTransactionDto,
  MoveItemRequestDto,
  MoveItemResponseDto,
} from "./inventory.js";

const SUMMARY: InventoryItemSummaryDto = {
  itemId: "item-1",
  displayName: "Chicken breast",
  productRef: null,
  ingredientRef: null,
  storageLocation: "FRIDGE",
  quantity: { unit: "lb", micros: "1250000", amount: "1.250000" },
  earliestExpiresAt: null,
  provenance: { quantity: null, earliestExpiresAt: null },
  lots: [],
};

describe("InventoryTransactionDto / InventoryItemDetailDto (M3-T3)", () => {
  it("TRANSACTION_TYPES_DTO lists all eight transaction types", () => {
    expect(TRANSACTION_TYPES_DTO).toHaveLength(8);
    expect(TRANSACTION_TYPES_DTO).toEqual([
      "INITIAL_STOCK",
      "PURCHASE",
      "CONSUME",
      "USE_IN_MEAL",
      "DISCARD",
      "EXPIRE",
      "DONATE",
      "ADJUSTMENT",
    ]);
  });

  it("accepts a plain user-authored ledger row, no householdId, no number quantity", () => {
    const row: InventoryTransactionDto = {
      transactionId: "tx-1",
      type: "PURCHASE",
      deltaMicros: "2000000",
      amount: "2.000000",
      recordedAt: "2026-09-16T18:04:00.000Z",
      actor: { kind: "user", displayInitials: "DC" },
      provenance: {
        tier: "KNOWN_FACT",
        source: "barcode-scan",
        confidence: null,
        recordedAt: null,
      },
      reason: null,
    };
    expect(row.systemFlag).toBeUndefined();
    expect(typeof row.deltaMicros).toBe("string");
  });

  it("a system clamp row carries systemFlag and no displayInitials", () => {
    const row: InventoryTransactionDto = {
      transactionId: "tx-clamp",
      type: "ADJUSTMENT",
      deltaMicros: "250000",
      amount: "0.250000",
      recordedAt: "2026-09-17T19:21:00.000Z",
      actor: { kind: "system" },
      provenance: { tier: "ESTIMATED", source: "ledger-clamp", confidence: null, recordedAt: null },
      reason: null,
      systemFlag: "OVER_CONSUMPTION",
    };
    expect(row.actor.displayInitials).toBeUndefined();
    expect(row.systemFlag).toBe("OVER_CONSUMPTION");
  });

  it("InventoryItemDetailDto is a summary plus history in sequence order", () => {
    const detail: InventoryItemDetailDto = { summary: SUMMARY, history: [] };
    expect(detail.summary.itemId).toBe("item-1");
    expect(detail.history).toEqual([]);
  });
});

describe("ConfirmAiProposal DTOs (M2-T5, D-028)", () => {
  it("the request carries a client key and nothing that names a household or a person", () => {
    const body: ConfirmAiProposalRequestDto = { idempotencyKey: "k-1" };
    expect(Object.keys(body)).toEqual(["idempotencyKey"]);
  });

  it("the response is the item detail and nothing else, so a replay is byte-identical", () => {
    const body: ConfirmAiProposalResponseDto = { item: { summary: SUMMARY, history: [] } };
    expect(Object.keys(body)).toEqual(["item"]);
  });

  it("the confirm path is the item path plus /confirm, with the id encoded", () => {
    expect(inventoryItemConfirmPath("item-1")).toBe("/v1/inventory/items/item-1/confirm");
    expect(inventoryItemConfirmPath("a/b")).toBe("/v1/inventory/items/a%2Fb/confirm");
    expect(INVENTORY_ITEM_CONFIRM_ROUTE).toBe("/v1/inventory/items/:itemId/confirm");
  });
});

describe("MoveItem DTOs (M2-T6, D-024 row 1)", () => {
  it("the request carries a destination and a key, and nothing that names a household, a person or a source", () => {
    const body: MoveItemRequestDto = { toLocation: "PANTRY", idempotencyKey: "k-1" };
    expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "toLocation"]);
  });

  it("the response is the item detail and nothing else, so a replay is byte-identical", () => {
    const body: MoveItemResponseDto = { item: { summary: SUMMARY, history: [] } };
    expect(Object.keys(body)).toEqual(["item"]);
  });

  it("the move path is the item path plus /move, with the id encoded", () => {
    expect(inventoryItemMovePath("item-1")).toBe("/v1/inventory/items/item-1/move");
    expect(inventoryItemMovePath("a/b")).toBe("/v1/inventory/items/a%2Fb/move");
    expect(INVENTORY_ITEM_MOVE_ROUTE).toBe("/v1/inventory/items/:itemId/move");
  });

  it("a MOVED history entry carries where the item went and no amount, and sits in the same history as ledger rows", () => {
    const moved: InventoryMoveEntryDto = {
      type: "MOVED",
      moveId: "move-1",
      fromLocation: "FRIDGE",
      toLocation: "PANTRY",
      recordedAt: "2026-10-01T12:00:00.000Z",
      actor: { kind: "user", displayInitials: "DC" },
    };
    const detail: InventoryItemDetailDto = { summary: SUMMARY, history: [moved] };
    expect(detail.history[0]?.type).toBe("MOVED");
    expect(Object.keys(moved)).not.toContain("amount");
    expect(Object.keys(moved)).not.toContain("deltaMicros");
    expect(TRANSACTION_TYPES_DTO as readonly string[]).not.toContain("MOVED");
  });

  it("a move out of an unassigned item has a null source", () => {
    const moved: InventoryMoveEntryDto = {
      type: "MOVED",
      moveId: "move-2",
      fromLocation: null,
      toLocation: "OTHER",
      recordedAt: "2026-10-01T12:00:00.000Z",
      actor: { kind: "user" },
    };
    expect(moved.fromLocation).toBeNull();
  });
});
