/**
 * The deterministic allergen screening engine (M1-T4).
 *
 * `screenSubject` is a pure, total function: same input, same verdict, always.
 * No clock, no randomness, no I/O, no network, no model call — allergen
 * evaluation is `Deterministic` authority in `ai-architecture.md` §2, SR-1 and
 * CLAUDE.md rule 7. An LLM may hand this engine *data* (an extracted recipe, a
 * proposed assertion) and that data can only ever add a match or an unknown;
 * there is no input, field or flag by which it can remove one (rule 9).
 *
 * ## The decision, in one place
 *
 * For each (member, restriction) pair the engine looks at every *locus* of the
 * subject — the product itself, or each recipe ingredient — and derives one
 * {@link RestrictionOutcome}, worst-wins across loci:
 *
 * | Outcome | Established by | Verdict |
 * |---|---|---|
 * | `MATCH` | a `CONTAINS` assertion for the restricted allergen, or a curated/user term found in a name or ingredient statement | `BLOCKED` |
 * | `POSSIBLE_MATCH` | a `MAY_CONTAIN` (cross-contact) assertion | severity-dependent, see {@link CROSS_CONTACT_POLICY} |
 * | `UNKNOWN` | nothing matched, and nothing licenses concluding absence | `ALLOWED_WITH_UNKNOWNS` |
 * | `NO_KNOWN_MATCH` | nothing matched, and an explicit `KNOWN_FACT` completeness declaration licenses concluding absence | `ALLOWED` |
 *
 * `MATCH` ⇒ `BLOCKED` is unconditional (INV-ALRG-1): it is computed before any
 * other consideration, no other field is consulted, and nothing downstream can
 * soften it. `UNKNOWN` never silently passes (INV-ALRG-2): it always yields
 * `ALLOWED_WITH_UNKNOWNS` carrying a {@link ScreeningUnknown} that names what
 * is unknown and where.
 *
 * Household verdict = worst member verdict; member verdict = worst restriction
 * verdict (SR-1 / INV-ALRG-1; the aggregation rule itself is new semantics
 * introduced by M1-T4, proposed for `domain-model.md` §4 at acceptance).
 *
 * ## Why `ALLOWED` is reachable at all
 *
 * Because absence-of-data is never absence-of-allergen, the engine will not
 * infer absence from silence. It concludes `NO_KNOWN_MATCH` only against an
 * explicit {@link AllergenDeclaration} at `KNOWN_FACT` tier — a sourced claim
 * that someone enumerated the allergens (a manufacturer label) or recorded the
 * full ingredient statement. Absent that, an LLM-generated recipe of bare
 * ingredient names can only ever come back `BLOCKED` or
 * `ALLOWED_WITH_UNKNOWNS`, which is the honest answer.
 */

import { deepFreeze } from "./freeze.js";
import { err, ok, type Outcome } from "./errors.js";
import { restrictionLabel, validateMembers } from "./restrictions.js";
import {
  ALLERGEN_EXCLUSIONS,
  ALLERGEN_TERMS,
  normalizeAllergenCode,
  type MajorAllergenCode,
} from "./taxonomy.js";
import { compileTerm, findTermMatches, type CompiledTerm } from "./text.js";
import type {
  AllergenAssertionInput,
  AllergenDeclaration,
  AllergyRestriction,
  EvidenceLocus,
  MemberScreeningResult,
  ProductSubjectInput,
  RecipeSubjectInput,
  RestrictionOutcome,
  RestrictionScreeningResult,
  ScreenedMember,
  ScreeningEvidence,
  ScreeningInput,
  ScreeningResult,
  ScreeningSubjectInput,
  ScreeningUnknown,
  ScreeningVerdict,
  ScreeningWarning,
  UnknownReason,
} from "./types.js";

/**
 * How a cross-contact (`MAY_CONTAIN`) assertion matching a restriction is
 * treated, by severity. **PROPOSED — awaiting architect ratification.**
 *
 * - `severe` ⇒ `BLOCK`. For an anaphylactic allergy, "the manufacturer does
 *   not know whether this contains it" is not a risk worth recommending.
 * - `standard` ⇒ `WARN_UNKNOWN`: `ALLOWED_WITH_UNKNOWNS` plus a `high`
 *   {@link ScreeningWarning}. A `MAY_CONTAIN` label *is* an explicit statement
 *   of uncertainty, which is precisely what the middle verdict exists to
 *   express; it is never rendered as safe, and it preserves the choice that
 *   people with non-severe allergies routinely make for themselves. Blocking
 *   here instead is a one-line change to this table — see the handoff report
 *   for the argument on both sides.
 *
 * This is **data, not a parameter**: there is deliberately no caller-supplied
 * option to relax it, because an option that turns a block into a non-block is
 * exactly the override channel the safety contract forbids.
 */
export const CROSS_CONTACT_POLICY: Readonly<
  Record<"standard" | "severe", "BLOCK" | "WARN_UNKNOWN">
> = Object.freeze({
  severe: "BLOCK",
  standard: "WARN_UNKNOWN",
});

/** Verdict ordering, worst first — used for every aggregation in this module. */
const VERDICT_RANK: Readonly<Record<ScreeningVerdict, number>> = Object.freeze({
  BLOCKED: 3,
  ALLOWED_WITH_UNKNOWNS: 2,
  ALLOWED: 1,
});

/** Outcome ordering, worst first. */
const OUTCOME_RANK: Readonly<Record<RestrictionOutcome, number>> = Object.freeze({
  MATCH: 4,
  POSSIBLE_MATCH: 3,
  UNKNOWN: 2,
  NO_KNOWN_MATCH: 1,
});

function worstVerdict(a: ScreeningVerdict, b: ScreeningVerdict): ScreeningVerdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

/** A parsed, interpretable allergen claim at a locus. */
interface ParsedAssertion {
  readonly code: MajorAllergenCode;
  readonly kind: "CONTAINS" | "MAY_CONTAIN";
  readonly rawCode: string;
  readonly source?: string;
  readonly tier?: string;
}

/** A claim we could not fully interpret — never silently discarded. */
interface UninterpretedAssertion {
  readonly rawCode: string;
  readonly rawKind: string;
  readonly reason: "UNRECOGNIZED_ASSERTION_CODE" | "UNRECOGNIZED_ASSERTION_KIND";
  /** Present when the kind parsed but the code did not. */
  readonly kind?: "CONTAINS" | "MAY_CONTAIN";
}

/** One screenable part of the subject, with its data already parsed. */
interface Locus {
  readonly locus: EvidenceLocus;
  readonly parsed: readonly ParsedAssertion[];
  readonly uninterpreted: readonly UninterpretedAssertion[];
  /** Name text (product name / ingredient ref), scanned as `NAME_TERM`. */
  readonly nameText: string;
  /** Free ingredient statement, scanned as `INGREDIENT_TEXT_TERM`. */
  readonly ingredientsText: string;
  readonly declaration?: AllergenDeclaration;
}

function parseAssertions(inputs: readonly AllergenAssertionInput[] | undefined): {
  parsed: ParsedAssertion[];
  uninterpreted: UninterpretedAssertion[];
} {
  const parsed: ParsedAssertion[] = [];
  const uninterpreted: UninterpretedAssertion[] = [];
  for (const input of inputs ?? []) {
    if (typeof input !== "object" || input === null) continue;
    const rawCode = typeof input.allergenCode === "string" ? input.allergenCode : "";
    const rawKind = typeof input.assertion === "string" ? input.assertion : "";

    if (rawKind !== "CONTAINS" && rawKind !== "MAY_CONTAIN") {
      uninterpreted.push({
        rawCode,
        rawKind,
        reason: "UNRECOGNIZED_ASSERTION_KIND",
      });
      continue;
    }
    const code = normalizeAllergenCode(rawCode);
    if (code === undefined) {
      uninterpreted.push({
        rawCode,
        rawKind,
        reason: "UNRECOGNIZED_ASSERTION_CODE",
        kind: rawKind,
      });
      continue;
    }
    const provenance = input.provenance;
    const source = typeof provenance?.source === "string" ? provenance.source : undefined;
    const tier = typeof provenance?.tier === "string" ? provenance.tier : undefined;
    parsed.push({
      code,
      kind: rawKind,
      rawCode,
      ...(source === undefined ? {} : { source }),
      ...(tier === undefined ? {} : { tier }),
    });
  }
  return { parsed, uninterpreted };
}

/**
 * Coerces a field that should be free text. `screenSubject` is documented as a
 * total function, and its callers include adapters over third-party data, so a
 * numeric or object `name` must degrade to "no text" rather than throw when it
 * reaches `String.prototype.normalize` (review finding F4).
 */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Coerces a field that should be a list of assertions. Notably a *string* here
 * would otherwise be iterated character by character by `for...of` — silently
 * screening nothing at all rather than failing loudly (review finding F4).
 */
function asAssertionList(value: unknown): readonly AllergenAssertionInput[] {
  return Array.isArray(value) ? (value as readonly AllergenAssertionInput[]) : [];
}

/** Coerces a declaration field: anything that is not an object is no declaration at all. */
function asDeclaration(value: unknown): AllergenDeclaration | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as AllergenDeclaration;
}

function buildLoci(subject: ScreeningSubjectInput): readonly Locus[] {
  if (subject.kind === "PRODUCT") {
    const product: ProductSubjectInput = subject;
    const { parsed, uninterpreted } = parseAssertions(asAssertionList(product.allergens));
    const nameText = asText(product.name);
    const declaration = asDeclaration(product.declaration);
    return [
      {
        locus: { part: "PRODUCT", ref: nameText.trim() === "" ? product.subjectId : nameText },
        parsed,
        uninterpreted,
        nameText,
        ingredientsText: asText(product.ingredientsText),
        ...(declaration === undefined ? {} : { declaration }),
      },
    ];
  }

  const recipe: RecipeSubjectInput = subject;
  return recipe.ingredients.map((ingredient, index): Locus => {
    const { parsed, uninterpreted } = parseAssertions(asAssertionList(ingredient.allergens));
    const declaration = asDeclaration(ingredient.declaration);
    return {
      locus: { part: "RECIPE_INGREDIENT", ref: ingredient.ref, ingredientIndex: index },
      parsed,
      uninterpreted,
      nameText: ingredient.ref,
      ingredientsText: asText(ingredient.ingredientsText),
      ...(declaration === undefined ? {} : { declaration }),
    };
  });
}

/** Terms and exclusions to scan text with, for one restriction. */
function scanTermsFor(restriction: AllergyRestriction): {
  terms: readonly CompiledTerm[];
  exclusions: readonly CompiledTerm[];
} {
  if (restriction.kind === "MAJOR") {
    return {
      terms: ALLERGEN_TERMS[restriction.allergen],
      exclusions: ALLERGEN_EXCLUSIONS[restriction.allergen],
    };
  }
  const compiled = compileTerm(restriction.term);
  // A user term that normalizes to nothing cannot exist: `userDefinedRestriction`
  // rejects it at construction, and `validateMembers` re-runs that construction.
  return { terms: compiled === undefined ? [] : [compiled], exclusions: [] };
}

function buildEvidence(
  member: ScreenedMember,
  restriction: AllergyRestriction,
  label: string,
  kind: ScreeningEvidence["kind"],
  locus: EvidenceLocus,
  matchedTerm: string,
  matchedText?: string,
  assertionSource?: string,
  assertionTier?: string,
): ScreeningEvidence {
  return {
    memberId: member.memberId,
    restrictionId: restriction.restrictionId,
    restrictionLabel: label,
    severity: restriction.severity,
    kind,
    locus,
    matchedTerm,
    ...(matchedText === undefined ? {} : { matchedText }),
    ...(assertionSource === undefined ? {} : { assertionSource }),
    ...(assertionTier === undefined ? {} : { assertionTier }),
  };
}

function buildUnknown(
  member: ScreenedMember,
  restriction: AllergyRestriction,
  label: string,
  reason: UnknownReason,
  locus: EvidenceLocus,
  detail: string,
): ScreeningUnknown {
  return {
    memberId: member.memberId,
    restrictionId: restriction.restrictionId,
    restrictionLabel: label,
    severity: restriction.severity,
    reason,
    locus,
    detail,
  };
}

/**
 * Decides why a locus could not resolve a restriction either way.
 * Ordered most-specific first so the reason is actionable.
 */
function unknownReasonFor(
  restriction: AllergyRestriction,
  locus: Locus,
  hasIngredientsText: boolean,
): { reason: UnknownReason; detail: string } {
  const firstUninterpreted = locus.uninterpreted[0];
  if (firstUninterpreted !== undefined) {
    return {
      reason: firstUninterpreted.reason,
      detail:
        firstUninterpreted.reason === "UNRECOGNIZED_ASSERTION_CODE"
          ? `allergen code not in taxonomy: ${firstUninterpreted.rawCode}`
          : `assertion kind not understood: ${firstUninterpreted.rawKind}`,
    };
  }
  if (restriction.kind === "USER_DEFINED" && !hasIngredientsText) {
    return {
      reason: "NO_INGREDIENT_TEXT",
      detail: `no ingredient statement to scan for user-defined term "${restriction.term}" (a name alone is not an ingredient statement)`,
    };
  }
  const declaration = locus.declaration;
  if (declaration === undefined) {
    return {
      reason: "NO_ALLERGEN_DATA",
      detail: "no allergen completeness declaration on file for this item",
    };
  }
  const claimsCompleteness =
    restriction.kind === "MAJOR"
      ? declaration.majorAllergens === "COMPLETE_FOR_MAJOR_ALLERGENS"
      : declaration.ingredientStatement === "COMPLETE";
  if (!claimsCompleteness) {
    return {
      reason: "INCOMPLETE_DECLARATION",
      detail:
        restriction.kind === "MAJOR"
          ? `declaration does not claim major-allergen completeness (majorAllergens=${declaration.majorAllergens})`
          : `declaration does not claim a complete ingredient statement (ingredientStatement=${declaration.ingredientStatement})`,
    };
  }
  if (declaration.tier !== "KNOWN_FACT") {
    return {
      reason: "UNVERIFIED_DECLARATION_TIER",
      detail: `completeness claimed at tier ${String(declaration.tier)}; only KNOWN_FACT can license a no-known-match conclusion`,
    };
  }
  return {
    reason: "UNSOURCED_DECLARATION",
    detail:
      "completeness is claimed but the declaration names no source; an unattributable completeness claim cannot license a no-known-match conclusion",
  };
}

/**
 * True when this locus's declaration licenses concluding absence for this
 * restriction. Every condition here is a reason to *refuse* the permissive
 * verdict; the function fails closed on anything it does not recognise.
 *
 * `hasIngredientsText` is specifically about the ingredient statement, not
 * about "any text at all". An earlier version accepted the *name* as scannable
 * text, which made the condition unconditionally true for recipe loci (a
 * recipe ingredient's `ref` is mandatory) and let a user-defined allergy reach
 * `ALLOWED` with zero ingredient statement ever scanned (review finding F2).
 */
function licensesAbsence(
  restriction: AllergyRestriction,
  locus: Locus,
  hasIngredientsText: boolean,
): boolean {
  if (locus.uninterpreted.length > 0) return false;
  const declaration = locus.declaration;
  if (declaration === undefined) return false;
  if (declaration.tier !== "KNOWN_FACT") return false;
  // The declaration is the trust root of the whole permissive verdict, so an
  // unattributable one is worthless: who claimed completeness must be on
  // record (review addition P5).
  if (typeof declaration.source !== "string" || declaration.source.trim() === "") return false;
  if (restriction.kind === "MAJOR") {
    return declaration.majorAllergens === "COMPLETE_FOR_MAJOR_ALLERGENS";
  }
  return declaration.ingredientStatement === "COMPLETE" && hasIngredientsText;
}

interface LocusFinding {
  readonly outcome: RestrictionOutcome;
  readonly evidence: readonly ScreeningEvidence[];
  readonly unknowns: readonly ScreeningUnknown[];
}

function evaluateLocus(
  member: ScreenedMember,
  restriction: AllergyRestriction,
  label: string,
  locus: Locus,
): LocusFinding {
  const evidence: ScreeningEvidence[] = [];
  let containsFound = false;
  let mayContainFound = false;

  // 1. Explicit assertions. For MAJOR restrictions the folded code must equal
  //    the restricted allergen. For USER_DEFINED restrictions the assertion's
  //    raw code string is scanned with the user's term, so an allergen the
  //    taxonomy does not model (e.g. `mustard`) still matches a user-defined
  //    mustard allergy.
  const { terms, exclusions } = scanTermsFor(restriction);

  for (const assertion of locus.parsed) {
    const matches =
      restriction.kind === "MAJOR"
        ? assertion.code === restriction.allergen
        : findTermMatches(assertion.rawCode, terms).length > 0;
    if (!matches) continue;
    if (assertion.kind === "CONTAINS") {
      containsFound = true;
      evidence.push(
        buildEvidence(
          member,
          restriction,
          label,
          restriction.kind === "MAJOR" ? "ASSERTION_CONTAINS" : "ASSERTION_CODE_TERM",
          locus.locus,
          restriction.kind === "MAJOR" ? assertion.code : restriction.term,
          assertion.rawCode,
          assertion.source,
          assertion.tier,
        ),
      );
    } else {
      mayContainFound = true;
      evidence.push(
        buildEvidence(
          member,
          restriction,
          label,
          restriction.kind === "MAJOR" ? "ASSERTION_MAY_CONTAIN" : "ASSERTION_CODE_TERM",
          locus.locus,
          restriction.kind === "MAJOR" ? assertion.code : restriction.term,
          assertion.rawCode,
          assertion.source,
          assertion.tier,
        ),
      );
    }
  }

  // A user-defined term may also match an assertion code we could not fold
  // onto the taxonomy — that data is uninterpreted for majors but still plain
  // text for a user term.
  if (restriction.kind === "USER_DEFINED") {
    for (const uninterpreted of locus.uninterpreted) {
      if (findTermMatches(uninterpreted.rawCode, terms).length === 0) continue;
      if (uninterpreted.kind === "MAY_CONTAIN") {
        mayContainFound = true;
      } else {
        containsFound = true;
      }
      evidence.push(
        buildEvidence(
          member,
          restriction,
          label,
          "ASSERTION_CODE_TERM",
          locus.locus,
          restriction.term,
          uninterpreted.rawCode,
        ),
      );
    }
  }

  // 2. Free-text scanning of the name and the ingredient statement.
  for (const nameMatch of findTermMatches(locus.nameText, terms, exclusions)) {
    containsFound = true;
    evidence.push(
      buildEvidence(
        member,
        restriction,
        label,
        "NAME_TERM",
        locus.locus,
        nameMatch.term,
        nameMatch.matchedText,
      ),
    );
  }
  for (const textMatch of findTermMatches(locus.ingredientsText, terms, exclusions)) {
    containsFound = true;
    evidence.push(
      buildEvidence(
        member,
        restriction,
        label,
        "INGREDIENT_TEXT_TERM",
        locus.locus,
        textMatch.term,
        textMatch.matchedText,
      ),
    );
  }

  if (containsFound) {
    return { outcome: "MATCH", evidence, unknowns: [] };
  }
  if (mayContainFound) {
    return { outcome: "POSSIBLE_MATCH", evidence, unknowns: [] };
  }

  // Deliberately the ingredient statement only — a name is not an ingredient
  // statement, and treating it as one was review finding F2.
  const hasIngredientsText = locus.ingredientsText.trim() !== "";
  if (licensesAbsence(restriction, locus, hasIngredientsText)) {
    return { outcome: "NO_KNOWN_MATCH", evidence: [], unknowns: [] };
  }
  const { reason, detail } = unknownReasonFor(restriction, locus, hasIngredientsText);
  return {
    outcome: "UNKNOWN",
    evidence: [],
    unknowns: [buildUnknown(member, restriction, label, reason, locus.locus, detail)],
  };
}

function verdictFor(
  outcome: RestrictionOutcome,
  severity: "standard" | "severe",
): ScreeningVerdict {
  switch (outcome) {
    case "MATCH":
      return "BLOCKED";
    case "POSSIBLE_MATCH":
      return CROSS_CONTACT_POLICY[severity] === "BLOCK" ? "BLOCKED" : "ALLOWED_WITH_UNKNOWNS";
    case "UNKNOWN":
      return "ALLOWED_WITH_UNKNOWNS";
    case "NO_KNOWN_MATCH":
      return "ALLOWED";
  }
}

function evaluateRestriction(
  member: ScreenedMember,
  restriction: AllergyRestriction,
  loci: readonly Locus[],
): RestrictionScreeningResult {
  const label = restrictionLabel(restriction);
  const evidence: ScreeningEvidence[] = [];
  const unknowns: ScreeningUnknown[] = [];
  let outcome: RestrictionOutcome = "NO_KNOWN_MATCH";

  for (const locus of loci) {
    const finding = evaluateLocus(member, restriction, label, locus);
    evidence.push(...finding.evidence);
    unknowns.push(...finding.unknowns);
    if (OUTCOME_RANK[finding.outcome] > OUTCOME_RANK[outcome]) {
      outcome = finding.outcome;
    }
  }

  return {
    memberId: member.memberId,
    restrictionId: restriction.restrictionId,
    restrictionLabel: label,
    kind: restriction.kind,
    severity: restriction.severity,
    outcome,
    verdict: verdictFor(outcome, restriction.severity),
    evidence,
    unknowns,
  };
}

function warningsForRestriction(result: RestrictionScreeningResult): readonly ScreeningWarning[] {
  const warnings: ScreeningWarning[] = [];
  if (result.outcome === "POSSIBLE_MATCH") {
    const severe = result.severity === "severe";
    warnings.push({
      code: severe ? "CROSS_CONTACT_SEVERE" : "CROSS_CONTACT",
      severity: severe ? "critical" : "high",
      memberId: result.memberId,
      restrictionId: result.restrictionId,
      restrictionLabel: result.restrictionLabel,
      message: severe
        ? `cross-contact assertion for a severe ${result.restrictionLabel} allergy`
        : `cross-contact assertion for ${result.restrictionLabel}; contains status is not known`,
    });
  }
  if (result.outcome === "UNKNOWN" && result.severity === "severe") {
    warnings.push({
      code: "SEVERE_ALLERGY_UNKNOWN_DATA",
      severity: "critical",
      memberId: result.memberId,
      restrictionId: result.restrictionId,
      restrictionLabel: result.restrictionLabel,
      message: `allergen data for ${result.restrictionLabel} is unknown and this allergy is severe`,
    });
  }
  return warnings;
}

function validateSubject(subject: unknown): Outcome<ScreeningSubjectInput> {
  if (typeof subject !== "object" || subject === null) {
    return err("NOT_AN_OBJECT", "subject must be an object", "subject");
  }
  const candidate = subject as {
    kind?: unknown;
    subjectId?: unknown;
    ingredients?: unknown;
  };
  if (typeof candidate.subjectId !== "string" || candidate.subjectId.trim() === "") {
    return err("EMPTY_SUBJECT_ID", "subjectId must be a non-empty string", "subject.subjectId");
  }
  if (candidate.kind === "PRODUCT") {
    return ok(subject as ProductSubjectInput);
  }
  if (candidate.kind === "RECIPE") {
    if (!Array.isArray(candidate.ingredients) || candidate.ingredients.length === 0) {
      return err(
        "EMPTY_RECIPE",
        "a recipe subject must list at least one ingredient; screening an empty recipe would return a vacuous result",
        "subject.ingredients",
      );
    }
    for (let index = 0; index < candidate.ingredients.length; index++) {
      const ingredient: unknown = candidate.ingredients[index];
      const field = `subject.ingredients[${String(index)}]`;
      if (typeof ingredient !== "object" || ingredient === null) {
        return err("NOT_AN_OBJECT", "ingredient must be an object", field);
      }
      const ref: unknown = (ingredient as { ref?: unknown }).ref;
      if (typeof ref !== "string" || ref.trim() === "") {
        return err(
          "EMPTY_INGREDIENT_REF",
          "ingredient ref must be a non-empty string",
          `${field}.ref`,
        );
      }
    }
    return ok(subject as RecipeSubjectInput);
  }
  return err(
    "INVALID_SUBJECT_KIND",
    `subject kind must be RECIPE or PRODUCT, got: ${String(candidate.kind)}`,
    "subject.kind",
  );
}

/**
 * Screens one subject against every restriction of every member.
 *
 * Total function: returns a typed {@link Outcome}, never throws for a domain
 * rule violation. The success value is deep-frozen — a verdict is a safety
 * decision and callers must not be able to edit `BLOCKED` into `ALLOWED` on
 * the returned object.
 *
 * A household with no members, or members with no restrictions, screens to
 * `ALLOWED`: there is no restriction to violate. The mandatory
 * `NO_SAFETY_GUARANTEE` warning is still present, as it is on every result.
 */
export function screenSubject(input: ScreeningInput): Outcome<ScreeningResult> {
  if (typeof input !== "object" || input === null) {
    return err("NOT_AN_OBJECT", "screening input must be an object", "input");
  }

  const validatedSubject = validateSubject(input.subject);
  if (!validatedSubject.ok) return validatedSubject;
  const validatedMembers = validateMembers(input.members);
  if (!validatedMembers.ok) return validatedMembers;

  const subject = validatedSubject.value;
  const loci = buildLoci(subject);

  const memberResults: MemberScreeningResult[] = [];
  const allEvidence: ScreeningEvidence[] = [];
  const allUnknowns: ScreeningUnknown[] = [];
  const warnings: ScreeningWarning[] = [
    {
      code: "NO_SAFETY_GUARANTEE",
      severity: "info",
      message:
        "screening reports known matches only; absence of a match is not a guarantee that this food is safe",
    },
  ];

  const hasUninterpretedData = loci.some((locus) => locus.uninterpreted.length > 0);
  if (hasUninterpretedData) {
    warnings.push({
      code: "UNRECOGNIZED_ALLERGEN_DATA",
      severity: "high",
      message:
        "this item carries allergen data the taxonomy could not interpret; affected restrictions are reported as unknown",
    });
  }

  let householdVerdict: ScreeningVerdict = "ALLOWED";

  for (const member of validatedMembers.value) {
    let memberVerdict: ScreeningVerdict = "ALLOWED";
    const restrictionResults: RestrictionScreeningResult[] = [];

    for (const restriction of member.restrictions) {
      const result = evaluateRestriction(member, restriction, loci);
      restrictionResults.push(result);
      allEvidence.push(...result.evidence);
      allUnknowns.push(...result.unknowns);
      warnings.push(...warningsForRestriction(result));
      memberVerdict = worstVerdict(memberVerdict, result.verdict);
    }

    memberResults.push({
      memberId: member.memberId,
      verdict: memberVerdict,
      restrictions: restrictionResults,
    });
    householdVerdict = worstVerdict(householdVerdict, memberVerdict);
  }

  return ok(
    deepFreeze({
      subjectKind: subject.kind,
      subjectId: subject.subjectId,
      verdict: householdVerdict,
      members: memberResults,
      evidence: allEvidence,
      unknowns: allUnknowns,
      warnings,
    }),
  );
}

/**
 * Screens several subjects against the same members, preserving input order.
 * Fails on the first invalid subject rather than returning partial results.
 */
export function screenSubjects(
  subjects: readonly ScreeningSubjectInput[],
  members: readonly ScreenedMember[],
): Outcome<readonly ScreeningResult[]> {
  const results: ScreeningResult[] = [];
  for (const subject of subjects) {
    const result = screenSubject({ subject, members });
    if (!result.ok) return result;
    results.push(result.value);
  }
  return ok(results);
}

/**
 * Splits results by verdict — the shape a recommendation pipeline needs to
 * satisfy INV-ALRG-1 ("no recommendation containing a known member allergen is
 * ever returned"): return `allowed` and `allowedWithUnknowns`, never `blocked`.
 */
export function partitionByVerdict(results: readonly ScreeningResult[]): {
  readonly blocked: readonly ScreeningResult[];
  readonly allowedWithUnknowns: readonly ScreeningResult[];
  readonly allowed: readonly ScreeningResult[];
} {
  const blocked: ScreeningResult[] = [];
  const allowedWithUnknowns: ScreeningResult[] = [];
  const allowed: ScreeningResult[] = [];
  for (const result of results) {
    if (result.verdict === "BLOCKED") blocked.push(result);
    else if (result.verdict === "ALLOWED_WITH_UNKNOWNS") allowedWithUnknowns.push(result);
    else allowed.push(result);
  }
  return { blocked, allowedWithUnknowns, allowed };
}
