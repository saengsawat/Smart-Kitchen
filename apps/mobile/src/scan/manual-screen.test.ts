/**
 * S9 component tests (M3-T4b), `app/add/manual.tsx` against the real
 * `FixtureApiClient`. `.test.ts`, not `.test.tsx`, same reason as
 * `scan-screen.test.ts`.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateItemRequestDto } from "@smart-kitchen/contracts";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { apiClient } from "../api/client";

let pushed: unknown[] = [];
let replaced: unknown[] = [];
let searchParams: {
  code?: string;
  name?: string;
  amount?: string;
  unit?: string;
  location?: string;
} = {};

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
  vi.restoreAllMocks();
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

  describe("M3-T5 prefill (S11's close-the-loop Add on a gap row with no itemId)", () => {
    it("prefills name, unit kind/unit, count and location from the search params", async () => {
      searchParams = { name: "Broccoli", amount: "2", unit: "lb", location: "FRIDGE" };
      const result = await renderScreen();

      expect((result.getByLabelText("Item name").props as { value?: string }).value).toBe(
        "Broccoli",
      );
      const massProps = result.getByLabelText("Mass").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(massProps.accessibilityState?.selected).toBe(true);
      const lbProps = result.getByLabelText("lb").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(lbProps.accessibilityState?.selected).toBe(true);
      expect(result.getByText("2")).toBeTruthy(); // the stepper's value
      const fridgeProps = result.getByLabelText("Fridge").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(fridgeProps.accessibilityState?.selected).toBe(true);
    });

    it("saving a prefilled item creates it with the prefilled amount/unit/location", async () => {
      searchParams = { name: "Broccoli", amount: "2", unit: "lb", location: "FRIDGE" };
      const result = await renderScreen();
      fireEvent.press(result.getByLabelText("Add to inventory"));
      await flushPending();

      const items = await apiClient.getInventoryItems();
      const created = items.find((item) => item.displayName === "Broccoli");
      expect(created?.quantity.unit).toBe("lb");
      expect(created?.quantity.amount).toBe("2");
      expect(created?.storageLocation).toBe("FRIDGE");
    });

    it("falls back to S9's own defaults when the prefill is absent (no regression for the S7/S8 miss path)", async () => {
      searchParams = { code: "040000519073" };
      const result = await renderScreen();

      expect((result.getByLabelText("Item name").props as { value?: string }).value).toBe("");
      const massProps = result.getByLabelText("Mass").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(massProps.accessibilityState?.selected).toBe(true);
      expect(result.getByText("1")).toBeTruthy();
    });

    it("falls back to a whole-unit default (1) for a non-integer or missing amount, never guessing a rounding rule, while name/unit/location still prefill (review round 2 test gap)", async () => {
      searchParams = { name: "Weird item", amount: "0.5", unit: "lb", location: "PANTRY" };
      const result = await renderScreen();
      expect(result.getByText("1")).toBeTruthy();
      // A fractional amount only skips the count prefill; it must not also
      // silently drop the other three (the earlier version of this test
      // checked the count alone).
      expect((result.getByLabelText("Item name").props as { value?: string }).value).toBe(
        "Weird item",
      );
      const lbProps = result.getByLabelText("lb").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(lbProps.accessibilityState?.selected).toBe(true);
      const pantryProps = result.getByLabelText("Pantry").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(pantryProps.accessibilityState?.selected).toBe(true);
    });

    it("never silently truncates a fraction into a same-shaped whole number (review round 1, F9)", async () => {
      // A naive `Number.parseInt("2.5", 10)` returns 2 — a *different*,
      // silently wrong whole number, not a fallback to the default. This
      // is the exact bug the review caught (a fractional gap "looked
      // whole" after truncation): the fix must recognise "2.5" as
      // fractional and fall back to 1, never accept the truncated "2".
      searchParams = { name: "Fractional item", amount: "2.5", unit: "lb" };
      const result = await renderScreen();
      expect(result.getByText("1")).toBeTruthy();
      expect(result.queryByText("2")).toBeNull();
    });

    it("ignores an unrecognised unit, falling back to Mass's first unit", async () => {
      searchParams = { name: "Mystery", amount: "1", unit: "not-a-real-unit" };
      const result = await renderScreen();
      const massProps = result.getByLabelText("Mass").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(massProps.accessibilityState?.selected).toBe(true);
    });

    it("ignores an unrecognised location, falling back to Fridge", async () => {
      searchParams = { name: "Mystery", location: "OTHER" };
      const result = await renderScreen();
      const fridgeProps = result.getByLabelText("Fridge").props as {
        accessibilityState?: { selected?: boolean };
      };
      expect(fridgeProps.accessibilityState?.selected).toBe(true);
    });
  });

  describe("review F3: idempotency key held across retaps, single-flight guard", () => {
    it("two Save taps in one frame produce exactly one createItem call, one key (review F3/F11)", async () => {
      const result = await renderScreen();
      fireEvent.changeText(result.getByLabelText("Item name"), "Double tap item");

      const calls: CreateItemRequestDto[] = [];
      const original = apiClient.createItem.bind(apiClient);
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        calls.push(input);
        return original(input);
      });

      const button = result.getByLabelText("Add to inventory");
      // No `await`/`flushPending` between these two: `saveInFlight` (a
      // `useRef`, not React state) must already be set by the time the
      // second press's synchronous handler body runs, same frame as the
      // first — the exact race `saving` (state) alone cannot close.
      fireEvent.press(button);
      fireEvent.press(button);
      await flushPending();

      expect(calls).toHaveLength(1);
      expect(replaced).toContain("/inventory");
      const items = await apiClient.getInventoryItems();
      expect(items.filter((item) => item.displayName === "Double tap item")).toHaveLength(1);
    });

    it("a failed save reuses the same key on a retap; the retap succeeds and creates exactly one item (review F3)", async () => {
      const result = await renderScreen();
      fireEvent.changeText(result.getByLabelText("Item name"), "Retry item");

      const calls: CreateItemRequestDto[] = [];
      const original = apiClient.createItem.bind(apiClient);
      let attempt = 0;
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        calls.push(input);
        attempt += 1;
        if (attempt === 1) {
          throw new Error("simulated network failure");
        }
        return original(input);
      });

      const button = result.getByLabelText("Add to inventory");
      fireEvent.press(button);
      await flushPending();
      expect(
        result.getByText(
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();
      expect(replaced).toEqual([]);

      // Nothing about the form changed since the failed attempt: the retap
      // must reuse the same idempotencyKey, not mint a fresh one.
      fireEvent.press(button);
      await flushPending();

      expect(calls).toHaveLength(2);
      expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
      expect(replaced).toContain("/inventory");
      const items = await apiClient.getInventoryItems();
      expect(items.filter((item) => item.displayName === "Retry item")).toHaveLength(1);
    });

    it("changing an input after a failed save discards the held key; the next Save mints a fresh one (review F3)", async () => {
      const result = await renderScreen();
      fireEvent.changeText(result.getByLabelText("Item name"), "Changed item");

      const calls: CreateItemRequestDto[] = [];
      const original = apiClient.createItem.bind(apiClient);
      let attempt = 0;
      vi.spyOn(apiClient, "createItem").mockImplementation(async (input) => {
        calls.push(input);
        attempt += 1;
        if (attempt === 1) {
          throw new Error("simulated network failure");
        }
        return original(input);
      });

      const button = result.getByLabelText("Add to inventory");
      fireEvent.press(button);
      await flushPending();

      // A real change to what Save would send: the amount stepper.
      fireEvent.press(result.getByLabelText("Increase quantity"));
      fireEvent.press(button);
      await flushPending();

      expect(calls).toHaveLength(2);
      expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);
    });
  });
});
