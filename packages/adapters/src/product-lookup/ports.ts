/**
 * `ProductLookupPort` / `NutritionSourcePort` — the port contracts named in
 * ai-architecture.md §3 (`ProductLookupPort resolve(code) → ProductRecord |
 * NotFound`, `NutritionSourcePort byProduct/byIngredient → NutritionProfile[]`).
 *
 * Every provider (this ticket's fixture adapter; a future Open Food Facts /
 * USDA FDC live adapter, M4) implements these same two interfaces — callers
 * never see which one they're talking to, and no vendor type crosses this
 * boundary (M1-T5 invariant).
 */

import type { AdapterError } from "./errors.js";
import type { NutritionProfile, ProductCatalogItem, ProductCode } from "./types.js";

/** Outcome of {@link ProductLookupPort.resolve}. */
export type ResolveResult =
  | { readonly status: "hit"; readonly code: ProductCode; readonly product: ProductCatalogItem }
  | { readonly status: "not-found"; readonly code: ProductCode }
  | { readonly status: "error"; readonly code: ProductCode; readonly error: AdapterError };

export interface ProductLookupPort {
  /**
   * Resolve a barcode/PLU code to a catalog record. Never throws — a
   * malformed code, a miss, and a read failure are all typed results, not
   * exceptions (see {@link ResolveResult}).
   */
  resolve(code: ProductCode): Promise<ResolveResult>;
}

/** Outcome of a {@link NutritionSourcePort} lookup. */
export type NutritionLookupResult =
  | { readonly status: "hit"; readonly profiles: readonly NutritionProfile[] }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly error: AdapterError };

export interface NutritionSourcePort {
  /** Nutrition profile(s) for a specific catalog product (by its code). */
  byProductCode(code: ProductCode): Promise<NutritionLookupResult>;
  /** Nutrition profile(s) for a generic ingredient concept (e.g. "banana", "chicken breast"), free-text search. */
  byIngredientSearch(query: string): Promise<NutritionLookupResult>;
}
