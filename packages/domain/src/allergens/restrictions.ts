/**
 * Restriction construction and input validation (M1-T4).
 *
 * Everything a caller hands the engine passes through here first, and comes
 * out the other side as a **freshly built object with an explicit field list**.
 * Nothing is spread, so any extra property a caller attaches — `override`,
 * `aiVerifiedSafe`, a pre-baked `verdict` — is dropped at the boundary and can
 * never reach the engine, let alone influence it. This is the direct lesson of
 * M1-T1 review finding F1 (an unfiltered `...input` spread let a caller forge
 * a system-only flag), applied from the start rather than after the fact.
 *
 * Validation **fails closed**: an input we cannot interpret is an error, not a
 * permissive default. In particular a restriction naming an allergen code
 * outside the taxonomy is rejected outright — silently ignoring it would mean
 * silently not protecting that member.
 */

import { err, MIN_TERM_LENGTH, ok, type Outcome } from "./errors.js";
import { isMajorAllergenCode, type MajorAllergenCode } from "./taxonomy.js";
import { normalizeText } from "./text.js";
import {
  RESTRICTION_SEVERITIES,
  type AllergyRestriction,
  type RestrictionSeverity,
  type ScreenedMember,
} from "./types.js";

const SEVERITY_SET: ReadonlySet<string> = new Set<string>(RESTRICTION_SEVERITIES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validateSeverity(value: unknown, field: string): Outcome<RestrictionSeverity> {
  if (typeof value !== "string" || !SEVERITY_SET.has(value)) {
    return err(
      "INVALID_SEVERITY",
      `severity must be one of ${RESTRICTION_SEVERITIES.join(" | ")}`,
      field,
    );
  }
  return ok(value as RestrictionSeverity);
}

/**
 * Builds a validated major-allergen restriction.
 *
 * The public signature is strictly typed for the benefit of typed call sites;
 * validation still runs, because TypeScript types are erased and much of this
 * data originates as JSON. Untrusted input should go through
 * {@link validateRestriction}, which accepts `unknown` and lands here.
 */
export function majorRestriction(
  restrictionId: string,
  allergen: MajorAllergenCode,
  severity: RestrictionSeverity,
): Outcome<AllergyRestriction> {
  return buildMajorRestriction(restrictionId, allergen, severity);
}

function buildMajorRestriction(
  restrictionId: unknown,
  allergen: unknown,
  severity: unknown,
): Outcome<AllergyRestriction> {
  if (!isNonEmptyString(restrictionId)) {
    return err("EMPTY_RESTRICTION_ID", "restrictionId must be a non-empty string", "restrictionId");
  }
  if (!isMajorAllergenCode(allergen)) {
    return err(
      "UNKNOWN_ALLERGEN_CODE",
      `restriction names an allergen code outside the taxonomy: ${String(allergen)}`,
      "allergen",
    );
  }
  const checkedSeverity = validateSeverity(severity, "severity");
  if (!checkedSeverity.ok) return checkedSeverity;

  return ok({
    kind: "MAJOR",
    restrictionId,
    allergen,
    severity: checkedSeverity.value,
  });
}

/** Builds a validated user-defined restriction, storing the term in normalized form. */
export function userDefinedRestriction(
  restrictionId: string,
  term: string,
  severity: RestrictionSeverity,
): Outcome<AllergyRestriction> {
  return buildUserDefinedRestriction(restrictionId, term, severity);
}

function buildUserDefinedRestriction(
  restrictionId: unknown,
  term: unknown,
  severity: unknown,
): Outcome<AllergyRestriction> {
  if (!isNonEmptyString(restrictionId)) {
    return err("EMPTY_RESTRICTION_ID", "restrictionId must be a non-empty string", "restrictionId");
  }
  if (typeof term !== "string") {
    return err("EMPTY_TERM", "term must be a string", "term");
  }
  const normalized = normalizeText(term);
  if (normalized === "") {
    return err("EMPTY_TERM", "term is empty after normalization", "term");
  }
  if (normalized.replace(/ /g, "").length < MIN_TERM_LENGTH) {
    return err(
      "TERM_TOO_SHORT",
      `user-defined term must have at least ${String(MIN_TERM_LENGTH)} characters after normalization; ` +
        `shorter terms match too much text to be safe evidence`,
      "term",
    );
  }
  const checkedSeverity = validateSeverity(severity, "severity");
  if (!checkedSeverity.ok) return checkedSeverity;

  return ok({
    kind: "USER_DEFINED",
    restrictionId,
    term: normalized,
    severity: checkedSeverity.value,
  });
}

/** Re-validates and rebuilds one restriction from untrusted input. */
export function validateRestriction(input: unknown, field: string): Outcome<AllergyRestriction> {
  if (typeof input !== "object" || input === null) {
    return err("NOT_AN_OBJECT", "restriction must be an object", field);
  }
  const candidate = input as {
    kind?: unknown;
    restrictionId?: unknown;
    allergen?: unknown;
    term?: unknown;
    severity?: unknown;
  };
  const restrictionId = typeof candidate.restrictionId === "string" ? candidate.restrictionId : "";

  if (candidate.kind === "MAJOR") {
    return buildMajorRestriction(restrictionId, candidate.allergen, candidate.severity);
  }
  if (candidate.kind === "USER_DEFINED") {
    return buildUserDefinedRestriction(restrictionId, candidate.term, candidate.severity);
  }
  return err(
    "INVALID_RESTRICTION_KIND",
    `restriction kind must be MAJOR or USER_DEFINED, got: ${String(candidate.kind)}`,
    field,
  );
}

/**
 * Validates the member list and rebuilds it field by field.
 *
 * Duplicate member ids and duplicate restriction ids within a member are
 * errors: evidence and unknowns are correlated back by those ids, so ambiguous
 * ids would make a result unexplainable.
 */
export function validateMembers(members: unknown): Outcome<readonly ScreenedMember[]> {
  if (!Array.isArray(members)) {
    return err("NOT_AN_OBJECT", "members must be an array", "members");
  }

  const seenMemberIds = new Set<string>();
  const validated: ScreenedMember[] = [];

  for (let index = 0; index < members.length; index++) {
    const raw: unknown = members[index];
    const field = `members[${String(index)}]`;
    if (typeof raw !== "object" || raw === null) {
      return err("NOT_AN_OBJECT", "member must be an object", field);
    }
    const candidate = raw as { memberId?: unknown; restrictions?: unknown };
    if (!isNonEmptyString(candidate.memberId)) {
      return err("EMPTY_MEMBER_ID", "memberId must be a non-empty string", `${field}.memberId`);
    }
    const memberId = candidate.memberId;
    if (seenMemberIds.has(memberId)) {
      return err("DUPLICATE_MEMBER_ID", `duplicate memberId: ${memberId}`, `${field}.memberId`);
    }
    seenMemberIds.add(memberId);

    const rawRestrictions: unknown = candidate.restrictions ?? [];
    if (!Array.isArray(rawRestrictions)) {
      return err("NOT_AN_OBJECT", "restrictions must be an array", `${field}.restrictions`);
    }

    const seenRestrictionIds = new Set<string>();
    const restrictions: AllergyRestriction[] = [];
    for (let r = 0; r < rawRestrictions.length; r++) {
      const restrictionField = `${field}.restrictions[${String(r)}]`;
      const validatedRestriction = validateRestriction(rawRestrictions[r], restrictionField);
      if (!validatedRestriction.ok) return validatedRestriction;
      const restriction = validatedRestriction.value;
      if (seenRestrictionIds.has(restriction.restrictionId)) {
        return err(
          "DUPLICATE_RESTRICTION_ID",
          `duplicate restrictionId within member ${memberId}: ${restriction.restrictionId}`,
          restrictionField,
        );
      }
      seenRestrictionIds.add(restriction.restrictionId);
      restrictions.push(restriction);
    }

    validated.push({ memberId, restrictions });
  }

  return ok(validated);
}

/** Display label for a restriction: the taxonomy code or the normalized user term. */
export function restrictionLabel(restriction: AllergyRestriction): string {
  return restriction.kind === "MAJOR" ? restriction.allergen : restriction.term;
}
