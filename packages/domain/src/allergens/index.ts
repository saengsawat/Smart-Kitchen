/**
 * Public API of the allergen module (M1-T4) — deterministic allergen screening.
 *
 * Standalone, pure, zero-I/O, beside the ledger and the units registry rather
 * than inside either. Allergen evaluation is `Deterministic` authority in
 * `ai-architecture.md` §2: no LLM, no fuzzy matching, no probabilistic scoring
 * anywhere in this module (SR-1, CLAUDE.md rule 7).
 *
 * ## Screening API
 *
 * ```ts
 * const peanutAllergy = majorRestriction("r1", "peanut", "severe");
 * if (!peanutAllergy.ok) throw new Error(peanutAllergy.error.message);
 *
 * const result = screenSubject({
 *   subject: {
 *     kind: "RECIPE",
 *     subjectId: "recipe-42",
 *     ingredients: [{ ref: "peanut butter" }, { ref: "bread" }],
 *   },
 *   members: [{ memberId: "m1", restrictions: [peanutAllergy.value] }],
 * });
 *
 * if (result.ok) {
 *   result.value.verdict;            // "BLOCKED"
 *   result.value.evidence[0]?.kind;  // "NAME_TERM" — why it blocked
 * }
 * ```
 *
 * The verdict is three-state — `BLOCKED | ALLOWED_WITH_UNKNOWNS | ALLOWED` —
 * and **`ALLOWED` means "no known match", never "safe"**. There is no boolean
 * safety flag in this API and no input field by which a caller can assert one
 * (SR-2, FR-ALG-2, brief §3).
 *
 * ## Requirements this places on client code (M3/M6 copy layer)
 *
 * 1. Never render any verdict as "safe", "allergen-free" or "OK to eat".
 *    `ALLOWED` renders as *no known allergen match* plus the standing caveat
 *    carried by the always-present `NO_SAFETY_GUARANTEE` warning.
 * 2. `ALLOWED_WITH_UNKNOWNS` must show what is unknown — the `unknowns` array
 *    names the restriction and the locus for exactly this purpose — and must
 *    never be visually collapsed into the `ALLOWED` state.
 * 3. `critical` warnings (`SEVERE_ALLERGY_UNKNOWN_DATA`, `CROSS_CONTACT_SEVERE`)
 *    must be prominent, per brief §3's "prominent warning" for serious allergies.
 * 4. Copy is keyed off `warning.code` / `unknown.reason`, not off the
 *    `message` strings, which are machine-facing.
 * 5. A `BLOCKED` recommendation is never displayed as a choice (INV-ALRG-1);
 *    filtering it out is the caller's job — see {@link partitionByVerdict}.
 */

export {
  CROSS_CONTACT_POLICY,
  partitionByVerdict,
  screenSubject,
  screenSubjects,
} from "./screen.js";

export {
  majorRestriction,
  restrictionLabel,
  userDefinedRestriction,
  validateMembers,
  validateRestriction,
} from "./restrictions.js";

export {
  ALLERGEN_CODE_ALIASES,
  ALLERGEN_EXCLUSION_PHRASES,
  ALLERGEN_EXCLUSIONS,
  ALLERGEN_TERM_PHRASES,
  ALLERGEN_TERMS,
  isMajorAllergenCode,
  MAJOR_ALLERGEN_CODES,
  MAJOR_ALLERGEN_LABELS,
  normalizeAllergenCode,
} from "./taxonomy.js";
export type { MajorAllergenCode } from "./taxonomy.js";

export {
  compileTerm,
  compileTerms,
  findTermMatches,
  normalizeText,
  tokenize,
  tokensEqual,
} from "./text.js";
export type { CompiledTerm, TermMatch } from "./text.js";

export { err, isAllergenError, MIN_TERM_LENGTH, ok } from "./errors.js";
export type { AllergenError, AllergenErrorCode, Outcome as AllergenOutcome } from "./errors.js";

export type {
  AllergenAssertionInput,
  AllergenDeclaration,
  AllergyRestriction,
  AssertionKind,
  AssertionProvenance,
  EvidenceKind,
  EvidenceLocus,
  IngredientStatementCompleteness,
  MajorAllergenCompleteness,
  MemberScreeningResult,
  ProductSubjectInput,
  ProvenanceTier as AllergenProvenanceTier,
  RecipeIngredientInput,
  RecipeSubjectInput,
  RestrictionOutcome,
  RestrictionScreeningResult,
  RestrictionSeverity,
  ScreenedMember,
  ScreeningEvidence,
  ScreeningInput,
  ScreeningResult,
  ScreeningSubjectInput,
  ScreeningUnknown,
  ScreeningVerdict,
  ScreeningWarning,
  UnknownReason,
  WarningCode,
  WarningSeverity,
} from "./types.js";

export { ASSERTION_KINDS, RESTRICTION_SEVERITIES } from "./types.js";
