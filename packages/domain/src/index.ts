/**
 * `@smart-kitchen/domain` — the deterministic core.
 *
 * Pure TypeScript: zero runtime dependencies, zero I/O, no clock, no
 * randomness (ARCHITECTURE.md §2, CLAUDE.md rule 7; enforced by the
 * dependency-boundary lint in `eslint.config.js`). Safety-critical arithmetic
 * lives here and nowhere else.
 *
 * Modules:
 * - `inventory` — the append-only inventory ledger (M1-T1, ADR-008).
 * - `units` — unit kinds/conversion, standalone beside the ledger (M1-T3).
 *   Re-exported explicitly (not `export *`) below because it defines its own
 *   `ok`/`err`/`Outcome` result helpers under those exact names by design
 *   (each module is meant to be self-contained) — an `export *` from more than
 *   one such module would make those specific names ambiguous at this barrel.
 *   Beyond that unavoidable omission, this barrel deliberately re-exports only
 *   the units module's *domain-facing* API (unit strings in, converted
 *   quantities/errors out) — its internal `Rational` (exact-fraction)
 *   arithmetic primitives are implementation detail nothing outside
 *   `units/**` needs yet, and stay available only via
 *   `packages/domain/src/units/index.ts` (architect-endorsed review fix,
 *   M1-T3 PASS WITH FIXES: narrower root surface now, since nothing depends
 *   on the raw Rational helpers).
 * - `allergens` — deterministic allergen screening (M1-T4, SR-1/SR-2).
 *   Re-exported explicitly for the same reason as `units`: it too defines its
 *   own `ok`/`err`/`Outcome` helpers, which stay module-local. Its verdict is
 *   three-state and `ALLOWED` means *no known match*, never "safe".
 */

export const DOMAIN_PACKAGE_NAME = "@smart-kitchen/domain";

export * from "./inventory/index.js";

export {
  addQuantities,
  compareQuantities,
  convert,
  convertWithBridge,
  makeBridge,
  neededQuantity,
  BASE_UNIT,
  lookupUnit,
  unitKind,
  unitsOfKind,
  UNIT_ENTRIES,
  UNIT_KINDS,
  isUnitError,
} from "./units/index.js";
export type {
  ConversionBridge,
  ConversionResult,
  UnitEntry,
  UnitError,
  UnitErrorCode,
  UnitKind,
  UnitOutcome,
} from "./units/index.js";

export {
  ALLERGEN_CODE_ALIASES,
  ALLERGEN_EXCLUSION_PHRASES,
  ALLERGEN_EXCLUSIONS,
  ALLERGEN_TERM_PHRASES,
  ALLERGEN_TERMS,
  ASSERTION_KINDS,
  compileTerm,
  compileTerms,
  CROSS_CONTACT_POLICY,
  findTermMatches,
  isAllergenError,
  isMajorAllergenCode,
  MAJOR_ALLERGEN_CODES,
  MAJOR_ALLERGEN_LABELS,
  majorRestriction,
  MIN_TERM_LENGTH,
  normalizeAllergenCode,
  normalizeText,
  partitionByVerdict,
  RESTRICTION_SEVERITIES,
  restrictionLabel,
  screenSubject,
  screenSubjects,
  tokenize,
  tokensEqual,
  userDefinedRestriction,
  validateMembers,
  validateRestriction,
} from "./allergens/index.js";
export type {
  AllergenAssertionInput,
  AllergenDeclaration,
  AllergenError,
  AllergenErrorCode,
  AllergenOutcome,
  AllergenProvenanceTier,
  AllergyRestriction,
  AssertionKind,
  AssertionProvenance,
  CompiledTerm,
  EvidenceKind,
  EvidenceLocus,
  IngredientStatementCompleteness,
  MajorAllergenCode,
  MajorAllergenCompleteness,
  MemberScreeningResult,
  ProductSubjectInput,
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
  TermMatch,
  UnknownReason,
  WarningCode,
  WarningSeverity,
} from "./allergens/index.js";
