/**
 * Fixture-backed {@link NutritionSourcePort} — nutrition profiles are
 * carried directly on each `tests/fixtures/products` fixture, so this port
 * reads the same catalog as {@link FixtureProductLookupPort} rather than a
 * separate `tests/fixtures/nutrition` corpus (testing-strategy.md §3's
 * `nutrition/` directory is for source-profile-vs-expected-total fixtures,
 * a different concern — nutrition arithmetic tests, not lookup contract
 * tests — and is out of this ticket's scope).
 */

import { loadFixtureCatalog, codeKey } from "./fixture-loader.js";
import { validateCodeFormat } from "./schema.js";
import type { NutritionLookupResult, NutritionSourcePort } from "./ports.js";
import type { NutritionProfile, ProductCode } from "./types.js";

export class FixtureNutritionSourcePort implements NutritionSourcePort {
  byProductCode(code: ProductCode): Promise<NutritionLookupResult> {
    const formatProblem = validateCodeFormat(code);
    if (formatProblem) {
      return Promise.resolve({
        status: "error",
        error: { code: "INVALID_CODE", message: formatProblem.message, field: "code" },
      });
    }

    const catalog = loadFixtureCatalog();
    if (!catalog.ok) return Promise.resolve({ status: "error", error: catalog.error });

    const product = catalog.value.byCode.get(codeKey(code));
    if (!product || product.nutrition.length === 0) {
      return Promise.resolve({ status: "not-found" });
    }
    return Promise.resolve({ status: "hit", profiles: product.nutrition });
  }

  byIngredientSearch(query: string): Promise<NutritionLookupResult> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return Promise.resolve({
        status: "error",
        error: { code: "INVALID_QUERY", message: "query must not be empty" },
      });
    }

    const catalog = loadFixtureCatalog();
    if (!catalog.ok) return Promise.resolve({ status: "error", error: catalog.error });

    const needle = trimmed.toLowerCase();
    const profiles: NutritionProfile[] = [];
    for (const product of catalog.value.products) {
      const haystack = `${product.name.value} ${product.category?.value ?? ""}`.toLowerCase();
      if (haystack.includes(needle)) {
        profiles.push(...product.nutrition);
      }
    }
    if (profiles.length === 0) return Promise.resolve({ status: "not-found" });
    return Promise.resolve({ status: "hit", profiles });
  }
}
