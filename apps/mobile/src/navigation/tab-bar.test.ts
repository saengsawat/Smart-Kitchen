/**
 * Tab shell component test (M3-T4a Objective (e)): the tab bar renders its
 * five slots (four `TAB_ORDER` buttons plus the centre scan FAB), the first
 * real render of `TabBar.tsx` (M3-T1's own worker report flagged adopting
 * `@testing-library/react-native` as future work; this is that work).
 *
 * `.test.ts`, not `.test.tsx`: every element below is built with
 * `React.createElement`.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({
  usePathname: () => "/",
  // asChild's real behaviour clones the child and wires navigation; a
  // component test of "does every slot render" needs none of that, so the
  // mock renders the child as-is.
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  cleanup();
});

describe("TabBar (component)", () => {
  it("renders five slots: Home, Inventory, Menu, Shopping and the centre scan FAB", async () => {
    const { TabBar } = await import("./TabBar");
    const result = render(React.createElement(TabBar));

    expect(result.getByLabelText("Home")).toBeTruthy();
    expect(result.getByLabelText("Inventory")).toBeTruthy();
    expect(result.getByLabelText("Menu")).toBeTruthy();
    expect(result.getByLabelText("Shopping")).toBeTruthy();
    expect(result.getByLabelText("Add, scan")).toBeTruthy();
    expect(result.getAllByRole("button")).toHaveLength(5);
  });
});
