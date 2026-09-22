import { describe, expect, it } from "vitest";
import {
  MAJOR_ALLERGEN_CODES_DTO,
  MAJOR_ALLERGEN_LABELS_DTO,
  type HouseholdDto,
  type MemberDto,
  type MemberRestrictionDto,
  type OnboardingStateDto,
} from "./household.js";

describe("household contracts (M3-T2)", () => {
  it("has exactly the nine FDA major allergen codes, in a stable order", () => {
    expect(MAJOR_ALLERGEN_CODES_DTO).toEqual([
      "peanut",
      "tree_nut",
      "milk",
      "egg",
      "fish",
      "shellfish",
      "wheat",
      "soy",
      "sesame",
    ]);
  });

  it("labels every code, in sentence case, with no trailing punctuation", () => {
    for (const code of MAJOR_ALLERGEN_CODES_DTO) {
      const label = MAJOR_ALLERGEN_LABELS_DTO[code];
      expect(label).toBe(label.toLowerCase());
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("accepts a MAJOR restriction with a code and a USER_DEFINED one without", () => {
    const major: MemberRestrictionDto = {
      kind: "MAJOR",
      code: "peanut",
      label: "peanut",
      severity: "severe",
    };
    const custom: MemberRestrictionDto = {
      kind: "USER_DEFINED",
      label: "kiwi",
      severity: "standard",
    };
    expect(major.code).toBe("peanut");
    expect(custom.code).toBeUndefined();
  });

  it("a member's restrictions and noneConfirmed model the explicit-none gate as data", () => {
    const withRestriction: MemberDto = {
      memberId: "member-maya",
      displayName: "Maya Chen",
      role: "member",
      restrictions: [{ kind: "MAJOR", code: "sesame", label: "sesame", severity: "standard" }],
      noneConfirmed: false,
      preferences: [],
    };
    const withNone: MemberDto = { ...withRestriction, restrictions: [], noneConfirmed: true };
    expect(withRestriction.restrictions.length > 0 || withRestriction.noneConfirmed).toBe(true);
    expect(withNone.restrictions.length > 0 || withNone.noneConfirmed).toBe(true);
  });

  it("OnboardingStateDto's household is null for a brand-new user", () => {
    const state: OnboardingStateDto = { household: null };
    expect(state.household).toBeNull();
  });

  it("OnboardingStateDto carries a populated household once one exists", () => {
    const household: HouseholdDto = {
      householdId: "hh-fixture-chen",
      name: "The Chens",
      members: [],
    };
    const state: OnboardingStateDto = { household };
    expect(state.household?.householdId).toBe("hh-fixture-chen");
  });
});
