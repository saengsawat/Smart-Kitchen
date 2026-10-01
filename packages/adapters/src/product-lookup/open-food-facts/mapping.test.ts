/**
 * OFF answer -> `ProductCatalogItem` mapping (M2-T4a (a), (b)), driven by the
 * real responses recorded in `tests/fixtures/off/` (capture dates and hosts
 * are in each file's `capture` block). No test here opens a connection.
 */

import {
  majorRestriction,
  screenSubject,
  userDefinedRestriction,
  type AllergenOutcome,
  type AllergyRestriction,
  type ScreeningResult,
} from "@smart-kitchen/domain";
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
    expect(capture.capturedAt).toMatch(/^2026-09-(29|30)T/);
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

  it("maps per-serving nutrition from OFF's normalized keys, sodium in mg", () => {
    // M3-T4e: this fixture predates `nutrition_data_per` joining the field
    // list, so the field is absent from the recorded body. Absent is not
    // "100g" (mapping.ts's nutritionProfiles doc comment), so no PER_100G
    // profile is emitted here even though the product is a solid, not a
    // liquid — this is exactly the fixture that exercises "absent emits
    // nothing" (BACKLOG.md M3-T4e "Tests required"). PER_SERVING is
    // unaffected by the field either way.
    expect(item.nutrition.map((n) => n.basis)).toEqual(["PER_SERVING"]);
    expect(item.nutrition[0]?.values).toEqual({
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
      ["en:coconut", "MAY_CONTAIN"], // dual emission: the raw tag rides along (D-026 amended)
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

  it("maps en:gluten to wheat (D-026) and passes the rest of the unmapped tags through raw", () => {
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["wheat", "CONTAINS"], // en:gluten (D-026)
      ["en:gluten", "CONTAINS"], // dual emission: the raw tag rides along (D-026 amended)
      ["sesame", "CONTAINS"],
      ["tree_nut", "MAY_CONTAIN"],
      ["en:Grains", "MAY_CONTAIN"],
      ["en:Seeds", "MAY_CONTAIN"],
    ]);
  });

  it("blocks a wheat allergy on the (mapped) gluten CONTAINS tag (D-026)", () => {
    const wheat = everyAllergenMember("standard");
    const screened = screenSubject({ subject: toEngineSubject(item), members: [wheat] });
    expect(screened.ok && screened.value.verdict).toBe("BLOCKED");
    if (screened.ok) {
      expect(
        screened.value.evidence.some(
          (e) => e.kind === "ASSERTION_CONTAINS" && e.matchedTerm === "wheat",
        ),
      ).toBe(true);
    }
  });

  it("the engine's fail-closed handling still flags the remaining unmapped tags (unknown plus UNRECOGNIZED_ALLERGEN_DATA)", () => {
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

describe("record with a real nutrition_data_per: 100ml (Ripple Dairy-Free Milk, M3-T4e, recorded from staging)", () => {
  const item = hit("liquid-per-100ml-ripple.json");

  it("emits no PER_100G profile: OFF's own nutrition_data_per says these _100g figures are per 100 ml, not per 100 g", () => {
    expect(item.nutrition.map((n) => n.basis)).toEqual(["PER_SERVING"]);
  });

  it("still maps the per-serving profile (a serving is a fixed amount, never ambiguous)", () => {
    expect(item.nutrition[0]).toMatchObject({
      basis: "PER_SERVING",
      values: expect.objectContaining({ calories: 70 }) as unknown,
    });
  });

  it("the same 48 fl oz quantity remains unparseable, same as the earlier capture of this product", () => {
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

describe("record for a UPC-E-compressible product (Honey Maid Graham Crackers, M2-T4b (f))", () => {
  const item = hit("upc-e-graham-crackers.json");

  it("maps the full record from the code the server queries with (the expanded UPC-A, not the 8-digit UPC-E)", () => {
    expect(item.id).toBe("044000004637");
    expect(item.codes).toEqual([{ codeType: "UPC_A", code: "044000004637" }]);
    expect(item.name.value).toBe("Honey Maid Graham Crackers");
    expect(item.brand?.value).toBe("Honey Maid");
  });

  it("parses '14.4 oz (408g)' and the bracketed serving amount", () => {
    expect(item.packageSize?.value).toEqual({ qty: 14.4, unit: "oz" });
    expect(item.servingSize?.value).toEqual({ qty: 30, unit: "g" });
  });

  it("its real en:gluten and en:soybeans tags map to wheat and soy (D-026)", () => {
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["wheat", "CONTAINS"],
      ["en:gluten", "CONTAINS"],
      ["soy", "CONTAINS"],
    ]);
  });

  it("nutrition_data_per is exactly 100g, so both profiles are emitted", () => {
    expect(item.nutrition.map((n) => n.basis).sort()).toEqual(["PER_100G", "PER_SERVING"]);
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
    // Review F1: a 404 carrying a found-product body is never a hit.
    [
      "404 with a status 1 product body",
      404,
      JSON.stringify({ status: 1, product: { product_name: "X" } }),
    ],
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

  it("a product with no usable name in either field is not-found (nothing to show, nothing invented)", () => {
    for (const name of [undefined, "", "   ", 42]) {
      const product = name === undefined ? {} : { product_name: name };
      expect(answer(200, JSON.stringify({ status: 1, product }))).toEqual({ status: "not-found" });
    }
    // product_name_en unusable too (blank/absent): still not-found.
    for (const nameEn of [undefined, "", "  "]) {
      const product = {
        product_name: "",
        ...(nameEn === undefined ? {} : { product_name_en: nameEn }),
      };
      expect(answer(200, JSON.stringify({ status: 1, product }))).toEqual({ status: "not-found" });
    }
  });

  it("M2-T4b (c): product_name_en is a fallback, tried only when product_name is unusable", () => {
    // Blank main name, usable English name: hit, named from product_name_en.
    const blank = answer(
      200,
      JSON.stringify({ status: 1, product: { product_name: "", product_name_en: "Indomie" } }),
    );
    expect(blank.status).toBe("hit");
    if (blank.status === "hit") expect(blank.product.name.value).toBe("Indomie");

    // A genuine main name is never overridden by product_name_en.
    const both = answer(
      200,
      JSON.stringify({
        status: 1,
        product: { product_name: "Le Nom", product_name_en: "The Name" },
      }),
    );
    expect(both.status).toBe("hit");
    if (both.status === "hit") expect(both.product.name.value).toBe("Le Nom");
  });

  it("the recorded English-name-only product (Indomie, product_name empty on staging) is a hit named from product_name_en", () => {
    const item = hit("english-name-only-indomie.json");
    expect(item.name.value).toBe("Indomie");
    expect(item.name.provenance).toEqual({
      tier: "ESTIMATED",
      source: OFF_SOURCE,
      observedAt: lastModifiedIso("english-name-only-indomie.json"),
    });
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
          nutrition_data_per: "100g",
          nutriments: { "energy-kcal_100g": "120", fat_100g: -1, proteins_100g: 3 },
        },
      }),
    );
    expect(outcome.status === "hit" && outcome.product.nutrition).toEqual([
      expect.objectContaining({ basis: "PER_100G", values: { proteinG: 3 } }),
    ]);
  });

  describe("nutrition_data_per gates the PER_100G profile (M3-T4e (c), ADR-006 open item)", () => {
    const body = (nutritionDataPer: unknown): string =>
      JSON.stringify({
        status: 1,
        product: {
          product_name: "P",
          ...(nutritionDataPer === undefined ? {} : { nutrition_data_per: nutritionDataPer }),
          nutriments: { "energy-kcal_100g": 100, "energy-kcal_serving": 50 },
        },
      });

    it('"100g" emits the PER_100G profile', () => {
      const outcome = answer(200, body("100g"));
      expect(outcome.status === "hit" && outcome.product.nutrition.map((n) => n.basis)).toContain(
        "PER_100G",
      );
    });

    it('"100ml" (a liquid) emits no PER_100G profile, so it is never mislabelled per 100 g', () => {
      const outcome = answer(200, body("100ml"));
      expect(outcome.status === "hit" && outcome.product.nutrition.map((n) => n.basis)).toEqual([
        "PER_SERVING",
      ]);
    });

    it("absent emits no PER_100G profile either (absence is honest, never assumed to be 100g)", () => {
      const outcome = answer(200, body(undefined));
      expect(outcome.status === "hit" && outcome.product.nutrition.map((n) => n.basis)).toEqual([
        "PER_SERVING",
      ]);
    });

    it("PER_SERVING is unaffected by nutrition_data_per in every case", () => {
      for (const value of ["100g", "100ml", undefined]) {
        const outcome = answer(200, body(value));
        expect(outcome.status === "hit" && outcome.product.nutrition.map((n) => n.basis)).toContain(
          "PER_SERVING",
        );
      }
    });
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

describe("dual emission for non-identity mappings (D-026 as amended, M2-T4b review F1)", () => {
  function built(outcome: AllergenOutcome<AllergyRestriction>): AllergyRestriction {
    if (!outcome.ok) throw new Error(outcome.error.message);
    return outcome.value;
  }
  function screen(item: ProductCatalogItem, restriction: AllergyRestriction): ScreeningResult {
    const result = screenSubject({
      subject: toEngineSubject(item),
      members: [{ memberId: "m1", restrictions: [restriction] }],
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }
  function synthetic(allergens: string[], traces: string[]): ProductCatalogItem {
    const body = JSON.stringify({
      status: 1,
      product: {
        code: "0096619555505",
        product_name: "X",
        allergens_tags: allergens,
        traces_tags: traces,
      },
    });
    const out = mapOffAnswer(
      { httpStatus: 200, bodyText: body },
      { codeType: "EAN13", code: "0096619555505" },
      FETCHED_AT,
    );
    if (out.status !== "hit") throw new Error("expected a hit");
    return out.product;
  }

  it("Honey Maid (en:gluten): a celiac user-defined 'gluten' restriction is BLOCKED on the raw tag", () => {
    const item = hit("upc-e-graham-crackers.json");
    const result = screen(item, built(userDefinedRestriction("r-gluten", "gluten", "severe")));
    expect(result.verdict).toBe("BLOCKED");
    expect(
      result.evidence.some(
        (e) => e.kind === "ASSERTION_CODE_TERM" && e.matchedText === "en:gluten",
      ),
    ).toBe(true);
  });

  it("Honey Maid: a wheat (MAJOR) restriction is also BLOCKED", () => {
    const item = hit("upc-e-graham-crackers.json");
    expect(screen(item, built(majorRestriction("r-wheat", "wheat", "severe"))).verdict).toBe(
      "BLOCKED",
    );
  });

  it("en:coconut: both tree_nut and the raw tag are emitted, same kind; a user-defined 'coconut' blocks", () => {
    const item = synthetic([], ["en:coconut"]);
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["tree_nut", "MAY_CONTAIN"],
      ["en:coconut", "MAY_CONTAIN"],
    ]);
    const result = screen(item, built(userDefinedRestriction("r-coconut", "coconut", "severe")));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence.some((e) => e.kind === "ASSERTION_CODE_TERM")).toBe(true);
  });

  it("en:molluscs: both shellfish and the raw tag are emitted; a user-defined 'molluscs' and a shellfish restriction both block", () => {
    const item = synthetic(["en:molluscs"], []);
    expect(item.allergens.map((a) => [a.allergenCode, a.assertion])).toEqual([
      ["shellfish", "CONTAINS"],
      ["en:molluscs", "CONTAINS"],
    ]);
    expect(
      screen(item, built(userDefinedRestriction("r-mollusc", "molluscs", "severe"))).verdict,
    ).toBe("BLOCKED");
    expect(
      screen(item, built(majorRestriction("r-shellfish", "shellfish", "severe"))).verdict,
    ).toBe("BLOCKED");
  });

  it("exact matches (en:peanuts) and unmapped tags (en:celery) emit once", () => {
    const item = synthetic(["en:peanuts", "en:celery"], []);
    expect(item.allergens.map((a) => a.allergenCode)).toEqual(["peanut", "en:celery"]);
  });
});
