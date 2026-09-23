/**
 * Toast host component test (M3-T4a Objective (f)): the global toast host
 * keeps showing (and its Undo keeps working) across a simulated route
 * change — the exact shape `app/_layout.tsx` relies on, where `<ToastHost />`
 * is a sibling of `<Slot />`, not inside it, so a navigation swapping the
 * screen underneath never remounts the host.
 *
 * `.test.ts`, not `.test.tsx`: every element below is built with
 * `React.createElement`.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { ToastHost, ToastProvider, useToast } from "./Toast";

afterEach(() => {
  cleanup();
});

function ScreenA({ onUndo }: { onUndo: () => void }): React.JSX.Element {
  const { show } = useToast();
  return React.createElement(
    Pressable,
    { accessibilityLabel: "trigger", onPress: () => show("Discarded. Undo", onUndo) },
    React.createElement(Text, null, "Screen A"),
  );
}

function ScreenB(): React.JSX.Element {
  return React.createElement(Text, null, "Screen B");
}

/** Mirrors app/_layout.tsx: ToastProvider wraps a "Slot" whose content changes, plus a sibling ToastHost. */
function App({ slot }: { slot: React.ReactNode }): React.JSX.Element {
  return React.createElement(ToastProvider, null, slot, React.createElement(ToastHost));
}

describe("ToastHost (component)", () => {
  it("shows a toast raised by one screen, and it survives a simulated navigation to a different screen", () => {
    let undone = false;
    const result = render(
      React.createElement(App, {
        slot: React.createElement(ScreenA, { onUndo: () => (undone = true) }),
      }),
    );

    fireEvent.press(result.getByLabelText("trigger"));
    expect(result.getByText("Discarded. Undo")).toBeTruthy();

    // Simulated route change: the "Slot" content swaps to a different
    // screen, same as expo-router's <Slot /> would on navigation. The
    // ToastProvider/ToastHost themselves are not re-created (they are not
    // part of this rerender's swapped slot), matching _layout.tsx exactly.
    result.rerender(React.createElement(App, { slot: React.createElement(ScreenB) }));

    expect(result.queryByText("Screen A")).toBeNull();
    expect(result.getByText("Screen B")).toBeTruthy();
    expect(result.getByText("Discarded. Undo")).toBeTruthy(); // survived the navigation

    fireEvent.press(result.getByLabelText("Undo"));
    expect(undone).toBe(true);
  });

  it("useToast throws a clear error when used outside a ToastProvider (a screen wired up wrong)", () => {
    expect(() => render(React.createElement(ScreenA, { onUndo: () => {} }))).toThrow(
      /must be rendered inside <ToastProvider>/,
    );
  });
});
