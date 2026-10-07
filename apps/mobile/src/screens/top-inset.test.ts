/**
 * M3-T10: every screen's header clears the status bar the way Home does since
 * BUG-007, `insets.top + spacing.md`. One table test over the screens; S7
 * (`app/add/scan.tsx`) is covered in `scan-screen.test.ts` because it needs
 * the camera mock.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spacing } from "../design/tokens";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { flushPending } from "../test-support/flush";
import { resetMockInsets, setMockTopInset } from "../test-support/safe-area-mock";
import { paddingTopAbove } from "../test-support/top-padding";
import { ToastProvider } from "../inventory/Toast";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: "fixture-item-strawberries" }),
}));

type Anchor = { kind: "text"; value: string } | { kind: "label"; value: string };

const SCREENS: ReadonlyArray<{
  name: string;
  load: () => Promise<{ default: React.ComponentType }>;
  anchor: Anchor;
}> = [
  {
    name: "S4 inventory",
    load: () => import("../../app/inventory"),
    anchor: { kind: "text", value: "Inventory" },
  },
  {
    name: "S5 item detail",
    load: () => import("../../app/inventory/[itemId]"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "S11 shopping",
    load: () => import("../../app/shopping"),
    anchor: { kind: "text", value: "Shopping" },
  },
  {
    name: "profile",
    load: () => import("../../app/profile"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "S6 legend",
    load: () => import("../../app/legend"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "add hub",
    load: () => import("../../app/add"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "S9 manual add",
    load: () => import("../../app/add/manual"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "S1 account",
    load: () => import("../../app/onboarding/account"),
    anchor: { kind: "label", value: "Back" },
  },
  {
    name: "S2 allergies",
    load: () => import("../../app/onboarding/allergies"),
    anchor: { kind: "label", value: "Back" },
  },
];

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  resetMockInsets();
});

describe("M3-T10 · header top padding follows the top safe-area inset", () => {
  for (const screen of SCREENS) {
    it(`${screen.name}: paddingTop is the inset plus spacing.md`, async () => {
      const { default: Screen } = await screen.load();
      for (const inset of [0, 44]) {
        setMockTopInset(inset);
        const result = render(
          React.createElement(ToastProvider, null, React.createElement(Screen)),
        );
        await flushPending();
        const node =
          screen.anchor.kind === "text"
            ? result.getAllByText(screen.anchor.value)[0]
            : result.getAllByLabelText(screen.anchor.value)[0];
        expect(paddingTopAbove(node?.parent ?? null)).toBe(inset + spacing.md);
        cleanup();
      }
    });
  }
});
