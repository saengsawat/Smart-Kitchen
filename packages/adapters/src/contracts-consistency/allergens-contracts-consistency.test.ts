/**
 * Allergen-contracts consistency check (M3-T4b).
 *
 * `packages/contracts/src/allergens.ts` hand-writes `ScreeningVerdictDto`,
 * `UnknownReasonDto`, `WarningCodeDto`, `EvidenceKindDto` and
 * `WarningSeverityDto` rather than importing
 * `packages/domain/src/allergens/types.ts`, for the same reason
 * `household-contracts-consistency.test.ts` gives for `MAJOR_ALLERGEN_CODES_DTO`:
 * contracts must stay dependency-free so `apps/mobile` can depend on it
 * without pulling `@smart-kitchen/domain` into the client bundle.
 *
 * Unlike `MAJOR_ALLERGEN_CODES` (a real runtime array `household-contracts-
 * consistency.test.ts` compares against directly) and the unit registry
 * (`units-contracts-consistency.test.ts` calls `lookupUnit` at runtime), the
 * five unions here are **type-only** in the domain: `packages/domain/src/
 * allergens/types.ts` declares `ScreeningVerdict`/`UnknownReason`/
 * `WarningCode`/`EvidenceKind`/`WarningSeverity` as plain TypeScript unions
 * with no backing `as const` array (`domain/src/index.ts`'s barrel re-exports
 * confirm this: only the *type*, never a value, crosses for any of the
 * five). There is nothing to compare at runtime, so the equivalence check
 * here is a **compile-time exhaustiveness proof** instead: each function
 * below switches on a domain-typed parameter, covering every DTO literal as
 * a `case`, with a `default` branch that only type-checks if the switch was
 * exhaustive over the *domain* type. `pnpm typecheck` therefore fails loudly
 * the moment the domain gains or loses a member — the same drift guarantee
 * a runtime `toEqual` gives the other consistency tests, enforced by the
 * compiler instead of by a comparison.
 *
 * That alone only catches drift in one direction: a *domain* addition (a
 * switch over the domain type must cover every case, so a new domain member
 * breaks the `default: assertNever` branch), but not a **phantom DTO
 * member** — a typo or a speculative addition to `SCREENING_VERDICTS_DTO`
 * etc. that the domain never had, which the domain-typed switch above would
 * never see at all (review F10). Closed by the mirror-image switches below,
 * each keyed on the *DTO* type and returning the domain type: those only
 * compile if every DTO literal maps to a real domain member, so an extra DTO
 * value fails to typecheck (no `case` can be added for it without the
 * domain type rejecting the return), and a missing one leaves the
 * `default: assertNever` branch reachable for a DTO value that was never
 * handled.
 *
 * The `it()` blocks below additionally prove, with the real
 * `packages/domain` engine (`screenSubject`), that a representative sample of
 * these codes are not just type-compatible but actually reachable — a light
 * regression net, not an attempt to re-run every `screen.test.ts` scenario
 * (that suite already owns exhaustive engine coverage; this file's job is
 * the *mirrored-list* consistency, which the exhaustiveness checks above
 * fully close).
 */

import { describe, expect, it } from "vitest";
import {
  majorRestriction,
  screenSubject,
  type EvidenceKind,
  type ScreeningVerdict,
  type UnknownReason,
  type WarningCode,
  type WarningSeverity,
} from "@smart-kitchen/domain";
import {
  EVIDENCE_KINDS_DTO,
  SCREENING_VERDICTS_DTO,
  UNKNOWN_REASONS_DTO,
  WARNING_CODES_DTO,
  WARNING_SEVERITIES_DTO,
  type EvidenceKindDto,
  type ScreeningVerdictDto,
  type UnknownReasonDto,
  type WarningCodeDto,
  type WarningSeverityDto,
} from "@smart-kitchen/contracts";

function assertNever(x: never): never {
  throw new Error(`allergens-contracts-consistency: unhandled domain value ${JSON.stringify(x)}`);
}

// Each function's `default: return assertNever(x)` only compiles if the
// switch exhausted every member of the domain-typed parameter — so adding or
// removing a domain union member breaks this file's typecheck.

function verdictToDto(v: ScreeningVerdict): ScreeningVerdictDto {
  switch (v) {
    case "BLOCKED":
      return "BLOCKED";
    case "ALLOWED_WITH_UNKNOWNS":
      return "ALLOWED_WITH_UNKNOWNS";
    case "ALLOWED":
      return "ALLOWED";
    default:
      return assertNever(v);
  }
}

function unknownReasonToDto(r: UnknownReason): UnknownReasonDto {
  switch (r) {
    case "NO_ALLERGEN_DATA":
      return "NO_ALLERGEN_DATA";
    case "INCOMPLETE_DECLARATION":
      return "INCOMPLETE_DECLARATION";
    case "UNVERIFIED_DECLARATION_TIER":
      return "UNVERIFIED_DECLARATION_TIER";
    case "UNSOURCED_DECLARATION":
      return "UNSOURCED_DECLARATION";
    case "NO_INGREDIENT_TEXT":
      return "NO_INGREDIENT_TEXT";
    case "UNRECOGNIZED_ASSERTION_CODE":
      return "UNRECOGNIZED_ASSERTION_CODE";
    case "UNRECOGNIZED_ASSERTION_KIND":
      return "UNRECOGNIZED_ASSERTION_KIND";
    case "MALFORMED_ALLERGEN_DATA":
      return "MALFORMED_ALLERGEN_DATA";
    default:
      return assertNever(r);
  }
}

function warningCodeToDto(c: WarningCode): WarningCodeDto {
  switch (c) {
    case "NO_SAFETY_GUARANTEE":
      return "NO_SAFETY_GUARANTEE";
    case "SEVERE_ALLERGY_UNKNOWN_DATA":
      return "SEVERE_ALLERGY_UNKNOWN_DATA";
    case "CROSS_CONTACT":
      return "CROSS_CONTACT";
    case "CROSS_CONTACT_SEVERE":
      return "CROSS_CONTACT_SEVERE";
    case "UNRECOGNIZED_ALLERGEN_DATA":
      return "UNRECOGNIZED_ALLERGEN_DATA";
    default:
      return assertNever(c);
  }
}

function warningSeverityToDto(s: WarningSeverity): WarningSeverityDto {
  switch (s) {
    case "info":
      return "info";
    case "high":
      return "high";
    case "critical":
      return "critical";
    default:
      return assertNever(s);
  }
}

function evidenceKindToDto(k: EvidenceKind): EvidenceKindDto {
  switch (k) {
    case "ASSERTION_CONTAINS":
      return "ASSERTION_CONTAINS";
    case "ASSERTION_MAY_CONTAIN":
      return "ASSERTION_MAY_CONTAIN";
    case "INGREDIENT_TEXT_TERM":
      return "INGREDIENT_TEXT_TERM";
    case "NAME_TERM":
      return "NAME_TERM";
    case "ASSERTION_CODE_TERM":
      return "ASSERTION_CODE_TERM";
    default:
      return assertNever(k);
  }
}

// --- Reverse direction (DTO -> domain), review F10: catches a phantom DTO
// member the forward switches above cannot see (see module doc comment).

function assertNeverDto(x: never): never {
  throw new Error(`allergens-contracts-consistency: unhandled DTO value ${JSON.stringify(x)}`);
}

function dtoToVerdict(v: ScreeningVerdictDto): ScreeningVerdict {
  switch (v) {
    case "BLOCKED":
      return "BLOCKED";
    case "ALLOWED_WITH_UNKNOWNS":
      return "ALLOWED_WITH_UNKNOWNS";
    case "ALLOWED":
      return "ALLOWED";
    default:
      return assertNeverDto(v);
  }
}

function dtoToUnknownReason(r: UnknownReasonDto): UnknownReason {
  switch (r) {
    case "NO_ALLERGEN_DATA":
      return "NO_ALLERGEN_DATA";
    case "INCOMPLETE_DECLARATION":
      return "INCOMPLETE_DECLARATION";
    case "UNVERIFIED_DECLARATION_TIER":
      return "UNVERIFIED_DECLARATION_TIER";
    case "UNSOURCED_DECLARATION":
      return "UNSOURCED_DECLARATION";
    case "NO_INGREDIENT_TEXT":
      return "NO_INGREDIENT_TEXT";
    case "UNRECOGNIZED_ASSERTION_CODE":
      return "UNRECOGNIZED_ASSERTION_CODE";
    case "UNRECOGNIZED_ASSERTION_KIND":
      return "UNRECOGNIZED_ASSERTION_KIND";
    case "MALFORMED_ALLERGEN_DATA":
      return "MALFORMED_ALLERGEN_DATA";
    default:
      return assertNeverDto(r);
  }
}

function dtoToWarningCode(c: WarningCodeDto): WarningCode {
  switch (c) {
    case "NO_SAFETY_GUARANTEE":
      return "NO_SAFETY_GUARANTEE";
    case "SEVERE_ALLERGY_UNKNOWN_DATA":
      return "SEVERE_ALLERGY_UNKNOWN_DATA";
    case "CROSS_CONTACT":
      return "CROSS_CONTACT";
    case "CROSS_CONTACT_SEVERE":
      return "CROSS_CONTACT_SEVERE";
    case "UNRECOGNIZED_ALLERGEN_DATA":
      return "UNRECOGNIZED_ALLERGEN_DATA";
    default:
      return assertNeverDto(c);
  }
}

function dtoToWarningSeverity(s: WarningSeverityDto): WarningSeverity {
  switch (s) {
    case "info":
      return "info";
    case "high":
      return "high";
    case "critical":
      return "critical";
    default:
      return assertNeverDto(s);
  }
}

function dtoToEvidenceKind(k: EvidenceKindDto): EvidenceKind {
  switch (k) {
    case "ASSERTION_CONTAINS":
      return "ASSERTION_CONTAINS";
    case "ASSERTION_MAY_CONTAIN":
      return "ASSERTION_MAY_CONTAIN";
    case "INGREDIENT_TEXT_TERM":
      return "INGREDIENT_TEXT_TERM";
    case "NAME_TERM":
      return "NAME_TERM";
    case "ASSERTION_CODE_TERM":
      return "ASSERTION_CODE_TERM";
    default:
      return assertNeverDto(k);
  }
}

describe("allergen contracts vs domain allergen types (compile-time exhaustiveness)", () => {
  // These assertions are almost incidental — the real proof is that this
  // file typechecks at all. Calling each function once keeps them "used" for
  // lint purposes and gives a runtime signal too.
  it("verdictToDto covers every ScreeningVerdict member", () => {
    expect(verdictToDto("BLOCKED")).toBe("BLOCKED");
    expect(verdictToDto("ALLOWED_WITH_UNKNOWNS")).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(verdictToDto("ALLOWED")).toBe("ALLOWED");
  });

  it("unknownReasonToDto covers every UnknownReason member", () => {
    const reasons: readonly UnknownReason[] = [
      "NO_ALLERGEN_DATA",
      "INCOMPLETE_DECLARATION",
      "UNVERIFIED_DECLARATION_TIER",
      "UNSOURCED_DECLARATION",
      "NO_INGREDIENT_TEXT",
      "UNRECOGNIZED_ASSERTION_CODE",
      "UNRECOGNIZED_ASSERTION_KIND",
      "MALFORMED_ALLERGEN_DATA",
    ];
    for (const reason of reasons) {
      expect(unknownReasonToDto(reason)).toBe(reason);
    }
  });

  it("warningCodeToDto covers every WarningCode member", () => {
    const codes: readonly WarningCode[] = [
      "NO_SAFETY_GUARANTEE",
      "SEVERE_ALLERGY_UNKNOWN_DATA",
      "CROSS_CONTACT",
      "CROSS_CONTACT_SEVERE",
      "UNRECOGNIZED_ALLERGEN_DATA",
    ];
    for (const code of codes) {
      expect(warningCodeToDto(code)).toBe(code);
    }
  });

  it("warningSeverityToDto covers every WarningSeverity member", () => {
    expect(warningSeverityToDto("info")).toBe("info");
    expect(warningSeverityToDto("high")).toBe("high");
    expect(warningSeverityToDto("critical")).toBe("critical");
  });

  it("evidenceKindToDto covers every EvidenceKind member", () => {
    const kinds: readonly EvidenceKind[] = [
      "ASSERTION_CONTAINS",
      "ASSERTION_MAY_CONTAIN",
      "INGREDIENT_TEXT_TERM",
      "NAME_TERM",
      "ASSERTION_CODE_TERM",
    ];
    for (const kind of kinds) {
      expect(evidenceKindToDto(kind)).toBe(kind);
    }
  });
});

describe("DTO -> domain direction (review F10, catches a phantom DTO member)", () => {
  it("dtoToVerdict covers every ScreeningVerdictDto member", () => {
    for (const v of SCREENING_VERDICTS_DTO) {
      expect(dtoToVerdict(v)).toBe(v);
    }
  });

  it("dtoToUnknownReason covers every UnknownReasonDto member", () => {
    for (const r of UNKNOWN_REASONS_DTO) {
      expect(dtoToUnknownReason(r)).toBe(r);
    }
  });

  it("dtoToWarningCode covers every WarningCodeDto member", () => {
    for (const c of WARNING_CODES_DTO) {
      expect(dtoToWarningCode(c)).toBe(c);
    }
  });

  it("dtoToWarningSeverity covers every WarningSeverityDto member", () => {
    for (const s of WARNING_SEVERITIES_DTO) {
      expect(dtoToWarningSeverity(s)).toBe(s);
    }
  });

  it("dtoToEvidenceKind covers every EvidenceKindDto member", () => {
    for (const k of EVIDENCE_KINDS_DTO) {
      expect(dtoToEvidenceKind(k)).toBe(k);
    }
  });
});

describe("allergen contracts codes are reachable from the real engine (light regression net)", () => {
  it("produces ALLOWED, ALLOWED_WITH_UNKNOWNS and BLOCKED via screenSubject", () => {
    const peanut = majorRestriction("r1", "peanut", "severe");
    if (!peanut.ok) throw new Error(peanut.error.message);

    const blocked = screenSubject({
      subject: { kind: "PRODUCT", subjectId: "p1", name: "Peanut butter" },
      members: [{ memberId: "m1", restrictions: [peanut.value] }],
    });
    if (!blocked.ok) throw new Error(blocked.error.message);
    expect(verdictToDto(blocked.value.verdict)).toBe("BLOCKED");
    expect(evidenceKindToDto(blocked.value.evidence[0]!.kind)).toBe("NAME_TERM");

    const unknown = screenSubject({
      subject: { kind: "PRODUCT", subjectId: "p2", name: "Mystery bar" },
      members: [{ memberId: "m1", restrictions: [peanut.value] }],
    });
    if (!unknown.ok) throw new Error(unknown.error.message);
    expect(verdictToDto(unknown.value.verdict)).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(unknownReasonToDto(unknown.value.unknowns[0]!.reason)).toBe("NO_ALLERGEN_DATA");
    expect(
      unknown.value.warnings.some(
        (w) => warningCodeToDto(w.code) === "SEVERE_ALLERGY_UNKNOWN_DATA",
      ),
    ).toBe(true);

    const allowed = screenSubject({
      subject: {
        kind: "PRODUCT",
        subjectId: "p3",
        name: "Rice cakes",
        declaration: {
          majorAllergens: "COMPLETE_FOR_MAJOR_ALLERGENS",
          ingredientStatement: "COMPLETE",
          tier: "KNOWN_FACT",
          source: "manufacturer-label",
        },
      },
      members: [{ memberId: "m1", restrictions: [peanut.value] }],
    });
    if (!allowed.ok) throw new Error(allowed.error.message);
    expect(verdictToDto(allowed.value.verdict)).toBe("ALLOWED");
    expect(
      allowed.value.warnings.some((w) => warningCodeToDto(w.code) === "NO_SAFETY_GUARANTEE"),
    ).toBe(true);
  });
});
