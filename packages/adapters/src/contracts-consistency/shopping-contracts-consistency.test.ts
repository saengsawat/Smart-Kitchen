/**
 * Shopping contracts consistency (M7-T1 (h)).
 *
 * Three drifts this closes:
 *
 * 1. **Paths.** Each client path helper must produce a URL that the matching
 *    server route pattern matches, with the row id in the parameter's place
 *    and encoded, so the client and `apps/api/src/http/shopping-routes.ts`
 *    cannot disagree about where a write goes.
 * 2. **The new error code.** `ROW_HAS_NO_ITEM` is an `ApiErrorCode`, not a
 *    ledger code: it is the API's own refusal and the ledger never raises it.
 * 3. **Units.** Migration 0009's CHECK on `shopping_rows.unit` must list
 *    exactly the contract's `UNITS_BY_KIND_DTO` symbols, so the database can
 *    never hold a row unit S11 and S9 cannot draw, and a unit added to the
 *    contract is not silently refused by the database. Read from the
 *    committed SQL with `node:fs`, the same pattern the fixture checks use:
 *    this package does not depend on `apps/api`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  LEDGER_ERROR_CODES_DTO,
  SHOPPING_PATH,
  SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE,
  SHOPPING_ROW_CHECK_ROUTE,
  SHOPPING_ROW_REMOVE_ROUTE,
  UNITS_BY_KIND_DTO,
  shoppingRowAddToInventoryPath,
  shoppingRowCheckPath,
  shoppingRowRemovePath,
} from "@smart-kitchen/contracts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(moduleDir, "..", "..", "..", "..");
const migrationPath = path.join(
  repoRoot,
  "apps",
  "api",
  "db",
  "migrations",
  "0009_shopping_rows.sql",
);

/** The route pattern as a regex, `:rowId` standing for one encoded path segment. */
function routeMatcher(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(":rowId", "([^/]+)");
  return new RegExp(`^${escaped}$`);
}

describe("shopping paths (M7-T1)", () => {
  const rowId = "0190f0a0-0000-7000-8000-000000000001";
  const cases = [
    ["check", SHOPPING_ROW_CHECK_ROUTE, shoppingRowCheckPath],
    ["add-to-inventory", SHOPPING_ROW_ADD_TO_INVENTORY_ROUTE, shoppingRowAddToInventoryPath],
    ["remove", SHOPPING_ROW_REMOVE_ROUTE, shoppingRowRemovePath],
  ] as const;

  it.each(cases)(
    "%s: the client path matches the server route with the row id in place",
    (_n, route, build) => {
      const match = routeMatcher(route).exec(build(rowId));
      expect(match?.[1]).toBe(rowId);
      expect(route.startsWith(`${SHOPPING_PATH}/rows/`)).toBe(true);
    },
  );

  it.each(cases)("%s: a hostile row id stays inside its segment", (_n, route, build) => {
    const hostile = "../../inventory/items";
    const match = routeMatcher(route).exec(build(hostile));
    expect(match?.[1]).toBe(encodeURIComponent(hostile));
  });
});

describe("ROW_HAS_NO_ITEM (M7-T1)", () => {
  it("is an API error code and not a ledger code", () => {
    expect(API_ERROR_CODES).toContain("ROW_HAS_NO_ITEM");
    expect(LEDGER_ERROR_CODES_DTO as readonly string[]).not.toContain("ROW_HAS_NO_ITEM");
  });
});

describe("migration 0009 shopping_rows.unit CHECK vs UNITS_BY_KIND_DTO", () => {
  it("lists exactly the contract units", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const check = /CHECK \(unit IN \(([^)]*)\)\)/.exec(sql);
    expect(check, "0009 should carry a CHECK (unit IN (...))").not.toBeNull();
    const inMigration = (check?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/^'|'$/g, ""))
      .sort();
    const inContract = Object.values(UNITS_BY_KIND_DTO).flat().sort();
    expect(inMigration).toEqual(inContract);
  });
});
