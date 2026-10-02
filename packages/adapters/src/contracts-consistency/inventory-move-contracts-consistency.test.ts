/**
 * Move an item between locations: contracts vs domain vs migrations (M2-T6,
 * D-024 row 1).
 *
 * 1. **Path.** The client's path helper produces a URL the server's route
 *    pattern matches, with the item id in the parameter's place and encoded.
 * 2. **The new error code.** `SAME_LOCATION` is the API's own refusal, an
 *    `ApiErrorCode`, never a ledger code: the ledger is not consulted.
 * 3. **The location enum.** The wire's `StorageLocationDto` and the domain's
 *    `StorageLocation` are the same set (compile-time, both ways), and both
 *    migrations' CHECKs (0003 on the item, 0011 on the move) list exactly the
 *    four values.
 * 4. **`MOVED` is not a ledger type.** The history entry kind that carries a
 *    move can never be mistaken for, or collide with, a ledger transaction
 *    type: it is in neither `TRANSACTION_TYPES_DTO` nor the domain's list, it
 *    carries no amount, and the union narrows on `type`.
 * 5. **The key shape.** 0011's `client_key` CHECK is the same pattern as
 *    0010's, which the sibling consistency suite pins to 0009's.
 *
 * Migrations are read from the committed SQL with `node:fs`; this package does
 * not depend on `apps/api`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRANSACTION_TYPES, type StorageLocation } from "@smart-kitchen/domain";
import {
  API_ERROR_CODES,
  INVENTORY_ITEM_MOVE_ROUTE,
  INVENTORY_ITEM_ROUTE,
  LEDGER_ERROR_CODES_DTO,
  TRANSACTION_TYPES_DTO,
  inventoryItemMovePath,
  type InventoryHistoryEntryDto,
  type InventoryMoveEntryDto,
  type InventoryTransactionDto,
  type StorageLocationDto,
} from "@smart-kitchen/contracts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(
  moduleDir,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "api",
  "db",
  "migrations",
);
const read = (file: string): string => readFileSync(path.join(migrationsDir, file), "utf8");

/** The route pattern as a regex, `:itemId` standing for one encoded path segment. */
function routeMatcher(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(":itemId", "([^/]+)");
  return new RegExp(`^${escaped}$`);
}

const LOCATIONS = ["FRIDGE", "FREEZER", "PANTRY", "OTHER"];

function names(list: string | undefined): string[] {
  return (list ?? "").split(",").map((entry) => entry.trim().replace(/'/g, ""));
}

describe("move an item between locations (M2-T6)", () => {
  it("the client path matches the server route with the item id in place", () => {
    const itemId = "0190f0a0-0000-7000-8000-000000000001";
    const match = routeMatcher(INVENTORY_ITEM_MOVE_ROUTE).exec(inventoryItemMovePath(itemId));
    expect(match?.[1]).toBe(itemId);
    expect(INVENTORY_ITEM_MOVE_ROUTE.startsWith(`${INVENTORY_ITEM_ROUTE}/`)).toBe(true);
  });

  it("a hostile item id stays inside its segment", () => {
    const hostile = "../../shopping/rows";
    const match = routeMatcher(INVENTORY_ITEM_MOVE_ROUTE).exec(inventoryItemMovePath(hostile));
    expect(match?.[1]).toBe(encodeURIComponent(hostile));
  });

  it("SAME_LOCATION is an API error code and not a ledger code", () => {
    expect(API_ERROR_CODES).toContain("SAME_LOCATION");
    expect(LEDGER_ERROR_CODES_DTO as readonly string[]).not.toContain("SAME_LOCATION");
  });

  it("the wire's location union and the domain's are the same set (compile-time, both directions)", () => {
    const toWire = (location: StorageLocation): StorageLocationDto => location;
    const toDomain = (location: StorageLocationDto): StorageLocation => location;
    expect(toWire("PANTRY")).toBe("PANTRY");
    expect(toDomain("OTHER")).toBe("OTHER");
  });

  it("the item CHECK (0003) and the move CHECKs (0011) list exactly the four locations", () => {
    const items = /storage_location\s+text CHECK \(storage_location IN \(([^)]*)\)\)/.exec(
      read("0003_inventory.sql"),
    );
    const moves = read("0011_inventory_item_moves.sql");
    const from = /from_location\s+text CHECK \(from_location IN \(([^)]*)\)\)/.exec(moves);
    const to = /to_location\s+text NOT NULL CHECK \(to_location IN \(([^)]*)\)\)/.exec(moves);
    expect(names(items?.[1])).toEqual(LOCATIONS);
    expect(names(from?.[1])).toEqual(LOCATIONS);
    expect(names(to?.[1])).toEqual(LOCATIONS);
  });

  it("MOVED is not a ledger transaction type, and the history union narrows on type", () => {
    expect(TRANSACTION_TYPES_DTO as readonly string[]).not.toContain("MOVED");
    expect(TRANSACTION_TYPES as readonly string[]).not.toContain("MOVED");

    const move: InventoryMoveEntryDto = {
      type: "MOVED",
      moveId: "m1",
      fromLocation: "FRIDGE",
      toLocation: "PANTRY",
      recordedAt: "2026-10-01T12:00:00.000Z",
      actor: { kind: "user", displayInitials: "DC" },
    };
    const entry: InventoryHistoryEntryDto = move;
    // Compile-time: only a ledger row has an amount, and only after narrowing.
    const amount = (e: InventoryHistoryEntryDto): string | null =>
      e.type === "MOVED" ? null : (e satisfies InventoryTransactionDto).amount;
    expect(amount(entry)).toBeNull();
    expect(Object.keys(move)).not.toContain("deltaMicros");
    expect(Object.keys(move)).not.toContain("amount");
  });

  it("migration 0011's client_key CHECK is the same key shape 0010 pins", () => {
    const pattern = /client_key\s+text NOT NULL CHECK \(client_key ~ '([^']+)'\)/;
    const moves = pattern.exec(read("0011_inventory_item_moves.sql"));
    const confirmations = pattern.exec(read("0010_inventory_confirmations.sql"));
    expect(moves?.[1]).toBe("^[A-Za-z0-9._-]{1,128}$");
    expect(moves?.[1]).toBe(confirmations?.[1]);
  });
});
