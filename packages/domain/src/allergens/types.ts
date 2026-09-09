/**
 * Allergen screening types (M1-T4) — the safety contract in type form.
 *
 * Two things are deliberately absent from this file and may never be added:
 *
 * 1. **There is no boolean `isSafe`, `safe`, `allergenFree` or equivalent.**
 *    The verdict is the three-state {@link ScreeningVerdict}; the permissive
 *    state is named `ALLOWED` (as in "nothing in our data matched a
 *    restriction"), never "safe". SR-2 / brief §3: the product must never
 *    imply a food is guaranteed safe because an allergen was not identified.
 * 2. **There is no field by which an input can assert its own verdict.** No
 *    `override`, no `verifiedSafe`, no `skipScreening`. `screenSubject` builds
 *    every output object from an explicit field list and never spreads caller
 *    input into a result (the forgery class found in M1-T1 review finding F1),
 *    so an unknown field on an input is dropped, not honoured.
 *
 * See `domain-model.md` §2 (`AllergyRestriction`, `AllergenAssertion`) and
 * `ai-architecture.md` §2 (allergen evaluation is Deterministic authority).
 */

import type { MajorAllergenCode } from "./taxonomy.js";

/** Confidence tier of a recorded fact (mirrors the ledger's and the adapters' `ProvenanceTier`). */
export type ProvenanceTier = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/**
 * How serious a member's allergy is. Drives cross-contact handling (see
 * `CROSS_CONTACT_POLICY` in `screen.ts`) and warning severity, and nothing
 * else — a `standard` allergy is still a hard restriction, never a preference
 * (domain-model.md §2: "**Never** modeled as a Preference").
 */
export type RestrictionSeverity = "standard" | "severe";

export const RESTRICTION_SEVERITIES = ["standard", "severe"] as const;

/**
 * One member's hard allergy restriction: either a taxonomy code or a
 * user-defined free-text term (brief §3 lists "User-defined allergy").
 */
export type AllergyRestriction =
  | {
      readonly kind: "MAJOR";
      /** Stable id, unique within the member — used to correlate evidence back to the restriction. */
      readonly restrictionId: string;
      readonly allergen: MajorAllergenCode;
      readonly severity: RestrictionSeverity;
    }
  | {
      readonly kind: "USER_DEFINED";
      readonly restrictionId: string;
      /** Normalized at construction; matched by the documented token rules in `text.ts`. */
      readonly term: string;
      readonly severity: RestrictionSeverity;
    };

/** A household member and the restrictions to screen on their behalf. */
export interface ScreenedMember {
  readonly memberId: string;
  readonly restrictions: readonly AllergyRestriction[];
}

/** Assertion kinds we understand. Note there is deliberately no "DOES_NOT_CONTAIN". */
export const ASSERTION_KINDS = ["CONTAINS", "MAY_CONTAIN"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/**
 * One source's allergen claim about a product or ingredient, shaped to accept
 * `AllergenTag` from `packages/adapters/src/product-lookup/types.ts` directly.
 *
 * `allergenCode` is a free string on purpose: upstream data uses whatever
 * spelling it likes, and a code we cannot fold onto the taxonomy must surface
 * as *unknown data* rather than be dropped (see `UNRECOGNIZED_ASSERTION_CODE`).
 *
 * An assertion kind outside {@link ASSERTION_KINDS} — including any invented
 * "free from" style claim — can never clear a restriction. It is recorded as
 * unparsable data, which invalidates the locus's completeness declaration and
 * therefore degrades that locus to unknown (rule 9: AI/vendor output may add
 * warnings, never remove one).
 */
export interface AllergenAssertionInput {
  readonly allergenCode: string;
  /**
   * Canonically one of {@link ASSERTION_KINDS}, but typed `string` because
   * this data arrives from upstream sources that may send anything. Anything
   * else is recorded as uninterpretable — it can never clear a restriction.
   */
  readonly assertion: string;
  readonly provenance?: AssertionProvenance;
}

export interface AssertionProvenance {
  /** Canonically a {@link ProvenanceTier}; typed `string` for the same reason as `assertion`. */
  readonly tier?: string;
  readonly source?: string;
  readonly observedAt?: string;
  readonly confidence?: number;
}

/** How complete the allergen data at a locus is claimed to be. */
export type MajorAllergenCompleteness = "COMPLETE_FOR_MAJOR_ALLERGENS" | "PARTIAL";

/** How complete the ingredient statement at a locus is claimed to be. */
export type IngredientStatementCompleteness = "COMPLETE" | "PARTIAL" | "ABSENT";

/**
 * The **only** way a screening can conclude that an allergen is absent.
 *
 * Absence-of-data is never absence-of-allergen (SR-2), so `ALLOWED` requires a
 * positive, sourced claim that someone actually enumerated the allergens — a
 * manufacturer label declaration, say. Two independent claims, because they
 * license different conclusions:
 *
 * - `majorAllergens: "COMPLETE_FOR_MAJOR_ALLERGENS"` licenses a *no known
 *   match* conclusion for `MAJOR` restrictions only. A US label declaring the
 *   nine majors says nothing whatsoever about a user-defined "mango" allergy.
 * - `ingredientStatement: "COMPLETE"` licenses it for `USER_DEFINED`
 *   restrictions, because a full ingredient statement is the text those terms
 *   are scanned against.
 *
 * Either claim counts **only** at `tier: "KNOWN_FACT"`. An `ESTIMATED` or
 * `AI_INTERPRETATION` declaration can never clear an allergen — that is rule 9
 * and SR-1 expressed as a data rule.
 */
export interface AllergenDeclaration {
  readonly majorAllergens: MajorAllergenCompleteness;
  readonly ingredientStatement: IngredientStatementCompleteness;
  /**
   * Canonically a {@link ProvenanceTier}; typed `string` because declarations
   * are frequently rehydrated from stored/fixture JSON. Only the exact value
   * `"KNOWN_FACT"` licenses a no-known-match conclusion.
   */
  readonly tier: string;
  readonly source: string;
  readonly observedAt?: string;
}

/** One ingredient line of a recipe under screening. */
export interface RecipeIngredientInput {
  /** Canonical ingredient name or the recipe's own wording; always term-scanned. */
  readonly ref: string;
  /** Per-ingredient allergen assertions where the ingredient resolved to catalog data. */
  readonly allergens?: readonly AllergenAssertionInput[];
  /** Full ingredient statement for this component, when one is on file. */
  readonly ingredientsText?: string;
  readonly declaration?: AllergenDeclaration;
}

/** A recipe under screening — e.g. an LLM-generated recipe, post-extraction (§18D, FR-ALG-1). */
export interface RecipeSubjectInput {
  readonly kind: "RECIPE";
  readonly subjectId: string;
  readonly title?: string;
  readonly ingredients: readonly RecipeIngredientInput[];
}

/** A product under screening — shaped to accept M1-T5 `ProductCatalogItem` data. */
export interface ProductSubjectInput {
  readonly kind: "PRODUCT";
  readonly subjectId: string;
  readonly name?: string;
  readonly allergens?: readonly AllergenAssertionInput[];
  readonly ingredientsText?: string;
  readonly declaration?: AllergenDeclaration;
}

export type ScreeningSubjectInput = RecipeSubjectInput | ProductSubjectInput;

export interface ScreeningInput {
  readonly subject: ScreeningSubjectInput;
  readonly members: readonly ScreenedMember[];
}

/**
 * The three-state verdict. **There is no fourth, permissive-and-certain
 * state**, and `ALLOWED` is not one: it means "no restriction matched the data
 * we hold, and that data claimed to be complete", which UI copy must render as
 * *no known match*, never as safe (SR-2, FR-ALG-2).
 */
export type ScreeningVerdict = "BLOCKED" | "ALLOWED_WITH_UNKNOWNS" | "ALLOWED";

/** Per-restriction finding. `NO_KNOWN_MATCH` is the strongest statement the engine can make. */
export type RestrictionOutcome = "MATCH" | "POSSIBLE_MATCH" | "UNKNOWN" | "NO_KNOWN_MATCH";

/** Where in the subject a finding came from. */
export interface EvidenceLocus {
  readonly part: "PRODUCT" | "RECIPE_INGREDIENT";
  /** Product name/id or the ingredient's `ref`, as supplied. */
  readonly ref: string;
  /** Index into `RecipeSubjectInput.ingredients`, for recipe loci. */
  readonly ingredientIndex?: number;
}

/** How a match was established. */
export type EvidenceKind =
  /** An explicit `CONTAINS` assertion whose code folds onto the restriction. */
  | "ASSERTION_CONTAINS"
  /** An explicit `MAY_CONTAIN` (cross-contact) assertion. */
  | "ASSERTION_MAY_CONTAIN"
  /** A curated/user term matched the free ingredient text. */
  | "INGREDIENT_TEXT_TERM"
  /** A curated/user term matched a name — a product name or a recipe ingredient's name. */
  | "NAME_TERM"
  /**
   * A user-defined term matched the *code string* of an allergen assertion the
   * taxonomy does not cover (e.g. a `mustard` tag against a "mustard" allergy).
   * `CONTAINS` yields a match; `MAY_CONTAIN` yields a possible match.
   */
  | "ASSERTION_CODE_TERM";

/**
 * One reason a restriction matched. This is what the UI copy layer renders as
 * "why" — always present on a `BLOCKED` verdict, never empty for a `MATCH`.
 */
export interface ScreeningEvidence {
  readonly memberId: string;
  readonly restrictionId: string;
  /** Taxonomy code or the user-defined term, for display. */
  readonly restrictionLabel: string;
  readonly severity: RestrictionSeverity;
  readonly kind: EvidenceKind;
  readonly locus: EvidenceLocus;
  /** The curated/user term or allergen code that matched. */
  readonly matchedTerm: string;
  /** The matched span of the subject's text, normalized (term-match evidence only). */
  readonly matchedText?: string;
  readonly assertionSource?: string;
  readonly assertionTier?: string;
}

/** Why a restriction could not be resolved either way. */
export type UnknownReason =
  /** No assertions and no completeness declaration at this locus. */
  | "NO_ALLERGEN_DATA"
  /** A declaration exists but does not claim completeness for this restriction kind. */
  | "INCOMPLETE_DECLARATION"
  /** A declaration claims completeness but at a tier below `KNOWN_FACT`. */
  | "UNVERIFIED_DECLARATION_TIER"
  /**
   * A declaration claims completeness at `KNOWN_FACT` but names no source.
   * The declaration is the trust root of the permissive verdict, so an
   * unattributable one is refused rather than honoured.
   */
  | "UNSOURCED_DECLARATION"
  /**
   * A user-defined term needs an *ingredient statement* and none is on file.
   * A product or ingredient name alone does not count — see `screen.ts`.
   */
  | "NO_INGREDIENT_TEXT"
  /** The locus carries an allergen code we cannot fold onto the taxonomy. */
  | "UNRECOGNIZED_ASSERTION_CODE"
  /** The locus carries an assertion whose kind we do not understand. */
  | "UNRECOGNIZED_ASSERTION_KIND";

/**
 * One thing the engine does not know — the structured payload INV-ALRG-2
 * requires. Always names *what* is unknown and *where*, never just "unknown".
 */
export interface ScreeningUnknown {
  readonly memberId: string;
  readonly restrictionId: string;
  readonly restrictionLabel: string;
  readonly severity: RestrictionSeverity;
  readonly reason: UnknownReason;
  readonly locus: EvidenceLocus;
  /** Machine-readable detail (e.g. the unrecognized code) — not UI copy. */
  readonly detail: string;
}

/** Warning classes. UI copy is keyed off `code`; `message` is for logs, not screens. */
export type WarningCode =
  /** Always present on every result: this engine cannot certify safety (SR-2). */
  | "NO_SAFETY_GUARANTEE"
  /** A `severe` member has unresolved allergen data on this subject. */
  | "SEVERE_ALLERGY_UNKNOWN_DATA"
  /** A `standard` member's allergen has a cross-contact (`MAY_CONTAIN`) assertion. */
  | "CROSS_CONTACT"
  /** A `severe` member's allergen has a cross-contact assertion (this also blocks). */
  | "CROSS_CONTACT_SEVERE"
  /** The subject carries allergen data we could not interpret. */
  | "UNRECOGNIZED_ALLERGEN_DATA";

/** Display urgency. `critical` warnings must be prominent (brief §3: "prominent warning"). */
export type WarningSeverity = "info" | "high" | "critical";

export interface ScreeningWarning {
  readonly code: WarningCode;
  readonly severity: WarningSeverity;
  readonly memberId?: string;
  readonly restrictionId?: string;
  readonly restrictionLabel?: string;
  /** Short machine-facing sentence. The client renders from `code`, not from this. */
  readonly message: string;
}

/** Result of screening one subject against one restriction. */
export interface RestrictionScreeningResult {
  readonly memberId: string;
  readonly restrictionId: string;
  readonly restrictionLabel: string;
  readonly kind: "MAJOR" | "USER_DEFINED";
  readonly severity: RestrictionSeverity;
  readonly outcome: RestrictionOutcome;
  readonly verdict: ScreeningVerdict;
  readonly evidence: readonly ScreeningEvidence[];
  readonly unknowns: readonly ScreeningUnknown[];
}

/** Result of screening one subject for one member. Verdict = worst restriction verdict. */
export interface MemberScreeningResult {
  readonly memberId: string;
  readonly verdict: ScreeningVerdict;
  readonly restrictions: readonly RestrictionScreeningResult[];
}

/**
 * The screening result. `verdict` is the **household** verdict: the worst of
 * all member verdicts, because a recommendation shown to a household is eaten
 * in that household (SR-1 / INV-ALRG-1; household verdict = worst member is
 * new semantics introduced by M1-T4, not yet in `domain-model.md` §4).
 */
export interface ScreeningResult {
  readonly subjectKind: "RECIPE" | "PRODUCT";
  readonly subjectId: string;
  readonly verdict: ScreeningVerdict;
  readonly members: readonly MemberScreeningResult[];
  /** Every match found, flattened across members — non-empty whenever `verdict === "BLOCKED"`. */
  readonly evidence: readonly ScreeningEvidence[];
  /** Everything unresolved, flattened — non-empty whenever `verdict === "ALLOWED_WITH_UNKNOWNS"`. */
  readonly unknowns: readonly ScreeningUnknown[];
  /** Always contains `NO_SAFETY_GUARANTEE`; plus per-member cross-contact/severe-unknown warnings. */
  readonly warnings: readonly ScreeningWarning[];
}
