import { describe, expect, it } from "vitest";

import {
  CROSS_CONTACT_POLICY,
  partitionByVerdict,
  screenSubject,
  screenSubjects,
  type RestrictionSeverity,
  type ScreeningResult,
} from "./index.js";
import {
  contains,
  expectScreened,
  fullDeclaration,
  majorRestrictionOf,
  mayContain,
  memberWith,
  productOf,
  recipeOf,
  userTermRestriction,
  verdictOfMember,
} from "./test-support.js";

function errorCode(result: { ok: boolean; error?: { code: string } }): string {
  expect(result.ok).toBe(false);
  return result.error?.code ?? "NO_ERROR";
}

describe("input validation (fails closed)", () => {
  const member = memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"));

  it("rejects malformed subjects", () => {
    expect(errorCode(screenSubject({ subject: null, members: [member] } as never))).toBe(
      "NOT_AN_OBJECT",
    );
    expect(
      errorCode(screenSubject({ subject: { kind: "RECIPE" }, members: [member] } as never)),
    ).toBe("EMPTY_SUBJECT_ID");
    expect(
      errorCode(
        screenSubject({ subject: { kind: "MEAL", subjectId: "s1" }, members: [member] } as never),
      ),
    ).toBe("INVALID_SUBJECT_KIND");
  });

  it("refuses an empty recipe rather than returning a vacuous no-known-match", () => {
    expect(
      errorCode(
        screenSubject({
          subject: { kind: "RECIPE", subjectId: "r1", ingredients: [] },
          members: [member],
        }),
      ),
    ).toBe("EMPTY_RECIPE");
  });

  it("rejects an ingredient with no reference", () => {
    expect(
      errorCode(
        screenSubject({
          subject: { kind: "RECIPE", subjectId: "r1", ingredients: [{ ref: "  " }] },
          members: [member],
        }),
      ),
    ).toBe("EMPTY_INGREDIENT_REF");
  });

  it("propagates member validation errors", () => {
    expect(
      errorCode(
        screenSubject({
          subject: recipeOf("r1", "water"),
          members: [
            {
              memberId: "m1",
              restrictions: [
                { kind: "MAJOR", restrictionId: "r1", allergen: "banana", severity: "severe" },
              ],
            },
          ] as never,
        }),
      ),
    ).toBe("UNKNOWN_ALLERGEN_CODE");
  });

  it("screens a household with no members or no restrictions as ALLOWED", () => {
    const noMembers = expectScreened(
      screenSubject({ subject: recipeOf("r1", "peanut butter"), members: [] }),
    );
    expect(noMembers.verdict).toBe("ALLOWED");
    expect(noMembers.warnings.map((w) => w.code)).toEqual(["NO_SAFETY_GUARANTEE"]);

    const noRestrictions = expectScreened(
      screenSubject({ subject: recipeOf("r1", "peanut butter"), members: [memberWith("m1")] }),
    );
    expect(noRestrictions.verdict).toBe("ALLOWED");
    expect(verdictOfMember(noRestrictions, "m1")).toBe("ALLOWED");
  });
});

describe("cross-contact (MAY_CONTAIN) severity matrix", () => {
  const subject = productOf("p1", {
    name: "Brownie bites",
    ingredientsText: "sugar, cocoa",
    allergens: [mayContain("tree_nut")],
    declaration: fullDeclaration(),
  });

  const matrix: readonly (readonly [RestrictionSeverity, ScreeningResult["verdict"], string])[] = [
    ["severe", "BLOCKED", "CROSS_CONTACT_SEVERE"],
    ["standard", "ALLOWED_WITH_UNKNOWNS", "CROSS_CONTACT"],
  ];

  for (const [severity, verdict, warningCode] of matrix) {
    it(`${severity} + MAY_CONTAIN => ${verdict} with a ${warningCode} warning`, () => {
      const result = expectScreened(
        screenSubject({
          subject,
          members: [memberWith("m1", majorRestrictionOf("r1", "tree_nut", severity))],
        }),
      );
      expect(result.verdict).toBe(verdict);
      expect(result.members[0]?.restrictions[0]?.outcome).toBe("POSSIBLE_MATCH");
      const warning = result.warnings.find((w) => w.code === warningCode);
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe(severity === "severe" ? "critical" : "high");
    });
  }

  it("keeps the policy as data, with no caller-supplied way to relax it", () => {
    expect(CROSS_CONTACT_POLICY).toEqual({ severe: "BLOCK", standard: "WARN_UNKNOWN" });
    expect(Object.isFrozen(CROSS_CONTACT_POLICY)).toBe(true);
  });

  it("lets a CONTAINS match outrank a MAY_CONTAIN on the same allergen", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Nut brownie",
          allergens: [mayContain("tree_nut"), contains("tree_nut")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "tree_nut", "standard"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.members[0]?.restrictions[0]?.outcome).toBe("MATCH");
  });
});

describe("evidence", () => {
  it("explains an assertion match with its source and tier", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Whole milk",
          allergens: [contains("milk", "KNOWN_FACT", "manufacturer-label")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "milk", "standard"))],
      }),
    );
    const assertionEvidence = result.evidence.find((e) => e.kind === "ASSERTION_CONTAINS");
    expect(assertionEvidence).toMatchObject({
      memberId: "m1",
      restrictionId: "r1",
      restrictionLabel: "milk",
      severity: "standard",
      matchedTerm: "milk",
      assertionSource: "manufacturer-label",
      assertionTier: "KNOWN_FACT",
      locus: { part: "PRODUCT", ref: "Whole milk" },
    });
  });

  it("explains a text match with the matched span", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Breakfast bar",
          ingredientsText: "oats, honey, roasted PEANUTS, salt",
        }),
        members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
      }),
    );
    const textEvidence = result.evidence.find((e) => e.kind === "INGREDIENT_TEXT_TERM");
    expect(textEvidence?.matchedTerm).toBe("peanut");
    expect(textEvidence?.matchedText).toBe("peanuts");
  });

  it("points at the offending recipe ingredient by index", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("r1", "chicken", "peanut oil", "rice"),
        members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
      }),
    );
    expect(result.evidence[0]?.locus).toEqual({
      part: "RECIPE_INGREDIENT",
      ref: "peanut oil",
      ingredientIndex: 1,
    });
  });

  it("matches a user-defined term against an assertion code the taxonomy lacks", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Table sauce",
          ingredientsText: "water, spices",
          allergens: [contains("mustard")],
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", userTermRestriction("r1", "mustard", "severe"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence[0]?.kind).toBe("ASSERTION_CODE_TERM");
    expect(result.evidence[0]?.matchedText).toBe("mustard");
  });
});

describe("aggregation", () => {
  it("takes the worst restriction verdict for a member and the worst member verdict for the household", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Cookies",
          ingredientsText: "wheat flour, sugar, butter, eggs",
          allergens: [contains("wheat"), contains("milk"), contains("egg"), mayContain("tree_nut")],
          declaration: fullDeclaration(),
        }),
        members: [
          memberWith("m-clear", majorRestrictionOf("r-a", "peanut", "severe")),
          memberWith("m-warn", majorRestrictionOf("r-b", "tree_nut", "standard")),
          memberWith(
            "m-blocked",
            majorRestrictionOf("r-c", "peanut", "standard"),
            majorRestrictionOf("r-d", "milk", "severe"),
          ),
        ],
      }),
    );
    expect(verdictOfMember(result, "m-clear")).toBe("ALLOWED");
    expect(verdictOfMember(result, "m-warn")).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(verdictOfMember(result, "m-blocked")).toBe("BLOCKED");
    expect(result.verdict).toBe("BLOCKED");
  });

  it("preserves member and restriction order from the input", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("r1", "water"),
        members: [
          memberWith("m2", majorRestrictionOf("r-x", "soy", "standard")),
          memberWith(
            "m1",
            majorRestrictionOf("r-y", "egg", "standard"),
            majorRestrictionOf("r-z", "fish", "standard"),
          ),
        ],
      }),
    );
    expect(result.members.map((m) => m.memberId)).toEqual(["m2", "m1"]);
    expect(result.members[1]?.restrictions.map((r) => r.restrictionId)).toEqual(["r-y", "r-z"]);
  });
});

describe("determinism", () => {
  it("returns identical results for identical inputs", () => {
    const build = (): ScreeningResult =>
      expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Cookies",
            ingredientsText: "wheat flour, butter, eggs, chopped walnuts",
            allergens: [contains("wheat"), mayContain("peanut")],
            declaration: fullDeclaration(),
          }),
          members: [
            memberWith("m1", majorRestrictionOf("r1", "peanut", "standard")),
            memberWith("m2", majorRestrictionOf("r2", "tree_nut", "severe")),
          ],
        }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("screenSubjects and partitionByVerdict", () => {
  const members = [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))];

  it("screens a batch in order", () => {
    const result = screenSubjects(
      [
        recipeOf("blocked", "peanut butter"),
        recipeOf("unknown", "chicken"),
        productOf("allowed", { name: "water", allergens: [], declaration: fullDeclaration() }),
      ],
      members,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.subjectId)).toEqual(["blocked", "unknown", "allowed"]);
    const partitioned = partitionByVerdict(result.value);
    expect(partitioned.blocked.map((r) => r.subjectId)).toEqual(["blocked"]);
    expect(partitioned.allowedWithUnknowns.map((r) => r.subjectId)).toEqual(["unknown"]);
    expect(partitioned.allowed.map((r) => r.subjectId)).toEqual(["allowed"]);
  });

  it("fails the batch on the first invalid subject rather than returning partial results", () => {
    const result = screenSubjects(
      [recipeOf("ok", "water"), { kind: "RECIPE", subjectId: "bad", ingredients: [] }],
      members,
    );
    expect(errorCode(result)).toBe("EMPTY_RECIPE");
  });
});
