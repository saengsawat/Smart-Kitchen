/**
 * Product-lookup contracts (M3-T4b): the wire shape of a barcode scan's
 * result, S8's confirm sheet payload.
 *
 * Shaped to accept `packages/adapters/src/product-lookup/types.ts`'s
 * `ProductCatalogItem`/`ResolveResult` data (that module's own doc comment:
 * "a future Open Food Facts / USDA FDC client adapter can map its wire shape
 * onto these types"), plus a `screening` field the adapter's own type does
 * not carry — allergen screening is a separate, server-side deterministic
 * step (M2-T3) that runs *against* a resolved product and this household's
 * members, so `ScannedProductDto` is the join of "what the catalog knows
 * about this product" and "what screening concluded for this household",
 * exactly what S8 renders as one sheet.
 *
 * **Exact quantities travel as decimal text, never a JSON number**
 * (packages/contracts/src/inventory.ts's rule 2, restated here): a package
 * size feeds S8's `count × packageSize` quantity math in exact micros
 * (CLAUDE.md rule 7), so {@link PackageSizeDto.qty} is decimal text parsed
 * with `BigInt`-based arithmetic, the same discipline as `QuantityDto.amount`.
 * Nutrition values (`NutritionValuesDto`) are a printed label's macro grid,
 * not inventory arithmetic the app performs on them — they stay plain
 * `number`s, mirroring the adapter's own `NutritionValues` shape.
 */

import type { FieldProvenanceDto } from "./inventory.js";
import type { ScreeningResultDto } from "./allergens.js";

/**
 * Barcode/PLU code formats (mirrors adapters' `CodeType`,
 * `packages/adapters/src/product-lookup/types.ts` — an adapter-owned type,
 * not a domain one, hand-mirrored here for the same "contracts stays
 * dependency-free" reason as every other list in this package).
 */
export const PRODUCT_CODE_TYPES_DTO = [
  "GTIN13",
  "GTIN14",
  "UPC_A",
  "EAN13",
  "EAN8",
  "PLU",
] as const;
export type ProductCodeTypeDto = (typeof PRODUCT_CODE_TYPES_DTO)[number];

/** expo-camera's `BarcodeScanningResult.type` values this app scans for (BACKLOG.md M3-T4b Objective (b)). */
export const SCANNABLE_BARCODE_TYPES_DTO = ["upc_a", "upc_e", "ean13", "ean8"] as const;
export type ScannableBarcodeTypeDto = (typeof SCANNABLE_BARCODE_TYPES_DTO)[number];

export interface ProductCodeDto {
  readonly codeType: ProductCodeTypeDto;
  readonly code: string;
}

/** A value plus the provenance of the field group it belongs to (mirrors adapters' `Provenanced<T>`). */
export interface ProvenancedDto<T> {
  readonly value: T;
  readonly provenance: FieldProvenanceDto;
}

/**
 * A package's printed size. `qty` is exact decimal text (e.g. `"16"`), not a
 * JSON number — see module doc comment. `unit` is the label's own free-form
 * unit string (`"oz"`, `"ct"`, …), mapped to a {@link UnitKindDto} (units.ts)
 * by the client before quantity math, never assumed to already be one of
 * this app's restricted unit symbols.
 */
export interface PackageSizeDto {
  readonly qty: string;
  readonly unit: string;
}

export interface NutritionValuesDto {
  readonly calories?: number;
  readonly proteinG?: number;
  readonly carbsG?: number;
  readonly fatG?: number;
  readonly fiberG?: number;
  readonly sugarG?: number;
  readonly sodiumMg?: number;
}

export type NutritionBasisDto = "PER_SERVING" | "PER_100G";

export interface NutritionProfileDto {
  readonly basis: NutritionBasisDto;
  readonly values: NutritionValuesDto;
  readonly provenance: FieldProvenanceDto;
}

/**
 * S8's product payload: identity, nutrition and allergen data, plus the
 * screening verdict already computed against this household. `bestBy` is
 * `null` when no shelf-life fact/estimate is on file (M8's expiry engine is
 * out of scope here, CLAUDE.md rule 3: this ticket never invents one where
 * the underlying record has none).
 */
export interface ScannedProductDto {
  readonly productId: string;
  readonly codes: readonly ProductCodeDto[];
  readonly name: ProvenancedDto<string>;
  readonly brand?: ProvenancedDto<string>;
  /**
   * Absent when the source gives no package size that parses cleanly into
   * the unit registry (M2-T4a: an Open Food Facts `quantity` such as
   * "48 fl oz" or "2 x 60 g"). Never defaulted, never guessed.
   */
  readonly packageSize?: ProvenancedDto<PackageSizeDto>;
  readonly nutrition: readonly NutritionProfileDto[];
  readonly ingredientsText?: ProvenancedDto<string>;
  readonly bestBy: ProvenancedDto<string> | null;
  readonly imageRef?: ProvenancedDto<string>;
  /**
   * Allergen screening for this household, already decided server-side.
   * Never computed client-side, and never inferred client-side either: the
   * client renders `NOT_RUN` only when the server says so (M2-T4a).
   */
  readonly screening: ScreeningOutcomeDto;
}

/** Outcome of a barcode/code lookup (mirrors adapters' `ResolveResult` shape, wire-safe). */
export type ProductLookupResultDto =
  | { readonly status: "hit"; readonly code: string; readonly product: ScannedProductDto }
  | { readonly status: "not-found"; readonly code: string }
  | { readonly status: "error"; readonly code: string; readonly message: string };

// ---------------------------------------------------------------------------
// M2-T4a: the screening outcome and the lookup route.
// ---------------------------------------------------------------------------

/**
 * Why screening did not run for a lookup. Until M2-T4 stores a household's
 * restrictions on the server there is nothing to screen against, so every
 * live lookup carries `HOUSEHOLD_RESTRICTIONS_NOT_STORED`. The list may grow
 * (an engine outage, say); copy-deck.md §3.3's `NOT_RUN` string stays
 * generic, so a new reason never needs new copy to render safely.
 */
export const SCREENING_NOT_RUN_REASONS_DTO = ["HOUSEHOLD_RESTRICTIONS_NOT_STORED"] as const;
export type ScreeningNotRunReasonDto = (typeof SCREENING_NOT_RUN_REASONS_DTO)[number];

/**
 * The allergen row's input on S8 (M2-T4a, D-025).
 *
 * `RUN` carries the engine's decided result, rendered as one of the three
 * verdicts. `NOT_RUN` is **not a verdict**: it says the check did not
 * happen, never that the product passed or failed it. The scan sheet renders
 * copy-deck.md §3.3's `NOT_RUN` string for it in neutral ink, and never
 * decides on its own that a check did not run.
 */
export type ScreeningOutcomeDto =
  | { readonly status: "RUN"; readonly result: ScreeningResultDto }
  | { readonly status: "NOT_RUN"; readonly reason: ScreeningNotRunReasonDto };

/**
 * `GET /v1/products/{code}` (M2-T4a): a barcode lookup for the caller's
 * household, any member. `code` is 8, 12, 13 or 14 digits; a 4 or 5 digit
 * produce code (PLU) is refused with 400 `PLU_NOT_SUPPORTED` and never sent
 * to a barcode source (ADR-006's settled sub-decision). The body is a
 * {@link ProductLookupResultDto} with HTTP 200 for all three outcomes;
 * `error` means the source could not answer (rate limited, unavailable,
 * timed out, or answered with something unreadable), which is never the
 * same thing as `not-found`.
 */
export const PRODUCT_LOOKUP_ROUTE = "/v1/products/:code";

/** The URL a client sends for {@link PRODUCT_LOOKUP_ROUTE}, with the code encoded. */
export function productLookupPath(code: string): string {
  return `/v1/products/${encodeURIComponent(code)}`;
}
