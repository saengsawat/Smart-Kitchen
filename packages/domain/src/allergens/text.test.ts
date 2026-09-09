import { describe, expect, it } from "vitest";

import {
  compileTerm,
  compileTerms,
  findTermMatches,
  maskExclusions,
  normalizeText,
  tokenize,
  tokensEqual,
} from "./text.js";

describe("normalizeText", () => {
  it("lowercases", () => {
    expect(normalizeText("PEANUT Butter")).toBe("peanut butter");
  });

  it("strips accents via NFKD so decomposed characters cannot dodge a term", () => {
    const precomposed = "cr\u00e8me fra\u00eeche";
    // Same text with combining marks instead of precomposed glyphs.
    const decomposed = precomposed.normalize("NFD");
    expect(decomposed).not.toBe(precomposed);
    expect(normalizeText(precomposed)).toBe("creme fraiche");
    expect(normalizeText(decomposed)).toBe("creme fraiche");
  });

  it("splits on every non-alphanumeric character", () => {
    expect(normalizeText("peanut-butter")).toBe("peanut butter");
    expect(normalizeText("soy(lecithin)")).toBe("soy lecithin");
    expect(normalizeText("milk/cream")).toBe("milk cream");
    expect(normalizeText("wheat.")).toBe("wheat");
    expect(normalizeText("egg,milk;soy")).toBe("egg milk soy");
  });

  it("collapses whitespace runs and trims", () => {
    expect(normalizeText("  peanut \t\n  butter  ")).toBe("peanut butter");
  });

  it("keeps digits", () => {
    expect(normalizeText("Blue 1 Lake")).toBe("blue 1 lake");
  });

  it("returns an empty string for text with no alphanumerics", () => {
    expect(normalizeText("!!! ---")).toBe("");
    expect(tokenize("!!! ---")).toEqual([]);
  });

  it("deletes zero-width and format characters instead of splitting on them (review finding F3)", () => {
    // These are invisible, so a human reads "pea<ZWSP>nut" as one word. Letting
    // the non-alphanumeric step turn them into a separator split the token and
    // made the term miss — which produced ALLOWED under a declaration.
    const invisibles: readonly (readonly [string, number])[] = [
      ["soft hyphen U+00AD", 0x00ad],
      ["zero-width space U+200B", 0x200b],
      ["zero-width non-joiner U+200C", 0x200c],
      ["zero-width joiner U+200D", 0x200d],
      ["left-to-right mark U+200E", 0x200e],
      ["right-to-left mark U+200F", 0x200f],
      ["word joiner U+2060", 0x2060],
      ["zero-width no-break space / BOM U+FEFF", 0xfeff],
    ];

    for (const [label, codePoint] of invisibles) {
      const char = String.fromCodePoint(codePoint);
      expect(normalizeText(`pea${char}nut`), label).toBe("peanut");
      expect(tokenize(`pea${char}nut`), label).toEqual(["peanut"]);
      // Also at the edges and doubled up.
      expect(normalizeText(`${char}peanut${char}`), label).toBe("peanut");
      expect(normalizeText(`pea${char}${char}nut`), label).toBe("peanut");
    }
  });

  it("still finds the term when a recipe hides an invisible inside it", () => {
    const peanutTerm = compileTerms(["peanut"]);
    for (const codePoint of [0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff]) {
      const sneaky = `roasted pea${String.fromCodePoint(codePoint)}nuts`;
      expect(findTermMatches(sneaky, peanutTerm).length, `U+${codePoint.toString(16)}`).toBe(1);
    }
  });

  it("is idempotent", () => {
    const once = normalizeText("Crème-Fraîche, 2% MILK!");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("tokensEqual — the single inflection rule", () => {
  it("matches exact tokens", () => {
    expect(tokensEqual("peanut", "peanut")).toBe(true);
  });

  it("matches a trailing s or es", () => {
    expect(tokensEqual("peanuts", "peanut")).toBe(true);
    expect(tokensEqual("mangoes", "mango")).toBe(true);
  });

  it("does not stem: no y->ies, no consonant doubling, no prefix matching", () => {
    expect(tokensEqual("anchovies", "anchovy")).toBe(false);
    expect(tokensEqual("peanut", "pea")).toBe(false);
    expect(tokensEqual("pea", "peanut")).toBe(false);
    expect(tokensEqual("milky", "milk")).toBe(false);
    expect(tokensEqual("milk", "milks")).toBe(false);
  });
});

describe("findTermMatches", () => {
  const peanut = compileTerms(["peanut", "peanut butter"]);

  it("matches whole tokens only, never substrings", () => {
    expect(findTermMatches("split pea soup", peanut)).toEqual([]);
    expect(findTermMatches("peas and carrots", peanut)).toEqual([]);
    expect(findTermMatches("roasted peanuts", peanut)).toHaveLength(1);
  });

  it("reports the matched span and its position", () => {
    const matches = findTermMatches("sugar, peanut butter, salt", peanut);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.term).toBe("peanut butter");
    expect(matches[0]?.matchedText).toBe("peanut butter");
    expect(matches[0]?.startToken).toBe(1);
    expect(matches[0]?.endToken).toBe(3);
  });

  it("prefers the longest term at a position, so a span yields one match", () => {
    const matches = findTermMatches("peanut butter", peanut);
    expect(matches.map((m) => m.term)).toEqual(["peanut butter"]);
  });

  it("is insensitive to case, punctuation and separators", () => {
    for (const text of ["PEANUT", "Peanut.", "peanut,", "(peanut)", "  peanut  ", "PEA-NUTS"]) {
      const found = findTermMatches(text, peanut);
      if (text === "PEA-NUTS") {
        // "pea nuts" is two tokens, neither of which equals "peanut".
        expect(found).toEqual([]);
      } else {
        expect(found.length).toBeGreaterThan(0);
      }
    }
  });

  it("finds every occurrence", () => {
    expect(findTermMatches("peanut oil and peanut flour", compileTerms(["peanut"]))).toHaveLength(
      2,
    );
  });

  it("is order-independent in the term list", () => {
    const a = findTermMatches("peanut butter cups", compileTerms(["peanut", "peanut butter"]));
    const b = findTermMatches("peanut butter cups", compileTerms(["peanut butter", "peanut"]));
    expect(a).toEqual(b);
  });

  it("returns nothing for empty inputs", () => {
    expect(findTermMatches("", peanut)).toEqual([]);
    expect(findTermMatches("peanut", [])).toEqual([]);
  });
});

describe("exclusion masking", () => {
  it("masks the tokens of an exclusion phrase", () => {
    const tokens = tokenize("sugar, peanut butter, salt");
    const masked = maskExclusions(tokens, compileTerms(["peanut butter"]));
    expect(masked).toEqual([false, true, true, false]);
  });

  it("stops a compound food from reading as the allergen", () => {
    const milkTerms = compileTerms(["butter", "milk"]);
    const milkExclusions = compileTerms(["peanut butter"]);
    expect(findTermMatches("peanut butter, salt", milkTerms, milkExclusions)).toEqual([]);
    expect(findTermMatches("butter, salt", milkTerms, milkExclusions)).toHaveLength(1);
  });

  it("applies longer exclusions first", () => {
    const wheatTerms = compileTerms(["flour"]);
    const wheatExclusions = compileTerms(["gluten free", "gluten free flour"]);
    expect(findTermMatches("gluten free flour", wheatTerms, wheatExclusions)).toEqual([]);
  });

  it("only masks the occurrence it matched, leaving other occurrences visible", () => {
    const terms = compileTerms(["peanut"]);
    const exclusions = compileTerms(["peanut free"]);
    // The masked "peanut free" must not hide the genuine "peanuts" after it.
    const matches = findTermMatches(
      "made in a peanut free facility; contains peanuts",
      terms,
      exclusions,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedText).toBe("peanuts");
  });
});

describe("compileTerm", () => {
  it("normalizes the phrase it stores", () => {
    expect(compileTerm("  Peanut-Butter ")).toEqual({
      term: "peanut butter",
      tokens: ["peanut", "butter"],
    });
  });

  it("returns undefined for a phrase with no tokens", () => {
    expect(compileTerm("   ")).toBeUndefined();
    expect(compileTerm("!!!")).toBeUndefined();
  });
});
