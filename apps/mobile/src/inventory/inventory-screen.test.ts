/**
 * S4 component tests (M3-T4a Objective (e)): first real
 * `@testing-library/react-native` coverage for `app/inventory.tsx`, over the
 * module-level `apiClient` singleton (a fresh `FixtureApiClient` in this test
 * environment — no `EXPO_PUBLIC_API_URL`, see `src/config/env.ts`) so no
 * household exists yet, the exact shape of a warm deep link landing on this
 * screen for one frame before `app/_layout.tsx`'s redirect resolves (that
 * layout's own doc comment/review F2).
 *
 * `.test.ts`, not `.test.tsx`: every JSX-shaped element below is built with
 * `React.createElement` so this file needs no JSX transform, matching the
 * root `vitest.config.ts`'s `include` glob (`*.test.ts`) with zero changes
 * to it.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { apiClient } from "../api/client";
import { GENERIC_LEDGER_ERROR_MESSAGE, GENERIC_READ_ERROR_MESSAGE } from "./errors";
import { ToastProvider } from "./Toast";

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
}));

afterEach(() => {
  cleanup();
});

describe("S4 · inventory list (component)", () => {
  it("renders safely on the pre-redirect frame (no household yet), never crashing on assumed data", async () => {
    const { default: InventoryScreen } = await import("../../app/inventory");
    let result: ReturnType<typeof render> | undefined;
    expect(() => {
      result = render(
        React.createElement(ToastProvider, null, React.createElement(InventoryScreen)),
      );
    }).not.toThrow();
    // The very first (synchronous) render happens before the mounting
    // effect's async apiClient.getInventoryItems() call resolves: this is
    // the pre-redirect frame itself, and the screen must render an (almost)
    // empty shell rather than assume `items` is already loaded.
    expect(result!.toJSON()).toBeTruthy();
  });

  it("eventually renders the first-run empty state once the (empty, new-user) fixture load resolves", async () => {
    const { default: InventoryScreen } = await import("../../app/inventory");
    const result = render(
      React.createElement(ToastProvider, null, React.createElement(InventoryScreen)),
    );
    await flushPending();
    expect(result.getByText("Nothing here yet")).toBeTruthy();
    expect(result.getByText("Inventory")).toBeTruthy();
  });

  it("a cold-start load failure shows the copy-deck §8 read fallback with Try again, never the save string (M9-T0 h)", async () => {
    const original = apiClient.getInventoryItems.bind(apiClient);
    let attempt = 0;
    apiClient.getInventoryItems = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("network down"));
      return original();
    };
    try {
      const { default: InventoryScreen } = await import("../../app/inventory");
      const result = render(
        React.createElement(ToastProvider, null, React.createElement(InventoryScreen)),
      );
      await flushPending();
      expect(result.getByText("Couldn't load your inventory.")).toBeTruthy();
      expect(result.getByText(GENERIC_READ_ERROR_MESSAGE)).toBeTruthy();
      expect(result.queryByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeNull();
    } finally {
      apiClient.getInventoryItems = original;
    }
  });
});
