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
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { apiClient, FixtureApiClient } from "../api/client";
import { GENERIC_LEDGER_ERROR_MESSAGE, GENERIC_READ_ERROR_MESSAGE } from "./errors";
import { ToastHost, ToastProvider } from "./Toast";

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

  describe("Confirm on a tray row (BUG-004)", () => {
    // Serves the returning-user fixture's list (Strawberries is an AI-tier
    // tray row) through the module-level singleton, counting list loads.
    async function withTray(
      confirm: (itemId: string) => Promise<void>,
      body: (ctx: { loads: () => number; confirmCalls: string[] }) => Promise<void>,
    ): Promise<void> {
      const seed = FixtureApiClient.returningUser();
      const originalList = apiClient.getInventoryItems.bind(apiClient);
      const originalConfirm = apiClient.confirmAiProposal.bind(apiClient);
      let loads = 0;
      const confirmCalls: string[] = [];
      apiClient.getInventoryItems = () => {
        loads += 1;
        return seed.getInventoryItems();
      };
      apiClient.confirmAiProposal = (itemId: string) => {
        confirmCalls.push(itemId);
        return confirm(itemId);
      };
      try {
        await body({ loads: () => loads, confirmCalls });
        // No unhandled-rejection listener of our own: apps/mobile's lint
        // config keeps Node's `process` out of app code, and vitest already
        // fails the whole run ("Errors 1 error", exit 1) on any unhandled
        // rejection, so give a stray one time to surface before returning.
        await flushPending(5);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      } finally {
        apiClient.getInventoryItems = originalList;
        apiClient.confirmAiProposal = originalConfirm;
      }
    }

    async function renderScreen(): Promise<ReturnType<typeof render>> {
      const { default: InventoryScreen } = await import("../../app/inventory");
      const result = render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(InventoryScreen),
          React.createElement(ToastHost),
        ),
      );
      await flushPending();
      return result;
    }

    it("a rejected confirm shows the generic ledger fallback, keeps the row, does not reload, leaks no rejection", async () => {
      await withTray(
        () => Promise.reject(new Error("FixtureApiClient: unknown item server-id")),
        async ({ loads, confirmCalls }) => {
          const result = await renderScreen();
          expect(result.getByText("Needs your confirmation")).toBeTruthy();
          const loadsBefore = loads();
          const buttons = result.getAllByLabelText("Confirm Strawberries").length;

          fireEvent.press(result.getAllByLabelText("Confirm Strawberries")[0]!);
          await flushPending();

          expect(confirmCalls).toEqual(["fixture-item-strawberries"]);
          expect(result.getByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeTruthy();
          expect(result.queryByText("Strawberries confirmed")).toBeNull();
          expect(result.queryByText(/unknown item/i)).toBeNull();
          expect(result.getAllByLabelText("Confirm Strawberries")).toHaveLength(buttons);
          expect(loads()).toBe(loadsBefore);
        },
      );
    });

    it("a resolved confirm still toasts the name as confirmed and reloads (pinned)", async () => {
      await withTray(
        () => Promise.resolve(),
        async ({ loads }) => {
          const result = await renderScreen();
          const loadsBefore = loads();

          fireEvent.press(result.getAllByLabelText("Confirm Strawberries")[0]!);
          await flushPending();

          expect(result.getByText("Strawberries confirmed")).toBeTruthy();
          expect(result.queryByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeNull();
          expect(loads()).toBe(loadsBefore + 1);
        },
      );
    });
  });
});
