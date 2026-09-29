/**
 * S11 component tests (M3-T5), `app/shopping.tsx` against the real
 * `FixtureApiClient` (the default `apiClient` singleton under test, no
 * `EXPO_PUBLIC_API_URL`). `.test.ts`, not `.test.tsx`, same reason as the
 * other screen component tests (every element built with
 * `React.createElement`).
 *
 * Every test joins the Chen fixture household first
 * (`apiClient.joinHousehold(FIXTURE_JOIN_CODE)`), which also re-seeds a
 * fresh copy of the shopping fixture rows (`src/api/client.ts`'s
 * `createHousehold`/`joinHousehold` doc comment), so one test's check-off
 * never leaks into the next.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { apiClient, FIXTURE_JOIN_CODE } from "../api/client";

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
  vi.restoreAllMocks();
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  await apiClient.joinHousehold(FIXTURE_JOIN_CODE);
  const { default: ShoppingScreen } = await import("../../app/shopping");
  const result = render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(ShoppingScreen),
      React.createElement(ToastHost),
    ),
  );
  await flushPending();
  return result;
}

describe("S11 · shopping list (component)", () => {
  it("renders the header buy count and department groups from the fixture list", async () => {
    const result = await renderScreen();
    expect(result.getByText("Shopping")).toBeTruthy();
    expect(result.getByText("5")).toBeTruthy(); // 5 open rows
    expect(result.getByText("Meat & seafood")).toBeTruthy();
    expect(result.getByText("Produce")).toBeTruthy();
    expect(result.getByText("Pantry")).toBeTruthy();
    expect(result.getByText("Already have · skipped")).toBeTruthy();
  });

  it("renders the three origin forms verbatim", async () => {
    const result = await renderScreen();
    expect(result.getByText("need 2 lb · have 1.25 lb")).toBeTruthy(); // chicken (menu, partial stock)
    expect(result.getByText("miso salmon · none on hand")).toBeTruthy(); // broccoli (menu, none on hand)
    expect(
      result.getByText("suggested to go with the stir-fry · a proposal until you keep it"),
    ).toBeTruthy(); // garlic (AI)
    expect(result.getByText("added by Maya Chen · not tied to a menu")).toBeTruthy(); // paper towels (member)
  });

  it("renders the skip section's sufficient/tiered amounts", async () => {
    const result = await renderScreen();
    expect(result.getByText("~4 cups")).toBeTruthy(); // rice, ESTIMATED
    expect(result.getByText("sufficient")).toBeTruthy(); // soy sauce, no tier
  });

  it("checking off chicken breast shows the loop bar; Add appends a PURCHASE of 0.75 lb", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off"));
    await flushPending();

    expect(result.getByText("Chicken breast checked off · add it to the pantry?")).toBeTruthy();

    const before = await apiClient.getInventoryItem("fixture-item-chicken");
    expect(before?.summary.quantity.amount).toBe("1.250000");

    fireEvent.press(result.getByLabelText("Add Chicken breast to inventory"));
    await flushPending();

    const after = await apiClient.getInventoryItem("fixture-item-chicken");
    expect(after?.summary.quantity.amount).toBe("2");
    expect(after?.history.at(-1)?.type).toBe("PURCHASE");
    expect(after?.history.at(-1)?.deltaMicros).toBe("750000");
    expect(result.getByText("Chicken breast added to Fridge · inventory updated")).toBeTruthy();
    // The loop bar is gone once Add succeeds.
    expect(result.queryByText("Chicken breast checked off · add it to the pantry?")).toBeNull();
    // The buy count dropped by one.
    expect(result.getByText("4")).toBeTruthy();
  });

  it("checking off broccoli and tapping Add navigates to S9, prefilled", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Broccoli, not checked off"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Add Broccoli to inventory"));

    expect(pushed).toEqual([
      {
        pathname: "/add/manual",
        params: { name: "Broccoli", amount: "2", unit: "lb", location: "FRIDGE" },
      },
    ]);
  });

  it("Remove on garlic removes the row and shows its decline toast", async () => {
    const result = await renderScreen();
    expect(result.getByText("Garlic")).toBeTruthy();

    fireEvent.press(result.getByLabelText("Remove Garlic"));
    await flushPending();

    expect(result.queryByText("Garlic")).toBeNull();
    expect(result.getByText("Garlic removed · AI suggestion declined")).toBeTruthy();
  });

  it("the dev offline toggle shows the banner; a check-off made offline shows Queued; going back online replays and clears it", async () => {
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Simulate offline"));
    await flushPending();
    expect(result.getByText(/You're offline\./)).toBeTruthy();

    fireEvent.press(result.getByLabelText("Chicken breast, not checked off"));
    await flushPending();
    expect(result.getByText("Queued")).toBeTruthy();

    fireEvent.press(result.getByLabelText("Simulate back online"));
    await flushPending();

    expect(result.queryByText("Queued")).toBeNull();
    const after = await apiClient.getShoppingList();
    expect(after.rows.find((r) => r.rowId === "row-chicken")?.status).toBe("done");
  });

  it("a replay that fails (the confirming call rejects) keeps the Queued tag", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Simulate offline"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off"));
    await flushPending();
    expect(result.getByText("Queued")).toBeTruthy();

    vi.spyOn(apiClient, "checkOffShoppingRow").mockRejectedValueOnce(new Error("still down"));
    fireEvent.press(result.getByLabelText("Simulate back online"));
    await flushPending();

    expect(result.getByText("Queued")).toBeTruthy();
  });

  it("the empty list renders the copy-deck §7 S11 state, and Browse recipes reaches the Menu tab", async () => {
    vi.spyOn(apiClient, "getShoppingList").mockResolvedValueOnce({
      rows: [],
      members: [],
      syncedAt: "2026-09-29T12:00:00.000Z",
    });
    const result = await renderScreen();

    expect(result.getByText("Your shopping list is empty.")).toBeTruthy();
    fireEvent.press(result.getByLabelText("Browse recipes"));
    expect(pushed).toEqual(["/menu"]);
  });

  it("a load failure (HttpApiClient's not-available-yet rejection, or any other) shows the generic fallback with Try again", async () => {
    vi.spyOn(apiClient, "getShoppingList").mockRejectedValueOnce(new Error("boom"));
    const result = await renderScreen();

    expect(result.getByText("Couldn't load your shopping list.")).toBeTruthy();
    expect(result.getByLabelText("Try again")).toBeTruthy();
  });
});
