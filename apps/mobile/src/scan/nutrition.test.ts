/**
 * S8 nutrition-strip helpers (M3-T4e Objective (b)): profile choice, basis
 * label and display-only rounding.
 */
import { describe, expect, it } from "vitest";
import type { NutritionProfileDto } from "@smart-kitchen/contracts";
import { NUTRITION_BASIS_LABEL, roundForDisplay, selectNutritionProfile } from "./nutrition";

const PROVENANCE = {
  tier: "ESTIMATED",
  source: "open-food-facts",
  confidence: null,
  recordedAt: "2026-09-29T00:00:00.000Z",
} as const;

function profile(basis: "PER_SERVING" | "PER_100G"): NutritionProfileDto {
  return { basis, values: { calories: 100 }, provenance: PROVENANCE };
}

describe("selectNutritionProfile", () => {
  it("prefers PER_SERVING when both are present", () => {
    const per100g = profile("PER_100G");
    const perServing = profile("PER_SERVING");
    expect(selectNutritionProfile([per100g, perServing])).toBe(perServing);
  });

  it("falls back to PER_100G when there is no PER_SERVING", () => {
    const per100g = profile("PER_100G");
    expect(selectNutritionProfile([per100g])).toBe(per100g);
  });

  it("is undefined when there is no profile at all", () => {
    expect(selectNutritionProfile([])).toBeUndefined();
  });
});

describe("NUTRITION_BASIS_LABEL", () => {
  it("matches BACKLOG.md M3-T4e Objective (b) verbatim", () => {
    expect(NUTRITION_BASIS_LABEL.PER_SERVING).toBe("per serving");
    expect(NUTRITION_BASIS_LABEL.PER_100G).toBe("per 100 g");
  });
});

describe("roundForDisplay", () => {
  it("rounds calories to a whole number", () => {
    expect(roundForDisplay(562.5, "kcal")).toBe(563);
    expect(roundForDisplay(180, "kcal")).toBe(180);
    expect(roundForDisplay(0.4, "kcal")).toBe(0);
  });

  it("rounds grams to one decimal place", () => {
    expect(roundForDisplay(10.94, "g")).toBe(10.9);
    expect(roundForDisplay(12.5, "g")).toBe(12.5);
    expect(roundForDisplay(1.56, "g")).toBe(1.6);
  });

  it("rounds milligrams to one decimal place", () => {
    expect(roundForDisplay(0.203125, "mg")).toBe(0.2);
  });

  it("passes undefined through, never defaulting to zero", () => {
    expect(roundForDisplay(undefined, "kcal")).toBeUndefined();
    expect(roundForDisplay(undefined, "g")).toBeUndefined();
  });
});
