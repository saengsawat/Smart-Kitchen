import { describe, expect, it } from "vitest";
import type { ScannedProductDto, ScreeningResultDto } from "@smart-kitchen/contracts";
import { fixtureLookupProduct } from "./fixture-products";
import {
  addCtaIsBlocked,
  allowedLine,
  evidenceLine,
  evidenceTier,
  extraWarningLines,
  ranScreeningResult,
  unknownLine,
  SCAN_SHEET_ALLOWED_LINE,
  SCAN_SHEET_NOT_RUN_GLYPH,
  SCAN_SHEET_NOT_RUN_LINE,
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

/** M2-T4a: fixture products are engine-generated, so their screening is always `RUN`. */
function screeningOf(product: ScannedProductDto): ScreeningResultDto {
  if (product.screening.status !== "RUN") throw new Error("fixture screening should be RUN");
  return product.screening.result;
}

describe("evidenceLine / unknownLine against the real, engine-generated fixtures", () => {
  it("tahini (BLOCKED): renders one line per evidence entry, not a single pick", () => {
    const product = hit("060000100810");
    const lines = screeningOf(product).evidence.map((e) => evidenceLine(e, resolveMemberName));
    expect(lines).toEqual([
      "Contains sesame · stated by the manufacturer · blocked for Maya Chen · not a safety guarantee",
      "Contains sesame · matched 'tahini' in the name · blocked for Maya Chen · not a safety guarantee",
      "Contains sesame · matched 'sesame seeds' in the ingredient statement · blocked for Maya Chen · not a safety guarantee",
    ]);
  });

  it("tahini also carries Maya's peanut unknown alongside the sesame block (both render, never one or the other)", () => {
    const product = hit("060000100810");
    expect(screeningOf(product).unknowns).toHaveLength(1);
    const line = unknownLine(screeningOf(product).unknowns[0]!, resolveMemberName);
    expect(line).toBe(
      "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee",
    );
  });

  it("eggs (ALLOWED_WITH_UNKNOWNS): renders one line per unknown, peanut before sesame", () => {
    const product = hit("060000100070");
    const lines = screeningOf(product).unknowns.map((u) => unknownLine(u, resolveMemberName));
    expect(lines).toEqual([
      "We don't have allergen information for this item. This matters for Maya Chen's severe peanut allergy. · not a safety guarantee",
      "We don't have allergen information for this item. This matters for Maya Chen's severe sesame allergy. · not a safety guarantee",
    ]);
    expect(screeningOf(product).evidence).toEqual([]);
  });

  it("chicken breast (ALLOWED_WITH_UNKNOWNS, fractional 1.5 lb package): same two-unknown shape, no evidence", () => {
    const product = hit("060000100100");
    expect(product.packageSize?.value.qty).toBe("1.5");
    expect(screeningOf(product).unknowns).toHaveLength(2);
    expect(screeningOf(product).evidence).toEqual([]);
  });

  it("evidenceTier falls back to another evidence entry's assertionTier for a free-text match with none of its own", () => {
    const product = hit("060000100810");
    const nameTermEvidence = screeningOf(product).evidence.find((e) => e.kind === "NAME_TERM")!;
    expect(nameTermEvidence.assertionTier).toBeUndefined();
    expect(evidenceTier(nameTermEvidence, screeningOf(product).evidence)).toBe("KNOWN_FACT");
  });

  it("a resolver that cannot name a member falls back to a neutral phrase, never the raw id (review F11)", () => {
    const product = hit("060000100070");
    const line = unknownLine(screeningOf(product).unknowns[0]!, () => "");
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

describe("NOT_RUN (M2-T4a, copy-deck §3.3)", () => {
  it("is the §3.3 string verbatim", () => {
    expect(SCAN_SHEET_NOT_RUN_LINE).toBe(
      "Allergens not checked · this household's allergies are not on the server yet · read the label · not a safety guarantee",
    );
  });

  it("carries no verdict word, no member, no allergen, no em dash, and 'safe' only inside the caveat", () => {
    const line = SCAN_SHEET_NOT_RUN_LINE.toLowerCase();
    for (const word of ["blocked", "cleared", "allowed", "no known", "match", "passed", "ok"]) {
      expect(line).not.toContain(word);
    }
    expect(line.replace("not a safety guarantee", "")).not.toContain("safe");
    expect(SCAN_SHEET_NOT_RUN_LINE).not.toContain("—");
    expect(SCAN_SHEET_NOT_RUN_LINE).not.toMatch(/\{\w+\}/);
    expect(SCAN_SHEET_NOT_RUN_GLYPH).not.toMatch(/[✓✔✕✗×!]/);
  });

  it("ranScreeningResult is null only for a NOT_RUN outcome", () => {
    expect(
      ranScreeningResult({ status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" }),
    ).toBeNull();
    const product = hit("060000100810");
    expect(ranScreeningResult(product.screening)).toBe(screeningOf(product));
  });
});

describe("extraWarningLines: UNRECOGNIZED_ALLERGEN_DATA and CROSS_CONTACT, synthetic DTOs (review F16)", () => {
  it("is empty for all three real fixtures (none carry these warning codes)", () => {
    for (const code of ["060000100810", "060000100070", "060000100100"]) {
      const product = hit(code);
      expect(extraWarningLines(screeningOf(product), resolveMemberName)).toEqual([]);
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
