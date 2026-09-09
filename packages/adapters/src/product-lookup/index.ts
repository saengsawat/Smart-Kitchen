/**
 * Public API of the product-lookup module (M1-T5).
 *
 * Typical use:
 * ```ts
 * const products = new FixtureProductLookupPort();
 * const result = await products.resolve({ codeType: "UPC_A", code: "036000291452" });
 * if (result.status === "hit") console.log(result.product.name.value);
 * ```
 */

export { FixtureProductLookupPort } from "./fixture-product-lookup-port.js";
export { FixtureNutritionSourcePort } from "./fixture-nutrition-source-port.js";

export { codeKey, loadFixtureCatalog, resetFixtureCatalogCache } from "./fixture-loader.js";
export type { FixtureCatalog } from "./fixture-loader.js";

export {
  BARCODES_FIXTURES_DIR,
  BARCODES_MANIFEST_PATH,
  PRODUCTS_FIXTURES_DIR,
  REPO_ROOT,
} from "./fixture-paths.js";

export {
  gs1CheckDigit,
  validateBarcodeManifestEntry,
  validateCodeFormat,
  validateProductCode,
  validateProductFixture,
} from "./schema.js";
export type { BarcodeManifestEntry } from "./schema.js";

export { err, isAdapterError, ok } from "./errors.js";
export type { AdapterError, AdapterErrorCode, Outcome as AdapterOutcome } from "./errors.js";

export type {
  NutritionLookupResult,
  ProductLookupPort,
  ResolveResult,
  NutritionSourcePort,
} from "./ports.js";

export type {
  AllergenAssertionKind,
  AllergenTag,
  CodeType,
  FieldProvenance,
  NutritionBasis,
  NutritionProfile,
  NutritionValues,
  PackageSize,
  ProductCatalogItem,
  ProductCode,
  ProductKind,
  Provenanced,
  ProvenanceTier,
  ServingSize,
} from "./types.js";
