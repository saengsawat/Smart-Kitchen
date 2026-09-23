/**
 * Allergen screening contracts (M3-T4b).
 *
 * Hand-written mirror of `packages/domain/src/allergens/types.ts`'s
 * `ScreeningResult` and its parts, the same pattern `household.ts` already
 * established for `MAJOR_ALLERGEN_CODES_DTO` (see that file's doc comment):
 * this package has zero dependencies so `apps/mobile` can depend on it
 * without ever pulling `@smart-kitchen/domain` into the client bundle (M3-T1
 * invariant). `packages/adapters/src/contracts-consistency/` carries the
 * tests that keep this file's unions equal to the domain's (a compile-time
 * equality check for the four unions below, since the domain does not export
 * a runtime array for any of them — unlike `MAJOR_ALLERGEN_CODES`, which
 * does, and unlike the unit registry, which `units.ts` checks at runtime).
 *
 * **No verdict is computed from this shape in the client.** A
 * `ScreeningResultDto` arrives already decided (from the fixture lookup
 * today, the real M2-T3 engine later) and the client renders exactly what it
 * says, keyed off `code`/`reason`/`kind`, never `message`-style free text
 * (copy-deck.md §2). This file carries no `message` field at all — the
 * domain's `ScreeningEvidence.message`/`ScreeningWarning.message` equivalents
 * are deliberately omitted, because a client that had them lying around would
 * be one lazy shortcut away from displaying machine-facing text instead of
 * copy-deck strings.
 */

import type { RestrictionSeverityDto } from "./household.js";

/** Mirrors domain's `ScreeningVerdict` (`packages/domain/src/allergens/types.ts`). */
export const SCREENING_VERDICTS_DTO = ["BLOCKED", "ALLOWED_WITH_UNKNOWNS", "ALLOWED"] as const;
export type ScreeningVerdictDto = (typeof SCREENING_VERDICTS_DTO)[number];

/** Mirrors domain's `UnknownReason`. */
export const UNKNOWN_REASONS_DTO = [
  "NO_ALLERGEN_DATA",
  "INCOMPLETE_DECLARATION",
  "UNVERIFIED_DECLARATION_TIER",
  "UNSOURCED_DECLARATION",
  "NO_INGREDIENT_TEXT",
  "UNRECOGNIZED_ASSERTION_CODE",
  "UNRECOGNIZED_ASSERTION_KIND",
  "MALFORMED_ALLERGEN_DATA",
] as const;
export type UnknownReasonDto = (typeof UNKNOWN_REASONS_DTO)[number];

/** Mirrors domain's `WarningCode`. */
export const WARNING_CODES_DTO = [
  "NO_SAFETY_GUARANTEE",
  "SEVERE_ALLERGY_UNKNOWN_DATA",
  "CROSS_CONTACT",
  "CROSS_CONTACT_SEVERE",
  "UNRECOGNIZED_ALLERGEN_DATA",
] as const;
export type WarningCodeDto = (typeof WARNING_CODES_DTO)[number];

/** Mirrors domain's `WarningSeverity`. */
export const WARNING_SEVERITIES_DTO = ["info", "high", "critical"] as const;
export type WarningSeverityDto = (typeof WARNING_SEVERITIES_DTO)[number];

/** Mirrors domain's `EvidenceKind`. */
export const EVIDENCE_KINDS_DTO = [
  "ASSERTION_CONTAINS",
  "ASSERTION_MAY_CONTAIN",
  "INGREDIENT_TEXT_TERM",
  "NAME_TERM",
  "ASSERTION_CODE_TERM",
] as const;
export type EvidenceKindDto = (typeof EVIDENCE_KINDS_DTO)[number];

/** Mirrors domain's `EvidenceLocus`. Not rendered on the scan sheet today, carried for parity/future use. */
export interface EvidenceLocusDto {
  readonly part: "PRODUCT" | "RECIPE_INGREDIENT";
  readonly ref: string;
  readonly ingredientIndex?: number;
}

/**
 * Mirrors domain's `ScreeningEvidence`. `memberId` is resolved to a display
 * name by the client from the household DTO it already holds, never
 * rendered raw and never from a fixed name map (copy-deck.md §2; review
 * F11). `assertionSource`/`assertionTier` mirror the domain field pair
 * added M3-T4b review round (F15): present only when the evidence came
 * from a structured assertion (`ASSERTION_CONTAINS`/`ASSERTION_MAY_CONTAIN`/
 * `ASSERTION_CODE_TERM`), `undefined` for a free-text match
 * (`NAME_TERM`/`INGREDIENT_TEXT_TERM`) — the tier chip S8 renders on a
 * `BLOCKED` line falls back to the record's own allergens-field tier when
 * this is absent (review F4/F5), never inventing one.
 */
export interface ScreeningEvidenceDto {
  readonly memberId: string;
  readonly restrictionId: string;
  readonly restrictionLabel: string;
  readonly severity: RestrictionSeverityDto;
  readonly kind: EvidenceKindDto;
  readonly locus: EvidenceLocusDto;
  readonly matchedTerm: string;
  readonly matchedText?: string;
  readonly assertionSource?: string;
  readonly assertionTier?: string;
}

/** Mirrors domain's `ScreeningUnknown`. `detail` is machine-facing (mirrors the domain field); copy is keyed off `reason`, never `detail`. */
export interface ScreeningUnknownDto {
  readonly memberId: string;
  readonly restrictionId: string;
  readonly restrictionLabel: string;
  readonly severity: RestrictionSeverityDto;
  readonly reason: UnknownReasonDto;
  readonly locus: EvidenceLocusDto;
  readonly detail: string;
}

/** Mirrors domain's `ScreeningWarning`, minus `message` (see module doc comment). */
export interface ScreeningWarningDto {
  readonly code: WarningCodeDto;
  readonly severity: WarningSeverityDto;
  readonly memberId?: string;
  readonly restrictionId?: string;
  readonly restrictionLabel?: string;
}

/** Mirrors domain's `MemberScreeningResult`. */
export interface MemberScreeningResultDto {
  readonly memberId: string;
  readonly verdict: ScreeningVerdictDto;
}

/**
 * Mirrors domain's `ScreeningResult`. `subjectKind` is narrowed to `"PRODUCT"`
 * (the only subject kind a scan/lookup ever screens; recipe screening is
 * M6's concern and has no client-facing DTO yet).
 */
export interface ScreeningResultDto {
  readonly subjectKind: "PRODUCT";
  readonly subjectId: string;
  readonly verdict: ScreeningVerdictDto;
  readonly members: readonly MemberScreeningResultDto[];
  readonly evidence: readonly ScreeningEvidenceDto[];
  readonly unknowns: readonly ScreeningUnknownDto[];
  readonly warnings: readonly ScreeningWarningDto[];
}
