import { describe, expect, it } from "vitest";
import { HOUSEHOLD_NAME_MAX_LENGTH, togglePreference, validateHouseholdName } from "./validation";

describe("validateHouseholdName", () => {
  it("rejects an empty name", () => {
    const result = validateHouseholdName("");
    expect(result).toEqual({ ok: false, message: "Enter a household name to continue." });
  });

  it("rejects a whitespace-only name", () => {
    const result = validateHouseholdName("    ");
    expect(result.ok).toBe(false);
  });

  it("trims surrounding whitespace on a valid name", () => {
    const result = validateHouseholdName("  The Chens  ");
    expect(result).toEqual({ ok: true, name: "The Chens" });
  });

  it("accepts a name at exactly the 60-character maximum", () => {
    const name = "A".repeat(HOUSEHOLD_NAME_MAX_LENGTH);
    expect(validateHouseholdName(name)).toEqual({ ok: true, name });
  });

  it("rejects a name over 60 characters", () => {
    const name = "A".repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1);
    const result = validateHouseholdName(name);
    expect(result.ok).toBe(false);
  });

  it("accepts a single-character name (the 1-character floor)", () => {
    expect(validateHouseholdName("X")).toEqual({ ok: true, name: "X" });
  });
});

describe("togglePreference", () => {
  it("adds a preference not already present", () => {
    expect(togglePreference([], "Vegetarian")).toEqual(["Vegetarian"]);
  });

  it("removes a preference already present", () => {
    expect(togglePreference(["Vegetarian", "High protein"], "Vegetarian")).toEqual([
      "High protein",
    ]);
  });

  it("leaves other preferences untouched", () => {
    expect(togglePreference(["Kid-friendly"], "Vegetarian")).toEqual([
      "Kid-friendly",
      "Vegetarian",
    ]);
  });
});
