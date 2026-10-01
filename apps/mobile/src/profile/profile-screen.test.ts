/**
 * S12 component tests, fixture path (BACKLOG.md M3-T6), `app/profile.tsx`
 * against a `FixtureApiClient.returningUser()` instance (the canonical Chen
 * household: Dean owner with no restrictions, Maya member with peanut and
 * sesame both severe -- `src/household/fixture-restrictions.json`, the same
 * source `docs/design/mockups/smart-kitchen-prototype.html`'s `#scr-profile`
 * sample data mirrors). See `profile-screen-http.test.ts` for the HTTP-path
 * counterpart (initials, Invite/rotate, the ask-the-owner line).
 *
 * A fresh instance per test (`resetFixtureClient()`, called from
 * `beforeEach`): a shared, mutated-in-place instance would leak one test's
 * saved restrictions into the next. This deliberately avoids
 * `vi.resetModules()` -- re-importing `react`/`react-native` after a reset
 * gives every later render a *different* module generation than the one
 * `@testing-library/react-native`'s own query helpers were bound to at this
 * file's load time, which breaks `getByText`/`getByLabelText` in ways that
 * have nothing to do with this screen's own behaviour. A getter on the
 * mocked module's `apiClient` export, reassigned in place, keeps every
 * import (this file's and `app/profile.tsx`'s own) pointed at one evolving
 * reference without ever touching the module registry.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { FIXTURE_IDENTITY_EMAIL, FIXTURE_JOIN_CODE } from "../api/client";
import { ToastProvider } from "../inventory/Toast";

let fixtureClient: import("../api/client").FixtureApiClient;

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    get apiClient() {
      return fixtureClient;
    },
  };
});

let replaced: unknown[] = [];
let canGoBack = true;

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => canGoBack,
    back: () => {},
  }),
}));

beforeEach(async () => {
  const { FixtureApiClient } = await import("../api/client");
  fixtureClient = FixtureApiClient.returningUser();
});

afterEach(() => {
  cleanup();
  replaced = [];
  canGoBack = true;
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: ProfileScreen } = await import("../../app/profile");
  const result = render(
    React.createElement(ToastProvider, null, React.createElement(ProfileScreen)),
  );
  await flushPending();
  return result;
}

describe("S12 · profile & household, fixture path", () => {
  it("shows the identity card: name and email (D-022 fixture identity), role and household name", async () => {
    const result = await renderScreen();
    expect(result.getByText(`${FIXTURE_IDENTITY_EMAIL} · owner · The Chens`)).toBeTruthy();
  });

  it("shows Dean and Maya with their summaries (BACKLOG.md M3-T6 acceptance)", async () => {
    const result = await renderScreen();

    expect(result.getByLabelText("Dean Chen, No known allergies · edit")).toBeTruthy();
    expect(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit")).toBeTruthy();
  });

  it("the Add-a-member row shows the fixture join code, not an Invite link", async () => {
    const result = await renderScreen();

    expect(result.getByText(`share the join code ${FIXTURE_JOIN_CODE}`)).toBeTruthy();
    expect(result.queryByLabelText("Invite")).toBeNull();
  });

  it("editing Maya's allergies changes only Maya's row (review round 1, F1: the save target is pinned)", async () => {
    const saveSpy = vi.spyOn(fixtureClient, "saveMemberRestrictions");
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit"));
    fireEvent.changeText(
      result.getByLabelText("Add another allergen or ingredient for Maya Chen"),
      "kiwi",
    );
    fireEvent.press(result.getByLabelText("Add custom allergen for Maya Chen"));
    fireEvent.press(result.getByLabelText("Save allergies for Maya"));
    await flushPending();

    // The rendered rows (an optimistic local update) would look right even
    // if the wrong id were sent to the port, so this pins the actual call
    // too: exactly one save, and it names Maya's memberId, not Dean's.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0]?.[0]).toBe("member-maya");
    expect(result.getByLabelText("Dean Chen, No known allergies · edit")).toBeTruthy();
    expect(result.getByLabelText("Maya Chen, Peanut, sesame, kiwi · severe · edit")).toBeTruthy();

    // Re-read from the port itself (not the screen's own optimistic state):
    // Dean's stored restrictions/noneConfirmed must be exactly what they
    // were before this edit, and Maya's must be exactly what was saved.
    const state = await fixtureClient.getOnboardingState();
    const dean = state.household?.members.find((m) => m.memberId === "member-dean");
    const maya = state.household?.members.find((m) => m.memberId === "member-maya");
    expect(dean?.restrictions).toEqual([]);
    expect(dean?.noneConfirmed).toBe(true);
    expect(maya?.restrictions.map((r) => r.label)).toEqual(["peanut", "sesame", "kiwi"]);
    expect(maya?.noneConfirmed).toBe(false);
  });

  it("the S2 gate still applies: clearing every selection without confirming none shows the inline message", async () => {
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit"));
    fireEvent.press(result.getByLabelText("peanut, selected"));
    fireEvent.press(result.getByLabelText("sesame, selected"));
    fireEvent.press(result.getByLabelText("Save allergies for Maya"));
    await flushPending();

    expect(
      result.getByText("Select at least one allergen, or confirm none, to continue"),
    ).toBeTruthy();
    // Nothing was saved: Maya's row is untouched.
    expect(result.queryByLabelText("Maya Chen, No known allergies · edit")).toBeNull();
  });

  it("Cancel discards the in-progress edit without saving", async () => {
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit"));
    fireEvent.press(result.getByLabelText("wheat"));
    fireEvent.press(result.getByLabelText("Cancel editing allergies for Maya"));
    await flushPending();

    expect(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit")).toBeTruthy();
  });

  it("review round 1, F8: tapping another row while a save is in flight is blocked", async () => {
    let resolveSave: (() => void) | undefined;
    vi.spyOn(fixtureClient, "saveMemberRestrictions").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve(undefined);
        }),
    );
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Maya Chen, Peanut, sesame · severe · edit"));
    fireEvent.press(result.getByLabelText("Save allergies for Maya"));
    await flushPending();

    // The save is still pending (the mock above never resolves it yet):
    // tapping Dean's row must not open a second editor, which would let
    // Maya's in-flight save land on whatever Dean's editor happened to be
    // showing once it resolves.
    fireEvent.press(result.getByLabelText("Dean Chen, No known allergies · edit"));
    await flushPending();

    expect(result.queryByLabelText("Save allergies for Dean")).toBeNull();
    expect(result.getByLabelText("Save allergies for Maya")).toBeTruthy();

    resolveSave?.();
    await flushPending();
  });

  it("Sign out clears the fixture household and lands on S1", async () => {
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Sign out"));
    await flushPending();

    expect(replaced).toEqual(["/onboarding/account"]);
    expect((await fixtureClient.getOnboardingState()).household).toBeNull();
  });

  it("a rejected read shows the §8 read fallback with Try again, same as S2", async () => {
    vi.spyOn(fixtureClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderScreen();

    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
  });

  it("Back is reachable and does not throw when there is a previous screen", async () => {
    const result = await renderScreen();
    expect(() => fireEvent.press(result.getByLabelText("Back"))).not.toThrow();
  });
});
