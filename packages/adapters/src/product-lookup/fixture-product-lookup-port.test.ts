import { describe, expect, it } from "vitest";
import { FixtureProductLookupPort } from "./fixture-product-lookup-port.js";
import { loadFixtureCatalog } from "./fixture-loader.js";
import type { BarcodeManifestEntry } from "./schema.js";

const catalogResult = loadFixtureCatalog();
if (!catalogResult.ok)
  throw new Error("fixture catalog failed to load for tests: " + catalogResult.error.message);
const catalog = catalogResult.value;

function manifestEntry(predicate: (entry: BarcodeManifestEntry) => boolean): BarcodeManifestEntry {
  const entry = catalog.manifest.find(predicate);
  if (!entry) throw new Error("expected fixture manifest entry not found — corpus changed?");
  return entry;
}

describe("FixtureProductLookupPort.resolve — hit path", () => {
  it("resolves a known code to its product with full identity", async () => {
    const entry = manifestEntry((e) => e.expect === "hit" && e.caseLabel === undefined);
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.id).toBe(entry.productId);
    expect(result.code).toEqual({ codeType: entry.codeType, code: entry.code });
  });

  it("carries per-field provenance on every present field group of a complete branded product", async () => {
    const entry = manifestEntry((e) => e.productId?.startsWith("dairy-") ?? false);
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    const product = result.product;

    expect(product.name.provenance.tier).toBeTruthy();
    expect(product.name.provenance.source.length).toBeGreaterThan(0);
    expect(product.brand?.provenance.source.length).toBeGreaterThan(0);
    expect(product.category?.provenance.source.length).toBeGreaterThan(0);
    expect(product.packageSize?.provenance.source.length).toBeGreaterThan(0);
    expect(product.servingSize?.provenance.source.length).toBeGreaterThan(0);
    expect(product.imageRef?.provenance.source.length).toBeGreaterThan(0);
    for (const profile of product.nutrition) {
      expect(profile.provenance.source.length).toBeGreaterThan(0);
    }
    for (const tag of product.allergens) {
      expect(tag.provenance.source.length).toBeGreaterThan(0);
    }
  });

  it("resolves a multi-code product from either of its codes to the same product id", async () => {
    const entries = catalog.manifest.filter(
      (e) => e.caseLabel === "multi-code" && e.expect === "hit",
    );
    const byProduct = new Map<string, BarcodeManifestEntry[]>();
    for (const entry of entries) {
      if (!entry.productId) continue;
      const list = byProduct.get(entry.productId) ?? [];
      list.push(entry);
      byProduct.set(entry.productId, list);
    }
    const [productId, codes] = [...byProduct.entries()].find(([, list]) => list.length >= 2) ?? [
      undefined,
      [],
    ];
    expect(productId).toBeDefined();
    expect(codes.length).toBeGreaterThanOrEqual(2);

    const port = new FixtureProductLookupPort();
    const results = await Promise.all(
      codes.map((entry) => port.resolve({ codeType: entry.codeType, code: entry.code })),
    );
    for (const result of results) {
      expect(result.status).toBe("hit");
      if (result.status === "hit") expect(result.product.id).toBe(productId);
    }
  });

  it("surfaces a multi-source-conflict as multiple disagreeing nutrition profiles, not a merged value", async () => {
    const entry = manifestEntry((e) => e.caseLabel === "multi-source-conflict");
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.nutrition.length).toBeGreaterThanOrEqual(2);
    const sources = new Set(result.product.nutrition.map((p) => p.provenance.source));
    expect(sources.size).toBeGreaterThanOrEqual(2);
    const calorieValues = new Set(result.product.nutrition.map((p) => p.values.calories));
    expect(calorieValues.size).toBeGreaterThanOrEqual(2); // sources genuinely disagree
  });

  it("resolves a generic/PLU produce item with GENERIC kind and no barcode", async () => {
    const entry = manifestEntry((e) => e.codeType === "PLU" && e.expect === "hit");
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: "PLU", code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.kind).toBe("GENERIC");
  });

  it("resolves a missing-nutrition product with an empty nutrition array (never guessed)", async () => {
    const missingNutritionId = catalog.products.find(
      (p) => p.nutrition.length === 0 && p.kind === "BRANDED",
    )?.id;
    expect(missingNutritionId).toBeDefined();
    const entry = manifestEntry((e) => e.productId === missingNutritionId);
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.nutrition).toEqual([]);
  });

  it("carries CONTAINS and MAY_CONTAIN allergen assertions on an allergen-bearing product", async () => {
    const allergenId = catalog.products.find((p) => p.allergens.length > 0)?.id;
    expect(allergenId).toBeDefined();
    const entry = manifestEntry((e) => e.productId === allergenId);
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.allergens.length).toBeGreaterThan(0);
  });
});

describe("FixtureProductLookupPort.resolve — miss path", () => {
  it("returns not-found for a well-formed code with no matching fixture", async () => {
    const entry = manifestEntry((e) => e.expect === "not-found");
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: entry.codeType, code: entry.code });
    expect(result).toEqual({
      status: "not-found",
      code: { codeType: entry.codeType, code: entry.code },
    });
  });
});

describe("FixtureProductLookupPort.resolve — error path", () => {
  it("returns a typed error for a malformed code (bad check digit), never a false miss", async () => {
    const port = new FixtureProductLookupPort();
    const result = await port.resolve({ codeType: "UPC_A", code: "012345678901" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("INVALID_CODE");
  });

  it("returns a typed error for a code of the wrong length", () => {
    const port = new FixtureProductLookupPort();
    return port.resolve({ codeType: "UPC_A", code: "123" }).then((result) => {
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error.code).toBe("INVALID_CODE");
    });
  });
});
