/**
 * First-run route guard (M3-T2 Objective (c)), a pure function over
 * {@link OnboardingStateDto} so routing can be unit-tested without mounting a
 * screen or a router.
 *
 * Deliberately reads only `state.household` and its members' saved
 * restriction/none state, never any local screen state, so a deep link
 * straight at "/" (or at "/onboarding/allergies" with the gate still open)
 * always recomputes the same answer from what the client port actually holds
 * — the explicit-none gate cannot be bypassed by navigating around it.
 *
 * {@link resolveLayoutRedirect} is the second half of that guarantee (M3-T2
 * review F2): `resolveOnboardingRoute` alone only protected "/" — a deep link
 * straight at "/inventory", "/menu", "/shopping" or "/add" (all real routes;
 * app.json declares scheme `smartkitchen` and enables web) rendered that
 * screen's placeholder with no gate check at all. `apps/mobile/app/_layout.tsx`
 * calls `resolveLayoutRedirect` once, for every route, so gating lives in
 * exactly one place rather than being re-derived per screen.
 */

import type { HouseholdDto, MemberDto, OnboardingStateDto } from "@smart-kitchen/contracts";

export type OnboardingRoute = "s1" | "s2" | "home";

/** Mirrors the S2 gate (`allergyGate.ts`'s `isMemberComplete`) over saved, not draft, state. */
export function isMemberAllergyStepComplete(
  member: Pick<MemberDto, "restrictions" | "noneConfirmed">,
): boolean {
  return member.restrictions.length > 0 || member.noneConfirmed;
}

/** A household with no members yet is never "complete" (vacuous truth guard). */
export function isHouseholdAllergyStepComplete(household: HouseholdDto): boolean {
  return household.members.length > 0 && household.members.every(isMemberAllergyStepComplete);
}

/**
 * - No household yet (brand-new user): S1.
 * - A household exists but the allergy gate is not satisfied for every member: S2.
 * - Otherwise: Home.
 */
export function resolveOnboardingRoute(state: OnboardingStateDto): OnboardingRoute {
  if (!state.household) {
    return "s1";
  }
  if (!isHouseholdAllergyStepComplete(state.household)) {
    return "s2";
  }
  return "home";
}

const ONBOARDING_ROUTE_PATH: Readonly<Record<Exclude<OnboardingRoute, "home">, string>> = {
  s1: "/onboarding/account",
  s2: "/onboarding/allergies",
};

/**
 * The one gate every route in the app goes through (M3-T2 review F2),
 * called from `app/_layout.tsx` for every pathname, not just "/". Returns
 * the path to redirect to, or `null` if the current pathname should render
 * as-is: either the gate is already satisfied (`route === "home"`), or the
 * pathname is already somewhere under `/onboarding` (S1/S2 themselves, and
 * their own back/Continue navigation, must never bounce off this guard).
 */
export function resolveLayoutRedirect(route: OnboardingRoute, pathname: string): string | null {
  if (route === "home") {
    return null;
  }
  if (pathname.startsWith("/onboarding")) {
    return null;
  }
  return ONBOARDING_ROUTE_PATH[route];
}

/** One `getOnboardingState()` read, tagged with the pathname it was fetched for. */
export interface OnboardingStateRead {
  readonly pathname: string;
  readonly state: OnboardingStateDto;
}

/**
 * Fresh-vs-stale wrapper around {@link resolveLayoutRedirect} (M3-T2 review
 * F18). `app/_layout.tsx` re-fetches onboarding state on every pathname
 * change (S1/S2 mutate it without remounting the layout), but that fetch is
 * async: for the one render between a navigation landing and the fresh read
 * resolving, `read` still describes the *previous* pathname. Computing a
 * redirect from that stale read is exactly the bug this fixes — after S2's
 * Continue calls `router.replace("/")`, the frame where `pathname` is "/"
 * would otherwise still carry `read.pathname === "/onboarding/allergies"`
 * with the pre-save (gate-still-open) state, so `resolveLayoutRedirect`
 * would redirect straight back to S2, forcing a second Continue press.
 *
 * When `read` is missing or tagged for a different pathname, this returns
 * `null` (never redirect on stale data) rather than guessing: the caller
 * renders the destination screen for that one frame instead, and the next
 * render, once the fresh read lands and is tagged for the current pathname,
 * applies whatever the *current* state actually calls for.
 */
export function resolveLayoutRedirectForRead(
  read: OnboardingStateRead | null,
  pathname: string,
): string | null {
  if (!read || read.pathname !== pathname) {
    return null;
  }
  return resolveLayoutRedirect(resolveOnboardingRoute(read.state), pathname);
}
