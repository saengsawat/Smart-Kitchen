import { describe, expect, it } from "vitest";
import type { ScreeningResultDto } from "@smart-kitchen/contracts";
import { fixtureLookupProduct } from "./fixture-products";
import {
  addCtaIsBlocked,
  allowedLine,
  evidenceLine,
  evidenceTier,
  extraWarningLines,
  unknownLine,
  SCAN_SHEET_ALLOWED_LINE,
  UNKNOWN_MEMBER_FALLBACK,
  type MemberNameResolver,
} from "./allergen-copy";

const NAMES: Readonly<Record<string, string>> = {
  "member-dean": "Dean Chen",
  "member-maya": "Maya Chen",
};
const resolveMemberName: MemberNameResolver = (id) => NAMES[id] ?? "";

function hit(code: string) {
  const result = fixtureLookupProduct(code);
  if (result.status !== "hit") throw new Error("expected a hit");
  return result.product;
}

describe("evidenceLine / unknownLine against the real, engine-generated fixtures", () => {
  it("tahini (BLOCKED): renders one line per evidence entry, not a single pick", () => {
    const product = hit("060000100810");
    const lines = product.screening.evidence.map((e) => evidenceLine(e, resolveMemberName));
    expect(lines).toEqual([
      "Contains sesame · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
      "Contains sesame · matched 'tahini' in the name · blocked for Maya Chen · not a safety guarantee",
      "Contains sesame · matched 'sesame seeds' in the ingredient statement · blocked for Maya Chen · not a safety guarantee",
    ]);
  });

  it("tahini also carries Maya's peanut unknown alongside the sesame block (both render, never one or the other)", () => {
    const product = hit("060000100810");
    expect(product.screening.unknowns).toHaveLength(1);
    const line = unknownLine(product.screening.unknowns[0]!, resolveMemberName);
    expect(line).toBe(
      "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee",
    );
  });

  it("eggs (ALLOWED_WITH_UNKNOWNS): renders one line per unknown, peanut before sesame", () => {
    const product = hit("060000100070");
    const lines = product.screening.unknowns.map((u) => unknownLine(u, resolveMemberName));
    expect(lines).toEqual([
      "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee",
      "We don't have allergen information for this item. This matters for Maya Chen's severe sesame allergy. · not a safety guarantee",
    ]);
    expect(product.screening.evidence).toEqual([]);
  });

  it("chicken breast (ALLOWED_WITH_UNKNOWNS, fractional 1.5 lb package): same two-unknown shape, no evidence", () => {
    const product = hit("060000100100");
    expect(product.packageSize.value.qty).toBe("1.5");
    expect(product.screening.unknowns).toHaveLength(2);
    expect(product.screening.evidence).toEqual([]);
  });

  it("evidenceTier falls back to another evidence entry's assertionTier for a free-text match with none of its own", () => {
    const product = hit("060000100810");
    const nameTermEvidence = product.screening.evidence.find((e) => e.kind === "NAME_TERM")!;
    expect(nameTermEvidence.assertionTier).toBeUndefined();
    expect(evidenceTier(nameTermEvidence, product.screening.evidence)).toBe("KNOWN_FACT");
  });

  it("a resolver that cannot name a member falls back to a neutral phrase, never the raw id (review F11)", () => {
    const product = hit("060000100070");
    const line = unknownLine(product.screening.unknowns[0]!, () => "");
    expect(line).toContain(UNKNOWN_MEMBER_FALLBACK);
    expect(line).not.toContain("member-maya");
  });
});

describe("no product screens ALLOWED today (D-017 gate b is open) — ALLOWED is exercised only by a synthetic DTO here", () => {
  /** Synthetic, hand-built ScreeningResultDto — labelled synthetic, never derived from a real corpus record (review F1/F2/F3 ruling). */
  const SYNTHETIC_ALLOWED_RESULT: ScreeningResultDto = {
    subjectKind: "PRODUCT",
    subjectId: "synthetic-allowed-example",
    verdict: "ALLOWED",
    members: [
      { memberId: "member-dean", verdict: "ALLOWED" },
      { memberId: "member-maya", verdict: "ALLOWED" },
    ],
    evidence: [],
    unknowns: [],
    warnings: [{ code: "NO_SAFETY_GUARANTEE", severity: "info" }],
  };

  it("allowedLine renders copy-deck.md §3.3's exact ALLOWED string, caveat folded in", () => {
    expect(allowedLine()).toBe(SCAN_SHEET_ALLOWED_LINE);
    expect(allowedLine()).toBe(
      "No known household match · label declaration · not a safety guarantee",
    );
    expect(addCtaIsBlocked(SYNTHETIC_ALLOWED_RESULT)).toBe(false);
  });

  it("never renders the word safe as a claim (only inside the negation caveat)", () => {
    const withoutCaveat = allowedLine().replace("not a safety guarantee", "");
    expect(withoutCaveat.toLowerCase()).not.toContain("safe");
  });
});

describe("extraWarningLines: UNRECOGNIZED_ALLERGEN_DATA and CROSS_CONTACT, synthetic DTOs (review F16)", () => {
  it("is empty for all three real fixtures (none carry these warning codes)", () => {
    for (const code of ["060000100810", "060000100070", "060000100100"]) {
      const product = hit(code);
      expect(extraWarningLines(product.screening, resolveMemberName)).toEqual([]);
    }
  });

  it("UNRECOGNIZED_ALLERGEN_DATA renders its ALLOWED-co-occurrence string when the verdict is ALLOWED (synthetic)", () => {
    const synthetic: ScreeningResultDto = {
      subjectKind: "PRODUCT",
      subjectId: "synthetic-unrecognized-allowed",
      verdict: "ALLOWED",
      members: [{ memberId: "member-dean", verdict: "ALLOWED" }],
      evidence: [],
      unknowns: [],
      warnings: [
        { code: "NO_SAFETY_GUARANTEE", severity: "info" },
        { code: "UNRECOGNIZED_ALLERGEN_DATA", severity: "high" },
      ],
    };
    expect(extraWarningLines(synthetic, resolveMemberName)).toEqual([
      "Some of this item's allergen data couldn't be read. It doesn't touch anyone's restrictions in your household, but check the label yourself.",
    ]);
  });

  it("UNRECOGNIZED_ALLERGEN_DATA renders its general string when the verdict is not ALLOWED (synthetic)", () => {
    const synthetic: ScreeningResultDto = {
      subjectKind: "PRODUCT",
      subjectId: "synthetic-unrecognized-unknown",
      verdict: "ALLOWED_WITH_UNKNOWNS",
      members: [{ memberId: "member-maya", verdict: "ALLOWED_WITH_UNKNOWNS" }],
      evidence: [],
      unknowns: [
        {
          memberId: "member-maya",
          restrictionId: "maya-sesame",
          restrictionLabel: "sesame",
          severity: "severe",
          reason: "NO_ALLERGEN_DATA",
          locus: { part: "PRODUCT", ref: "Synthetic product" },
          detail: "synthetic",
        },
      ],
      warnings: [
        { code: "NO_SAFETY_GUARANTEE", severity: "info" },
        { code: "UNRECOGNIZED_ALLERGEN_DATA", severity: "high" },
      ],
    };
    expect(extraWarningLines(synthetic, resolveMemberName)).toEqual([
      "Some of this item's allergen data couldn't be read, so we couldn't check that part. Check the label yourself.",
    ]);
  });

  it("CROSS_CONTACT names the member and the allergen, standard severity (synthetic)", () => {
    const synthetic: ScreeningResultDto = {
      subjectKind: "PRODUCT",
      subjectId: "synthetic-cross-contact",
      verdict: "ALLOWED_WITH_UNKNOWNS",
      members: [{ memberId: "member-dean", verdict: "ALLOWED_WITH_UNKNOWNS" }],
      evidence: [],
      unknowns: [],
      warnings: [
        { code: "NO_SAFETY_GUARANTEE", severity: "info" },
        {
          code: "CROSS_CONTACT",
          severity: "high",
          memberId: "member-dean",
          restrictionId: "dean-milk",
          restrictionLabel: "milk",
        },
      ],
    };
    expect(extraWarningLines(synthetic, resolveMemberName)).toEqual([
      "This item may have cross-contact with milk (the manufacturer says 'may contain'). Not blocked, because Dean Chen's allergy is standard severity.",
    ]);
  });
});

describe("evidenceLine covers every EvidenceKind (synthetic, since the real fixtures only exercise three of the five)", () => {
  function evidence(kind: string, extra: Record<string, unknown> = {}) {
    return {
      memberId: "member-maya",
      restrictionId: "maya-sesame",
      restrictionLabel: "sesame",
      severity: "severe" as const,
      kind,
      locus: { part: "PRODUCT" as const, ref: "Synthetic" },
      matchedTerm: "sesame",
      ...extra,
    } as Parameters<typeof evidenceLine>[0];
  }

  it("ASSERTION_MAY_CONTAIN", () => {
    expect(evidenceLine(evidence("ASSERTION_MAY_CONTAIN"), resolveMemberName)).toBe(
      "May contain sesame (cross-contact) · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
    );
  });

  it("ASSERTION_CODE_TERM", () => {
    expect(
      evidenceLine(evidence("ASSERTION_CODE_TERM", { matchedTerm: "mustard" }), resolveMemberName),
    ).toBe(
      "Contains sesame · matched the allergen tag 'mustard' · blocked for Maya Chen · not a safety guarantee",
    );
  });
});
