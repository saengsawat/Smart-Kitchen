/**
 * S8's nutrition strip (M3-T4e Objective (b)): which profile to show, its
 * basis label, and display-only rounding. `NutritionValuesDto` fields are
 * plain `number`s already (packages/contracts/src/products.ts's own doc
 * comment: "a printed label's macro grid, not inventory arithmetic the app
 * performs on them"), never exact-decimal-text quantities, so rounding one
 * for display with `Math.round` does not touch CLAUDE.md rule 7's ledger-math
 * discipline — the record's own stored value is never read back from this
 * module or written anywhere.
 */

import type { NutritionBasisDto, NutritionProfileDto } from "@smart-kitchen/contracts";

/** The strip's basis label, one word choice per BACKLOG.md M3-T4e Objective (b), verbatim ("per serving" / "per 100 g"). */
export const NUTRITION_BASIS_LABEL: Readonly<Record<NutritionBasisDto, string>> = {
  PER_SERVING: "per serving",
  PER_100G: "per 100 g",
};

/** Shown, with no numbers, when the record carries no nutrition profile at all. */
export const NUTRITION_NOT_ON_FILE_TEXT = "Nutrition not on file";

/**
 * S8 shows exactly one profile: `PER_SERVING` when the record has it, else
 * `PER_100G`, else none (Objective (b)). Never both, never the record's own
 * array order (OFF's own mapping puts `PER_100G` first, the M2-T4a follow-up
 * this ticket closes).
 */
export function selectNutritionProfile(
  profiles: readonly NutritionProfileDto[],
): NutritionProfileDto | undefined {
  return (
    profiles.find((profile) => profile.basis === "PER_SERVING") ??
    profiles.find((profile) => profile.basis === "PER_100G")
  );
}

/**
 * Display-only rounding: whole calories, one decimal place for grams and
 * milligrams (Objective (b)). `undefined` in, `undefined` out — a field the
 * record does not carry is never defaulted to zero (rule 3).
 */
export function roundForDisplay(
  value: number | undefined,
  kind: "kcal" | "g" | "mg",
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return kind === "kcal" ? Math.round(value) : Math.round(value * 10) / 10;
}
