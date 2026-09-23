/**
 * Screening-fixture consistency check (M3-T4b review fix, root cause
 * F1/F2/F3): proves `apps/mobile/src/scan/fixtures/*.json` — the committed
 * output of `packages/adapters/scripts/gen-screening-fixtures.mjs` — is
 * exactly what the real `screenSubject` engine produces today, run over the
 * exact corpus records and the exact Chen household
 * (`apps/mobile/src/household/fixture-restrictions.json`) those fixtures
 * are supposed to represent.
 *
 * This regenerates in memory (via {@link generateScreeningFixtures}, the
 * same function the script's CLI entry point calls to write the committed
 * files — one implementation, not two that could independently drift) and
 * asserts deep equality against the committed JSON. If anyone hand-edits a
 * committed fixture file, or the corpus/household/engine changes without
 * re-running the generator, this test fails the build rather than let a
 * stale or hand-tweaked verdict ship silently — the exact failure mode the
 * review found in this ticket's first pass.
 *
 * Imports the `.mjs` script directly (a plain ESM module, no TypeScript
 * syntax, so vitest's transform loads it like any other source file) rather
 * than re-implementing the generation logic here.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_PRODUCTS,
  generateManifest,
  generateScreeningFixtures,
} from "../../../adapters/scripts/gen-screening-fixtures.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(moduleDir, "..", "..", "..", "..");
const fixturesDir = path.join(repoRoot, "apps", "mobile", "src", "scan", "fixtures");

function readCommittedJson(fileName: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, fileName), "utf8")) as unknown;
}

describe("apps/mobile/src/scan/fixtures/*.json matches the real engine, regenerated in memory", () => {
  it("generates the same set of product ids the committed directory holds (no stale/orphaned file, none missing)", () => {
    const generated = generateScreeningFixtures();
    const committedFiles = readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(committedFiles).toEqual([...Object.keys(generated)].sort());
  });

  it.each(FIXTURE_PRODUCTS.map((p) => p.productId))(
    "%s: committed JSON deep-equals a fresh regeneration",
    (productId) => {
      const fresh = generateScreeningFixtures()[productId];
      const committed = readCommittedJson(`${productId}.json`);
      expect(committed).toEqual(fresh);
    },
  );

  it("the committed manifest.json matches a fresh regeneration", () => {
    const committed = readCommittedJson("manifest.json");
    expect(committed).toEqual(generateManifest());
  });

  it("no corpus record used here carries an AllergenDeclaration (D-017 gate b is open) — every verdict is BLOCKED or ALLOWED_WITH_UNKNOWNS, never ALLOWED", () => {
    const generated = generateScreeningFixtures();
    for (const [productId, product] of Object.entries(generated)) {
      expect(
        product.screening.verdict === "BLOCKED" ||
          product.screening.verdict === "ALLOWED_WITH_UNKNOWNS",
        `${productId} screened ${product.screening.verdict}; expected BLOCKED or ALLOWED_WITH_UNKNOWNS ` +
          `since no corpus record carries an AllergenDeclaration yet`,
      ).toBe(true);
    }
  });
});
