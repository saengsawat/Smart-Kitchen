/**
 * OFF v2 product response -> `ProductCatalogItem` (M2-T4a (a) outcome
 * mapping and (b) field mapping). Pure: no I/O, no clock, so every rule
 * here is tested against the recorded fixtures in `tests/fixtures/off/`.
 *
 * ## Outcome mapping (never guess "not found")
 *
 * | OFF answered | Result |
 * | --- | --- |
 * | 200, JSON, `status: 1`, a `product` object with a name | `hit` |
 * | 200 or 404, JSON, `status: 0` | `not-found` (the code is kept, S7 renders it) |
 * | 200, JSON, `status: 1`, no usable `product_name` but a usable `product_name_en` | `hit`, named from `product_name_en` |
 * | 200, JSON, `status: 1`, product without a usable `product_name` or `product_name_en` | `not-found`, see below |
 * | 404 whose body is not OFF's JSON miss | `error` `UPSTREAM_MALFORMED` (a wrong base URL must not look like "every product is missing") |
 * | 429 | `error` `UPSTREAM_RATE_LIMITED` |
 * | 5xx | `error` `UPSTREAM_UNAVAILABLE` |
 * | any other 4xx, a 3xx that was not followed | `error` `UPSTREAM_REJECTED` |
 * | not JSON, wrong shape, a `code` that names a different product | `error` `UPSTREAM_MALFORMED` |
 *
 * A record OFF has but with no usable name in either `product_name` or the
 * `product_name_en` fallback (M2-T4b (c)) is answered `not-found`: the scan
 * sheet has nothing to put in its header, the S7 miss path already keeps the
 * code and hands off to manual add, and inventing a name is not an option
 * (the item-level decision is recorded in the worker report).
 *
 * ## Tier policy (D-025)
 *
 * The code match is the only Known Fact, and it is not a field of the
 * record: it is the fact that OFF answered for this code, which the scan
 * sheet shows as its identity chip. **Every field below is `ESTIMATED`**
 * with source `open-food-facts` and `observedAt` from `last_modified_t`
 * (the fetch time when OFF sends none). No `AllergenDeclaration` is ever
 * produced from OFF data, so the engine can never reach `ALLOWED` on an OFF
 * record alone (D-017). A field OFF does not send is absent, never defaulted.
 */

import type { AdapterError } from "../errors.js";
import type {
  AllergenTag,
  FieldProvenance,
  NutritionProfile,
  NutritionValues,
  ProductCatalogItem,
  ProductCode,
  Provenanced,
} from "../types.js";
import { offAllergenCodesFor } from "./allergen-tag-map.js";
import { OFF_MAX_BODY_CHARS } from "./config.js";
import { parseOffQuantity } from "./parse-quantity.js";

/** The provenance source every OFF-derived field carries. */
export const OFF_SOURCE = "open-food-facts";

export type OffMappedOutcome =
  | { readonly status: "hit"; readonly product: ProductCatalogItem }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly error: AdapterError };

export interface OffHttpAnswer {
  readonly httpStatus: number;
  readonly bodyText: string;
}

function fail(code: AdapterError["code"], message: string): OffMappedOutcome {
  return { status: "error", error: { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (text.length > OFF_MAX_BODY_CHARS) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Two GTINs name the same product when they differ only in leading zeros (OFF normalizes 9 to 12 digit codes to 13). */
export function sameGtin(a: string, b: string): boolean {
  return a.replace(/^0+/, "") === b.replace(/^0+/, "");
}

/** Maps one HTTP answer from `GET /api/v2/product/{code}.json` for the code that was asked. */
export function mapOffAnswer(
  answer: OffHttpAnswer,
  requested: ProductCode,
  fetchedAt: string,
): OffMappedOutcome {
  const { httpStatus } = answer;
  if (httpStatus === 429) return fail("UPSTREAM_RATE_LIMITED", "Open Food Facts answered 429");
  if (httpStatus >= 500)
    return fail("UPSTREAM_UNAVAILABLE", `Open Food Facts answered ${String(httpStatus)}`);
  if (httpStatus !== 200 && httpStatus !== 404) {
    return fail("UPSTREAM_REJECTED", `Open Food Facts answered ${String(httpStatus)}`);
  }

  const parsed = parseJson(answer.bodyText);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return fail(
      "UPSTREAM_MALFORMED",
      `Open Food Facts answered ${String(httpStatus)} without a JSON object`,
    );
  }
  const body = parsed.value;
  const code = body["code"];
  if (code !== undefined && (typeof code !== "string" || !sameGtin(code, requested.code))) {
    return fail("UPSTREAM_MALFORMED", "Open Food Facts answered for a different code");
  }

  const status = body["status"];
  if (status === 0) return { status: "not-found" };
  if (httpStatus === 404) {
    return fail(
      "UPSTREAM_MALFORMED",
      "Open Food Facts answered 404 without its product-not-found body",
    );
  }
  if (status !== 1 || !isPlainObject(body["product"])) {
    return fail("UPSTREAM_MALFORMED", "Open Food Facts answered 200 without a product");
  }
  return mapOffProduct(body["product"], requested, fetchedAt);
}

/** Maps the `product` object of a `status: 1` answer. */
export function mapOffProduct(
  product: Record<string, unknown>,
  requested: ProductCode,
  fetchedAt: string,
): OffMappedOutcome {
  const productCode = product["code"];
  if (
    productCode !== undefined &&
    (typeof productCode !== "string" || !sameGtin(productCode, requested.code))
  ) {
    return fail("UPSTREAM_MALFORMED", "Open Food Facts product names a different code");
  }
  const allergensRaw = product["allergens_tags"];
  const tracesRaw = product["traces_tags"];
  if (
    (allergensRaw !== undefined && !Array.isArray(allergensRaw)) ||
    (tracesRaw !== undefined && !Array.isArray(tracesRaw))
  ) {
    // An allergen field in a shape OFF does not document is not "no allergens"
    // and not something to half-read either: the whole answer is refused.
    return fail("UPSTREAM_MALFORMED", "Open Food Facts allergen tags are not arrays");
  }

  // M2-T4b (c): product_name_en is a fallback, tried only when the record's
  // own product_name is unusable (absent, blank, or non-string) — never
  // preferred over a genuine main-language name.
  const name = nonEmptyText(product["product_name"]) ?? nonEmptyText(product["product_name_en"]);
  if (name === undefined) return { status: "not-found" };

  const provenance: FieldProvenance = {
    tier: "ESTIMATED",
    source: OFF_SOURCE,
    observedAt: observedAtFrom(product["last_modified_t"], fetchedAt),
  };
  const estimated = <T>(value: T): Provenanced<T> => ({ value, provenance });

  const brand = nonEmptyText(product["brands"]);
  const category = mostSpecificCategory(product["categories_tags"]);
  const packageSize = parseOffQuantity(product["quantity"]);
  const servingSize = parseOffQuantity(product["serving_size"]);
  const ingredientsText = nonEmptyText(product["ingredients_text"]);
  const imageRef = httpsUrl(product["image_front_url"]);

  const allergens: AllergenTag[] = [
    ...(allergensRaw ?? []).flatMap((tag: unknown): AllergenTag[] =>
      offAllergenCodesFor(tag).map((allergenCode) => ({
        allergenCode,
        assertion: "CONTAINS",
        provenance,
      })),
    ),
    ...(tracesRaw ?? []).flatMap((tag: unknown): AllergenTag[] =>
      offAllergenCodesFor(tag).map((allergenCode) => ({
        allergenCode,
        assertion: "MAY_CONTAIN",
        provenance,
      })),
    ),
  ];

  const item: ProductCatalogItem = {
    id: requested.code,
    kind: "BRANDED",
    codes: [{ codeType: requested.codeType, code: requested.code }],
    name: estimated(name),
    ...(brand === undefined ? {} : { brand: estimated(brand) }),
    ...(category === undefined ? {} : { category: estimated(category) }),
    ...(packageSize === undefined ? {} : { packageSize: estimated(packageSize) }),
    ...(servingSize === undefined ? {} : { servingSize: estimated(servingSize) }),
    nutrition: nutritionProfiles(product["nutriments"], provenance, product["nutrition_data_per"]),
    ...(ingredientsText === undefined ? {} : { ingredientsText: estimated(ingredientsText) }),
    allergens,
    ...(imageRef === undefined ? {} : { imageRef: estimated(imageRef) }),
  };
  return { status: "hit", product: item };
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function httpsUrl(value: unknown): string | undefined {
  const text = nonEmptyText(value);
  return text !== undefined && text.startsWith("https://") ? text : undefined;
}

/** `last_modified_t` is Unix seconds (OFF v2 schema, `product_meta.yaml`). */
function observedAtFrom(value: unknown, fetchedAt: string): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fetchedAt;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? fetchedAt : date.toISOString();
}

/**
 * The last well-formed `en:` tag of `categories_tags` (OFF lists categories
 * from general to specific), kept as the tag itself. Contributor text that
 * OFF did not normalize (`en:Pâtes à tartiner`) is skipped, not cleaned up.
 */
function mostSpecificCategory(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (let i = value.length - 1; i >= 0; i--) {
    const tag: unknown = value[i];
    if (typeof tag === "string" && /^en:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) return tag;
  }
  return undefined;
}

/**
 * OFF nutrient keys per basis. `_100g` and `_serving` values are OFF's
 * normalized figures (grams for masses, kcal for `energy-kcal`), the ones
 * its schema says to use. Sodium arrives in grams and is shifted to
 * milligrams by moving the decimal point, never by float multiplication.
 * A value that is not a finite, non-negative JSON number is left out.
 */
const NUTRIENT_KEYS: readonly (readonly [keyof NutritionValues, string, "g" | "mg" | "kcal"])[] = [
  ["calories", "energy-kcal", "kcal"],
  ["proteinG", "proteins", "g"],
  ["carbsG", "carbohydrates", "g"],
  ["fatG", "fat", "g"],
  ["fiberG", "fiber", "g"],
  ["sugarG", "sugars", "g"],
  ["sodiumMg", "sodium", "mg"],
];

/**
 * M3-T4e (c), ADR-006 open item: OFF reuses the `_100g` nutriment suffix for
 * both mass-based and volume-based products, so `_100g`'s values are per
 * 100 ml, not per 100 g, whenever `nutrition_data_per` says so. Until the
 * contracts basis enum grows a `PER_100ML` (out of this ticket's scope,
 * `packages/contracts/src/products.ts`), a per-100-ml record gets no
 * `PER_100G` profile at all — absence is honest, a wrong label is not. Only
 * an exact `"100g"` licenses the `PER_100G` profile; anything else
 * (`"100ml"`, `"serving"`, an unrecognised value, or the field being absent
 * entirely) suppresses it. `_serving` values are never ambiguous this way
 * (a serving is a fixed amount in the record's own unit) and are unaffected.
 */
function nutritionProfiles(
  value: unknown,
  provenance: FieldProvenance,
  nutritionDataPer: unknown,
): NutritionProfile[] {
  if (!isPlainObject(value)) return [];
  const profiles: NutritionProfile[] = [];
  for (const [basis, suffix] of [
    ["PER_100G", "_100g"],
    ["PER_SERVING", "_serving"],
  ] as const) {
    if (basis === "PER_100G" && nutritionDataPer !== "100g") continue;
    const values: { -readonly [K in keyof NutritionValues]?: number } = {};
    let any = false;
    for (const [field, nutrient, unit] of NUTRIENT_KEYS) {
      const raw = value[`${nutrient}${suffix}`];
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
      values[field] = unit === "mg" ? gramsToMilligrams(raw) : raw;
      any = true;
    }
    if (any) profiles.push({ basis, values, provenance });
  }
  return profiles;
}

/**
 * Grams to milligrams by shifting the decimal point three places in the
 * number's own shortest decimal text (`0.365384615384615` -> `365.384615384615`),
 * so the result is the label figure scaled, not a float product with a
 * rounding tail. Exponent-form input (tiny values) falls back to a
 * 15-significant-digit product.
 */
export function gramsToMilligrams(grams: number): number {
  const text = String(grams);
  if (/e/i.test(text)) return Number((grams * 1000).toPrecision(15));
  const [whole = "0", fraction = ""] = text.split(".");
  const padded = fraction.padEnd(3, "0");
  const shiftedWhole = `${whole}${padded.slice(0, 3)}`.replace(/^0+(?=\d)/, "");
  const rest = padded.slice(3);
  return Number(rest === "" ? shiftedWhole : `${shiftedWhole}.${rest}`);
}
