import { describe, expect, it } from "vitest";
import { codeKey, loadFixtureCatalog } from "./fixture-loader.js";
import { BARCODES_FIXTURES_DIR, PRODUCTS_FIXTURES_DIR, REPO_ROOT } from "./fixture-paths.js";

describe("fixture path resolution", () => {
  it("resolves fixture directories under the repo's tests/fixtures, not process.cwd()", () => {
    expect(PRODUCTS_FIXTURES_DIR.replace(/\\/g, "/")).toMatch(/tests\/fixtures\/products$/);
    expect(BARCODES_FIXTURES_DIR.replace(/\\/g, "/")).toMatch(/tests\/fixtures\/barcodes$/);
    expect(PRODUCTS_FIXTURES_DIR.startsWith(REPO_ROOT)).toBe(true);
  });
});

describe("loadFixtureCatalog", () => {
  it("loads the real fixture corpus without error", () => {
    const result = loadFixtureCatalog();
    expect(result.ok).toBe(true);
  });

  it("indexes every product by id and by each of its codes", () => {
    const result = loadFixtureCatalog();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.products.length).toBeGreaterThanOrEqual(90);
    for (const product of result.value.products) {
      expect(result.value.byId.get(product.id)).toBe(product);
      for (const code of product.codes) {
        expect(result.value.byCode.get(codeKey(code))).toBe(product);
      }
    }
  });

  it("loads a non-empty barcode manifest and cross-references resolve", () => {
    const result = loadFixtureCatalog();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.manifest.length).toBeGreaterThan(0);
    for (const entry of result.value.manifest) {
      if (entry.expect === "hit") {
        expect(entry.productId).toBeDefined();
        expect(result.value.byId.has(entry.productId as string)).toBe(true);
      }
    }
  });

  it("includes at least one entry of every required corpus case (testing-strategy.md §3)", () => {
    const result = loadFixtureCatalog();
    if (!result.ok) throw new Error(result.error.message);
    const cases = new Set(result.value.manifest.map((entry) => entry.caseLabel).filter(Boolean));
    expect(cases.has("multi-code")).toBe(true);
    expect(cases.has("multi-source-conflict")).toBe(true);
    expect(cases.has("generic-plu")).toBe(true);
    expect(cases.has("missing-nutrition")).toBe(true);
    expect(cases.has("miss")).toBe(true);
  });

  it("caches the catalog across calls (same reference)", () => {
    const first = loadFixtureCatalog();
    const second = loadFixtureCatalog();
    expect(first).toBe(second);
  });
});
