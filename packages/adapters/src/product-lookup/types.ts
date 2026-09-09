/**
 * Product-lookup record types (M1-T5).
 *
 * Shaped to align with `docs/architecture/domain-model.md` §2's
 * `ProductCatalogItem` / `NutritionProfile` / `AllergenAssertion` entities,
 * but these are **adapter-owned** types, not domain types: `packages/domain`
 * does not yet have a product-catalog module (that lands with the schema in
 * M1-T2 / the catalog-merge work in M4), and `packages/contracts` is
 * explicitly out of scope for this ticket. Nothing here is a vendor SDK
 * type — every field is redefined in this module's own vocabulary, so a
 * future Open Food Facts / USDA FDC client adapter can map its wire shape
 * onto these types without leaking that wire shape through the port.
 *
 * Provenance is per field-group (not one blanket provenance for the whole
 * record): different fields of the same product legitimately come from
 * different upstream sources with different trust levels (ai-architecture.md
 * §3: "per-field tiers where sources disagree"), and domain-model.md
 * principle 3 requires provenance "everywhere facts can be wrong."
 */

/** Confidence tier of a recorded fact (mirrors domain-model.md §1 principle 3 / ADR-008's `ProvenanceTier`). */
export type ProvenanceTier = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/**
 * Per-field-group provenance, exactly the shape named in BACKLOG.md M1-T5:
 * `{tier, source, observedAt, confidence?}`. Deliberately narrower than the
 * domain ledger's `Provenance` (no `modelRef`/`confirmedBy` — those describe
 * *confirmation into ledger state*, which is out of this port's scope; a
 * product-catalog row is not itself a ledger transaction).
 */
export interface FieldProvenance {
  readonly tier: ProvenanceTier;
  /** Stable identifier of the origin, e.g. `fixture`, `open-food-facts`, `usda-fdc:12345`. */
  readonly source: string;
  /** When this field's value was observed/fetched from its source. */
  readonly observedAt: string;
  /** 0..1, probabilistic sources only (e.g. AI_INTERPRETATION fuzzy matches). */
  readonly confidence?: number;
}

/** A value with the provenance of the field group it belongs to. */
export interface Provenanced<T> {
  readonly value: T;
  readonly provenance: FieldProvenance;
}

/** Barcode/PLU code formats this port understands. PLU = produce lookup code (no barcode). */
export type CodeType = "GTIN13" | "UPC_A" | "EAN13" | "EAN8" | "PLU";

export interface ProductCode {
  readonly codeType: CodeType;
  readonly code: string;
}

export interface PackageSize {
  readonly qty: number;
  /** Free-form unit string (e.g. `oz`, `g`, `ct`) — pass-through here, not `packages/domain/units`'s `Unit`. */
  readonly unit: string;
}

export interface ServingSize {
  readonly qty: number;
  readonly unit: string;
}

/** Basis a `NutritionProfile`'s values are expressed on. */
export type NutritionBasis = "PER_SERVING" | "PER_100G";

export interface NutritionValues {
  readonly calories?: number;
  readonly proteinG?: number;
  readonly carbsG?: number;
  readonly fatG?: number;
  readonly fiberG?: number;
  readonly sugarG?: number;
  readonly sodiumMg?: number;
}

/**
 * One source's nutrition claim for a product/ingredient. A resolved product
 * may carry **more than one** `NutritionProfile` when upstream sources
 * disagree — that disagreement is surfaced as data (two profiles, two
 * provenances), never silently merged into one number. Merging/reconciling
 * into a single authoritative value is explicitly out of this ticket's scope
 * (BACKLOG.md M1-T5: "our-catalog merge logic (M4)").
 */
export interface NutritionProfile {
  readonly basis: NutritionBasis;
  readonly values: NutritionValues;
  readonly provenance: FieldProvenance;
}

/** Assertion kind for an allergen tag (never "safe" — absence of a tag is not absence of the allergen, SR-2). */
export type AllergenAssertionKind = "CONTAINS" | "MAY_CONTAIN";

/**
 * One source's allergen claim. `allergenCode` is a free string here
 * (the FDA-major-allergen taxonomy itself is `packages/domain`'s allergen
 * module, M1-T4 — not yet built, and not this ticket's concern) but fixture
 * values are drawn from the FDA's 9 major allergens for realism: milk, egg,
 * fish, shellfish, tree_nut, peanut, wheat, soy, sesame.
 */
export interface AllergenTag {
  readonly allergenCode: string;
  readonly assertion: AllergenAssertionKind;
  readonly provenance: FieldProvenance;
}

/**
 * Whether a catalog row is a branded product (has a package barcode) or a
 * generic/PLU item (produce, bulk bins — no barcode, identified by name/PLU).
 */
export type ProductKind = "BRANDED" | "GENERIC";

/**
 * A normalized product-catalog record. Aligns with domain-model.md's
 * `ProductCatalogItem` field list (name, brand, category, package qty/unit,
 * serving, nutrition, ingredients text, allergen tags, image ref, code+type)
 * plus `codes` as an array (`ProductIdentifier`: "one product may have
 * several codes").
 */
export interface ProductCatalogItem {
  /** Adapter/fixture-local identifier — not a vendor id, ours to assign. */
  readonly id: string;
  readonly kind: ProductKind;
  /** Every code this product is known to resolve from (multi-code products carry 2+). */
  readonly codes: readonly ProductCode[];
  readonly name: Provenanced<string>;
  readonly brand?: Provenanced<string>;
  readonly category?: Provenanced<string>;
  readonly packageSize?: Provenanced<PackageSize>;
  readonly servingSize?: Provenanced<ServingSize>;
  /** Absent/empty = no nutrition data known (an ESTIMATED/omitted case downstream, never guessed — SR-3). */
  readonly nutrition: readonly NutritionProfile[];
  readonly ingredientsText?: Provenanced<string>;
  /** Absent/empty here means *no assertion on file*, not "allergen-free" — SR-2, never asserted by this adapter. */
  readonly allergens: readonly AllergenTag[];
  readonly imageRef?: Provenanced<string>;
}
