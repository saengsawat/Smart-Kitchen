import { describe, expect, it } from "vitest";

import { MIN_TERM_LENGTH } from "./errors.js";
import {
  majorRestriction,
  restrictionLabel,
  userDefinedRestriction,
  validateMembers,
  validateRestriction,
} from "./restrictions.js";

function expectError(result: { ok: boolean; error?: { code: string } }, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe(code);
}

describe("majorRestriction", () => {
  it("builds a restriction from valid input", () => {
    const result = majorRestriction("r1", "peanut", "severe");
    expect(result).toEqual({
      ok: true,
      value: { kind: "MAJOR", restrictionId: "r1", allergen: "peanut", severity: "severe" },
    });
  });

  it("rejects an allergen code outside the taxonomy rather than ignoring it", () => {
    // Silently dropping an unknown restriction would mean silently not
    // protecting that member — the engine fails closed instead.
    expectError(
      validateRestriction(
        { kind: "MAJOR", restrictionId: "r1", allergen: "mustard", severity: "severe" },
        "r",
      ),
      "UNKNOWN_ALLERGEN_CODE",
    );
    expectError(
      validateRestriction(
        { kind: "MAJOR", restrictionId: "r1", allergen: "peanuts", severity: "severe" },
        "r",
      ),
      "UNKNOWN_ALLERGEN_CODE",
    );
  });

  it("rejects an empty id and an invalid severity", () => {
    expectError(
      validateRestriction(
        { kind: "MAJOR", restrictionId: "", allergen: "peanut", severity: "severe" },
        "r",
      ),
      "EMPTY_RESTRICTION_ID",
    );
    expectError(
      validateRestriction(
        { kind: "MAJOR", restrictionId: "r1", allergen: "peanut", severity: "mild" },
        "r",
      ),
      "INVALID_SEVERITY",
    );
    expectError(
      validateRestriction({ kind: "MAJOR", restrictionId: "r1", allergen: "peanut" }, "r"),
      "INVALID_SEVERITY",
    );
  });
});

describe("userDefinedRestriction", () => {
  it("stores the term normalized", () => {
    const result = userDefinedRestriction("r1", "  Dragon-Fruit  ", "standard");
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "USER_DEFINED") {
      expect(result.value.term).toBe("dragon fruit");
    }
  });

  it("rejects empty and whitespace-only terms", () => {
    expectError(userDefinedRestriction("r1", "", "standard"), "EMPTY_TERM");
    expectError(userDefinedRestriction("r1", "   ", "standard"), "EMPTY_TERM");
    expectError(userDefinedRestriction("r1", "!!!", "standard"), "EMPTY_TERM");
  });

  it("rejects terms too short to be safe evidence", () => {
    expectError(userDefinedRestriction("r1", "ax", "standard"), "TERM_TOO_SHORT");
    expect(userDefinedRestriction("r1", "pea", "standard").ok).toBe(true);
    expect(MIN_TERM_LENGTH).toBe(3);
  });

  it("counts characters, not tokens, for the length floor", () => {
    // "a b" normalizes to two 1-character tokens: 2 characters, still too short.
    expectError(userDefinedRestriction("r1", "a b", "standard"), "TERM_TOO_SHORT");
  });
});

describe("validateMembers", () => {
  const peanut = { kind: "MAJOR", restrictionId: "r1", allergen: "peanut", severity: "severe" };

  it("rebuilds members field by field, dropping smuggled properties", () => {
    const result = validateMembers([
      {
        memberId: "m1",
        verdict: "ALLOWED",
        trusted: true,
        restrictions: [
          { ...peanut, waived: true, outcome: "NO_KNOWN_MATCH", severityOverride: "none" },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        memberId: "m1",
        restrictions: [
          { kind: "MAJOR", restrictionId: "r1", allergen: "peanut", severity: "severe" },
        ],
      },
    ]);
    const member = result.value[0];
    expect(member).not.toHaveProperty("verdict");
    expect(member).not.toHaveProperty("trusted");
    expect(member?.restrictions[0]).not.toHaveProperty("waived");
    expect(member?.restrictions[0]).not.toHaveProperty("outcome");
  });

  it("accepts an empty member list and members with no restrictions", () => {
    expect(validateMembers([])).toEqual({ ok: true, value: [] });
    const noRestrictions = validateMembers([{ memberId: "m1" }]);
    expect(noRestrictions).toEqual({ ok: true, value: [{ memberId: "m1", restrictions: [] }] });
  });

  it("rejects malformed members", () => {
    expectError(validateMembers("nope"), "NOT_AN_OBJECT");
    expectError(validateMembers([null]), "NOT_AN_OBJECT");
    expectError(validateMembers([{ memberId: "" }]), "EMPTY_MEMBER_ID");
    expectError(validateMembers([{ memberId: 7 }]), "EMPTY_MEMBER_ID");
    expectError(validateMembers([{ memberId: "m1", restrictions: "nope" }]), "NOT_AN_OBJECT");
  });

  it("rejects duplicate ids, which would make evidence ambiguous", () => {
    expectError(
      validateMembers([
        { memberId: "m1", restrictions: [] },
        { memberId: "m1", restrictions: [] },
      ]),
      "DUPLICATE_MEMBER_ID",
    );
    expectError(
      validateMembers([
        { memberId: "m1", restrictions: [peanut, { ...peanut, allergen: "milk" }] },
      ]),
      "DUPLICATE_RESTRICTION_ID",
    );
  });

  it("rejects an unknown restriction kind", () => {
    expectError(
      validateMembers([
        { memberId: "m1", restrictions: [{ kind: "PREFERENCE", restrictionId: "r1" }] },
      ]),
      "INVALID_RESTRICTION_KIND",
    );
  });

  it("allows the same restrictionId on different members", () => {
    const result = validateMembers([
      { memberId: "m1", restrictions: [peanut] },
      { memberId: "m2", restrictions: [peanut] },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("restrictionLabel", () => {
  it("uses the code for major allergens and the term for user-defined ones", () => {
    const major = majorRestriction("r1", "tree_nut", "standard");
    const custom = userDefinedRestriction("r2", "Mango", "standard");
    expect(major.ok && restrictionLabel(major.value)).toBe("tree_nut");
    expect(custom.ok && restrictionLabel(custom.value)).toBe("mango");
  });
});
