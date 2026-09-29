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

// ---------------------------------------------------------------------------
// M2-T3: household endpoints (create, join by code, members, rotate code).
//
// Three rules shape these types.
//
// 1. **No allergy data on the wire yet.** {@link MemberDto} carries
//    `restrictions` and `noneConfirmed` as required fields, and the server has
//    nowhere to read them from until the household permissions decision (A3)
//    lands with M2-T4. Returning `[]` and `false` would be a lie a screen
//    could mistake for "no known allergies", so the server answers the
//    smaller {@link HouseholdMemberSummaryDto} instead, which simply does not
//    have those fields. `MemberDto` stays as the client's onboarding type.
// 2. **Initials, not names, and never an email.** A member is shown on the
//    wire as display initials and a role. `memberId` is the membership's own
//    id, never the user's id.
// 3. **The join code travels once.** The plaintext code is in the response
//    that created it (household creation, rotation) and nowhere else; the
//    server stores only a hash and cannot show it again. An owner who has
//    lost it rotates it.
// ---------------------------------------------------------------------------

/** Longest household name the server accepts, after trimming, in characters. */
export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

/** One member, as the household endpoints report it (see rule 1 above). */
export interface HouseholdMemberSummaryDto {
  /** The membership's id. Not a user id. */
  readonly memberId: string;
  /** Two-letter-style initials for the member chip; `"?"` when no name is on file. */
  readonly displayInitials: string;
  readonly role: HouseholdRoleDto;
  /** True on the caller's own row, so a screen can say "you" without knowing a user id. */
  readonly isCaller: boolean;
}

/** A household with its members, for S1/S12 (no restrictions until M2-T4). */
export interface HouseholdSummaryDto {
  readonly householdId: string;
  readonly name: string;
  /** Owners first, then members, each in the order they joined. */
  readonly members: readonly HouseholdMemberSummaryDto[];
}

/** A freshly issued join code. The only time the plaintext is ever sent. */
export interface JoinCodeDto {
  /** `XXXX-NNN`, letters without I/O and digits 2 to 9. */
  readonly code: string;
  readonly issuedAt: string;
}

/** Body of `POST /v1/households`. */
export interface CreateHouseholdRequestDto {
  /** Trimmed by the server; 1 to {@link HOUSEHOLD_NAME_MAX_LENGTH} characters after trimming. */
  readonly name: string;
}

/** Response of `POST /v1/households`: the new household (caller as owner) and its first code. */
export interface CreateHouseholdResponseDto {
  readonly household: HouseholdSummaryDto;
  readonly joinCode: JoinCodeDto;
}

/** Body of `POST /v1/households/join`. */
export interface JoinHouseholdRequestDto {
  /** As typed; the server trims it and ignores letter case. */
  readonly code: string;
}

/** Response of `POST /v1/households/join`. */
export interface JoinHouseholdResponseDto {
  readonly household: HouseholdSummaryDto;
  /** True when the caller already belonged, so nothing was added (idempotent join). */
  readonly alreadyMember: boolean;
}

/** One household the caller belongs to, for `GET /v1/households/mine`. */
export interface HouseholdMembershipDto {
  readonly householdId: string;
  readonly name: string;
  readonly role: HouseholdRoleDto;
  readonly joinedAt: string;
  /** True on the household requests currently run as (the most recently joined). */
  readonly current: boolean;
}

/** Response of `GET /v1/households/mine`. Empty for a signed-in person with no household yet. */
export interface HouseholdMembershipsResponseDto {
  readonly households: readonly HouseholdMembershipDto[];
}

/** Response of `POST /v1/households/me/join-code` (owner only): the new code. */
export interface RotateJoinCodeResponseDto {
  readonly joinCode: JoinCodeDto;
}

/** Paths of the household endpoints, shared so the client and the routes cannot drift. */
export const HOUSEHOLDS_PATH = "/v1/households";
export const HOUSEHOLD_JOIN_PATH = "/v1/households/join";
export const HOUSEHOLD_ME_PATH = "/v1/households/me";
export const HOUSEHOLD_MINE_PATH = "/v1/households/mine";
export const HOUSEHOLD_JOIN_CODE_PATH = "/v1/households/me/join-code";
