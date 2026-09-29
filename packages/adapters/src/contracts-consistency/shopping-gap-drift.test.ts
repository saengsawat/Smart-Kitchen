/**
 * Shopping gap-drift check (M3-T5 Objective (j), INV-SHOP-1).
 *
 * `apps/mobile/src/shopping/fixture-shopping-list.json`'s `buyMicros` is a
 * fixture-authored value, not a live server computation (M7 has not shipped
 * the real endpoint yet) — CLAUDE.md rule 7 still applies to a fixture: "the
 * client never computes a gap ... amounts are displayed from micros only",
 * which only holds if the fixture's own `buyMicros` values are themselves
 * exactly what the real domain gap function would produce. This test
 * recomputes every row's gap with the domain's actual `neededQuantity`
 * (`packages/domain/src/units/convert.ts`) from `needMicros`/`haveMicros`
 * and fails on any difference, so the fixture can never carry a
 * hand-invented gap that silently drifts from the domain's own math.
 *
 * Reads the committed JSON directly via `node:fs` (this package does not
 * depend on `apps/mobile`), the same pattern
 * `shopping-units-consistency.test.ts` and `screening-fixtures-consistency.
 * test.ts` use.
 *
 * A `status: "skipped"` row's `buyMicros` must be `"0"` by the same
 * `neededQuantity` clamp every other row uses (never a separately-invented
 * "already have" rule): `needMicros <= haveMicros` for every skip row in
 * this fixture, which this test also proves rather than assumes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { neededQuantity } from "@smart-kitchen/domain";

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
  readonly needMicros: string;
  readonly haveMicros: string;
  readonly buyMicros: string;
  readonly unit: string;
  readonly status: "open" | "done" | "skipped";
}

interface RawList {
  readonly rows: readonly RawRow[];
}

function readFixture(): RawList {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as RawList;
}

describe("apps/mobile/src/shopping/fixture-shopping-list.json buyMicros vs the domain's neededQuantity", () => {
  it.each(readFixture().rows.map((row) => [row.rowId, row] as const))(
    "%s: committed buyMicros equals a fresh neededQuantity(need, have) in the row's own unit",
    (_rowId, row) => {
      const result = neededQuantity(
        BigInt(row.needMicros),
        row.unit,
        BigInt(row.haveMicros),
        row.unit,
      );
      expect(result.ok, `neededQuantity should resolve unit "${row.unit}"`).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.micros).toBe(BigInt(row.buyMicros));
    },
  );

  it("every skipped row's committed buyMicros is 0 (need already covered by have)", () => {
    const skipped = readFixture().rows.filter((row) => row.status === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    for (const row of skipped) {
      expect(BigInt(row.buyMicros)).toBe(0n);
    }
  });
});
