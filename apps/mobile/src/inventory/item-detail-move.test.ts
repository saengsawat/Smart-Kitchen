/**
 * M2-T6 (d): S5's "Move to" chip row, against the default fixture `ApiClient`
 * (no `EXPO_PUBLIC_API_URL`), plus the S4 regroup that follows a move.
 *
 * The chips offer the other locations of the enum; tapping one calls
 * `moveItem`, the header's location text updates, the toast reads "Moved to
 * Pantry", the history shows the new row, and nothing about the quantity
 * changes. S4, opened afterwards, lists the item under its new group.
 * `.test.ts` with `React.createElement`, like its siblings.
 */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";
import { flushPending } from "../test-support/flush";
import { GENERIC_LEDGER_ERROR_MESSAGE } from "./errors";
import { ledgerRowsOf } from "./history";
import { ToastHost, ToastProvider } from "./Toast";

const EGGS = "fixture-item-eggs"; // Fridge, 8 count (lot label "carton of 12")

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: "fixture-item-eggs" }),
}));

beforeEach(async () => {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: Screen } = await import("../../app/inventory/[itemId]");
  const result = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Screen),
      React.createElement(ToastHost),
    ),
  );
  await flushPending();
  return result;
}

/** The header line under the big quantity: "on hand · {Location}". */
function locationLine(result: ReturnType<typeof render>): string {
  const node = result.getByText(/on hand/);
  const children = (node.props as { children: unknown }).children;
  return (Array.isArray(children) ? children : [children]).join("");
}

describe("S5 · Move to (M2-T6)", () => {
  it("offers the other three locations under 'Move to', never the current one", async () => {
    const result = await renderScreen();
    expect(result.getByText("Move to")).toBeTruthy();
    expect(result.getByLabelText("Move to Freezer")).toBeTruthy();
    expect(result.getByLabelText("Move to Pantry")).toBeTruthy();
    expect(result.getByLabelText("Move to Other")).toBeTruthy();
    expect(result.queryByLabelText("Move to Fridge")).toBeNull();
    expect(locationLine(result)).toContain("Fridge");
  });

  it("Move to Pantry calls the client, updates the header, toasts and adds the history row", async () => {
    const result = await renderScreen();
    const spy = vi.spyOn(apiClient, "moveItem");

    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();

    expect(spy).toHaveBeenCalledWith(EGGS, "PANTRY");
    expect(locationLine(result)).toContain("Pantry");
    expect(locationLine(result)).not.toContain("Fridge");
    // The toast and the history row both read "Moved to Pantry".
    expect(result.getAllByText("Moved to Pantry")).toHaveLength(2);
    expect(result.getByText("from Fridge")).toBeTruthy();
  });

  it("the chip row now offers the old location and not the new one", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();
    expect(result.getByLabelText("Move to Fridge")).toBeTruthy();
    expect(result.queryByLabelText("Move to Pantry")).toBeNull();
  });

  it("changes nothing about the quantity or the ledger: the amount, the Why line and every ledger row stay", async () => {
    const before = await apiClient.getInventoryItem(EGGS);
    const result = await renderScreen();
    const whyBefore = result.getByText(/^Why /).props as { children: unknown };

    fireEvent.press(result.getByLabelText("Move to Freezer"));
    await flushPending();

    const after = await apiClient.getInventoryItem(EGGS);
    expect(after?.summary.quantity).toEqual(before?.summary.quantity);
    expect(ledgerRowsOf(after?.history ?? [])).toEqual(ledgerRowsOf(before?.history ?? []));
    expect((result.getByText(/^Why /).props as { children: unknown }).children).toEqual(
      whyBefore.children,
    );
    expect(result.getByText("8 of 12")).toBeTruthy();
  });

  it("lists the move row first in the history (newest first), above the ledger rows", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();
    // The history heading is followed by the move row (newest first).
    const titles = result
      .getAllByText(/^(Moved to Pantry|Purchased|Initial stock|Added)/)
      .map((node) => (node.props as { children: unknown }).children);
    expect(titles[0]).toBe("Moved to Pantry");
  });

  it("a failed move shows the §8 fallback, leaves the header and the chips alone and does not claim success", async () => {
    const result = await renderScreen();
    vi.spyOn(apiClient, "moveItem").mockRejectedValue(new Error("network down"));

    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();

    expect(result.getByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeTruthy();
    expect(result.queryByText("Moved to Pantry")).toBeNull();
    expect(locationLine(result)).toContain("Fridge");
    expect(result.getByLabelText("Move to Pantry")).toBeTruthy();
  });

  it("taps inside one frame send one move: the guard is a ref, and the chips are disabled while the request is in flight", async () => {
    const result = await renderScreen();
    let release: () => void = () => {};
    const spy = vi.spyOn(apiClient, "moveItem").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    // All three taps inside one act(): no re-render between them, so a
    // guard held in React state would let every one through.
    act(() => {
      fireEvent.press(result.getByLabelText("Move to Pantry"));
      fireEvent.press(result.getByLabelText("Move to Pantry"));
      fireEvent.press(result.getByLabelText("Move to Freezer"));
    });
    await flushPending();
    expect(spy).toHaveBeenCalledTimes(1);

    release();
    await flushPending();
  });
});

describe("S4 · regroups an item after a move (M2-T6)", () => {
  async function renderS4(): Promise<ReturnType<typeof render>> {
    const { default: InventoryScreen } = await import("../../app/inventory");
    const result = render(
      React.createElement(ToastProvider, null, React.createElement(InventoryScreen)),
    );
    await flushPending();
    return result;
  }

  it("lists the item under Pantry after it was moved there, and the Fridge count drops by one", async () => {
    const before = await renderS4();
    expect(before.getByText("6 items")).toBeTruthy(); // Fridge: chicken, strawberries, spinach, mushrooms, yogurt, eggs
    expect(before.getByText("2 items")).toBeTruthy(); // Pantry: rice, olive oil
    cleanup();

    await apiClient.moveItem(EGGS, "PANTRY");

    const after = await renderS4();
    expect(after.getByText("5 items")).toBeTruthy();
    expect(after.getByText("3 items")).toBeTruthy();
    expect(after.queryByText("6 items")).toBeNull();
  });

  it("the Pantry tab then lists the moved item", async () => {
    await apiClient.moveItem(EGGS, "PANTRY");
    const result = await renderS4();
    fireEvent.press(result.getByLabelText("Pantry"));
    await flushPending();
    expect(result.getAllByText("Eggs").length).toBeGreaterThan(0);
    cleanup();

    const fridge = await renderS4();
    fireEvent.press(fridge.getByLabelText("Fridge"));
    await flushPending();
    expect(fridge.queryByText("Eggs")).toBeNull();
  });
});
