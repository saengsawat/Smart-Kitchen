/**
 * S6 legend (BUG-003 review F1): it shows the floating tab bar and scrolls,
 * so its content pads by the tab bar's footprint like S4/S5/S11/S12.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setMockBottomInset } from "../test-support/safe-area-mock";
import { tabBarClearanceFor } from "../navigation/TabBar";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
}));

afterEach(() => {
  cleanup();
  setMockBottomInset(0);
});

describe("S6 · legend · tab bar clearance (BUG-003)", () => {
  it("pads the scroll content by the tab bar's footprint for a non-zero bottom inset", async () => {
    setMockBottomInset(34);
    const { default: LegendScreen } = await import("../../app/legend");
    const result = render(React.createElement(LegendScreen));
    const scroll = result.UNSAFE_getByType("ScrollView" as unknown as React.ComponentType);
    const list: readonly unknown[] = Array.isArray(scroll.props.contentContainerStyle)
      ? scroll.props.contentContainerStyle
      : [scroll.props.contentContainerStyle];
    const flat: Record<string, unknown> = {};
    for (const entry of list) {
      if (entry && typeof entry === "object") Object.assign(flat, entry);
    }
    expect(flat.paddingBottom).toBe(tabBarClearanceFor(34));
    expect(tabBarClearanceFor(34)).toBe(134);
  });
});
