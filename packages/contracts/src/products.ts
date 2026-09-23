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
export const PRODUCT_CODE_TYPES_DTO = ["GTIN13", "UPC_A", "EAN13", "EAN8", "PLU"] as const;
export type ProductCodeTypeDto = (typeof PRODUCT_CODE_TYPES_DTO)[number];

/** expo-camera's `BarcodeScanningResult.type` values this app scans for (BACKLOG.md M3-T4b Objective (b)). */
export const SCANNABLE_BARCODE_TYPES_DTO = ["upc_a", "ean13", "ean8"] as const;
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
  readonly packageSize: ProvenancedDto<PackageSizeDto>;
  readonly nutrition: readonly NutritionProfileDto[];
  readonly ingredientsText?: ProvenancedDto<string>;
  readonly bestBy: ProvenancedDto<string> | null;
  readonly imageRef?: ProvenancedDto<string>;
  /** Allergen screening for this household, already decided server-side (fixture today, M2-T3 later). Never computed client-side. */
  readonly screening: ScreeningResultDto;
}

/** Outcome of a barcode/code lookup (mirrors adapters' `ResolveResult` shape, wire-safe). */
export type ProductLookupResultDto =
  | { readonly status: "hit"; readonly code: string; readonly product: ScannedProductDto }
  | { readonly status: "not-found"; readonly code: string }
  | { readonly status: "error"; readonly code: string; readonly message: string };
