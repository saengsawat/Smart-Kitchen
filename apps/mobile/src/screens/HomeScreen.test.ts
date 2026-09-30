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

afterEach(() => {
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
});
