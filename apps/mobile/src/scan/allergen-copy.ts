/**
 * S8's allergen row copy (M3-T4b, review round 2 ruling on F3/F6/F7).
 *
 * **Every unknown and every evidence entry gets its own line — never a
 * single "primary" pick.** The review's first pass condensed each
 * `ScreeningResultDto` down to one summary sentence (picking "the first
 * severe unknown" / "the first evidence with matchedText"), which silently
 * dropped real, distinct findings (a product can be `BLOCKED` on one
 * restriction *and* unresolved on another at the same time — the tahini
 * fixture is exactly this: `BLOCKED` for Maya's sesame, `UNKNOWN` for her
 * peanut, both real facts about the same scan). This module instead renders
 * copy-deck.md §3.1's full, canonical per-reason/per-severity unknown-line
 * table and per-`EvidenceKind` evidence-line table — the same strings that
 * surface already has for the recipe-detail screen — in this surface's
 * condensed layout: each line keeps the same words, with this surface's
 * inline caveat clause appended.
 *
 * **No verdict, warning or unknown is computed, inferred, softened or
 * reordered here.** Every function below is a pure lookup/interpolation
 * keyed off `ScreeningResultDto.verdict`/`.code`/`.reason`/`.kind` — never
 * off free text — from a `ScreeningResultDto` the caller already decided.
 * `memberId`s are resolved to display names by a caller-supplied resolver
 * (review F11: the screen builds this from the household DTO it already
 * holds, never a fixed name map baked into this module).
 */

import type {
  ScreeningEvidenceDto,
  ScreeningResultDto,
  ScreeningUnknownDto,
  ScreeningWarningDto,
  UnknownReasonDto,
} from "@smart-kitchen/contracts";

/** copy-deck.md §3.3's adopted inline caveat clause, appended to every non-`ALLOWED` line on this surface. Exported so the exact literal is reused, never retyped. */
export const SCAN_SHEET_CAVEAT_SUFFIX = " · not a safety guarantee";

/** copy-deck.md §3.3, `ALLOWED` row, verbatim (already folds the caveat into the line itself). */
export const SCAN_SHEET_ALLOWED_LINE =
  "No known household match · label declaration · not a safety guarantee";

/** A resolver from `memberId` to a display name, built by the caller from the household DTO it holds (review F11) — never a fixed map, never the raw id. */
export type MemberNameResolver = (memberId: string) => string;

/**
 * Neutral fallback wording (review F11; **not** in copy-deck.md — review
 * round 3 R3 correction: an earlier comment here wrongly attributed this to
 * §3.1, which has no such string). A new string this ticket proposes for
 * the deck (see the worker report's proposed-strings section), used only if
 * a resolver cannot name the member — never the raw id.
 */
export const UNKNOWN_MEMBER_FALLBACK = "a household member";

/**
 * copy-deck.md §3.1's unknown-line table, by `UnknownReason` and severity.
 * Verbatim; `{member}`/`{allergen}` are interpolated by
 * {@link unknownLine}, never baked in here.
 */
const UNKNOWN_LINE_TEMPLATES: Readonly<
  Record<UnknownReasonDto, { readonly standard: string; readonly severe: string }>
> = {
  NO_ALLERGEN_DATA: {
    standard:
      "We don't have allergen information for this item, so {member}'s {allergen} allergy is unresolved.",
    severe:
      "We don't have allergen information for this item. This matters for {member}'s severe {allergen} allergy.",
  },
  INCOMPLETE_DECLARATION: {
    standard: "The label on file doesn't say whether it covers {member}'s {allergen} allergy.",
    severe: "The label on file doesn't say whether it covers {member}'s severe {allergen} allergy.",
  },
  UNVERIFIED_DECLARATION_TIER: {
    standard:
      "The label's claim to list every allergen hasn't been confirmed yet, so we can't clear {allergen} for {member}.",
    severe:
      "The label's claim to list every allergen hasn't been confirmed yet. It can't clear {member}'s severe {allergen} allergy.",
  },
  UNSOURCED_DECLARATION: {
    standard:
      "The label's claim to list every allergen doesn't name a source we can check, so {allergen} is unresolved for {member}.",
    severe:
      "The label's claim to list every allergen doesn't name a source we can check. {member}'s severe {allergen} allergy stays unresolved.",
  },
  NO_INGREDIENT_TEXT: {
    standard: "There's no ingredient list on file to check for {member}'s {allergen} allergy.",
    severe: "There's no ingredient list on file to check for {member}'s severe {allergen} allergy.",
  },
  UNRECOGNIZED_ASSERTION_CODE: {
    standard:
      "This item lists an allergen code we don't recognize, so we can't clear {allergen} for {member}.",
    severe:
      "This item lists an allergen code we don't recognize. It can't clear {member}'s severe {allergen} allergy.",
  },
  UNRECOGNIZED_ASSERTION_KIND: {
    standard:
      "This item's allergen data uses a claim type we don't recognize, so {allergen} stays unresolved for {member}.",
    severe:
      "This item's allergen data uses a claim type we don't recognize. {member}'s severe {allergen} allergy stays unresolved.",
  },
  MALFORMED_ALLERGEN_DATA: {
    standard:
      "This item's allergen data is in a format we can't read, so {allergen} stays unresolved for {member}.",
    severe:
      "This item's allergen data is in a format we can't read. {member}'s severe {allergen} allergy stays unresolved.",
  },
};

function interpolate(template: string, member: string, allergen: string): string {
  return template.replace("{member}", member).replace("{allergen}", allergen);
}

/** copy-deck.md §3.1's unknown-line table, one line per `ScreeningUnknownDto`, this surface's caveat appended. */
export function unknownLine(
  unknown: ScreeningUnknownDto,
  resolveMemberName: MemberNameResolver,
): string {
  const template =
    UNKNOWN_LINE_TEMPLATES[unknown.reason][unknown.severity === "severe" ? "severe" : "standard"];
  const member = resolveMemberName(unknown.memberId) || UNKNOWN_MEMBER_FALLBACK;
  return interpolate(template, member, unknown.restrictionLabel) + SCAN_SHEET_CAVEAT_SUFFIX;
}

/**
 * copy-deck.md §3.1's evidence-line table, one line per `ScreeningEvidenceDto`,
 * this surface's caveat appended. The BACKLOG's own worked example:
 * "Contains peanut · matched 'peanuts' in the ingredient statement · blocked
 * for Maya".
 */
export function evidenceLine(
  evidence: ScreeningEvidenceDto,
  resolveMemberName: MemberNameResolver,
): string {
  const member = resolveMemberName(evidence.memberId) || UNKNOWN_MEMBER_FALLBACK;
  const allergen = evidence.restrictionLabel;
  const matched = evidence.matchedText ?? evidence.matchedTerm;
  let body: string;
  switch (evidence.kind) {
    case "ASSERTION_CONTAINS":
      body = `Contains ${allergen} · stated by the manufacturer · blocked for ${member}`;
      break;
    case "ASSERTION_MAY_CONTAIN":
      body = `May contain ${allergen} (cross-contact) · stated by the manufacturer · blocked for ${member}`;
      break;
    case "INGREDIENT_TEXT_TERM":
      body = `Contains ${allergen} · matched '${matched}' in the ingredient statement · blocked for ${member}`;
      break;
    case "NAME_TERM":
      body = `Contains ${allergen} · matched '${matched}' in the name · blocked for ${member}`;
      break;
    case "ASSERTION_CODE_TERM":
      body = `Contains ${allergen} · matched the allergen tag '${evidence.matchedTerm}' · blocked for ${member}`;
      break;
  }
  return body + SCAN_SHEET_CAVEAT_SUFFIX;
}

/**
 * The tier chip an evidence line's own provenance carries (review F4/F5):
 * the evidence's own `assertionTier` when it came from a structured
 * assertion; otherwise (a free-text `NAME_TERM`/`INGREDIENT_TEXT_TERM`
 * match, which has no assertion of its own to tier) falls back to any
 * *other* evidence entry in the same result that does carry one — "the
 * record's allergens tier" the ruling names, read here as: whatever tier
 * this screening's own structured assertions were recorded at, since every
 * assertion on one product in this fixture corpus shares one tier/source.
 * `undefined` only if no evidence in the whole result carries a tier at
 * all (nothing invented).
 */
export function evidenceTier(
  evidence: ScreeningEvidenceDto,
  allEvidence: readonly ScreeningEvidenceDto[],
): string | undefined {
  if (evidence.assertionTier !== undefined) {
    return evidence.assertionTier;
  }
  return allEvidence.find((e) => e.assertionTier !== undefined)?.assertionTier;
}

/** copy-deck.md §3.3's one-line rendering for `ALLOWED` (no evidence/unknowns to enumerate — the trivial case). */
export function allowedLine(): string {
  return SCAN_SHEET_ALLOWED_LINE;
}

/** copy-deck.md §3.1's `UNRECOGNIZED_ALLERGEN_DATA` string, selected by whether it co-occurs with `ALLOWED` (M1-T6 F7). */
function unrecognizedAllergenDataLine(result: ScreeningResultDto): string {
  return result.verdict === "ALLOWED"
    ? "Some of this item's allergen data couldn't be read. It doesn't touch anyone's restrictions in your household, but check the label yourself."
    : "Some of this item's allergen data couldn't be read, so we couldn't check that part. Check the label yourself.";
}

/** copy-deck.md §3.1's `CROSS_CONTACT` string (standard-severity cross-contact, never blocks). */
function crossContactLine(
  warning: ScreeningWarningDto,
  resolveMemberName: MemberNameResolver,
): string {
  const member = warning.memberId
    ? resolveMemberName(warning.memberId) || UNKNOWN_MEMBER_FALLBACK
    : "this member";
  const allergen = warning.restrictionLabel ?? "this allergen";
  return (
    `This item may have cross-contact with ${allergen} (the manufacturer says 'may contain'). ` +
    `Not blocked, because ${member}'s allergy is standard severity.`
  );
}

/**
 * `UNRECOGNIZED_ALLERGEN_DATA` and `CROSS_CONTACT` render on this surface
 * too (copy-deck.md §3.3's closing note), when present.
 * `SEVERE_ALLERGY_UNKNOWN_DATA`/`CROSS_CONTACT_SEVERE` render *through* the
 * unknown/evidence lines above, never as a separate sentence (copy-deck.md
 * §3.1), and `NO_SAFETY_GUARANTEE` is the standing caveat already folded
 * into every line above, so neither is repeated here.
 */
export function extraWarningLines(
  result: ScreeningResultDto,
  resolveMemberName: MemberNameResolver,
): readonly string[] {
  const lines: string[] = [];
  for (const warning of result.warnings) {
    if (warning.code === "UNRECOGNIZED_ALLERGEN_DATA") {
      lines.push(unrecognizedAllergenDataLine(result));
    } else if (warning.code === "CROSS_CONTACT") {
      lines.push(crossContactLine(warning, resolveMemberName));
    }
  }
  return lines;
}

/**
 * `BLOCKED` never renders with the terracotta primary-CTA colour (P5: a
 * blocked outcome is never presented as a recommendation) — the Add button
 * still works (the product is in the house either way, BACKLOG.md M3-T4b
 * Objective (c)), it just loses the brand colour. Keyed off `verdict`, the
 * same rule the row's own colour follows.
 */
export function addCtaIsBlocked(result: ScreeningResultDto): boolean {
  return result.verdict === "BLOCKED";
}
