/**
 * Schema validation for `tests/fixtures/products/**` and
 * `tests/fixtures/barcodes/**` — hand-rolled (no `zod`/`ajv`; CLAUDE.md rule
 * 11 requires justifying any new dependency, and this schema is small and
 * stable enough not to need one). Every fixture file is validated through
 * this module before the fixture-backed ports use it, and the same
 * validators are exercised directly by `schema.test.ts`'s negative cases.
 *
 * Rebuilds each value as a fresh object from only its declared fields
 * (mirrors `packages/domain/src/inventory/ledger.ts`'s `copyProvenance`
 * discipline) rather than casting the parsed JSON — a fixture with an extra
 * or mistyped field fails validation instead of silently passing through.
 *
 * Field reads use {@link field} (bracket access) throughout: parsed JSON is
 * typed `Record<string, unknown>` once confirmed to be a plain object, and
 * this repo's `tsconfig.base.json` sets `noPropertyAccessFromIndexSignature`,
 * which forbids dot access on an index-signature type.
 */

import { err, ok, type Outcome } from "./errors.js";
import type {
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

const CODE_TYPES: readonly CodeType[] = ["GTIN13", "UPC_A", "EAN13", "EAN8", "PLU"];
const PROVENANCE_TIERS: readonly ProvenanceTier[] = [
  "KNOWN_FACT",
  "ESTIMATED",
  "AI_INTERPRETATION",
];
const NUTRITION_BASES: readonly NutritionBasis[] = ["PER_SERVING", "PER_100G"];
const ALLERGEN_ASSERTIONS: readonly AllergenAssertionKind[] = ["CONTAINS", "MAY_CONTAIN"];
const PRODUCT_KINDS: readonly ProductKind[] = ["BRANDED", "GENERIC"];

/** Digit length for each fixed-length code type (`PLU` is variable, handled separately). */
const CODE_LENGTHS: Readonly<Record<"GTIN13" | "UPC_A" | "EAN13" | "EAN8", number>> = {
  GTIN13: 13,
  UPC_A: 12,
  EAN13: 13,
  EAN8: 8,
};

/**
 * GS1 mod-10 check digit — the same algorithm underlies EAN-8, UPC-A,
 * EAN-13, and GTIN-13 (they differ only in length): starting from the
 * rightmost digit of `digitsWithoutCheck`, alternate weights 3, 1, 3, 1, ...
 */
export function gs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  for (let i = 0; i < digitsWithoutCheck.length; i++) {
    const digit = Number(digitsWithoutCheck[digitsWithoutCheck.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Structural + check-digit validation of a code. Returns `null` when valid. */
export function validateCodeFormat(code: ProductCode): { message: string } | null {
  if (!CODE_TYPES.includes(code.codeType)) {
    return { message: `unknown codeType "${String(code.codeType)}"` };
  }
  if (code.codeType === "PLU") {
    return /^\d{4,5}$/.test(code.code)
      ? null
      : { message: `PLU code must be 4-5 digits, got "${code.code}"` };
  }
  const expectedLength = CODE_LENGTHS[code.codeType];
  if (!/^\d+$/.test(code.code) || code.code.length !== expectedLength) {
    return {
      message: `${code.codeType} must be exactly ${String(expectedLength)} numeric digits, got "${code.code}"`,
    };
  }
  const withoutCheck = code.code.slice(0, -1);
  const checkDigit = Number(code.code[code.code.length - 1]);
  if (gs1CheckDigit(withoutCheck) !== checkDigit) {
    return { message: `${code.codeType} "${code.code}" fails the GS1 check-digit test` };
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Bracket-notation field read, so callers never write `record.someField` on an index-signature type. */
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function fail<T>(path: string, message: string): Outcome<T> {
  return err("FIXTURE_SCHEMA_INVALID", `${path}: ${message}`, path);
}

function validateProvenance(raw: unknown, path: string): Outcome<FieldProvenance> {
  if (!isPlainObject(raw)) return fail(path, "must be an object");
  const tier = field(raw, "tier");
  const source = field(raw, "source");
  const observedAt = field(raw, "observedAt");
  const confidence = field(raw, "confidence");

  if (!PROVENANCE_TIERS.includes(tier as ProvenanceTier)) {
    return fail(`${path}.tier`, `must be one of ${PROVENANCE_TIERS.join(", ")}`);
  }
  if (!isNonEmptyString(source)) return fail(`${path}.source`, "must be a non-empty string");
  if (!isNonEmptyString(observedAt))
    return fail(`${path}.observedAt`, "must be a non-empty ISO instant string");
  if (Number.isNaN(Date.parse(observedAt))) {
    return fail(`${path}.observedAt`, `"${observedAt}" is not a parseable instant`);
  }
  if (
    confidence !== undefined &&
    (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1)
  ) {
    return fail(`${path}.confidence`, "must be a number between 0 and 1");
  }

  const provenance: FieldProvenance = {
    tier: tier as ProvenanceTier,
    source,
    observedAt,
    ...(confidence === undefined ? {} : { confidence }),
  };
  return ok(provenance);
}

function validateProvenanced<T>(
  raw: unknown,
  path: string,
  validateValue: (rawValue: unknown, valuePath: string) => Outcome<T>,
): Outcome<Provenanced<T>> {
  if (!isPlainObject(raw)) return fail(path, "must be an object with { value, provenance }");
  const value = validateValue(field(raw, "value"), `${path}.value`);
  if (!value.ok) return value;
  const provenance = validateProvenance(field(raw, "provenance"), `${path}.provenance`);
  if (!provenance.ok) return provenance;
  return ok({ value: value.value, provenance: provenance.value });
}

/**
 * `raw === undefined` is treated as "field group absent" and validates to
 * `ok(undefined)` rather than an error — most field groups on
 * {@link ProductCatalogItem} are optional. Deliberately a `const`-friendly
 * single-assignment helper (never `let` + conditional reassignment): that
 * pattern is what keeps the `.ok`-narrowed `.value` access below valid
 * without a type assertion.
 */
function validateOptionalProvenanced<T>(
  raw: unknown,
  path: string,
  validateValue: (rawValue: unknown, valuePath: string) => Outcome<T>,
): Outcome<Provenanced<T> | undefined> {
  if (raw === undefined) return ok(undefined);
  return validateProvenanced(raw, path, validateValue);
}

function validateString(raw: unknown, path: string): Outcome<string> {
  if (!isNonEmptyString(raw)) return fail(path, "must be a non-empty string");
  return ok(raw);
}

export function validateProductCode(raw: unknown, path: string): Outcome<ProductCode> {
  if (!isPlainObject(raw)) return fail(path, "must be an object with { codeType, code }");
  const codeType = field(raw, "codeType");
  const code = field(raw, "code");
  if (!CODE_TYPES.includes(codeType as CodeType)) {
    return fail(`${path}.codeType`, `must be one of ${CODE_TYPES.join(", ")}`);
  }
  if (!isNonEmptyString(code)) return fail(`${path}.code`, "must be a non-empty string");
  const candidate: ProductCode = { codeType: codeType as CodeType, code };
  const formatProblem = validateCodeFormat(candidate);
  if (formatProblem) return fail(`${path}.code`, formatProblem.message);
  return ok(candidate);
}

function validateQtyUnit<T extends { qty: number; unit: string }>(
  raw: unknown,
  path: string,
): Outcome<T> {
  if (!isPlainObject(raw)) return fail(path, "must be an object with { qty, unit }");
  const qty = field(raw, "qty");
  const unit = field(raw, "unit");
  if (!isFiniteNumber(qty) || qty <= 0)
    return fail(`${path}.qty`, "must be a positive finite number");
  if (!isNonEmptyString(unit)) return fail(`${path}.unit`, "must be a non-empty string");
  return ok({ qty, unit } as T);
}

const NUTRITION_VALUE_FIELDS: readonly (keyof NutritionValues)[] = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sugarG",
  "sodiumMg",
];

function validateNutritionValues(raw: unknown, path: string): Outcome<NutritionValues> {
  if (!isPlainObject(raw)) return fail(path, "must be an object");
  const values: Record<string, number> = {};
  for (const key of NUTRITION_VALUE_FIELDS) {
    const fieldValue = field(raw, key);
    if (fieldValue === undefined) continue;
    if (!isFiniteNumber(fieldValue) || fieldValue < 0) {
      return fail(`${path}.${key}`, "must be a non-negative finite number when present");
    }
    values[key] = fieldValue;
  }
  return ok(values as NutritionValues);
}

function validateNutritionProfile(raw: unknown, path: string): Outcome<NutritionProfile> {
  if (!isPlainObject(raw)) return fail(path, "must be an object");
  const basis = field(raw, "basis");
  if (!NUTRITION_BASES.includes(basis as NutritionBasis)) {
    return fail(`${path}.basis`, `must be one of ${NUTRITION_BASES.join(", ")}`);
  }
  const values = validateNutritionValues(field(raw, "values"), `${path}.values`);
  if (!values.ok) return values;
  const provenance = validateProvenance(field(raw, "provenance"), `${path}.provenance`);
  if (!provenance.ok) return provenance;
  return ok({ basis: basis as NutritionBasis, values: values.value, provenance: provenance.value });
}

function validateAllergenTag(raw: unknown, path: string): Outcome<AllergenTag> {
  if (!isPlainObject(raw)) return fail(path, "must be an object");
  const allergenCode = field(raw, "allergenCode");
  const assertion = field(raw, "assertion");
  if (!isNonEmptyString(allergenCode))
    return fail(`${path}.allergenCode`, "must be a non-empty string");
  if (!ALLERGEN_ASSERTIONS.includes(assertion as AllergenAssertionKind)) {
    return fail(`${path}.assertion`, `must be one of ${ALLERGEN_ASSERTIONS.join(", ")}`);
  }
  const provenance = validateProvenance(field(raw, "provenance"), `${path}.provenance`);
  if (!provenance.ok) return provenance;
  return ok({
    allergenCode,
    assertion: assertion as AllergenAssertionKind,
    provenance: provenance.value,
  });
}

function validateArray<T>(
  raw: unknown,
  path: string,
  validateItem: (rawItem: unknown, itemPath: string) => Outcome<T>,
): Outcome<readonly T[]> {
  if (!Array.isArray(raw)) return fail(path, "must be an array");
  const items: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = validateItem(raw[i], `${path}[${String(i)}]`);
    if (!item.ok) return item;
    items.push(item.value);
  }
  return ok(items);
}

/**
 * Validates a raw parsed-JSON value as a {@link ProductCatalogItem} fixture.
 * `label` is the file/source identifier used in error messages (not part of
 * the returned record).
 */
export function validateProductFixture(raw: unknown, label: string): Outcome<ProductCatalogItem> {
  if (!isPlainObject(raw)) return fail(label, "fixture must be a JSON object");

  const id = validateString(field(raw, "id"), `${label}.id`);
  if (!id.ok) return id;

  const kind = field(raw, "kind");
  if (!PRODUCT_KINDS.includes(kind as ProductKind)) {
    return fail(`${label}.kind`, `must be one of ${PRODUCT_KINDS.join(", ")}`);
  }

  const codes = validateArray(field(raw, "codes"), `${label}.codes`, validateProductCode);
  if (!codes.ok) return codes;
  if (codes.value.length === 0) return fail(`${label}.codes`, "must contain at least one code");

  const name = validateProvenanced(field(raw, "name"), `${label}.name`, validateString);
  if (!name.ok) return name;

  const brand = validateOptionalProvenanced(field(raw, "brand"), `${label}.brand`, validateString);
  if (!brand.ok) return brand;

  const category = validateOptionalProvenanced(
    field(raw, "category"),
    `${label}.category`,
    validateString,
  );
  if (!category.ok) return category;

  const packageSize = validateOptionalProvenanced<PackageSize>(
    field(raw, "packageSize"),
    `${label}.packageSize`,
    validateQtyUnit<PackageSize>,
  );
  if (!packageSize.ok) return packageSize;

  const servingSize = validateOptionalProvenanced<ServingSize>(
    field(raw, "servingSize"),
    `${label}.servingSize`,
    validateQtyUnit<ServingSize>,
  );
  if (!servingSize.ok) return servingSize;

  const nutrition = validateArray(
    field(raw, "nutrition"),
    `${label}.nutrition`,
    validateNutritionProfile,
  );
  if (!nutrition.ok) return nutrition;

  const ingredientsText = validateOptionalProvenanced(
    field(raw, "ingredientsText"),
    `${label}.ingredientsText`,
    validateString,
  );
  if (!ingredientsText.ok) return ingredientsText;

  const allergens = validateArray(
    field(raw, "allergens"),
    `${label}.allergens`,
    validateAllergenTag,
  );
  if (!allergens.ok) return allergens;

  const imageRef = validateOptionalProvenanced(
    field(raw, "imageRef"),
    `${label}.imageRef`,
    validateString,
  );
  if (!imageRef.ok) return imageRef;

  const item: ProductCatalogItem = {
    id: id.value,
    kind: kind as ProductKind,
    codes: codes.value,
    name: name.value,
    ...(brand.value !== undefined ? { brand: brand.value } : {}),
    ...(category.value !== undefined ? { category: category.value } : {}),
    ...(packageSize.value !== undefined ? { packageSize: packageSize.value } : {}),
    ...(servingSize.value !== undefined ? { servingSize: servingSize.value } : {}),
    nutrition: nutrition.value,
    ...(ingredientsText.value !== undefined ? { ingredientsText: ingredientsText.value } : {}),
    allergens: allergens.value,
    ...(imageRef.value !== undefined ? { imageRef: imageRef.value } : {}),
  };
  return ok(item);
}

/** One row of `tests/fixtures/barcodes/manifest.json`. */
export interface BarcodeManifestEntry {
  readonly code: string;
  readonly codeType: CodeType;
  readonly expect: "hit" | "not-found";
  /** Fixture `id` this code should resolve to; required when `expect` is `"hit"`. */
  readonly productId?: string;
  /** Test-categorization label, e.g. `"multi-code"`, `"multi-source-conflict"`, `"generic-plu"`. */
  readonly caseLabel?: string;
  readonly notes?: string;
}

export function validateBarcodeManifestEntry(
  raw: unknown,
  path: string,
): Outcome<BarcodeManifestEntry> {
  if (!isPlainObject(raw)) return fail(path, "must be an object");
  const code = field(raw, "code");
  const codeType = field(raw, "codeType");
  const expectField = field(raw, "expect");
  const productId = field(raw, "productId");
  const caseLabel = field(raw, "caseLabel");
  const notes = field(raw, "notes");

  if (!isNonEmptyString(code)) return fail(`${path}.code`, "must be a non-empty string");
  if (!CODE_TYPES.includes(codeType as CodeType)) {
    return fail(`${path}.codeType`, `must be one of ${CODE_TYPES.join(", ")}`);
  }
  const codeFormatProblem = validateCodeFormat({ codeType: codeType as CodeType, code });
  if (codeFormatProblem) return fail(`${path}.code`, codeFormatProblem.message);
  if (expectField !== "hit" && expectField !== "not-found") {
    return fail(`${path}.expect`, 'must be "hit" or "not-found"');
  }
  if (expectField === "hit" && !isNonEmptyString(productId)) {
    return fail(
      `${path}.productId`,
      'required and must be a non-empty string when expect is "hit"',
    );
  }
  if (productId !== undefined && !isNonEmptyString(productId)) {
    return fail(`${path}.productId`, "must be a non-empty string when present");
  }
  if (caseLabel !== undefined && !isNonEmptyString(caseLabel)) {
    return fail(`${path}.caseLabel`, "must be a non-empty string when present");
  }
  if (notes !== undefined && typeof notes !== "string") {
    return fail(`${path}.notes`, "must be a string when present");
  }
  const entry: BarcodeManifestEntry = {
    code,
    codeType: codeType as CodeType,
    expect: expectField,
    ...(productId !== undefined ? { productId } : {}),
    ...(caseLabel !== undefined ? { caseLabel } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
  return ok(entry);
}
