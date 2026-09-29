/**
 * OFF answer -> `ProductCatalogItem` mapping (M2-T4a (a), (b)), driven by the
 * real responses recorded in `tests/fixtures/off/` (capture dates and hosts
 * are in each file's `capture` block). No test here opens a connection.
 */

import { screenSubject } from "@smart-kitchen/domain";
import { describe, expect, it } from "vitest";
import type { ProductCatalogItem, ProductCode } from "../types.js";
import { gramsToMilligrams, mapOffAnswer, OFF_SOURCE, type OffMappedOutcome } from "./mapping.js";
import {
  collectTiers,
  everyAllergenMember,
  loadRecorded,
  RECORDED_OFF_FILES,
  recordedAnswer,
  recordedCode,
  toEngineSubject,
  type RecordedOffFile,
} from "./test-support.js";

const FETCHED_AT = "2026-09-29T18:30:00.000Z";

function requested(code: string): ProductCode {
  const codeType = code.length === 8 ? "EAN8" : code.length === 12 ? "UPC_A" : "EAN13";
  return { codeType, code };
}

function mapRecorded(file: RecordedOffFile): OffMappedOutcome {
  return mapOffAnswer(recordedAnswer(file), requested(recordedCode(file)), FETCHED_AT);
}

function hit(file: RecordedOffFile): ProductCatalogItem {
  const outcome = mapRecorded(file);
  if (outcome.status !== "hit") throw new Error(`${file}: expected a hit, got ${outcome.status}`);
  return outcome.product;
}

function lastModifiedIso(file: RecordedOffFile): string {
  const body = loadRecorded(file).body as { product: { last_modified_t: number } };
  return new Date(body.product.last_modified_t * 1000).toISOString();
}

const HIT_FILES = RECORDED_OFF_FILES.filter((f) => f !== "not-found.json");

describe("recorded fixtures are what they claim to be", () => {
  it.each(RECORDED_OFF_FILES)("%s carries its capture date, host and request", (file) => {
    const { capture } = loadRecorded(file);
    expect(capture.capturedAt).toMatch(/^2026-09-29T/);
    expect(["https://world.openfoodfacts.org", "https://world.openfoodfacts.net"]).toContain(
      capture.host,
    );
    expect(capture.request).toMatch(/^\/api\/v2\/product\/\d+\.json\?fields=/);
  });
});

describe("tier policy (D-025): nothing from OFF is Known Fact", () => {
  it.each(HIT_FILES)("%s: every provenance is ESTIMATED from open-food-facts", (file) => {
    const item = hit(file);
    const tiers = collectTiers(item);
    expect(tiers.length).toBeGreaterThan(0);
    expect(new Set(tiers)).toEqual(new Set(["ESTIMATED"]));
    expect(item.name.provenance).toEqual({
      tier: "ESTIMATED",
      source: OFF_SOURCE,
      observedAt: lastModifiedIso(file),
    });
  });

  it.each(HIT_FILES)("%s: the engine never reaches ALLOWED on OFF data alone", (file) => {
    const subject = toEngineSubject(hit(file));
    for (const severity of ["severe", "standard"] as const) {
      const screened = screenSubject({ subject, members: [everyAllergenMember(severity)] });
      expect(screened.ok).toBe(true);
      if (screened.ok) expect(screened.value.verdict).not.toBe("ALLOWED");
    }
  });

  it("the mapped item has no field that could carry a completeness declaration", () => {
    for (const file of HIT_FILES) {
      expect(Object.keys(hit(file))).not.toContain("declaration");
    }
  });
});

describe("full record (Kirkland organic peanut butter, US, recorded from production)", () => {
  const item = hit("full-peanut-butter.json");

  it("maps identity and label fields, each ESTIMATED", () => {
    expect(item.id).toBe("096619555505");
    expect(item.kind).toBe("BRANDED");
    expect(item.codes).toEqual([{ codeType: "UPC_A", code: "096619555505" }]);
    expect(item.name.value).toBe("Organic Creamy Peanut Butter");
    expect(item.brand?.value).toBe("Kirkland");
    expect(item.category?.value).toBe("en:creamy-peanut-butters");
    expect(item.ingredientsText?.value).toBe("Dry roasted organic peanuts, sea salt");
    expect(item.imageRef?.value).toMatch(/^https:\/\/images\.openfoodfacts\.org\//);
  });

  it("parses '793.8 g' and '1 portion (32 g)'", () => {
    expect(item.packageSize?.value).toEqual({ qty: 793.8, unit: "g" });
    expect(item.servingSize?.value).toEqual({ qty: 32, unit: "g" });
  });

  it("maps per-100 g and per-serving nutrition from OFF's normalized keys, sodium in mg", () => {
    expect(item.nutrition.map((n) => n.basis)).toEqual(["PER_100G", "PER_SERVING"]);
    expect(item.nutrition[0]?.values).toEqual({
      calories: 562.5,
      proteinG: 12.5,
      carbsG: 10.94,
      fatG: 23.44,
      fiberG: 4.69,
      sugarG: 1.56,
      sodiumMg: 0.203125,
    });
    expect(item.nutrition[1]?.values).toEqual({
      calories: 180,
      proteinG: 4,
      carbsG: 3.5,
      fatG: 7.5,
      fiberG: 1.5,
      sugarG: 0.499,
      sodiumMg: 0.065,
    });
  });

  it("allergens_tags become CONTAINS and traces_tags MAY_CONTAIN, through the tag map", () => {
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["peanut", "CONTAINS"],
      ["tree_nut", "MAY_CONTAIN"], // en:nuts
      ["soy", "MAY_CONTAIN"], // en:soybeans
      ["tree_nut", "MAY_CONTAIN"], // en:coconut, D-017 P3
    ]);
  });

  it("blocks a peanut allergy on the CONTAINS tag", () => {
    const peanut = everyAllergenMember("standard");
    const screened = screenSubject({ subject: toEngineSubject(item), members: [peanut] });
    expect(screened.ok && screened.value.verdict).toBe("BLOCKED");
  });
});

describe("record with no allergen field (Almond Breeze, captured with allergen fields omitted)", () => {
  const item = hit("no-allergen-fields-almond-breeze.json");

  it("has no allergen tags and invents none", () => {
    expect(item.allergens).toEqual([]);
  });

  it("is absence of data, not absence of allergens: every restriction stays unknown", () => {
    const member = everyAllergenMember("severe");
    const screened = screenSubject({ subject: toEngineSubject(item), members: [member] });
    expect(screened.ok).toBe(true);
    if (!screened.ok) return;
    // "almond" in the name and ingredients still blocks tree nut; everything else is unknown, never cleared.
    expect(screened.value.verdict).toBe("BLOCKED");
    const unresolved = new Set(screened.value.unknowns.map((u) => u.restrictionId));
    const blocked = new Set(screened.value.evidence.map((e) => e.restrictionId));
    for (const restriction of member.restrictions) {
      expect(
        unresolved.has(restriction.restrictionId) || blocked.has(restriction.restrictionId),
      ).toBe(true);
    }
  });

  it("an empty quantity string leaves packageSize absent", () => {
    expect(item.packageSize).toBeUndefined();
    expect(item.servingSize?.value).toEqual({ qty: 240, unit: "ml" });
  });
});

describe("record with traces only (Bear Naked granola)", () => {
  const item = hit("traces-only-granola.json");

  it("every tag is MAY_CONTAIN", () => {
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["tree_nut", "MAY_CONTAIN"],
    ]);
  });

  it("'12 oz (340g)' parses as 12 oz", () => {
    expect(item.packageSize?.value).toEqual({ qty: 12, unit: "oz" });
  });
});

describe("record with unmapped allergen tags (Dave's Killer Bread)", () => {
  const item = hit("unmapped-tags-bread.json");

  it("passes unmapped tags through raw", () => {
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["en:gluten", "CONTAINS"],
      ["sesame", "CONTAINS"],
      ["tree_nut", "MAY_CONTAIN"],
      ["en:Grains", "MAY_CONTAIN"],
      ["en:Seeds", "MAY_CONTAIN"],
    ]);
  });

  it("the engine's fail-closed handling flags them (unknown plus UNRECOGNIZED_ALLERGEN_DATA)", () => {
    const member = everyAllergenMember("standard");
    const screened = screenSubject({ subject: toEngineSubject(item), members: [member] });
    expect(screened.ok).toBe(true);
    if (!screened.ok) return;
    expect(screened.value.warnings.map((w) => w.code)).toContain("UNRECOGNIZED_ALLERGEN_DATA");
    expect(screened.value.unknowns.map((u) => u.reason)).toContain("UNRECOGNIZED_ASSERTION_CODE");
  });
});

describe("record with an unparseable quantity (Ripple, '48 fl oz')", () => {
  it("leaves packageSize absent rather than reading fl oz as oz", () => {
    const item = hit("unparseable-quantity-ripple.json");
    expect(loadRecorded("unparseable-quantity-ripple.json").body).toMatchObject({
      product: { quantity: "48 fl oz" },
    });
    expect(item.packageSize).toBeUndefined();
  });
});

describe("sparse record (store sandwich: no quantity, no ingredients, no categories)", () => {
  it("maps what is there and nothing else", () => {
    const item = hit("sparse-sandwich.json");
    expect(item.name.value).toBe("Turkey Gouda On Ciabatta");
    expect(item.packageSize).toBeUndefined();
    expect(item.ingredientsText).toBeUndefined();
    expect(item.category).toBeUndefined();
    expect(item.servingSize?.value).toEqual({ qty: 227, unit: "g" });
    expect(item.allergens).toEqual([]);
  });
});

describe("outcome mapping", () => {
  const code: ProductCode = { codeType: "UPC_A", code: "096619555505" };
  const answer = (httpStatus: number, bodyText: string): OffMappedOutcome =>
    mapOffAnswer({ httpStatus, bodyText }, code, FETCHED_AT);

  it("the recorded 404 with status 0 is not-found", () => {
    expect(mapRecorded("not-found.json")).toEqual({ status: "not-found" });
  });

  it("200 with status 0 is not-found", () => {
    expect(answer(200, JSON.stringify({ code: "0096619555505", status: 0 }))).toEqual({
      status: "not-found",
    });
  });

  it.each([
    [429, "UPSTREAM_RATE_LIMITED"],
    [500, "UPSTREAM_UNAVAILABLE"],
    [502, "UPSTREAM_UNAVAILABLE"],
    [503, "UPSTREAM_UNAVAILABLE"],
    [400, "UPSTREAM_REJECTED"],
    [401, "UPSTREAM_REJECTED"],
    [403, "UPSTREAM_REJECTED"],
    [410, "UPSTREAM_REJECTED"],
    [204, "UPSTREAM_REJECTED"],
  ])("HTTP %d is error %s, never not-found", (status, errorCode) => {
    const outcome = answer(status, JSON.stringify({ status: 0 }));
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.code).toBe(errorCode);
  });

  it.each([
    ["200 with HTML", 200, "<html>temporarily unavailable</html>"],
    ["200 with truncated JSON", 200, '{"status":1,"product":{"product_na'],
    ["200 with a JSON array", 200, "[]"],
    ["200 with status 1 and no product", 200, JSON.stringify({ status: 1 })],
    ["200 with an unknown status value", 200, JSON.stringify({ status: 2, product: {} })],
    ["404 with an HTML page (a wrong base URL)", 404, "<html>Not Found</html>"],
    ["404 with JSON that is not OFF's miss", 404, JSON.stringify({ error: "nope" })],
    [
      "a body naming a different product",
      200,
      JSON.stringify({ code: "3017620422003", status: 0 }),
    ],
    [
      "a product naming a different code",
      200,
      JSON.stringify({ status: 1, product: { code: "3017620422003", product_name: "Nutella" } }),
    ],
    [
      "allergens_tags that is not an array",
      200,
      JSON.stringify({ status: 1, product: { product_name: "X", allergens_tags: "en:milk" } }),
    ],
    [
      "traces_tags that is not an array",
      200,
      JSON.stringify({ status: 1, product: { product_name: "X", traces_tags: { milk: true } } }),
    ],
  ])("%s is error UPSTREAM_MALFORMED, never not-found", (_label, status, body) => {
    const outcome = answer(status, body);
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.error.code).toBe("UPSTREAM_MALFORMED");
  });

  it("a product with no usable name is not-found (nothing to show, nothing invented)", () => {
    for (const name of [undefined, "", "   ", 42]) {
      const product = name === undefined ? {} : { product_name: name };
      expect(answer(200, JSON.stringify({ status: 1, product }))).toEqual({ status: "not-found" });
    }
  });

  it("OFF's leading-zero normalization is the same product", () => {
    const outcome = answer(
      200,
      JSON.stringify({
        code: "0096619555505",
        status: 1,
        product: { code: "0096619555505", product_name: "P" },
      }),
    );
    expect(outcome.status).toBe("hit");
  });

  it("an object inside traces_tags (allowed by OFF's schema) passes through as its JSON text", () => {
    const outcome = answer(
      200,
      JSON.stringify({
        status: 1,
        product: { product_name: "P", traces_tags: [{ id: "en:milk" }] },
      }),
    );
    expect(outcome.status === "hit" && outcome.product.allergens).toEqual([
      expect.objectContaining({ allergenCode: '{"id":"en:milk"}', assertion: "MAY_CONTAIN" }),
    ]);
  });

  it("nutrient values that are not finite non-negative numbers are left out, never coerced", () => {
    const outcome = answer(
      200,
      JSON.stringify({
        status: 1,
        product: {
          product_name: "P",
          nutriments: { "energy-kcal_100g": "120", fat_100g: -1, proteins_100g: 3 },
        },
      }),
    );
    expect(outcome.status === "hit" && outcome.product.nutrition).toEqual([
      expect.objectContaining({ basis: "PER_100G", values: { proteinG: 3 } }),
    ]);
  });

  it("observedAt falls back to the fetch time when last_modified_t is missing", () => {
    const outcome = answer(200, JSON.stringify({ status: 1, product: { product_name: "P" } }));
    expect(outcome.status === "hit" && outcome.product.name.provenance.observedAt).toBe(FETCHED_AT);
  });

  it("an image URL that is not https is left out", () => {
    const outcome = answer(
      200,
      JSON.stringify({
        status: 1,
        product: { product_name: "P", image_front_url: "http://x/y.jpg" },
      }),
    );
    expect(outcome.status === "hit" && outcome.product.imageRef).toBeUndefined();
  });
});

describe("gramsToMilligrams shifts the decimal point, it does not multiply floats", () => {
  it.each([
    [0.0428, 42.8],
    [0.365384615384615, 365.384615384615],
    [0.000203125, 0.203125],
    [1.66, 1660],
    [2, 2000],
    [0, 0],
    [0.1, 100],
    [0.0012, 1.2],
  ])("%d g is %d mg", (grams, milligrams) => {
    expect(gramsToMilligrams(grams)).toBe(milligrams);
  });

  it("exponent-form input still lands on a clean value", () => {
    expect(gramsToMilligrams(4e-7)).toBe(0.0004);
  });
});
