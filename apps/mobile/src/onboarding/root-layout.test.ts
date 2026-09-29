/**
 * `app/_layout.tsx` component tests (M3-T4d review F2): the one gate every
 * route in the app goes through must fail CLOSED on a rejected
 * `getOnboardingState()` read, whether that is the very first read (cold
 * start) or a later navigation's re-read, and must never render `<Slot />`
 * or `<Redirect />` while blocked.
 *
 * `.test.ts`, not `.test.tsx`: every element below is built with
 * `React.createElement`. Against the real `FixtureApiClient` (the default
 * `apiClient` singleton, no `EXPO_PUBLIC_API_URL`), with
 * `getOnboardingState` mocked per test via `vi.spyOn` to control success vs
 * rejection independently of the fixture's own household state.
 *
 * `expo-router`'s `Slot`/`Redirect`/`usePathname`/`Link` are all mocked:
 * `Slot` and `Redirect` render an identifiable marker `Text` (never the
 * real navigator, which needs a real router tree this test does not build)
 * so a test can assert which one (if either) rendered.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { apiClient } from "../api/client";

let mockPathname = "/";

vi.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Slot: () => React.createElement(Text, null, "SLOT_RENDERED"),
  Redirect: ({ href }: { href: string }) =>
    React.createElement(Text, null, `REDIRECT_RENDERED:${href}`),
}));

vi.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  cleanup();
  mockPathname = "/";
  vi.restoreAllMocks();
});

async function renderLayout(): Promise<ReturnType<typeof render>> {
  const { default: RootLayout } = await import("../../app/_layout");
  const result = render(React.createElement(RootLayout));
  await flushPending();
  return result;
}

describe("app/_layout.tsx (component, review F2 fail-closed)", () => {
  it("a rejected read at cold start renders the fallback and nothing else", async () => {
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderLayout();

    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
    expect(result.getByLabelText("Try again")).toBeTruthy();
    expect(result.queryByText("SLOT_RENDERED")).toBeNull();
    expect(result.queryByText(/^REDIRECT_RENDERED/)).toBeNull();
  });

  it("a rejected read on a later navigation does not render the destination (no bypass of S1/S2 via a deep link)", async () => {
    // First render: a successful read for "/", household null -> S1 redirect.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    const result = await renderLayout();
    expect(result.getByText(/^REDIRECT_RENDERED:\/onboarding\/account$/)).toBeTruthy();

    // Simulate a deep link straight at /inventory whose own read rejects.
    mockPathname = "/inventory";
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const { default: RootLayout } = await import("../../app/_layout");
    result.rerender(React.createElement(RootLayout));
    await flushPending();

    expect(result.queryByText("SLOT_RENDERED")).toBeNull();
    expect(result.queryByText(/^REDIRECT_RENDERED/)).toBeNull();
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
  });

  it("Try again re-reads and, on success, renders the destination", async () => {
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderLayout();
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();

    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    fireEvent.press(result.getByLabelText("Try again"));
    await flushPending();

    expect(result.queryByText("Couldn't load your household.")).toBeNull();
    expect(result.getByText(/^REDIRECT_RENDERED:\/onboarding\/account$/)).toBeTruthy();
  });
});
