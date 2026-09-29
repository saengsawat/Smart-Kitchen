/**
 * Shopping fixture units-consistency check (M3-T5).
 *
 * `apps/mobile/src/shopping/fixture-shopping-list.json` is the Chen
 * household's fixture shopping list (BACKLOG.md M3-T5 Objective (h)). Every
 * row's `unit` must be one of the symbols
 * `packages/contracts/src/units.ts`'s `UNITS_BY_KIND_DTO` restricts S9's
 * manual-add unit picker to (Objective (i): "the unit list mirrors the
 * M1-T3 registry"), the same restriction
 * `units-contracts-consistency.test.ts` already proves against the real
 * domain registry — so a fixture row can never carry a unit S9 itself could
 * not accept.
 *
 * Reads the committed JSON directly via `node:fs` (same pattern
 * `screening-fixtures-consistency.test.ts` uses for
 * `apps/mobile/src/scan/fixtures/*.json`), not a package import: this
 * package does not depend on `apps/mobile`, and does not need to — a plain
 * JSON file needs no compile step to read.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UNITS_BY_KIND_DTO } from "@smart-kitchen/contracts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(moduleDir, "..", "..", "..", "..");
const fixturePath = path.join(
  repoRoot,
  "apps",
  "mobile",
  "src",
  "shopping",
  "fixture-shopping-list.json",
);

interface RawRow {
  readonly rowId: string;
  readonly unit: string;
}

interface RawList {
  readonly rows: readonly RawRow[];
}

function readFixture(): RawList {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as RawList;
}

const ALL_UNITS = new Set(Object.values(UNITS_BY_KIND_DTO).flat());

describe("apps/mobile/src/shopping/fixture-shopping-list.json units vs UNITS_BY_KIND_DTO", () => {
  it("has at least one row (the check below would vacuously pass on an empty list)", () => {
    expect(readFixture().rows.length).toBeGreaterThan(0);
  });

  it.each(readFixture().rows.map((row) => [row.rowId, row.unit] as const))(
    "%s: unit %s is one of UNITS_BY_KIND_DTO's symbols",
    (_rowId, unit) => {
      expect(ALL_UNITS.has(unit)).toBe(true);
    },
  );
});
