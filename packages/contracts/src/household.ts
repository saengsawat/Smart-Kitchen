/**
 * Household + onboarding contracts (M3-T2).
 *
 * Shared shape for S1 (account + household) and S2 (allergies + preferences),
 * used by `apps/mobile`'s fixture `ApiClient` today and by the real household
 * endpoint once M2-T3 lands behind the same port.
 *
 * `MajorAllergenCodeDto` is a hand-written mirror of
 * `packages/domain/src/allergens/taxonomy.ts`'s `MAJOR_ALLERGEN_CODES`, not an
 * import of it: this package has zero dependencies (see package.json) so that
 * `apps/mobile` can depend on it without ever pulling `@smart-kitchen/domain`
 * into the client bundle. `packages/adapters/src/contracts-consistency/`
 * carries the test that keeps the two lists equal — it can depend on domain,
 * this package cannot.
 */

/** The nine FDA major food allergens, as stable codes (mirrors domain's `MAJOR_ALLERGEN_CODES`). */
export const MAJOR_ALLERGEN_CODES_DTO = [
  "peanut",
  "tree_nut",
  "milk",
  "egg",
  "fish",
  "shellfish",
  "wheat",
  "soy",
  "sesame",
] as const;

export type MajorAllergenCodeDto = (typeof MAJOR_ALLERGEN_CODES_DTO)[number];

/**
 * Sentence-case display label per code (mirrors domain's `MAJOR_ALLERGEN_LABELS`,
 * itself documented there as "a fallback UI label, not final copy" — this deck
 * adopts it as-is for MVP per copy-deck.md §2).
 */
export const MAJOR_ALLERGEN_LABELS_DTO: Readonly<Record<MajorAllergenCodeDto, string>> =
  Object.freeze({
    peanut: "peanut",
    tree_nut: "tree nut",
    milk: "milk",
    egg: "egg",
    fish: "fish",
    shellfish: "crustacean shellfish",
    wheat: "wheat",
    soy: "soy",
    sesame: "sesame",
  });

/** Never inferred, never downgraded (D-017 P4): a visible per-allergen choice, defaulting to standard. */
export type RestrictionSeverityDto = "standard" | "severe";

/**
 * One member's declared restriction. `MAJOR` restrictions carry `code`
 * (one of {@link MajorAllergenCodeDto}) and `label` mirrors
 * {@link MAJOR_ALLERGEN_LABELS_DTO}. `USER_DEFINED` restrictions carry the
 * member's own free-text wording as `label` and no `code`.
 */
export interface MemberRestrictionDto {
  readonly kind: "MAJOR" | "USER_DEFINED";
  readonly code?: MajorAllergenCodeDto;
  readonly label: string;
  readonly severity: RestrictionSeverityDto;
}

export type HouseholdRoleDto = "owner" | "member";

/**
 * One household member's current allergy + preference state. The owner
 * enters this for every member at onboarding (OQ-D5 default: "owner-enters-all
 * at signup, members confirm on join"); `restrictions` and `noneConfirmed` are
 * mutually exclusive — never both empty/false, per the S2 gate.
 */
export interface MemberDto {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: HouseholdRoleDto;
  readonly restrictions: readonly MemberRestrictionDto[];
  /** True only once the member's explicit "no known allergies" option has been confirmed. */
  readonly noneConfirmed: boolean;
  readonly preferences: readonly string[];
}

export interface HouseholdDto {
  readonly householdId: string;
  readonly name: string;
  readonly members: readonly MemberDto[];
}

/**
 * What the client needs to decide first-run routing (S1 -> S2 -> Home vs
 * Home directly). `household` is `null` for a brand-new user who has not yet
 * created or joined one. Whether the S2 allergy gate is satisfied is computed
 * from `household.members` by the pure route-guard module
 * (`apps/mobile/src/onboarding/route.ts`), not duplicated here as a second
 * boolean that could drift from the member data it describes.
 */
export interface OnboardingStateDto {
  readonly household: HouseholdDto | null;
}
