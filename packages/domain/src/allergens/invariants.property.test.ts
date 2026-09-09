/**
 * Property-based invariant tests for allergen screening.
 *
 * These generalise the example-based INV-ALRG-1/INV-ALRG-2 suites: rather than
 * asserting one adversarial input is handled, they assert the shape of the
 * whole space — a match always blocks, extra fields never matter, more
 * restrictions never loosen a verdict.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import {
  ALLERGEN_TERM_PHRASES,
  MAJOR_ALLERGEN_CODES,
  findTermMatches,
  compileTerms,
  screenSubject,
  type MajorAllergenCode,
  type RecipeIngredientInput,
  type ScreenedMember,
  type ScreeningVerdict,
} from "./index.js";
import {
  expectScreened,
  fullDeclaration,
  majorRestrictionOf,
  memberWith,
  recipeOf,
} from "./test-support.js";

const VERDICT_RANK: Readonly<Record<ScreeningVerdict, number>> = {
  BLOCKED: 3,
  ALLOWED_WITH_UNKNOWNS: 2,
  ALLOWED: 1,
};

/** Arbitrary non-empty ingredient name made of letters and spaces. */
const ingredientName = fc
  .string()
  .map((raw) => raw.replace(/[^a-zA-Z ]/g, "").trim())
  .map((clean) => (clean === "" ? "plain ingredient" : clean));

const severity = fc.constantFrom("standard" as const, "severe" as const);
const allergenCode = fc.constantFrom(...MAJOR_ALLERGEN_CODES);

describe("property: a curated term anywhere in a recipe always blocks (INV-ALRG-1)", () => {
  it("blocks whatever else the recipe contains and wherever the term sits", () => {
    fc.assert(
      fc.property(
        allergenCode,
        fc.array(ingredientName, { maxLength: 8 }),
        fc.nat(),
        severity,
        (code, others, positionSeed, memberSeverity) => {
          const phrases = ALLERGEN_TERM_PHRASES[code];
          const phrase = phrases[positionSeed % phrases.length];
          if (phrase === undefined) return true;

          const ingredients: RecipeIngredientInput[] = others.map((ref) => ({ ref }));
          const insertAt = positionSeed % (ingredients.length + 1);
          ingredients.splice(insertAt, 0, { ref: phrase, declaration: fullDeclaration() });

          const result = expectScreened(
            screenSubject({
              subject: { kind: "RECIPE", subjectId: "prop-recipe", ingredients },
              members: [memberWith("m1", majorRestrictionOf("r1", code, memberSeverity))],
            }),
          );
          return result.verdict === "BLOCKED" && result.evidence.length > 0;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("property: unknown input fields never change a verdict", () => {
  it("ignores arbitrary extra properties on subject, ingredients and restrictions", () => {
    fc.assert(
      fc.property(
        fc.array(ingredientName, { minLength: 1, maxLength: 5 }),
        allergenCode,
        fc.dictionary(
          fc.constantFrom("aiVerifiedSafe", "verdict", "override", "trusted", "x"),
          fc.oneof(fc.boolean(), fc.string(), fc.constant("ALLOWED")),
        ),
        (names, code, smuggled) => {
          const baseIngredients = names.map((ref) => ({ ref }));
          const members = [memberWith("m1", majorRestrictionOf("r1", code, "severe"))];

          const clean = expectScreened(
            screenSubject({
              subject: { kind: "RECIPE", subjectId: "prop-recipe", ingredients: baseIngredients },
              members,
            }),
          );

          const dirtySubject = {
            kind: "RECIPE",
            subjectId: "prop-recipe",
            ...smuggled,
            ingredients: baseIngredients.map((i) => ({ ...i, ...smuggled })),
          } as never;
          const dirtyMembers = [
            {
              memberId: "m1",
              ...smuggled,
              restrictions: [
                {
                  kind: "MAJOR",
                  restrictionId: "r1",
                  allergen: code,
                  severity: "severe",
                  ...smuggled,
                },
              ],
            },
          ] as unknown as ScreenedMember[];

          const dirty = expectScreened(
            screenSubject({ subject: dirtySubject, members: dirtyMembers }),
          );
          return JSON.stringify(clean) === JSON.stringify(dirty);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: verdicts only ever get worse as restrictions are added", () => {
  it("adding a restriction never loosens the member verdict", () => {
    fc.assert(
      fc.property(
        fc.array(ingredientName, { minLength: 1, maxLength: 5 }),
        allergenCode,
        allergenCode,
        severity,
        (names, first, second, sev) => {
          const subject = recipeOf("prop-recipe", ...names);
          const before = expectScreened(
            screenSubject({
              subject,
              members: [memberWith("m1", majorRestrictionOf("r1", first, sev))],
            }),
          );
          const after = expectScreened(
            screenSubject({
              subject,
              members: [
                memberWith(
                  "m1",
                  majorRestrictionOf("r1", first, sev),
                  majorRestrictionOf("r2", second, sev),
                ),
              ],
            }),
          );
          return VERDICT_RANK[after.verdict] >= VERDICT_RANK[before.verdict];
        },
      ),
      { numRuns: 200 },
    );
  });

  it("adding a member never loosens the household verdict", () => {
    fc.assert(
      fc.property(
        fc.array(ingredientName, { minLength: 1, maxLength: 5 }),
        allergenCode,
        allergenCode,
        (names, first, second) => {
          const subject = recipeOf("prop-recipe", ...names);
          const one = [memberWith("m1", majorRestrictionOf("r1", first, "standard"))];
          const two = [...one, memberWith("m2", majorRestrictionOf("r1", second, "severe"))];
          const before = expectScreened(screenSubject({ subject, members: one }));
          const after = expectScreened(screenSubject({ subject, members: two }));
          return VERDICT_RANK[after.verdict] >= VERDICT_RANK[before.verdict];
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: household verdict is exactly the worst member verdict", () => {
  it("equals the maximum member rank", () => {
    fc.assert(
      fc.property(
        fc.array(ingredientName, { minLength: 1, maxLength: 4 }),
        fc.array(fc.tuple(allergenCode, severity), { minLength: 1, maxLength: 4 }),
        (names, memberSpecs) => {
          const members = memberSpecs.map((spec, index) =>
            memberWith(`m${String(index)}`, majorRestrictionOf("r1", spec[0], spec[1])),
          );
          const result = expectScreened(
            screenSubject({ subject: recipeOf("prop-recipe", ...names), members }),
          );
          const worst = Math.max(...result.members.map((m) => VERDICT_RANK[m.verdict]));
          return VERDICT_RANK[result.verdict] === worst;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: screening is deterministic", () => {
  it("produces byte-identical results for the same input", () => {
    fc.assert(
      fc.property(
        fc.array(ingredientName, { minLength: 1, maxLength: 6 }),
        allergenCode,
        severity,
        (names, code, sev) => {
          const input = {
            subject: recipeOf("prop-recipe", ...names),
            members: [memberWith("m1", majorRestrictionOf("r1", code, sev))],
          };
          const first = expectScreened(screenSubject(input));
          const second = expectScreened(screenSubject(input));
          return JSON.stringify(first) === JSON.stringify(second);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: term matching is token equality, never substring containment", () => {
  it("never matches a term glued inside a longer token", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("peanut", "milk", "soy", "sesame", "wheat"),
        fc
          .string()
          .map((s) => s.replace(/[^a-z]/g, ""))
          .filter((s) => s.length > 0),
        (term, glue) => {
          const terms = compileTerms([term]);
          // The glued token is a single token that merely *contains* the term.
          const glued = `${glue}${term}${glue}`;
          if (glued === term) return true;
          return findTermMatches(glued, terms).length === 0;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is invariant to case and to punctuation used as a separator", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("peanut", "milk", "soy"),
        fc.constantFrom(",", ";", "-", "/", "  ", "()"),
        (code: MajorAllergenCode, separator: string) => {
          const terms = compileTerms([...ALLERGEN_TERM_PHRASES[code]]);
          const text = `water${separator}${code.toUpperCase()}${separator}salt`;
          return findTermMatches(text, terms).length > 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});
