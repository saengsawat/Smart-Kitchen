/**
 * S9 component tests (M3-T4b), `app/add/manual.tsx` against the real
 * `FixtureApiClient`. `.test.ts`, not `.test.tsx`, same reason as
 * `scan-screen.test.ts`.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { apiClient } from "../api/client";

let pushed: unknown[] = [];
let replaced: unknown[] = [];
let searchParams: { code?: string } = {};

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: (href: unknown) => pushed.push(href),
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => false,
    back: () => {},
  }),
  useLocalSearchParams: () => searchParams,
}));

afterEach(() => {
  cleanup();
  pushed = [];
  replaced = [];
  searchParams = {};
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: Screen } = await import("../../app/add/manual");
  return render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Screen),
      React.createElement(ToastHost),
    ),
  );
}

describe("S9 · manual add", () => {
  it("gates on a name: Add to inventory shows an error and does not navigate when the name is blank", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Add to inventory"));
    await flushPending();

    expect(result.getByText("Name this item before adding it.")).toBeTruthy();
    expect(replaced).toEqual([]);
  });

  it("clears the name error once typing starts", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Add to inventory"));
    await flushPending();
    expect(result.getByText("Name this item before adding it.")).toBeTruthy();

    fireEvent.changeText(result.getByLabelText("Item name"), "Frozen dumplings");
    expect(result.queryByText("Name this item before adding it.")).toBeNull();
  });

  it("creates a manual item as Known Fact, in the chosen unit and location, and navigates to S4", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Item name"), "Trader Joe's frozen dumplings");
    fireEvent.press(result.getByLabelText("Volume")); // switch unit kind
    fireEvent.press(result.getByLabelText("Increase quantity"));
    fireEvent.press(result.getByLabelText("Freezer"));
    fireEvent.press(result.getByLabelText("Add to inventory"));
    await flushPending();

    expect(replaced).toContain("/inventory");
    expect(
      result.queryByText(
        "Something went wrong saving that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeNull();

    const items = await apiClient.getInventoryItems();
    const created = items.find((item) => item.displayName === "Trader Joe's frozen dumplings");
    expect(created).toBeTruthy();
    expect(created?.storageLocation).toBe("FREEZER");
    expect(created?.quantity.unit).toBe("ml"); // Volume kind's first unit
    expect(created?.quantity.amount).toBe("2"); // stepper started at 1, incremented once
    expect(created?.provenance.quantity?.tier).toBe("KNOWN_FACT");
    const detail = created ? await apiClient.getInventoryItem(created.itemId) : null;
    expect(detail?.history[0]?.type).toBe("INITIAL_STOCK");
  });

  it("disables Add to inventory at a zero amount (review F17)", async () => {
    const result = await renderScreen();
    fireEvent.changeText(result.getByLabelText("Item name"), "Zero test item");
    fireEvent.press(result.getByLabelText("Decrease quantity")); // 1 -> 0

    const button = result.getByLabelText("Add to inventory");
    const props = button.props as { accessibilityState?: { disabled?: boolean } };
    expect(props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(button);
    await flushPending();

    expect(replaced).toEqual([]);
    const items = await apiClient.getInventoryItems();
    expect(items.some((item) => item.displayName === "Zero test item")).toBe(false);
  });

  it("shows the retained-code note when reached from a miss (BACKLOG.md M3-T4b Objective (d))", async () => {
    searchParams = { code: "040000519073" };
    const result = await renderScreen();
    expect(
      result.getByText(
        "Barcode 0 40000 51907 3 kept on file. If it is added to a data source later, we will offer to fill in these facts automatically.",
      ),
    ).toBeTruthy();
  });

  it("shows no retained-code note when not reached from a miss", async () => {
    const result = await renderScreen();
    expect(result.queryByText(/kept on file/)).toBeNull();
  });
});
