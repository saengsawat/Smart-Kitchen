/**
 * M2-T4a consistency checks: the OFF allergen tag map against the domain
 * taxonomy, and the product-lookup contracts (route constant, path helper,
 * `NOT_RUN` reasons, the PLU refusal code).
 */

import {
  API_ERROR_CODES,
  MAJOR_ALLERGEN_CODES_DTO,
  PRODUCT_LOOKUP_ROUTE,
  SCANNABLE_BARCODE_TYPES_DTO,
  SCREENING_NOT_RUN_REASONS_DTO,
  productLookupPath,
  type ScreeningOutcomeDto,
} from "@smart-kitchen/contracts";
import { MAJOR_ALLERGEN_CODES, normalizeAllergenCode } from "@smart-kitchen/domain";
import { describe, expect, it } from "vitest";
import {
  OFF_ALLERGEN_TAG_MAP,
  mapOffAllergenTag,
} from "../product-lookup/open-food-facts/allergen-tag-map.js";

const mapEntries = Object.entries(OFF_ALLERGEN_TAG_MAP);

describe("OFF allergen tag map vs the domain taxonomy", () => {
  it("every mapped value is one of the nine domain codes (and the contracts mirror)", () => {
    for (const [tag, code] of mapEntries) {
      expect(MAJOR_ALLERGEN_CODES, tag).toContain(code);
      expect(MAJOR_ALLERGEN_CODES_DTO, tag).toContain(code);
    }
  });

  it("every key is an `en:` tag id", () => {
    for (const [tag] of mapEntries) expect(tag).toMatch(/^en:[a-z]+(?:-[a-z]+)*$/);
  });

  it("is exactly this map: any entry removed or changed is a visible test change (review F2, D-026)", () => {
    // Removing `en:molluscs` would turn a mollusc CONTAINS tag into an
    // unknown, so a shellfish allergy would read ALLOWED_WITH_UNKNOWNS
    // instead of BLOCKED. Removing `en:gluten` would turn a gluten CONTAINS
    // tag back into an unrecognized-data warning instead of a wheat block
    // (D-026). Narrowing this map must never pass silently.
    expect(OFF_ALLERGEN_TAG_MAP).toEqual({
      "en:peanuts": "peanut",
      "en:gluten": "wheat",
      "en:nuts": "tree_nut",
      "en:milk": "milk",
      "en:eggs": "egg",
      "en:fish": "fish",
      "en:crustaceans": "shellfish",
      "en:molluscs": "shellfish",
      "en:soybeans": "soy",
      "en:sesame-seeds": "sesame",
      "en:coconut": "tree_nut",
    });
    expect(Object.keys(OFF_ALLERGEN_TAG_MAP)).toHaveLength(11);
  });

  it("covers every major allergen: wheat is now reached via `en:gluten` (D-026)", () => {
    const reached = new Set(Object.values(OFF_ALLERGEN_TAG_MAP));
    const missing = MAJOR_ALLERGEN_CODES.filter((code) => !reached.has(code));
    expect(missing).toEqual([]);
  });

  it("a raw OFF tag is not already readable by the engine, so passing it through raw can only read as unrecognized", () => {
    // If the engine ever learned to read `en:`-prefixed tags on its own, an
    // unmapped raw tag could start meaning something this map never decided.
    const rawSeenInRecordings = [
      "en:Grains",
      "en:Seeds",
      "en:none",
      "en:celery",
      "en:3520367101",
      "fr:lait",
    ];
    for (const tag of [...mapEntries.map(([t]) => t), ...rawSeenInRecordings]) {
      expect(normalizeAllergenCode(tag), tag).toBeUndefined();
    }
  });

  it("unmapped tags pass through unchanged; prototype keys do not resolve", () => {
    expect(mapOffAllergenTag("en:gluten")).toBe("wheat");
    expect(mapOffAllergenTag("en:none")).toBe("en:none");
    expect(mapOffAllergenTag("constructor")).toBe("constructor");
    expect(mapOffAllergenTag("__proto__")).toBe("__proto__");
    expect(mapOffAllergenTag("en:peanuts")).toBe("peanut");
  });
});

describe("product lookup contracts", () => {
  it("the route constant and the path helper agree", () => {
    expect(PRODUCT_LOOKUP_ROUTE).toBe("/v1/products/:code");
    expect(productLookupPath("096619555505")).toBe(
      PRODUCT_LOOKUP_ROUTE.replace(":code", "096619555505"),
    );
    expect(productLookupPath("12/34")).toBe("/v1/products/12%2F34");
  });

  it("the one NOT_RUN reason today is that restrictions are not stored on the server", () => {
    expect([...SCREENING_NOT_RUN_REASONS_DTO]).toEqual(["HOUSEHOLD_RESTRICTIONS_NOT_STORED"]);
    const outcome: ScreeningOutcomeDto = {
      status: "NOT_RUN",
      reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED",
    };
    expect(Object.keys(outcome).sort()).toEqual(["reason", "status"]);
  });

  it("the camera scans UPC-E too (M2-T4b (a)); the server expands it before lookup", () => {
    expect([...SCANNABLE_BARCODE_TYPES_DTO]).toEqual(["upc_a", "upc_e", "ean13", "ean8"]);
  });

  it("PLU_NOT_SUPPORTED is an API error code", () => {
    expect(API_ERROR_CODES).toContain("PLU_NOT_SUPPORTED");
  });
});
