/**
 * `app/_layout.tsx` component tests (M3-T4d review F2, BUG-001): the one
 * gate every route in the app goes through must fail CLOSED on a rejected
 * `getOnboardingState()` read, whether that is the very first read (cold
 * start) or a later navigation's re-read, must hold while a fresh read is
 * pending for a non-home stale route, and must never let the covered screen
 * be seen or used while blocked.
 *
 * BUG-001 changed HOW the layout blocks, not WHAT it blocks: it used to
 * unmount `<Slot />` (expo-router's navigator) and render nothing, the
 * fallback, or `<Redirect />` in its place, and unmounting the navigator
 * mid-navigation is what looped into "Maximum update depth exceeded" after
 * S2's Continue. The layout now keeps `<Slot />` mounted for its whole
 * lifetime and covers it (opaque cover on top, the navigator's subtree not
 * touchable and hidden from accessibility), and redirects through
 * `router.replace`. So the earlier "no SLOT_RENDERED" assertions, which
 * encoded the old mechanism, now assert the requirement itself: the gate
 * cover is up and the screen underneath is hidden and not interactive.
 *
 * `.test.ts`, not `.test.tsx`: every element below is built with
 * `React.createElement`. Against the real `FixtureApiClient` (the default
 * `apiClient` singleton, no `EXPO_PUBLIC_API_URL`), with
 * `getOnboardingState` mocked per test via `vi.spyOn` to control success vs
 * rejection independently of the fixture's own household state.
 *
 * `expo-router` is mocked: `usePathname` reads a tiny external store (so a
 * test can change the pathname from inside an effect, the way expo-router's
 * own store does), `useRouter().replace` records its target, and `Slot`
 * renders a marker `Text` and counts its own mounts and unmounts. With
 * `emulateNavigatorStore` on, `Slot` also mimics what the real navigator
 * does to the router store (see the BUG-001 test).
 */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStateDto } from "@smart-kitchen/contracts";
import { flushPending } from "../test-support/flush";
import { apiClient } from "../api/client";

let mockPathname = "/";
const pathnameListeners = new Set<() => void>();
function setMockPathname(next: string): void {
  mockPathname = next;
  for (const listener of pathnameListeners) listener();
}

let replaced: string[] = [];
let slotMounts = 0;
let slotUnmounts = 0;

/**
 * BUG-001 emulation of expo-router's navigator, from the browser trace of
 * the bug: while the navigator is mounted the router store reports the
 * URL's pathname; when it unmounts its navigation state is gone and the
 * store falls back to another route ("/onboarding/account" in the trace);
 * when it mounts again it restores the URL's pathname. Both happen
 * synchronously inside layout effects, like the real `useSyncState`.
 */
let emulateNavigatorStore = false;
let mockFontsLoaded = true;
let urlPathname = "/";
const NAVIGATOR_GONE_FALLBACK = "/onboarding/account";

vi.mock("expo-router", () => ({
  usePathname: () =>
    React.useSyncExternalStore(
      (listener) => {
        pathnameListeners.add(listener);
        return () => pathnameListeners.delete(listener);
      },
      () => mockPathname,
    ),
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: () => {},
    back: () => {},
    canGoBack: () => false,
  }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Slot: function SlotMock() {
    React.useLayoutEffect(() => {
      slotMounts += 1;
      if (emulateNavigatorStore) setMockPathname(urlPathname);
      return () => {
        slotUnmounts += 1;
        if (emulateNavigatorStore) setMockPathname(NAVIGATOR_GONE_FALLBACK);
      };
    }, []);
    return React.createElement(Text, null, "SLOT_RENDERED");
  },
}));

vi.mock("expo-font", () => ({
  useFonts: () => [mockFontsLoaded, null],
}));

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  cleanup();
  mockPathname = "/";
  pathnameListeners.clear();
  replaced = [];
  slotMounts = 0;
  slotUnmounts = 0;
  emulateNavigatorStore = false;
  mockFontsLoaded = true;
  urlPathname = "/";
  vi.restoreAllMocks();
});

type Rendered = ReturnType<typeof render>;
type Node = ReturnType<Rendered["getByText"]>;

async function renderLayout(): Promise<Rendered> {
  const { default: RootLayout } = await import("../../app/_layout");
  const result = render(React.createElement(RootLayout));
  await flushPending();
  return result;
}

async function navigate(result: Rendered, pathname: string): Promise<void> {
  mockPathname = pathname;
  const { default: RootLayout } = await import("../../app/_layout");
  result.rerender(React.createElement(RootLayout));
  await flushPending();
}

/** The View wrapping `<Slot />` that carries the gate's hide/disable props. */
function slotWrapper(result: Rendered): Node {
  let node: Node | null = result.getByText("SLOT_RENDERED");
  while (node && node.props.importantForAccessibility === undefined) {
    node = node.parent;
  }
  if (!node) {
    throw new Error("no gate wrapper around <Slot />");
  }
  return node;
}

/** The requirement: the covered screen is neither visible, nor tappable, nor announced. */
function expectScreenBlocked(result: Rendered): void {
  const cover = result.getByTestId("root-gate-cover");
  expect(cover.props.style).toMatchObject({ position: "absolute", top: 0, bottom: 0 });
  const coverStyle = cover.props.style as { backgroundColor?: string };
  expect(coverStyle.backgroundColor).toBeTruthy(); // opaque, nothing shows through
  const wrapper = slotWrapper(result);
  expect(wrapper.props.pointerEvents).toBe("none");
  expect(wrapper.props["aria-hidden"]).toBe(true);
  expect(wrapper.props.accessibilityElementsHidden).toBe(true);
  expect(wrapper.props.importantForAccessibility).toBe("no-hide-descendants");
  expect(result.queryByLabelText("Inventory")).toBeNull(); // no tab bar while covered
}

function expectScreenShown(result: Rendered): void {
  expect(result.queryByTestId("root-gate-cover")).toBeNull();
  const wrapper = slotWrapper(result);
  expect(wrapper.props.pointerEvents).toBe("auto");
  expect(wrapper.props["aria-hidden"]).toBe(false);
  expect(wrapper.props.importantForAccessibility).toBe("auto");
}

function oneMemberHousehold(complete: boolean): OnboardingStateDto {
  return {
    household: {
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [
        {
          memberId: "mem-1",
          displayName: "Ada",
          role: "owner",
          restrictions: [],
          noneConfirmed: complete,
          preferences: [],
        },
      ],
    },
  };
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
    // BUG-001: was "no SLOT_RENDERED"; the requirement is that the screen
    // underneath is not visible or usable, and the fallback is the only
    // thing on top of it.
    expectScreenBlocked(result);
    expect(replaced).toEqual([]);
  });

  it("a rejected read on a later navigation does not render the destination (no bypass of S1/S2 via a deep link)", async () => {
    // First render: a successful read for "/", household null -> S1 redirect.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    const result = await renderLayout();
    expect(replaced).toEqual(["/onboarding/account"]);

    // Simulate a deep link straight at /inventory whose own read rejects.
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    await navigate(result, "/inventory");

    expectScreenBlocked(result);
    expect(replaced).toEqual(["/onboarding/account"]); // no redirect off a failed read
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
  });

  it("a never-resolving read after an S1-routed read holds (covered, no redirect) for as long as it is pending (review round 2, F2)", async () => {
    // First render: a successful read for "/", household null -> S1 redirect
    // (the stale read's own route is "s1", not "home").
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    const result = await renderLayout();
    expect(replaced).toEqual(["/onboarding/account"]);

    // A deep link straight at /inventory whose own read never settles
    // (never resolves, never rejects): the M3-T2 F18 "render the
    // destination for one frame" tolerance must not become an unbounded
    // window while this is in flight.
    vi.spyOn(apiClient, "getOnboardingState").mockImplementationOnce(() => new Promise(() => {}));
    await navigate(result, "/inventory");

    expectScreenBlocked(result);
    expect(replaced).toEqual(["/onboarding/account"]); // a hold never redirects
    expect(result.queryByText("Couldn't load your household.")).toBeNull(); // held, not a read failure
  });

  it("a still-pending read whose stale route was already home still renders Slot for that one frame (F18 preserved)", async () => {
    // First render: a successful read for "/", household fully onboarded
    // -> route "home", no redirect, Slot renders.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce(oneMemberHousehold(true));
    const result = await renderLayout();
    expectScreenShown(result);

    // Navigate to another tab whose own read is still pending: the stale
    // route was already "home", so this is exactly F18's safe case and
    // must keep showing Slot, not hold.
    vi.spyOn(apiClient, "getOnboardingState").mockImplementationOnce(() => new Promise(() => {}));
    await navigate(result, "/inventory");

    expectScreenShown(result);
    expect(replaced).toEqual([]);
  });

  it("Try again re-reads and, on success, renders the destination", async () => {
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    const result = await renderLayout();
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();

    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    fireEvent.press(result.getByLabelText("Try again"));
    await flushPending();

    expect(result.queryByText("Couldn't load your household.")).toBeNull();
    // BUG-001: was "REDIRECT_RENDERED:/onboarding/account"; the redirect is
    // now a router.replace, and the screen stays covered until it lands.
    expect(replaced).toEqual(["/onboarding/account"]);
    expectScreenBlocked(result);
  });
});

describe("app/_layout.tsx (component, BUG-001 never unmounts the navigator)", () => {
  it("S2's Continue to / while the S2-routed read is still stale settles on Home with one navigator mount and no update-depth loop", async () => {
    emulateNavigatorStore = true;
    urlPathname = "/onboarding/allergies";
    mockPathname = "/onboarding/allergies";
    // S2's own read: a household whose allergy gate is still open.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce(oneMemberHousehold(false));
    const result = await renderLayout();
    expect(result.getByText("SLOT_RENDERED")).toBeTruthy();
    expect(slotMounts).toBe(1);

    // Continue saved the gate and called router.replace("/"): the URL and
    // the store move to "/" while the fresh read for "/" is in flight.
    let resolveFresh: (state: OnboardingStateDto) => void = () => {};
    vi.spyOn(apiClient, "getOnboardingState").mockImplementationOnce(
      () =>
        new Promise<OnboardingStateDto>((resolve) => {
          resolveFresh = resolve;
        }),
    );
    const consoleError = vi.spyOn(console, "error");
    urlPathname = "/";
    // The bug, before the fix: React threw "Maximum update depth exceeded"
    // right here, from the store updates the navigator's unmount and remount
    // fired inside layout effects. Captured rather than left to throw so the
    // assertion names it.
    let thrown: unknown;
    try {
      act(() => {
        setMockPathname("/");
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(slotUnmounts).toBe(0);
    expect(slotMounts).toBe(1);

    // The pending window: held (covered), not unmounted, not redirected.
    expect(mockPathname).toBe("/");
    expectScreenBlocked(result);

    // The fresh read lands: the gate is satisfied, Home shows.
    act(() => {
      resolveFresh(oneMemberHousehold(true));
    });
    await flushPending();

    expect(mockPathname).toBe("/");
    expectScreenShown(result);
    expect(replaced).toEqual([]);
    expect(slotMounts).toBe(1);
    expect(slotUnmounts).toBe(0);
    const depthErrors = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("Maximum update depth"),
    );
    expect(depthErrors).toEqual([]);
  });

  it("keeps one navigator mount across every gate state: redirect, onboarding, hold, failed read, Try again, Home", async () => {
    // Cold start at "/" with no household: covered, redirect issued.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    const result = await renderLayout();
    expectScreenBlocked(result);
    expect(replaced).toEqual(["/onboarding/account"]);

    // The redirect lands on S1: shown.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce({ household: null });
    await navigate(result, "/onboarding/account");
    expectScreenShown(result);

    // A deep link to /inventory whose read fails: covered by the fallback.
    vi.spyOn(apiClient, "getOnboardingState").mockRejectedValueOnce(new Error("network down"));
    await navigate(result, "/inventory");
    expectScreenBlocked(result);
    expect(result.getByText("Couldn't load your household.")).toBeTruthy();

    // Try again, now onboarded: shown.
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValueOnce(oneMemberHousehold(true));
    fireEvent.press(result.getByLabelText("Try again"));
    await flushPending();
    expectScreenShown(result);
    expect(replaced).toEqual(["/onboarding/account"]);

    expect(slotMounts).toBe(1);
    expect(slotUnmounts).toBe(0);
  });

  it("does not issue a redirect before the navigator has rendered (a read can land before the fonts)", async () => {
    mockFontsLoaded = false;
    vi.spyOn(apiClient, "getOnboardingState").mockResolvedValue({ household: null });
    const result = await renderLayout();
    expect(result.queryByText("SLOT_RENDERED")).toBeNull();
    expect(replaced).toEqual([]);

    mockFontsLoaded = true;
    await navigate(result, "/");
    expect(slotMounts).toBe(1);
    expect(replaced).toEqual(["/onboarding/account"]);
    expectScreenBlocked(result);
  });
});
