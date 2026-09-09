/**
 * Screening-level regression tests for the M1-T4 independent review findings.
 *
 * Kept in one file, each `describe` named for its finding, so the reviewer can
 * re-check the fixes directly. Every test here **fails if its fix is reverted**
 * — that was the explicit acceptance condition (see the mutation table in
 * `docs/handoff/M1-T4.worker.md` §"Fixes applied").
 *
 * The theme of F1/F2/F3 is the same and worth stating plainly: none of them
 * bypassed a *block*, they were all paths to a wrongly **permissive** verdict.
 * `ALLOWED` is the state with a licence requirement, so every one of these is a
 * test that the licence is actually checked.
 */

import { describe, expect, it } from "vitest";

import { screenSubject } from "./index.js";
import {
  contains,
  expectScreened,
  fullDeclaration,
  majorRestrictionOf,
  memberWith,
  productOf,
  recipeOf,
  userTermRestriction,
} from "./test-support.js";

const peanutSevere = memberWith("m-alex", majorRestrictionOf("r1", "peanut", "severe"));
const peanutStandard = memberWith("m-jamie", majorRestrictionOf("r1", "peanut", "standard"));

describe("F1: an allergen code that is an Object.prototype key is unrecognized data", () => {
  it("does not treat a constructor-coded assertion as recognized", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Snack mix",
          ingredientsText: "oats, raisins",
          allergens: [contains("constructor")],
          declaration: fullDeclaration(),
        }),
        members: [peanutStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("UNRECOGNIZED_ASSERTION_CODE");
    expect(result.warnings.map((w) => w.code)).toContain("UNRECOGNIZED_ALLERGEN_DATA");
  });

  it("still raises the critical severe-allergy warning it previously suppressed", () => {
    // The original bug cleared this warning entirely: the constructor-coded
    // assertion resolved to a truthy "code", so the locus looked interpretable
    // and the declaration was honoured.
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Snack mix",
          ingredientsText: "oats, raisins",
          allergens: [contains("constructor")],
          declaration: fullDeclaration(),
        }),
        members: [peanutSevere],
      }),
    );
    expect(result.verdict).not.toBe("ALLOWED");
    expect(result.warnings.map((w) => w.code)).toContain("SEVERE_ALLERGY_UNKNOWN_DATA");
  });

  it("handles every prototype-key spelling the same way", () => {
    for (const code of ["constructor", "Constructor", "constructor!", "toString", "__proto__"]) {
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Snack mix",
            ingredientsText: "oats",
            allergens: [contains(code)],
            declaration: fullDeclaration(),
          }),
          members: [peanutStandard],
        }),
      );
      expect(result.verdict, `code ${code}`).toBe("ALLOWED_WITH_UNKNOWNS");
    }
  });
});

describe("F2: a name is not an ingredient statement", () => {
  it("refuses ALLOWED for a user-defined term when a product has only a name", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Tropical Blend Juice",
          allergens: [],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "severe"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("NO_INGREDIENT_TEXT");
  });

  it("refuses ALLOWED for a user-defined term when a recipe ingredient has only a ref", () => {
    // A recipe ingredient's `ref` is mandatory, so the old "any text" check was
    // unconditionally satisfied for every recipe locus — the worst shape of F2.
    const result = expectScreened(
      screenSubject({
        subject: recipeOf(
          "recipe-1",
          { ref: "tropical fruit blend", declaration: fullDeclaration(), allergens: [] },
          { ref: "sparkling water", declaration: fullDeclaration(), allergens: [] },
        ),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "severe"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns.map((u) => u.reason)).toEqual([
      "NO_INGREDIENT_TEXT",
      "NO_INGREDIENT_TEXT",
    ]);
  });

  it("whitespace-only ingredient text does not count either", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Juice",
          ingredientsText: "   \t\n  ",
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "standard"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("NO_INGREDIENT_TEXT");
  });

  it("still reaches ALLOWED once a real ingredient statement is present", () => {
    // The fix must not over-reject: this is the legitimate ALLOWED case.
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Tropical Blend Juice",
          ingredientsText: "water, apple juice concentrate, citric acid",
          allergens: [],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "severe"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED");
  });

  it("does not affect major-allergen restrictions, which the label declaration covers", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Bottled water",
          allergens: [],
          declaration: fullDeclaration(),
        }),
        members: [peanutStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED");
  });
});

describe("P5: an unattributable completeness declaration cannot license absence", () => {
  const shapes: readonly (readonly [string, unknown])[] = [
    ["empty source", ""],
    ["whitespace source", "   "],
    ["missing source", undefined],
    ["non-string source", 42],
  ];

  for (const [label, source] of shapes) {
    it(`refuses ALLOWED with an ${label}`, () => {
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Bottled water",
            ingredientsText: "water",
            allergens: [],
            declaration: { ...fullDeclaration(), source } as never,
          }),
          members: [peanutStandard],
        }),
      );
      expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
      expect(result.unknowns[0]?.reason).toBe("UNSOURCED_DECLARATION");
    });
  }

  it("still distinguishes an unverified tier from an unsourced declaration", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Bottled water",
          ingredientsText: "water",
          allergens: [],
          declaration: { ...fullDeclaration(), tier: "AI_INTERPRETATION" },
        }),
        members: [peanutStandard],
      }),
    );
    expect(result.unknowns[0]?.reason).toBe("UNVERIFIED_DECLARATION_TIER");
  });
});

describe("F4: screenSubject is total on malformed subject data", () => {
  const malformed: readonly (readonly [string, Record<string, unknown>])[] = [
    ["null declaration", { name: "Thing", declaration: null }],
    ["numeric declaration", { name: "Thing", declaration: 7 }],
    ["string declaration", { name: "Thing", declaration: "COMPLETE" }],
    ["numeric name", { name: 42, ingredientsText: "water" }],
    ["object name", { name: { toString: "nope" }, ingredientsText: "water" }],
    ["numeric ingredientsText", { name: "Thing", ingredientsText: 1234 }],
    ["null ingredientsText", { name: "Thing", ingredientsText: null }],
    ["string allergens", { name: "Thing", allergens: "peanut" }],
    ["numeric allergens", { name: "Thing", allergens: 5 }],
    ["null allergens", { name: "Thing", allergens: null }],
    ["allergens with null entries", { name: "Thing", allergens: [null, undefined, 3] }],
  ];

  for (const [label, fields] of malformed) {
    it(`returns a verdict rather than throwing: ${label}`, () => {
      const call = () =>
        screenSubject({
          subject: { kind: "PRODUCT", subjectId: "p1", ...fields } as never,
          members: [peanutSevere],
        });
      expect(call).not.toThrow();
      const result = expectScreened(call());
      // Malformed data is never a licence to conclude absence.
      expect(result.verdict).not.toBe("ALLOWED");
    });
  }

  it("does not iterate a string allergens field character by character", () => {
    // `for...of "peanut"` yields 6 single characters; the old code skipped them
    // silently, so the field looked empty and clean rather than malformed.
    const result = expectScreened(
      screenSubject({
        subject: { kind: "PRODUCT", subjectId: "p1", name: "Thing", allergens: "peanut" } as never,
        members: [peanutSevere],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("NO_ALLERGEN_DATA");
  });

  it("falls back to the subject id when the name is not usable text", () => {
    const result = expectScreened(
      screenSubject({
        subject: { kind: "PRODUCT", subjectId: "p-42", name: 42 } as never,
        members: [peanutSevere],
      }),
    );
    expect(result.unknowns[0]?.locus.ref).toBe("p-42");
  });

  it("is total on malformed recipe ingredient fields too", () => {
    const call = () =>
      screenSubject({
        subject: {
          kind: "RECIPE",
          subjectId: "r1",
          ingredients: [
            { ref: "flour", ingredientsText: 9, allergens: "milk", declaration: null },
            { ref: "water", declaration: 3 },
          ],
        } as never,
        members: [peanutSevere],
      });
    expect(call).not.toThrow();
    expect(expectScreened(call()).verdict).not.toBe("ALLOWED");
  });
});

describe("F5: alias folding is exercised end to end", () => {
  it("blocks a milk restriction on a product tagged `dairy`", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Creamer pods",
          ingredientsText: "water, sugar, vegetable oil",
          allergens: [contains("dairy")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "milk", "severe"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence[0]?.kind).toBe("ASSERTION_CONTAINS");
    // Evidence records the folded taxonomy code and the raw source spelling.
    expect(result.evidence[0]?.matchedTerm).toBe("milk");
    expect(result.evidence[0]?.matchedText).toBe("dairy");
  });

  it("blocks a soy restriction on a product tagged `soya`", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Bouillon cubes",
          ingredientsText: "salt, yeast extract",
          allergens: [contains("soya")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "soy", "standard"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence[0]?.matchedTerm).toBe("soy");
    expect(result.evidence[0]?.matchedText).toBe("soya");
  });

  it("blocks a shellfish restriction on a product tagged `crustacean`", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Seafood stock",
          ingredientsText: "water, vegetables, natural flavor",
          allergens: [contains("crustacean")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "shellfish", "severe"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence[0]?.matchedTerm).toBe("shellfish");
    expect(result.evidence[0]?.matchedText).toBe("crustacean");
  });

  it("folds an alias on a MAY_CONTAIN assertion too", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Biscuits",
          ingredientsText: "sugar, oil",
          allergens: [{ allergenCode: "tree nuts", assertion: "MAY_CONTAIN" }],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "tree_nut", "severe"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence[0]?.kind).toBe("ASSERTION_MAY_CONTAIN");
  });
});

describe("F3: invisible characters cannot hide an allergen from screening", () => {
  it("blocks a peanut recipe whatever zero-width character is spliced in", () => {
    for (const codePoint of [0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff]) {
      const char = String.fromCodePoint(codePoint);
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Snack mix",
            ingredientsText: `oats, roasted pea${char}nuts, salt`,
            allergens: [],
            declaration: fullDeclaration(),
          }),
          members: [peanutSevere],
        }),
      );
      expect(result.verdict, `U+${codePoint.toString(16)}`).toBe("BLOCKED");
    }
  });
});
