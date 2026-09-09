/**
 * Builders shared by the allergen screening tests.
 *
 * Same convention as `inventory/test-support.ts`: it lives in `src/` so it
 * stays inside the package tsconfig under the same strict settings as the code
 * it exercises, is deliberately dependency-free (no vitest, no fast-check, no
 * `node:*`) so the domain dependency-boundary lint applies to it unchanged, and
 * is not re-exported from the package's public API.
 */

import type {
  AllergenAssertionInput,
  AllergenDeclaration,
  AllergyRestriction,
  MajorAllergenCode,
  ProductSubjectInput,
  RecipeIngredientInput,
  RecipeSubjectInput,
  RestrictionSeverity,
  ScreenedMember,
  ScreeningResult,
  ScreeningVerdict,
} from "./index.js";

export const OBSERVED_AT = "2026-08-15T00:00:00.000Z";

/** A `KNOWN_FACT` declaration claiming both kinds of completeness — the only route to `ALLOWED`. */
export function fullDeclaration(source = "manufacturer-label"): AllergenDeclaration {
  return {
    majorAllergens: "COMPLETE_FOR_MAJOR_ALLERGENS",
    ingredientStatement: "COMPLETE",
    tier: "KNOWN_FACT",
    source,
    observedAt: OBSERVED_AT,
  };
}

/** A declaration that claims nothing — the common real-world case. */
export function partialDeclaration(source = "vendor-feed"): AllergenDeclaration {
  return {
    majorAllergens: "PARTIAL",
    ingredientStatement: "PARTIAL",
    tier: "KNOWN_FACT",
    source,
    observedAt: OBSERVED_AT,
  };
}

export function contains(
  allergenCode: string,
  tier = "KNOWN_FACT",
  source = "manufacturer-label",
): AllergenAssertionInput {
  return {
    allergenCode,
    assertion: "CONTAINS",
    provenance: { tier, source, observedAt: OBSERVED_AT },
  };
}

export function mayContain(
  allergenCode: string,
  tier = "KNOWN_FACT",
  source = "manufacturer-label",
): AllergenAssertionInput {
  return {
    allergenCode,
    assertion: "MAY_CONTAIN",
    provenance: { tier, source, observedAt: OBSERVED_AT },
  };
}

export function majorRestrictionOf(
  restrictionId: string,
  allergen: MajorAllergenCode,
  severity: RestrictionSeverity = "severe",
): AllergyRestriction {
  return { kind: "MAJOR", restrictionId, allergen, severity };
}

export function userTermRestriction(
  restrictionId: string,
  term: string,
  severity: RestrictionSeverity = "severe",
): AllergyRestriction {
  return { kind: "USER_DEFINED", restrictionId, term, severity };
}

export function memberWith(
  memberId: string,
  ...restrictions: readonly AllergyRestriction[]
): ScreenedMember {
  return { memberId, restrictions };
}

export function recipeOf(
  subjectId: string,
  ...ingredients: readonly (string | RecipeIngredientInput)[]
): RecipeSubjectInput {
  return {
    kind: "RECIPE",
    subjectId,
    ingredients: ingredients.map((i) => (typeof i === "string" ? { ref: i } : i)),
  };
}

export function productOf(
  subjectId: string,
  fields: Omit<ProductSubjectInput, "kind" | "subjectId"> = {},
): ProductSubjectInput {
  return { kind: "PRODUCT", subjectId, ...fields };
}

/** Unwraps a successful screening or throws with the error code — keeps tests readable. */
export function expectScreened(result: {
  ok: boolean;
  value?: ScreeningResult;
  error?: { code: string; message: string };
}): ScreeningResult {
  if (!result.ok || result.value === undefined) {
    throw new Error(`expected a screening result, got error: ${result.error?.code ?? "unknown"}`);
  }
  return result.value;
}

/** Sorted, de-duplicated list helper for set-style assertions. */
export function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

export function verdictOfMember(result: ScreeningResult, memberId: string): ScreeningVerdict {
  const member = result.members.find((m) => m.memberId === memberId);
  if (member === undefined) throw new Error(`no result for member ${memberId}`);
  return member.verdict;
}
