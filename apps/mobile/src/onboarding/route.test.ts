import { describe, expect, it } from "vitest";
import type { HouseholdDto, MemberDto, OnboardingStateDto } from "@smart-kitchen/contracts";
import {
  isHouseholdAllergyStepComplete,
  resolveLayoutRedirect,
  resolveLayoutRedirectForRead,
  resolveOnboardingRoute,
  type OnboardingRoute,
  type OnboardingStateRead,
} from "./route";

function member(overrides: Partial<MemberDto> = {}): MemberDto {
  return {
    memberId: "member-dean",
    displayName: "Dean Chen",
    role: "owner",
    restrictions: [],
    noneConfirmed: false,
    preferences: [],
    ...overrides,
  };
}

function household(members: readonly MemberDto[]): HouseholdDto {
  return { householdId: "hh-fixture-chen", name: "The Chens", members };
}

describe("resolveOnboardingRoute (new vs returning user)", () => {
  it("sends a brand-new user (no household) to S1", () => {
    expect(resolveOnboardingRoute({ household: null })).toBe("s1");
  });

  it("sends a user with a household but an unfinished allergy gate to S2", () => {
    const state = { household: household([member(), member({ memberId: "member-maya" })]) };
    expect(resolveOnboardingRoute(state)).toBe("s2");
  });

  it("sends a user with a household where only some members are done to S2", () => {
    const state = {
      household: household([
        member({ noneConfirmed: true }),
        member({ memberId: "member-maya" }), // Maya not done yet
      ]),
    };
    expect(resolveOnboardingRoute(state)).toBe("s2");
  });

  it("sends a returning user with a complete household straight to Home", () => {
    const state = {
      household: household([
        member({ noneConfirmed: true }),
        member({
          memberId: "member-maya",
          restrictions: [{ kind: "MAJOR", code: "sesame", label: "sesame", severity: "standard" }],
        }),
      ]),
    };
    expect(resolveOnboardingRoute(state)).toBe("home");
  });

  it("treats a household with zero members as not complete (vacuous-truth guard)", () => {
    expect(resolveOnboardingRoute({ household: household([]) })).toBe("s2");
  });
});

describe('resolveLayoutRedirect (M3-T2 review F2: every route goes through this, not just "/")', () => {
  // The five real app routes (BACKLOG.md M3-T1 TAB_ORDER + CENTER_ACTION),
  // all directly reachable by deep link (app.json: scheme "smartkitchen",
  // web enabled) without ever passing through "/".
  const APP_ROUTES = ["/", "/inventory", "/menu", "/shopping", "/add"] as const;
  const ONBOARDING_PATHS = ["/onboarding/account", "/onboarding/allergies"] as const;

  describe.each(["s1", "s2"] as const satisfies readonly OnboardingRoute[])(
    "route = %s (gate not yet satisfied)",
    (route) => {
      const target = route === "s1" ? "/onboarding/account" : "/onboarding/allergies";

      it.each(APP_ROUTES)("redirects a deep link to %s to the gate", (pathname) => {
        expect(resolveLayoutRedirect(route, pathname)).toBe(target);
      });

      it.each(ONBOARDING_PATHS)("never redirects away from an onboarding path (%s)", (pathname) => {
        expect(resolveLayoutRedirect(route, pathname)).toBeNull();
      });

      it("never redirects a sub-path under /onboarding either", () => {
        expect(resolveLayoutRedirect(route, "/onboarding/account/extra")).toBeNull();
      });
    },
  );

  describe("route = home (gate satisfied)", () => {
    it.each([...APP_ROUTES, ...ONBOARDING_PATHS])("never redirects %s", (pathname) => {
      expect(resolveLayoutRedirect("home", pathname)).toBeNull();
    });
  });
});

describe("resolveLayoutRedirectForRead (M3-T2 review F18: fresh vs stale read)", () => {
  const gateOpenState: OnboardingStateDto = { household: null }; // route "s1"
  const gateSatisfiedState: OnboardingStateDto = {
    household: household([
      member({ noneConfirmed: true }),
      member({
        memberId: "member-maya",
        restrictions: [{ kind: "MAJOR", code: "sesame", label: "sesame", severity: "standard" }],
      }),
    ]),
  }; // route "home"

  it("returns null when there is no read yet (first render, nothing to compute from)", () => {
    expect(resolveLayoutRedirectForRead(null, "/inventory")).toBeNull();
  });

  it("returns null when the read is stale (tagged for a different pathname), even if that state would redirect", () => {
    const staleRead: OnboardingStateRead = {
      pathname: "/onboarding/allergies",
      state: gateOpenState,
    };
    // The exact review F18 scenario: S2's Continue just called router.replace("/"),
    // pathname is now "/", but the read in hand is still the pre-save one tagged for
    // "/onboarding/allergies". Must not redirect back to S2 on that stale data.
    expect(resolveLayoutRedirectForRead(staleRead, "/")).toBeNull();
  });

  it("computes the real redirect once the read is fresh (tagged for the current pathname)", () => {
    const freshRead: OnboardingStateRead = { pathname: "/inventory", state: gateOpenState };
    expect(resolveLayoutRedirectForRead(freshRead, "/inventory")).toBe("/onboarding/account");
  });

  it("returns null for a fresh read whose route is already home", () => {
    const freshRead: OnboardingStateRead = { pathname: "/", state: gateSatisfiedState };
    expect(resolveLayoutRedirectForRead(freshRead, "/")).toBeNull();
  });

  it("returns null for a fresh read on an onboarding path even with an open gate", () => {
    const freshRead: OnboardingStateRead = {
      pathname: "/onboarding/allergies",
      state: gateOpenState,
    };
    expect(resolveLayoutRedirectForRead(freshRead, "/onboarding/allergies")).toBeNull();
  });
});

describe("isHouseholdAllergyStepComplete", () => {
  it("is true when every member has a restriction", () => {
    const h = household([
      member({
        restrictions: [{ kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" }],
      }),
      member({ memberId: "member-maya", noneConfirmed: true }),
    ]);
    expect(isHouseholdAllergyStepComplete(h)).toBe(true);
  });

  it("is false when any member has neither a restriction nor none confirmed", () => {
    const h = household([member({ noneConfirmed: true }), member({ memberId: "member-maya" })]);
    expect(isHouseholdAllergyStepComplete(h)).toBe(false);
  });
});
