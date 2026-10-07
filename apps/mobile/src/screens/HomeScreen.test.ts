/**
 * Home component test (review round 1, F9): the one addition M3-T6 makes to
 * this placeholder, the header's account affordance, had no test at all.
 * Everything else about this screen (the empty-kitchen state, M3-T2) is
 * unchanged and untested here on purpose.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { spacing } from "../design/tokens";
import { HomeScreen } from "./HomeScreen";

let pushed: unknown[] = [];

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: (href: unknown) => pushed.push(href),
    replace: () => {},
    canGoBack: () => false,
    back: () => {},
  }),
}));

let topInset = 0;

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: topInset, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  topInset = 0;
  cleanup();
  pushed = [];
});

describe("HomeScreen", () => {
  it("the header's account button opens the profile screen (BACKLOG.md M3-T6 Objective (a))", async () => {
    const result = render(React.createElement(HomeScreen));
    await flushPending();

    fireEvent.press(result.getByLabelText("Account"));

    expect(pushed).toEqual(["/profile"]);
  });

  it("the header sits below the top safe-area inset (BUG-007)", async () => {
    topInset = 40;
    const result = render(React.createElement(HomeScreen));
    await flushPending();

    // Walk up from the button to the header View (the first ancestor that
    // carries a paddingTop in its style).
    let paddingTop: number | undefined;
    for (
      let node = result.getByLabelText("Account").parent;
      node && paddingTop === undefined;
      node = node.parent
    ) {
      const layers = [node.props.style as unknown].flat(Infinity) as Array<
        { paddingTop?: number } | undefined
      >;
      paddingTop = layers.reduce<number | undefined>((acc, l) => l?.paddingTop ?? acc, undefined);
    }
    expect(paddingTop).toBe(40 + spacing.md);
  });
});
