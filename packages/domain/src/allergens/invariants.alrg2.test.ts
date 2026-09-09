/**
 * INV-ALRG-2 — "Missing allergen data surfaces as *unknown + warning*, never as
 * safe" (testing-strategy.md §2; SR-2; FR-ALG-2).
 *
 * Permanent suite (CLAUDE.md rule 13). The theme throughout: silence in the
 * data is never evidence of absence, and the only thing that ever licenses an
 * `ALLOWED` verdict is an explicit `KNOWN_FACT` completeness declaration.
 */

import { describe, expect, it } from "vitest";

import { screenSubject, type ScreeningUnknown } from "./index.js";
import {
  contains,
  expectScreened,
  fullDeclaration,
  majorRestrictionOf,
  memberWith,
  partialDeclaration,
  productOf,
  recipeOf,
  uniqueSorted,
  userTermRestriction,
} from "./test-support.js";

const milkStandard = memberWith("m-jamie", majorRestrictionOf("r1", "milk", "standard"));
const milkSevere = memberWith("m-alex", majorRestrictionOf("r1", "milk", "severe"));

describe("INV-ALRG-2: missing data never passes silently", () => {
  it("reports unknown, not allowed, for a bare recipe of ingredient names", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("recipe-1", "chicken breast", "olive oil", "garlic"),
        members: [milkStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(uniqueSorted(result.unknowns.map((u) => u.reason))).toEqual(["NO_ALLERGEN_DATA"]);
  });

  it("raises one unknown per unresolved locus, so the gap is visible per ingredient", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("recipe-1", "chicken breast", "olive oil", "garlic"),
        members: [milkStandard],
      }),
    );
    expect(result.unknowns).toHaveLength(3);
    expect(result.unknowns.map((u) => u.locus.ref)).toEqual([
      "chicken breast",
      "olive oil",
      "garlic",
    ]);
  });

  it("names what is unknown and where, on every unknown payload", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("recipe-1", "chicken breast"),
        members: [milkSevere, memberWith("m2", userTermRestriction("r2", "mango", "standard"))],
      }),
    );
    expect(result.unknowns.length).toBeGreaterThan(0);
    for (const unknown of result.unknowns satisfies readonly ScreeningUnknown[]) {
      expect(unknown.memberId).toBeTruthy();
      expect(unknown.restrictionId).toBeTruthy();
      expect(unknown.restrictionLabel).toBeTruthy();
      expect(unknown.severity).toBeTruthy();
      expect(unknown.reason).toBeTruthy();
      expect(unknown.locus.ref).toBeTruthy();
      expect(unknown.detail.length).toBeGreaterThan(0);
    }
  });

  it("adds a critical warning when the member's allergy is severe", () => {
    const result = expectScreened(
      screenSubject({ subject: recipeOf("recipe-1", "chicken breast"), members: [milkSevere] }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    const severeWarning = result.warnings.find((w) => w.code === "SEVERE_ALLERGY_UNKNOWN_DATA");
    expect(severeWarning?.severity).toBe("critical");
    expect(severeWarning?.memberId).toBe("m-alex");
    expect(severeWarning?.restrictionLabel).toBe("milk");
  });

  it("never reports ALLOWED without an explicit completeness declaration", () => {
    const subjectsWithoutLicence = [
      // No declaration at all.
      productOf("p1", { name: "Plain water", ingredientsText: "water", allergens: [] }),
      // A declaration that claims nothing.
      productOf("p2", {
        name: "Plain water",
        ingredientsText: "water",
        allergens: [],
        declaration: partialDeclaration(),
      }),
      // Completeness claimed, but not at KNOWN_FACT tier.
      productOf("p3", {
        name: "Plain water",
        ingredientsText: "water",
        allergens: [],
        declaration: { ...fullDeclaration(), tier: "AI_INTERPRETATION" },
      }),
      productOf("p4", {
        name: "Plain water",
        ingredientsText: "water",
        allergens: [],
        declaration: { ...fullDeclaration(), tier: "ESTIMATED" },
      }),
      // An allergen tag list is not a completeness claim on its own.
      productOf("p5", {
        name: "Plain bread",
        ingredientsText: "water, yeast",
        allergens: [contains("wheat")],
      }),
    ];

    for (const subject of subjectsWithoutLicence) {
      const result = expectScreened(screenSubject({ subject, members: [milkStandard] }));
      expect(result.verdict, `subject ${subject.subjectId} must not be ALLOWED`).toBe(
        "ALLOWED_WITH_UNKNOWNS",
      );
      expect(result.unknowns.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes why it could not conclude", () => {
    const expectations: readonly (readonly [string, ScreeningUnknown["reason"]])[] = [
      ["p-none", "NO_ALLERGEN_DATA"],
      ["p-partial", "INCOMPLETE_DECLARATION"],
      ["p-ai", "UNVERIFIED_DECLARATION_TIER"],
    ];
    const subjects = {
      "p-none": productOf("p-none", { name: "Water", ingredientsText: "water" }),
      "p-partial": productOf("p-partial", {
        name: "Water",
        ingredientsText: "water",
        declaration: partialDeclaration(),
      }),
      "p-ai": productOf("p-ai", {
        name: "Water",
        ingredientsText: "water",
        declaration: { ...fullDeclaration(), tier: "AI_INTERPRETATION" },
      }),
    } as const;

    for (const [id, reason] of expectations) {
      const result = expectScreened(
        screenSubject({ subject: subjects[id as keyof typeof subjects], members: [milkStandard] }),
      );
      expect(result.unknowns[0]?.reason, `subject ${id}`).toBe(reason);
    }
  });

  it("reports NO_INGREDIENT_TEXT when a user-defined term has nothing to scan", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", { allergens: [], declaration: fullDeclaration() }),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "standard"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("NO_INGREDIENT_TEXT");
  });

  it("does not let a major-allergen declaration resolve a user-defined term", () => {
    // A US label enumerating the nine majors says nothing about mango.
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Fruit blend",
          ingredientsText: "water, apple juice",
          allergens: [],
          declaration: {
            majorAllergens: "COMPLETE_FOR_MAJOR_ALLERGENS",
            ingredientStatement: "PARTIAL",
            tier: "KNOWN_FACT",
            source: "manufacturer-label",
          },
        }),
        members: [
          memberWith("m1", majorRestrictionOf("r1", "milk", "standard")),
          memberWith("m2", userTermRestriction("r2", "mango", "standard")),
        ],
      }),
    );
    expect(result.members.find((m) => m.memberId === "m1")?.verdict).toBe("ALLOWED");
    expect(result.members.find((m) => m.memberId === "m2")?.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
  });

  it("treats an allergen code outside the taxonomy as unknown, never as no-allergen", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Table sauce",
          ingredientsText: "water, vinegar",
          allergens: [contains("mustard")],
          declaration: fullDeclaration(),
        }),
        members: [milkStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("UNRECOGNIZED_ASSERTION_CODE");
    expect(result.unknowns[0]?.detail).toContain("mustard");
    expect(result.warnings.map((w) => w.code)).toContain("UNRECOGNIZED_ALLERGEN_DATA");
  });

  it("cannot be cleared by an invented negative assertion", () => {
    for (const forgedKind of [
      "DOES_NOT_CONTAIN",
      "FREE_FROM",
      "ALLERGEN_FREE",
      "",
      "CONTAINS_NOT",
    ]) {
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Snack mix",
            ingredientsText: "oats, raisins",
            allergens: [{ allergenCode: "milk", assertion: forgedKind }],
            declaration: fullDeclaration(),
          }),
          members: [milkStandard],
        }),
      );
      expect(result.verdict, `forged kind ${forgedKind}`).toBe("ALLOWED_WITH_UNKNOWNS");
      expect(result.unknowns[0]?.reason).toBe("UNRECOGNIZED_ASSERTION_KIND");
    }
  });

  it("degrades the whole recipe to unknown when only some ingredients are declared", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf(
          "recipe-1",
          { ref: "rolled oats", declaration: fullDeclaration(), allergens: [] },
          { ref: "mystery seasoning blend" },
        ),
        members: [milkStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns).toHaveLength(1);
    expect(result.unknowns[0]?.locus.ref).toBe("mystery seasoning blend");
  });

  it("reaches ALLOWED only when every locus is fully declared", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf(
          "recipe-1",
          { ref: "rolled oats", declaration: fullDeclaration(), allergens: [] },
          { ref: "raisins", declaration: fullDeclaration(), allergens: [] },
        ),
        members: [milkStandard],
      }),
    );
    expect(result.verdict).toBe("ALLOWED");
    expect(result.unknowns).toHaveLength(0);
    expect(result.warnings.map((w) => w.code)).toEqual(["NO_SAFETY_GUARANTEE"]);
  });
});
