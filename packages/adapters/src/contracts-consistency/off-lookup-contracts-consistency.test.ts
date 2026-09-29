/**
 * M2-T4a consistency checks: the OFF allergen tag map against the domain
 * taxonomy, and the product-lookup contracts (route constant, path helper,
 * `NOT_RUN` reasons, the PLU refusal code).
 */

import {
  API_ERROR_CODES,
  MAJOR_ALLERGEN_CODES_DTO,
  PRODUCT_LOOKUP_ROUTE,
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

  it("covers every major allergen except wheat, which OFF only reports as `en:gluten` (deliberately unmapped)", () => {
    const reached = new Set(Object.values(OFF_ALLERGEN_TAG_MAP));
    const missing = MAJOR_ALLERGEN_CODES.filter((code) => !reached.has(code));
    expect(missing).toEqual(["wheat"]);
  });

  it("a raw OFF tag is not already readable by the engine, so passing it through raw can only read as unrecognized", () => {
    // If the engine ever learned to read `en:`-prefixed tags on its own, an
    // unmapped raw tag could start meaning something this map never decided.
    const rawSeenInRecordings = [
      "en:gluten",
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
    expect(mapOffAllergenTag("en:gluten")).toBe("en:gluten");
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

  it("PLU_NOT_SUPPORTED is an API error code", () => {
    expect(API_ERROR_CODES).toContain("PLU_NOT_SUPPORTED");
  });
});
