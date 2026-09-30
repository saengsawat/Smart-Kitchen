/**
 * S1 component tests (M3-T4d review F1/F5/F9), `app/onboarding/account.tsx`
 * against a real `HttpApiClient` with a mocked global `fetch` (never a real
 * network call) — the counterpart to `account-screen.test.ts`'s fixture
 * path; see that file's doc comment for why this is a separate file.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";

// Forces the screen (which imports the module-level `apiClient` singleton
// directly) onto a real HttpApiClient for this file, same pattern as
// item-detail-screen.test.ts.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, apiClient: new actual.HttpApiClient("http://localhost:4000") };
});

let pushed: unknown[] = [];
let replaced: unknown[] = [];

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: (href: unknown) => pushed.push(href),
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => false,
    back: () => {},
  }),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  pushed = [];
  replaced = [];
  globalThis.fetch = originalFetch;
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: AccountScreen } = await import("../../app/onboarding/account");
  return render(React.createElement(AccountScreen));
}

const SAMPLE_CREATE_RESPONSE = {
  household: {
    householdId: "hh-1",
    name: "The Ostrowskis",
    members: [{ memberId: "mem-1", displayInitials: "AO", role: "owner", isCaller: true }],
  },
  joinCode: { code: "ABCD-234", issuedAt: "2026-09-29T00:00:00.000Z" },
};

describe("S1 · account + household, HTTP path (component)", () => {
  it("review F1: create household shows the one-time join-code interstitial; Continue lands on S2", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_CREATE_RESPONSE), { status: 201 }));
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");
    fireEvent.press(result.getByLabelText("Create household"));
    await flushPending();

    expect(
      result.getByText("Household created. Your join code: ABCD-234. Save it to invite others."),
    ).toBeTruthy();
    expect(pushed).toEqual([]); // not navigated yet — the code must be seen first

    fireEvent.press(result.getByLabelText("Continue"));
    expect(pushed).toEqual(["/onboarding/allergies"]);
  });

  it("review F5: 'Signed in as Dean Chen.' never renders on the HTTP path", async () => {
    // 403 "no household" (`getOnboardingState`'s own documented reading of
    // that status): the affiliation check this file's F2 tests exercise
    // resolves to "no household", same as a genuinely fresh caller.
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 403 }));
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Continue with email"));
    await flushPending();
    expect(result.queryByText("Signed in as Dean Chen.")).toBeNull();
  });

  it("review round 1, F2: an already-affiliated caller is routed straight to '/' on Continue with email, never shown the household cards", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            householdId: "hh-existing",
            name: "The Ostrowskis",
            members: [{ memberId: "mem-1", displayInitials: "AO", role: "owner", isCaller: true }],
          }),
          { status: 200 },
        ),
      );
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Continue with email"));
    await flushPending();

    expect(replaced).toEqual(["/"]);
    expect(pushed).toEqual([]);
    expect(result.queryByText("Signed in as Dean Chen.")).toBeNull();
  });

  it("review round 1, F2: a rejected affiliation check fails closed with the §8 read fallback, never silently showing the cards", async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Continue with email"));
    await flushPending();

    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
    expect(replaced).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("review F9: a 400 BAD_REQUEST create-household refusal renders the exact household-name sentence", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "BAD_REQUEST", message: "server's own wording", correlationId: "c1" },
          }),
          { status: 400 },
        ),
      );
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");
    fireEvent.press(result.getByLabelText("Create household"));
    await flushPending();

    expect(result.getByText("Give the household a name of 1 to 60 characters.")).toBeTruthy();
    expect(result.queryByText("server's own wording")).toBeNull();
    expect(pushed).toEqual([]);
  });

  it("review F9: any other create-household failure renders the generic fallback, not the household-name sentence", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "INTERNAL", message: "boom", correlationId: "c1" } }),
          { status: 500 },
        ),
      );
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Household name"), "The Ostrowskis");
    fireEvent.press(result.getByLabelText("Create household"));
    await flushPending();

    expect(
      result.getByText(
        "Something went wrong saving that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
    expect(result.queryByText("Give the household a name of 1 to 60 characters.")).toBeNull();
  });
});
