/**
 * The Chen fixture household's members and restrictions — **one source of
 * truth** (review F8, architect ruling), read by both sides that need it:
 *
 * - `src/api/client.ts`'s `FixtureApiClient.returningUser()`, for the
 *   onboarding/household state S2 and every screen that reads
 *   `HouseholdDto.members` (S8's allergen-row member-name resolution
 *   included, review F11 — never a hardcoded name map).
 * - `packages/adapters/scripts/gen-screening-fixtures.mjs`, which reads
 *   `fixture-restrictions.json` directly (plain JSON, no TypeScript compile
 *   step needed for a Node script) to build the same household as
 *   `ScreenedMember[]` for the real `screenSubject` engine.
 *
 * Before this ticket's review-fix round, `returningUser()` hand-wrote Maya's
 * restrictions independently of the screening-fixture generator's
 * household, and the two silently disagreed (review F8's root-cause
 * finding). A single JSON file removes the possibility of that drift by
 * construction: whichever side's household changes, the other reads the
 * same file.
 *
 * The household this ticket specifies: Dean — no restrictions; Maya —
 * peanut severe, sesame severe (peanut listed first, which is why the
 * generated screening fixtures' evidence/unknown arrays name peanut before
 * sesame wherever both are unresolved for Maya on the same product).
 */

import {
  MAJOR_ALLERGEN_LABELS_DTO,
  type HouseholdRoleDto,
  type MajorAllergenCodeDto,
  type MemberDto,
  type MemberRestrictionDto,
  type RestrictionSeverityDto,
} from "@smart-kitchen/contracts";
import raw from "./fixture-restrictions.json";

interface RawRestriction {
  readonly restrictionId: string;
  readonly code: MajorAllergenCodeDto;
  readonly severity: RestrictionSeverityDto;
}

interface RawMember {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: HouseholdRoleDto;
  readonly restrictions: readonly RawRestriction[];
}

const data = raw as { readonly members: readonly RawMember[] };

/** `MemberDto[]` for `FixtureApiClient.returningUser()`'s household. */
export function fixtureChenMembers(): readonly MemberDto[] {
  return data.members.map((member): MemberDto => ({
    memberId: member.memberId,
    displayName: member.displayName,
    role: member.role,
    restrictions: member.restrictions.map((r): MemberRestrictionDto => ({
      kind: "MAJOR",
      code: r.code,
      label: MAJOR_ALLERGEN_LABELS_DTO[r.code],
      severity: r.severity,
    })),
    // The explicit "no known allergies" declaration (S2 gate, OQ-D5):
    // true only for a member with zero restrictions, matching this
    // fixture's only such member (Dean). A member with restrictions is
    // never noneConfirmed (mutually exclusive, src/api/client.ts's own
    // saveMemberRestrictions rule).
    noneConfirmed: member.restrictions.length === 0,
    preferences: [],
  }));
}

/** Every restriction id/label/severity for one member, keyed by memberId — used by the screening generator (via the raw JSON) and available here for parity checks. */
export function fixtureChenMemberNames(): Readonly<Record<string, string>> {
  return Object.fromEntries(data.members.map((m) => [m.memberId, m.displayName]));
}
