/**
 * S1 component tests (M3-T4d review F1/F5/F11), `app/onboarding/account.tsx`
 * against the real `FixtureApiClient` (the default `apiClient` singleton
 * under test, no `EXPO_PUBLIC_API_URL`). `.test.ts`, not `.test.tsx`, same
 * reason as the other screen component tests (every element built with
 * `React.createElement`).
 *
 * See `account-screen-http.test.ts` for the `HttpApiClient` path (the
 * post-create join-code interstitial, review F9's household-name-refusal
 * mapping): the two client types cannot share one `vi.mock("../api/client",
 * ...)` module factory within a single file, so this repo's convention
 * (item-detail-screen.test.ts vs shopping-screen.test.ts) is one file per
 * client type.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { apiClient, type FixtureApiClient } from "../api/client";

let pushed: unknown[] = [];

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: (href: unknown) => pushed.push(href),
    replace: () => {},
    canGoBack: () => false,
    back: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  pushed = [];
  vi.restoreAllMocks();
  // Review round 1, F2: `handleContinueWithEmail` now reads
  // `getOnboardingState()` and redirects away when a household already
  // exists, so this file's shared `apiClient` singleton (every test below
  // uses the same instance, by design, per this file's own header comment)
  // can no longer carry a household from one test into the next -- an
  // earlier test's `createHousehold`/`joinHousehold` would otherwise make a
  // later "Continue with email" test redirect instead of showing the
  // household cards, for a reason that has nothing to do with what that
  // test is actually checking.
  (apiClient as FixtureApiClient).clearHouseholdUntilServerSaysOtherwise();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: AccountScreen } = await import("../../app/onboarding/account");
  return render(React.createElement(AccountScreen));
}

describe("S1 · account + household, fixture path (component)", () => {
  it("review F1: create household goes straight to S2, no join-code interstitial (the fixture path never showed one)", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");
    fireEvent.press(result.getByLabelText("Create household"));
    await flushPending();

    expect(pushed).toEqual(["/onboarding/allergies"]);
    expect(result.queryByText(/Your join code/)).toBeNull();
    // The Create-household form should not still be showing either (would
    // indicate the interstitial branch was taken and never resolved).
    expect(result.queryByLabelText("Continue")).toBeNull();
  });

  it("review F5: 'Signed in as Dean Chen.' renders on the fixture path", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Continue with email"));
    await flushPending();
    expect(result.getByText("Signed in as Dean Chen.")).toBeTruthy();
  });

  it("review F4/F11: two Create-household taps in one frame produce exactly one createHousehold call", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");

    let calls = 0;
    const original = apiClient.createHousehold.bind(apiClient);
    vi.spyOn(apiClient, "createHousehold").mockImplementation(async (name) => {
      calls += 1;
      return original(name);
    });

    const button = result.getByLabelText("Create household");
    // No `await`/`flushPending` between these two: the same-frame race
    // `requestInFlight` (a `useRef`) closes, that `householdBusy` (state)
    // alone cannot.
    fireEvent.press(button);
    fireEvent.press(button);
    await flushPending();

    expect(calls).toBe(1);
    expect(pushed).toEqual(["/onboarding/allergies"]);
  });

  it("review F4: a Create-household tap while a join is in flight is refused (create and join never in flight together)", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Join code"), "CHEN-482");
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");

    let createCalls = 0;
    const originalCreate = apiClient.createHousehold.bind(apiClient);
    vi.spyOn(apiClient, "createHousehold").mockImplementation(async (name) => {
      createCalls += 1;
      return originalCreate(name);
    });

    fireEvent.press(result.getByLabelText("Join household"));
    fireEvent.press(result.getByLabelText("Create household")); // same frame as the join tap
    await flushPending();

    expect(createCalls).toBe(0); // the in-flight join guard refused it
    expect(pushed).toEqual(["/onboarding/allergies"]); // the join itself still succeeded
  });

  it("review round 2 (F4/F11 pin): two Join-household taps in one frame produce exactly one joinHousehold call", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Join code"), "CHEN-482");

    let calls = 0;
    const original = apiClient.joinHousehold.bind(apiClient);
    vi.spyOn(apiClient, "joinHousehold").mockImplementation(async (code) => {
      calls += 1;
      return original(code);
    });

    const button = result.getByLabelText("Join household");
    // No `await`/`flushPending` between these two: same reasoning as the
    // create-side pin above, but exercising `handleJoinHousehold`'s own
    // `requestInFlight` check, not create's.
    fireEvent.press(button);
    fireEvent.press(button);
    await flushPending();

    expect(calls).toBe(1);
    expect(pushed).toEqual(["/onboarding/allergies"]);
  });

  it("review round 2 (F4/F11 pin): a Join-household tap while a create is in flight is refused", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Join code"), "CHEN-482");
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");

    let joinCalls = 0;
    const originalJoin = apiClient.joinHousehold.bind(apiClient);
    vi.spyOn(apiClient, "joinHousehold").mockImplementation(async (code) => {
      joinCalls += 1;
      return originalJoin(code);
    });

    fireEvent.press(result.getByLabelText("Create household"));
    fireEvent.press(result.getByLabelText("Join household")); // same frame as the create tap
    await flushPending();

    expect(joinCalls).toBe(0); // the in-flight create guard refused it
    expect(pushed).toEqual(["/onboarding/allergies"]); // the create itself still succeeded
  });
});
