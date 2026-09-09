import { describe, expect, it } from "vitest";

import {
  ALLERGEN_EXCLUSION_PHRASES,
  ALLERGEN_EXCLUSIONS,
  ALLERGEN_TERM_PHRASES,
  ALLERGEN_TERMS,
  isMajorAllergenCode,
  MAJOR_ALLERGEN_CODES,
  MAJOR_ALLERGEN_LABELS,
  normalizeAllergenCode,
} from "./taxonomy.js";
import { findTermMatches } from "./text.js";

describe("major allergen codes", () => {
  it("are exactly the nine FDA major allergens", () => {
    expect([...MAJOR_ALLERGEN_CODES].sort()).toEqual([
      "egg",
      "fish",
      "milk",
      "peanut",
      "sesame",
      "shellfish",
      "soy",
      "tree_nut",
      "wheat",
    ]);
  });

  it("has a label, a term list and an exclusion list for every code", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      expect(MAJOR_ALLERGEN_LABELS[code]).toBeTruthy();
      expect(ALLERGEN_TERMS[code].length).toBeGreaterThan(0);
      expect(ALLERGEN_EXCLUSIONS[code]).toBeDefined();
    }
  });

  it("recognizes only exact codes", () => {
    expect(isMajorAllergenCode("peanut")).toBe(true);
    expect(isMajorAllergenCode("Peanut")).toBe(false);
    expect(isMajorAllergenCode("peanuts")).toBe(false);
    expect(isMajorAllergenCode("pea")).toBe(false);
    expect(isMajorAllergenCode(undefined)).toBe(false);
    expect(isMajorAllergenCode(42)).toBe(false);
  });

  it("every allergen's own name matches its own term list", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      const label = MAJOR_ALLERGEN_LABELS[code];
      expect(findTermMatches(label, ALLERGEN_TERMS[code]).length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeAllergenCode", () => {
  it("passes through canonical codes", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      expect(normalizeAllergenCode(code)).toBe(code);
    }
  });

  it("folds case, punctuation and separators", () => {
    expect(normalizeAllergenCode("Tree Nuts")).toBe("tree_nut");
    expect(normalizeAllergenCode("tree-nuts")).toBe("tree_nut");
    expect(normalizeAllergenCode("TREE_NUT")).toBe("tree_nut");
    expect(normalizeAllergenCode("  milk  ")).toBe("milk");
  });

  it("maps the aliases other sources use", () => {
    expect(normalizeAllergenCode("dairy")).toBe("milk");
    expect(normalizeAllergenCode("soya")).toBe("soy");
    expect(normalizeAllergenCode("crustacean shellfish")).toBe("shellfish");
    expect(normalizeAllergenCode("peanuts")).toBe("peanut");
    expect(normalizeAllergenCode("sesame seeds")).toBe("sesame");
  });

  it("returns undefined rather than guessing", () => {
    expect(normalizeAllergenCode("mustard")).toBeUndefined();
    expect(normalizeAllergenCode("celery")).toBeUndefined();
    expect(normalizeAllergenCode("lupin")).toBeUndefined();
    expect(normalizeAllergenCode("")).toBeUndefined();
    expect(normalizeAllergenCode("???")).toBeUndefined();
  });

  it("does not resolve inherited Object.prototype keys (review finding F1)", () => {
    // A bare `aliases[folded]` read resolves prototype properties, so a
    // `constructor`-coded assertion came back "recognized" (as the Object
    // function), which cleared the unrecognized-data warnings and could
    // upgrade a verdict to ALLOWED. Own-property lookup only.
    for (const key of [
      "constructor",
      "Constructor",
      "constructor!",
      "  constructor  ",
      "__proto__",
      "prototype",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
    ]) {
      expect(normalizeAllergenCode(key), `${key} must not resolve`).toBeUndefined();
    }
  });

  it("deliberately does not equate gluten with wheat", () => {
    // Gluten is also in barley and rye, so the claims are not the same claim.
    // Unrecognized => unknown + warning, which is the conservative outcome.
    expect(normalizeAllergenCode("gluten")).toBeUndefined();
  });
});

describe("curated term data", () => {
  it("catches the common spellings of each allergen", () => {
    const expectations: readonly (readonly [string, keyof typeof ALLERGEN_TERMS])[] = [
      ["roasted peanuts", "peanut"],
      ["groundnut oil", "peanut"],
      ["chopped walnuts", "tree_nut"],
      ["blanched almond flour", "tree_nut"],
      ["nonfat dry milk", "milk"],
      ["sodium caseinate", "milk"],
      ["whey protein concentrate", "milk"],
      ["dried egg whites", "egg"],
      ["ovalbumin", "egg"],
      ["anchovies in oil", "fish"],
      ["worcestershire sauce", "fish"],
      ["cooked shrimp", "shellfish"],
      ["king crab legs", "shellfish"],
      ["enriched wheat flour", "wheat"],
      ["semolina", "wheat"],
      ["soy lecithin", "soy"],
      ["organic tofu", "soy"],
      ["tahini paste", "sesame"],
      ["toasted sesame oil", "sesame"],
    ];
    for (const [text, code] of expectations) {
      expect(
        findTermMatches(text, ALLERGEN_TERMS[code], ALLERGEN_EXCLUSIONS[code]).length,
        `expected "${text}" to match ${code}`,
      ).toBeGreaterThan(0);
    }
  });

  it("does not fire on lookalike foods (exclusion data doing its job)", () => {
    const nonMatches: readonly (readonly [string, keyof typeof ALLERGEN_TERMS])[] = [
      // "butter" is a milk term, but these compounds are not dairy.
      ["peanut butter, sugar", "milk"],
      ["almond butter", "milk"],
      ["cocoa butter", "milk"],
      ["cream of tartar", "milk"],
      ["unsweetened almond milk", "milk"],
      ["coconut milk", "milk"],
      // "flour" is a wheat term, but these flours are not wheat.
      ["rice flour", "wheat"],
      ["almond flour", "wheat"],
      ["chickpea flour", "wheat"],
      // Token equality alone (no exclusion needed).
      ["buckwheat groats", "wheat"],
      ["split pea soup", "peanut"],
      ["water chestnuts", "tree_nut"],
      ["nutritional yeast", "tree_nut"],
      ["eggplant parmesan", "egg"],
      ["shellfish free broth", "shellfish"],
      // "curd" is a milk term; bean curd is tofu (review finding F9).
      ["bean curd, water, salt", "milk"],
    ];
    for (const [text, code] of nonMatches) {
      expect(
        findTermMatches(text, ALLERGEN_TERMS[code], ALLERGEN_EXCLUSIONS[code]),
        `expected "${text}" NOT to match ${code}`,
      ).toEqual([]);
    }
  });

  it("still catches a real allergen next to an excluded phrase", () => {
    // Exclusions mask only their own occurrence — they are not a kill switch.
    const text = "peanut butter, butter, sugar";
    expect(findTermMatches(text, ALLERGEN_TERMS.milk, ALLERGEN_EXCLUSIONS.milk)).toHaveLength(1);
    expect(findTermMatches(text, ALLERGEN_TERMS.peanut, ALLERGEN_EXCLUSIONS.peanut)).toHaveLength(
      1,
    );
  });

  it("keeps peanut and tree nut distinct", () => {
    expect(
      findTermMatches("peanuts", ALLERGEN_TERMS.tree_nut, ALLERGEN_EXCLUSIONS.tree_nut),
    ).toEqual([]);
    expect(findTermMatches("walnuts", ALLERGEN_TERMS.peanut, ALLERGEN_EXCLUSIONS.peanut)).toEqual(
      [],
    );
  });

  it("exposes the raw phrase lists for audit, matching the compiled ones", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      expect(ALLERGEN_TERM_PHRASES[code].length).toBe(ALLERGEN_TERMS[code].length);
      expect(ALLERGEN_EXCLUSION_PHRASES[code].length).toBe(ALLERGEN_EXCLUSIONS[code].length);
    }
  });

  it("contains no duplicate terms within an allergen", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      const terms = ALLERGEN_TERMS[code].map((t) => t.term);
      expect(new Set(terms).size, `duplicate term in ${code}`).toBe(terms.length);
    }
  });
});
