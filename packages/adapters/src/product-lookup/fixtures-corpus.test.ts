/**
 * Corpus-wide checks over the actual checked-in fixture files (as opposed to
 * `schema.test.ts`'s inline positive/negative cases, and
 * `fixture-loader.test.ts`'s loader-behavior checks). Reads directly from
 * `tests/fixtures/products` + `tests/fixtures/barcodes` — the only I/O this
 * suite performs, matching the module's own "no I/O outside the fixtures
 * dir" invariant.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BARCODES_MANIFEST_PATH, PRODUCTS_FIXTURES_DIR } from "./fixture-paths.js";
import { validateBarcodeManifestEntry, validateProductFixture } from "./schema.js";
import type { ProductCatalogItem } from "./types.js";

function loadAllProductFixtures(): { filename: string; product: ProductCatalogItem }[] {
  const filenames = readdirSync(PRODUCTS_FIXTURES_DIR).filter((name) => name.endsWith(".json"));
  return filenames.map((filename) => {
    const raw = JSON.parse(
      readFileSync(path.join(PRODUCTS_FIXTURES_DIR, filename), "utf8"),
    ) as unknown;
    const result = validateProductFixture(raw, filename);
    if (!result.ok)
      throw new Error(`${filename} failed schema validation: ${result.error.message}`);
    return { filename, product: result.value };
  });
}

describe("tests/fixtures/products corpus", () => {
  const all = loadAllProductFixtures();

  it("every fixture file validates against the product schema", () => {
    expect(all.length).toBeGreaterThan(0);
    // loadAllProductFixtures() above already throws on the first schema
    // failure; reaching this line means every file validated.
  });

  it("is approximately 100 curated products (testing-strategy.md §3)", () => {
    expect(all.length).toBeGreaterThanOrEqual(90);
    expect(all.length).toBeLessThanOrEqual(120);
  });

  it("spans every required case from testing-strategy.md §3", () => {
    const products = all.map((entry) => entry.product);

    const completeBranded = products.filter(
      (p) => p.kind === "BRANDED" && p.nutrition.length > 0 && p.brand && p.category,
    );
    const missingNutrition = products.filter((p) => p.nutrition.length === 0);
    const allergenBearing = products.filter((p) => p.allergens.length > 0);
    const multiCode = products.filter((p) => p.codes.length >= 2);
    const genericPlu = products.filter(
      (p) => p.kind === "GENERIC" && p.codes.some((c) => c.codeType === "PLU"),
    );

    expect(completeBranded.length).toBeGreaterThan(10);
    expect(missingNutrition.length).toBeGreaterThan(0);
    expect(allergenBearing.length).toBeGreaterThan(0);
    expect(multiCode.length).toBeGreaterThan(0);
    expect(genericPlu.length).toBeGreaterThan(0);
  });

  it("has a multi-source-conflict subset: products with 2+ disagreeing nutrition profiles", () => {
    const products = all.map((entry) => entry.product);
    const conflicts = products.filter((p) => p.nutrition.length >= 2);
    expect(conflicts.length).toBeGreaterThan(0);
    for (const product of conflicts) {
      const sources = new Set(product.nutrition.map((n) => n.provenance.source));
      expect(sources.size).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no duplicate product ids", () => {
    const ids = all.map((entry) => entry.product.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no code claimed by more than one product", () => {
    const seen = new Map<string, string>();
    for (const { product } of all) {
      for (const code of product.codes) {
        const key = `${code.codeType}:${code.code}`;
        const owner = seen.get(key);
        expect(
          owner,
          `code ${key} claimed by both ${String(owner)} and ${product.id}`,
        ).toBeUndefined();
        seen.set(key, product.id);
      }
    }
  });

  it("every product has at least a name and does not assert allergen-free by omission", () => {
    for (const { product } of all) {
      expect(product.name.value.length).toBeGreaterThan(0);
      // absence of `allergens` entries is asserted structurally never to mean
      // "safe" anywhere downstream — this fixture set simply never emits a
      // synthetic "NONE" assertion, since no such assertion kind exists on
      // AllergenTag (SR-2: absence-of-data != absence-of-allergen).
      for (const tag of product.allergens) {
        expect(["CONTAINS", "MAY_CONTAIN"]).toContain(tag.assertion);
      }
    }
  });
});

describe("tests/fixtures/barcodes/manifest.json", () => {
  it("validates against the manifest schema and references only existing products", () => {
    const raw = JSON.parse(readFileSync(BARCODES_MANIFEST_PATH, "utf8")) as unknown[];
    expect(Array.isArray(raw)).toBe(true);
    const ids = new Set(loadAllProductFixtures().map((entry) => entry.product.id));
    for (let i = 0; i < raw.length; i++) {
      const result = validateBarcodeManifestEntry(raw[i], `manifest[${String(i)}]`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      if (result.value.expect === "hit") {
        expect(ids.has(result.value.productId as string)).toBe(true);
      }
    }
  });

  it("includes both hit and not-found (miss) cases", () => {
    const raw = JSON.parse(readFileSync(BARCODES_MANIFEST_PATH, "utf8")) as { expect: string }[];
    expect(raw.some((entry) => entry.expect === "hit")).toBe(true);
    expect(raw.some((entry) => entry.expect === "not-found")).toBe(true);
  });
});
