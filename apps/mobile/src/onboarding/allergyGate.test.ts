import { describe, expect, it } from "vitest";
import type { MemberDto } from "@smart-kitchen/contracts";
import {
  ALLERGY_GATE_MESSAGE,
  addCustomAllergen,
  buildInitialMemberDraft,
  draftFromMember,
  isGateSatisfied,
  isMemberComplete,
  setSeverity,
  toRestrictionDtos,
  toggleMajorAllergen,
  toggleNone,
  type MemberAllergyDraft,
} from "./allergyGate";

const dean: MemberAllergyDraft = buildInitialMemberDraft({
  memberId: "member-dean",
  displayName: "Dean Chen",
});
const maya: MemberAllergyDraft = buildInitialMemberDraft({
  memberId: "member-maya",
  displayName: "Maya Chen",
});

describe("buildInitialMemberDraft", () => {
  it("starts with no selections and none not confirmed", () => {
    expect(dean.selections).toEqual([]);
    expect(dean.noneConfirmed).toBe(false);
  });
});

describe("toggleMajorAllergen", () => {
  it("selects a major allergen at standard severity by default (D-017 P4)", () => {
    const next = toggleMajorAllergen(dean, "peanut", "peanut");
    expect(next.selections).toEqual([
      { key: "peanut", kind: "MAJOR", code: "peanut", label: "peanut", severity: "standard" },
    ]);
  });

  it("deselects an already-selected allergen (toggle off)", () => {
    const selected = toggleMajorAllergen(dean, "peanut", "peanut");
    const deselected = toggleMajorAllergen(selected, "peanut", "peanut");
    expect(deselected.selections).toEqual([]);
  });

  it("selecting an allergen clears a prior none confirmation (mutual exclusion)", () => {
    const none = toggleNone(dean);
    expect(none.noneConfirmed).toBe(true);
    const selected = toggleMajorAllergen(none, "sesame", "sesame");
    expect(selected.noneConfirmed).toBe(false);
    expect(selected.selections).toHaveLength(1);
  });

  it("supports selecting more than one allergen independently", () => {
    const step1 = toggleMajorAllergen(dean, "peanut", "peanut");
    const step2 = toggleMajorAllergen(step1, "milk", "milk");
    expect(step2.selections.map((s) => s.code)).toEqual(["peanut", "milk"]);
  });
});

describe("setSeverity", () => {
  it("changes a selected allergen's severity from standard to severe", () => {
    const selected = toggleMajorAllergen(dean, "peanut", "peanut");
    const severe = setSeverity(selected, "peanut", "severe");
    expect(severe.selections[0]?.severity).toBe("severe");
  });

  it("changes severity back from severe to standard (never stuck escalated)", () => {
    const selected = toggleMajorAllergen(dean, "peanut", "peanut");
    const severe = setSeverity(selected, "peanut", "severe");
    const backToStandard = setSeverity(severe, "peanut", "standard");
    expect(backToStandard.selections[0]?.severity).toBe("standard");
  });

  it("is a no-op for a key that is not currently selected", () => {
    const untouched = setSeverity(dean, "peanut", "severe");
    expect(untouched.selections).toEqual([]);
  });

  it("does not affect other members' selections (severity is per member)", () => {
    const dean1 = toggleMajorAllergen(dean, "peanut", "peanut");
    const maya1 = toggleMajorAllergen(maya, "peanut", "peanut");
    const dean2 = setSeverity(dean1, "peanut", "severe");
    expect(dean2.selections[0]?.severity).toBe("severe");
    expect(maya1.selections[0]?.severity).toBe("standard");
  });
});

describe("addCustomAllergen", () => {
  it("adds a free-text entry as USER_DEFINED at standard severity", () => {
    const next = addCustomAllergen(dean, "kiwi");
    expect(next.selections).toEqual([
      { key: "custom:kiwi", kind: "USER_DEFINED", label: "kiwi", severity: "standard" },
    ]);
  });

  it("trims whitespace and ignores a blank submission", () => {
    const trimmed = addCustomAllergen(dean, "  kiwi  ");
    expect(trimmed.selections[0]?.label).toBe("kiwi");
    const blank = addCustomAllergen(dean, "   ");
    expect(blank.selections).toEqual([]);
  });

  it("does not add the same label twice, case-insensitively", () => {
    const once = addCustomAllergen(dean, "Kiwi");
    const twice = addCustomAllergen(once, "kiwi");
    expect(twice.selections).toHaveLength(1);
  });

  it("clears a prior none confirmation (mutual exclusion)", () => {
    const none = toggleNone(dean);
    const withCustom = addCustomAllergen(none, "kiwi");
    expect(withCustom.noneConfirmed).toBe(false);
  });
});

describe("toggleNone", () => {
  it("turning none on clears every existing selection", () => {
    const selected = toggleMajorAllergen(dean, "peanut", "peanut");
    const none = toggleNone(selected);
    expect(none.noneConfirmed).toBe(true);
    expect(none.selections).toEqual([]);
  });

  it("turning none off again just clears the flag", () => {
    const none = toggleNone(dean);
    const off = toggleNone(none);
    expect(off.noneConfirmed).toBe(false);
    expect(off.selections).toEqual([]);
  });
});

describe("isMemberComplete", () => {
  it("is false for a fresh member (neither a selection nor none)", () => {
    expect(isMemberComplete(dean)).toBe(false);
  });

  it("is true once a member has at least one selection", () => {
    expect(isMemberComplete(toggleMajorAllergen(dean, "peanut", "peanut"))).toBe(true);
  });

  it("is true once a member has confirmed none", () => {
    expect(isMemberComplete(toggleNone(dean))).toBe(true);
  });
});

describe("isGateSatisfied (every member covered, none excepted)", () => {
  it("is false when no members are supplied", () => {
    expect(isGateSatisfied([])).toBe(false);
  });

  it("is false when any one member is incomplete, even if others are done", () => {
    const mayaDone = toggleNone(maya);
    expect(isGateSatisfied([dean, mayaDone])).toBe(false);
  });

  it("is true only once every member has a restriction or confirmed none", () => {
    const deanDone = toggleMajorAllergen(dean, "peanut", "peanut");
    const mayaDone = toggleNone(maya);
    expect(isGateSatisfied([deanDone, mayaDone])).toBe(true);
  });

  it("is true when every member independently has a real restriction (no none involved)", () => {
    const deanDone = toggleMajorAllergen(dean, "peanut", "peanut");
    const mayaDone = addCustomAllergen(maya, "kiwi");
    expect(isGateSatisfied([deanDone, mayaDone])).toBe(true);
  });
});

describe("toRestrictionDtos", () => {
  it("projects a MAJOR selection with its code", () => {
    const withPeanut = setSeverity(
      toggleMajorAllergen(dean, "peanut", "peanut"),
      "peanut",
      "severe",
    );
    expect(toRestrictionDtos(withPeanut)).toEqual([
      { kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" },
    ]);
  });

  it("projects a USER_DEFINED selection without a code field", () => {
    const withCustom = addCustomAllergen(dean, "kiwi");
    const dtos = toRestrictionDtos(withCustom);
    expect(dtos).toEqual([{ kind: "USER_DEFINED", label: "kiwi", severity: "standard" }]);
    expect(dtos[0]).not.toHaveProperty("code");
  });

  it("is empty for a member who confirmed none", () => {
    expect(toRestrictionDtos(toggleNone(dean))).toEqual([]);
  });
});

describe("draftFromMember (re-entering S2 without losing prior answers)", () => {
  function savedMember(overrides: Partial<MemberDto> = {}): MemberDto {
    return {
      memberId: "member-maya",
      displayName: "Maya Chen",
      role: "member",
      restrictions: [],
      noneConfirmed: false,
      preferences: [],
      ...overrides,
    };
  }

  it("rebuilds noneConfirmed", () => {
    const draft = draftFromMember(savedMember({ noneConfirmed: true }));
    expect(draft.noneConfirmed).toBe(true);
    expect(draft.selections).toEqual([]);
  });

  it("rebuilds MAJOR and USER_DEFINED selections, round-tripping through toRestrictionDtos", () => {
    const member = savedMember({
      restrictions: [
        { kind: "MAJOR", code: "sesame", label: "sesame", severity: "severe" },
        { kind: "USER_DEFINED", label: "kiwi", severity: "standard" },
      ],
    });
    const draft = draftFromMember(member);
    expect(draft.noneConfirmed).toBe(false);
    expect(toRestrictionDtos(draft)).toEqual(member.restrictions);
  });

  it("a fresh member (never touched S2) rebuilds to an incomplete draft", () => {
    const draft = draftFromMember(savedMember());
    expect(isMemberComplete(draft)).toBe(false);
  });
});

describe("ALLERGY_GATE_MESSAGE", () => {
  it("is the exact inline copy the ticket requires", () => {
    expect(ALLERGY_GATE_MESSAGE).toBe("Select at least one allergen, or confirm none, to continue");
  });
});
