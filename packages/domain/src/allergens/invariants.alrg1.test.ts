/**
 * INV-ALRG-1 — "No recommendation containing a known member allergen is ever
 * returned, regardless of LLM output" (testing-strategy.md §2).
 *
 * This suite is permanent (CLAUDE.md rule 13): it may not be deleted or
 * weakened to make a change pass. It is written adversarially — every test
 * here is an attempt to get a peanut-bearing subject past a peanut allergy.
 */

import { describe, expect, it } from "vitest";

import {
  MAJOR_ALLERGEN_CODES,
  MAJOR_ALLERGEN_LABELS,
  partitionByVerdict,
  screenSubject,
  type MajorAllergenCode,
  type ScreeningResult,
} from "./index.js";
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

const peanutAllergy = memberWith("m-alex", majorRestrictionOf("r1", "peanut", "severe"));

describe("INV-ALRG-1: a known allergen match always blocks", () => {
  it("blocks a peanut-bearing recipe against a peanut allergy", () => {
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("recipe-1", "chicken breast", "peanut butter", "lime juice"),
        members: [peanutAllergy],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]?.restrictionId).toBe("r1");
    expect(result.evidence[0]?.locus.ref).toBe("peanut butter");
  });

  it("blocks for every one of the nine major allergens", () => {
    for (const code of MAJOR_ALLERGEN_CODES) {
      const result = expectScreened(
        screenSubject({
          subject: recipeOf(`recipe-${code}`, "water", MAJOR_ALLERGEN_LABELS[code]),
          members: [memberWith("m1", majorRestrictionOf("r1", code, "standard"))],
        }),
      );
      expect(result.verdict, `expected ${code} to block`).toBe("BLOCKED");
    }
  });

  it("blocks regardless of case, punctuation and pluralization", () => {
    const variants = [
      "PEANUT BUTTER",
      "Peanut-Butter",
      "peanuts",
      "PeAnUt oil",
      "roasted   peanut",
      "(peanut)",
      "peanut, roasted",
    ];
    for (const variant of variants) {
      const result = expectScreened(
        screenSubject({ subject: recipeOf("r", "water", variant), members: [peanutAllergy] }),
      );
      expect(result.verdict, `expected "${variant}" to block`).toBe("BLOCKED");
    }
  });

  it("blocks on an explicit CONTAINS assertion whatever its provenance tier", () => {
    for (const tier of ["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION", "nonsense-tier"]) {
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "Trail mix",
            allergens: [contains("peanut", tier)],
            declaration: fullDeclaration(),
          }),
          members: [peanutAllergy],
        }),
      );
      expect(result.verdict, `expected tier ${tier} to block`).toBe("BLOCKED");
    }
  });

  it("blocks even when a KNOWN_FACT declaration claims the allergens are fully enumerated", () => {
    // The declaration licenses concluding *absence*; it cannot un-do a match.
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Peanut Butter Cups",
          ingredientsText: "sugar, peanuts, cocoa butter",
          allergens: [],
          declaration: fullDeclaration(),
        }),
        members: [peanutAllergy],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
  });

  it("blocks when one ingredient matches among many that are fully declared clean", () => {
    const clean = Array.from({ length: 20 }, (_, i) => ({
      ref: `clean ingredient ${String(i)}`,
      declaration: fullDeclaration(),
    }));
    const result = expectScreened(
      screenSubject({
        subject: recipeOf("recipe-big", ...clean, { ref: "peanut oil" }),
        members: [peanutAllergy],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
  });

  it("blocks the household when any single member is blocked", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Peanut brittle",
          allergens: [contains("peanut")],
          declaration: fullDeclaration(),
        }),
        members: [
          memberWith("m-clear", majorRestrictionOf("r1", "fish", "severe")),
          memberWith("m-none"),
          peanutAllergy,
        ],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.members.find((m) => m.memberId === "m-clear")?.verdict).not.toBe("BLOCKED");
    expect(result.members.find((m) => m.memberId === "m-alex")?.verdict).toBe("BLOCKED");
  });

  it("blocks on a user-defined term exactly as it does on a taxonomy code", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Tropical juice",
          ingredientsText: "water, mango puree",
          declaration: fullDeclaration(),
        }),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "standard"))],
      }),
    );
    expect(result.verdict).toBe("BLOCKED");
  });
});

describe("INV-ALRG-1: no input field can override a block", () => {
  const cleanSubject = recipeOf("recipe-1", "chicken breast", "peanut butter");
  const clean = expectScreened(screenSubject({ subject: cleanSubject, members: [peanutAllergy] }));

  it("ignores smuggled safety fields on the subject", () => {
    const smuggled = {
      ...cleanSubject,
      aiVerifiedSafe: true,
      verdict: "ALLOWED",
      allergenFree: true,
      skipScreening: true,
      screeningPassed: true,
      override: { blocked: false },
      __proto__safe: true,
    } as unknown as typeof cleanSubject;

    const result = expectScreened(screenSubject({ subject: smuggled, members: [peanutAllergy] }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result).toEqual(clean);
  });

  it("ignores smuggled fields on ingredients, members and restrictions", () => {
    const smuggled = {
      kind: "RECIPE",
      subjectId: "recipe-1",
      ingredients: [
        { ref: "chicken breast" },
        { ref: "peanut butter", aiVerifiedSafe: true, allergenFree: true, verdict: "ALLOWED" },
      ],
    } as unknown as typeof cleanSubject;

    const smuggledMembers = [
      {
        memberId: "m-alex",
        verdict: "ALLOWED",
        restrictions: [
          {
            kind: "MAJOR",
            restrictionId: "r1",
            allergen: "peanut",
            severity: "severe",
            waived: true,
            disabled: true,
            outcome: "NO_KNOWN_MATCH",
          },
        ],
      },
    ] as unknown as (typeof peanutAllergy)[];

    const result = expectScreened(screenSubject({ subject: smuggled, members: smuggledMembers }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result).toEqual(clean);
  });

  it("does not copy any unknown input field into the result", () => {
    const smuggled = {
      ...cleanSubject,
      aiVerifiedSafe: true,
      evilMarker: "should-not-appear",
    } as unknown as typeof cleanSubject;
    const result = expectScreened(screenSubject({ subject: smuggled, members: [peanutAllergy] }));
    expect(JSON.stringify(result)).not.toContain("should-not-appear");
    expect(JSON.stringify(result)).not.toContain("aiVerifiedSafe");
  });

  it("returns a deep-frozen result, so a verdict cannot be edited afterwards", () => {
    const result = expectScreened(
      screenSubject({ subject: cleanSubject, members: [peanutAllergy] }),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as { verdict: string }).verdict = "ALLOWED";
    }).toThrow(TypeError);
    expect(() => {
      (result.evidence as ScreeningResult["evidence"][number][]).pop();
    }).toThrow(TypeError);
    expect(result.verdict).toBe("BLOCKED");
  });

  it("keeps blocked results out of the recommendable partitions", () => {
    const partitioned = partitionByVerdict([clean]);
    expect(partitioned.blocked).toHaveLength(1);
    expect(partitioned.allowed).toHaveLength(0);
    expect(partitioned.allowedWithUnknowns).toHaveLength(0);
  });
});

describe("INV-ALRG-1: the API never asserts safety", () => {
  it("exposes no key whose name claims safety anywhere in a result", () => {
    const result = expectScreened(
      screenSubject({
        subject: productOf("p1", {
          name: "Trail mix",
          ingredientsText: "oats, raisins",
          allergens: [contains("peanut")],
          declaration: fullDeclaration(),
        }),
        members: [peanutAllergy],
      }),
    );

    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        keys.add(key);
        walk(child);
      }
    };
    walk(result);

    for (const key of keys) {
      expect(/safe|allergenfree|isok/i.test(key), `result key "${key}" claims safety`).toBe(false);
    }
  });

  it("only ever produces the three documented verdicts", () => {
    const subjects = [
      recipeOf("r1", "peanut butter"),
      recipeOf("r2", "chicken breast"),
      productOf("p1", { name: "water", allergens: [], declaration: fullDeclaration() }),
    ];
    const seen = new Set<string>();
    for (const subject of subjects) {
      const result = expectScreened(screenSubject({ subject, members: [peanutAllergy] }));
      seen.add(result.verdict);
      for (const member of result.members) seen.add(member.verdict);
    }
    for (const verdict of seen) {
      expect(["BLOCKED", "ALLOWED_WITH_UNKNOWNS", "ALLOWED"]).toContain(verdict);
    }
    // All three states are reachable with the three subjects above.
    expect(seen.size).toBe(3);
  });

  it("carries the standing no-guarantee warning on every result, including ALLOWED ones", () => {
    const codes: MajorAllergenCode[] = ["peanut", "milk"];
    for (const code of codes) {
      const result = expectScreened(
        screenSubject({
          subject: productOf("p1", {
            name: "water",
            allergens: [],
            declaration: fullDeclaration(),
          }),
          members: [memberWith("m1", majorRestrictionOf("r1", code, "standard"))],
        }),
      );
      expect(result.verdict).toBe("ALLOWED");
      expect(result.warnings.map((w) => w.code)).toContain("NO_SAFETY_GUARANTEE");
    }
  });
});
