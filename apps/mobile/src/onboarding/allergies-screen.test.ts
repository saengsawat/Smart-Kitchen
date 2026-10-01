/**
 * S2 component tests (M3-T4d review F2), `app/onboarding/allergies.tsx`
 * against the real `FixtureApiClient` (the default `apiClient` singleton,
 * no `EXPO_PUBLIC_API_URL`), `getOnboardingState` controlled per test via
 * `vi.spyOn`. `.test.ts`, not `.test.tsx`, same reason as the other screen
 * component tests.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";

let replaced: unknown[] = [];

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => false,
    back: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  replaced = [];
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: AllergiesScreen } = await import("../../app/onboarding/allergies");
  const result = render(React.createElement(AllergiesScreen));
  await flushPending();
  return result;
}

describe("S2 · allergies, review F2 (fail-closed read, same handling as app/_layout.tsx)", () => {
  it("a rejected read shows the fallback with Try again instead of spinning forever", async () => {
    await apiClient.joinHousehold(FIXTURE_JOIN_CODE); // a household must exist for S2 to be reachable at all
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderScreen();

    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
    expect(result.getByLabelText("Try again")).toBeTruthy();
    // The gate form itself must not render while blocked.
    expect(result.queryByText("Allergies")).toBeNull();
  });

  it("Try again re-reads and, on success, renders the gate form", async () => {
    await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderScreen();
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();

    fireEvent.press(result.getByLabelText("Try again"));
    await flushPending();

    expect(result.queryByText("Couldn't load your household.")).toBeNull();
    expect(result.getByText("Allergies")).toBeTruthy();
  });
});
