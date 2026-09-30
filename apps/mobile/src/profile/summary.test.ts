/**
 * `src/profile/summary.ts` unit tests (review round 1, F4): none existed
 * before, and the review found two live mutants (deleting the
 * empty-restrictions clause; forcing `hasSevere = true` unconditionally)
 * that survived every other suite untouched. Every form the ticket
 * specifies gets its own pinned case here.
 */
import type { MemberDto, MemberRestrictionDto } from "@smart-kitchen/contracts";
import { describe, expect, it } from "vitest";
import { initialsFromName, memberAllergySummary } from "./summary";

type Member = Pick<MemberDto, "restrictions" | "noneConfirmed">;

function member(restrictions: readonly MemberRestrictionDto[], noneConfirmed: boolean): Member {
  return { restrictions, noneConfirmed };
}

describe("memberAllergySummary", () => {
  it("noneConfirmed renders the explicit declaration", () => {
    expect(memberAllergySummary(member([], true))).toBe("No known allergies · edit");
  });

  it("noneConfirmed wins even if restrictions were somehow also present (defensive; the gate never allows both)", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "peanut", label: "peanut", severity: "standard" },
    ];
    expect(memberAllergySummary(member(restrictions, true))).toBe("No known allergies · edit");
  });

  it("review round 1, F4: zero restrictions and noneConfirmed false is 'not set yet', never 'no known allergies'", () => {
    expect(memberAllergySummary(member([], false))).toBe("Allergies not set yet · edit");
  });

  it("one standard-severity MAJOR restriction: no 'severe' segment", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "milk", label: "milk", severity: "standard" },
    ];
    expect(memberAllergySummary(member(restrictions, false))).toBe("Milk · edit");
  });

  it("review round 1, F4: hasSevere is a real predicate, not hardcoded true -- an all-standard list never says severe", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "milk", label: "milk", severity: "standard" },
      { kind: "MAJOR", code: "egg", label: "egg", severity: "standard" },
    ];
    const summary = memberAllergySummary(member(restrictions, false));
    expect(summary).toBe("Milk, egg · edit");
    expect(summary).not.toContain("severe");
  });

  it("two MAJOR restrictions, both severe: joined, sentence-cased once, one 'severe' segment", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" },
      { kind: "MAJOR", code: "sesame", label: "sesame", severity: "severe" },
    ];
    expect(memberAllergySummary(member(restrictions, false))).toBe(
      "Peanut, sesame · severe · edit",
    );
  });

  it("mixed severities: 'severe' appears if ANY restriction is severe, even a later one", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "milk", label: "milk", severity: "standard" },
      { kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" },
    ];
    expect(memberAllergySummary(member(restrictions, false))).toBe("Milk, peanut · severe · edit");
  });

  it("a USER_DEFINED restriction renders the member's own wording verbatim, not a MAJOR label lookup", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "USER_DEFINED", label: "kiwi", severity: "standard" },
    ];
    expect(memberAllergySummary(member(restrictions, false))).toBe("Kiwi · edit");
  });

  it("a mix of MAJOR and USER_DEFINED joins in restriction order, sentence-casing only the first word", () => {
    const restrictions: MemberRestrictionDto[] = [
      { kind: "MAJOR", code: "sesame", label: "sesame", severity: "severe" },
      { kind: "USER_DEFINED", label: "kiwi", severity: "standard" },
    ];
    expect(memberAllergySummary(member(restrictions, false))).toBe("Sesame, kiwi · severe · edit");
  });
});

describe("initialsFromName", () => {
  it("a two-word name takes the first letter of the first and last token", () => {
    expect(initialsFromName("Dean Chen")).toBe("DC");
  });

  it("a three-word name still takes only the first and the last token", () => {
    expect(initialsFromName("Mary Jane Watson")).toBe("MW");
  });

  it("a single-token name falls back to its first two characters", () => {
    expect(initialsFromName("Cher")).toBe("CH");
  });

  it("an empty or whitespace-only name never throws or renders empty", () => {
    expect(initialsFromName("   ")).toBe("?");
  });
});
