/**
 * The move route and repository's location list (M2-T6), without a database:
 * `STORAGE_LOCATIONS_DB` is the list the route's body schema and the stored-value
 * parser use, and it must be exactly what both migrations' CHECKs allow.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "../migrate.js";
import { parseStoredLocation, STORAGE_LOCATIONS_DB } from "./moves.js";
import { UnknownStoredValueError } from "./snapshot.js";

function checkList(file: string, column: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const match = new RegExp(
    `${column}\\s+text(?: NOT NULL)? CHECK \\(${column} IN \\(([^)]*)\\)\\)`,
  ).exec(sql);
  return (match?.[1] ?? "").split(",").map((entry) => entry.trim().replace(/'/g, ""));
}

describe("STORAGE_LOCATIONS_DB", () => {
  it("is exactly the list the 0003 item CHECK and the 0011 move CHECKs allow", () => {
    expect(checkList("0003_inventory.sql", "storage_location")).toEqual([...STORAGE_LOCATIONS_DB]);
    expect(checkList("0011_inventory_item_moves.sql", "from_location")).toEqual([
      ...STORAGE_LOCATIONS_DB,
    ]);
    expect(checkList("0011_inventory_item_moves.sql", "to_location")).toEqual([
      ...STORAGE_LOCATIONS_DB,
    ]);
  });
});

describe("parseStoredLocation", () => {
  it("passes null (an item with no location) and each of the four values through", () => {
    expect(parseStoredLocation("c", null)).toBeNull();
    for (const location of STORAGE_LOCATIONS_DB) {
      expect(parseStoredLocation("c", location)).toBe(location);
    }
  });

  it("refuses anything else rather than guessing", () => {
    expect(() => parseStoredLocation("c", "GARAGE")).toThrow(UnknownStoredValueError);
    expect(() => parseStoredLocation("c", "pantry")).toThrow(UnknownStoredValueError);
  });
});
