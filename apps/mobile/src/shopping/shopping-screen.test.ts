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
 *
 * `sharedShoppingQueue` (review round 1, F1) is a *module* singleton by
 * design — that is exactly the fix — so, unlike `shoppingRows`, it is
 * **not** reset by `joinHousehold`. `afterEach` below clears it and resets
 * `apiClient`'s dev-only offline flag explicitly, so a test that leaves a
 * failed entry queued (or the client offline) cannot leak into the next
 * test in this file.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "../inventory/Toast";
import { apiClient, FIXTURE_JOIN_CODE, hasDevOfflineToggle } from "../api/client";
import { sharedShoppingQueue } from "./shared-queue";

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
  sharedShoppingQueue.clear();
  if (hasDevOfflineToggle(apiClient) && apiClient.isOffline()) {
    apiClient.setOfflineForDev(false);
  }
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

  it("a load failure (HttpApiClient's not-available-yet rejection, or any other) shows the generic *read* fallback with Try again (review F13)", async () => {
    vi.spyOn(apiClient, "getShoppingList").mockRejectedValueOnce(new Error("boom"));
    const result = await renderScreen();

    expect(result.getByText("Couldn't load your shopping list.")).toBeTruthy();
    // F13: "saving that" is wrong for a read failure.
    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
    expect(result.getByLabelText("Try again")).toBeTruthy();
  });
});

describe("S11 review round 1 fixes", () => {
  it("F1: an offline check-off survives an unmount/remount, still Queued, and replays once going online", async () => {
    const first = await renderScreen();
    fireEvent.press(first.getByLabelText("Simulate offline"));
    await flushPending();
    fireEvent.press(first.getByLabelText("Chicken breast, not checked off"));
    await flushPending();
    expect(first.getByText("Queued")).toBeTruthy();

    first.unmount();

    // Remount without rejoining the household (a real route change does
    // not re-run onboarding): the same apiClient/sharedShoppingQueue.
    const { default: ShoppingScreen } = await import("../../app/shopping");
    const second = render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ShoppingScreen),
        React.createElement(ToastHost),
      ),
    );
    await flushPending();

    expect(second.getByLabelText("Chicken breast, checked off")).toBeTruthy();
    expect(second.getByText("Queued")).toBeTruthy();

    const checkOffSpy = vi.spyOn(apiClient, "checkOffShoppingRow");
    fireEvent.press(second.getByLabelText("Simulate back online"));
    await flushPending();

    expect(second.queryByText("Queued")).toBeNull();
    expect(checkOffSpy).toHaveBeenCalledTimes(1);
    const after = await apiClient.getShoppingList();
    expect(after.rows.find((r) => r.rowId === "row-chicken")?.status).toBe("done");

    second.unmount();
  });

  it("F2: a new online tap on a row with a still-failed queued entry replaces it (replaying immediately) rather than a stale entry later resurrecting the row", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Simulate offline"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off")); // K1: checked=true
    await flushPending();

    // Go online: the automatic replay of K1 fails once.
    vi.spyOn(apiClient, "checkOffShoppingRow").mockRejectedValueOnce(new Error("still down"));
    fireEvent.press(result.getByLabelText("Simulate back online"));
    await flushPending();
    expect(result.getByText("Queued")).toBeTruthy(); // K1 still queued (failed)

    // Still online: the user unchecks the row. This must replace K1 (not
    // bypass it with a direct call), and replay immediately.
    fireEvent.press(result.getByLabelText("Chicken breast, checked off"));
    await flushPending();

    expect(result.queryByText("Queued")).toBeNull();
    expect(result.getByLabelText("Chicken breast, not checked off")).toBeTruthy();

    // A later connectivity flap must find nothing stale left to replay.
    fireEvent.press(result.getByLabelText("Simulate offline"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Simulate back online"));
    await flushPending();

    expect(result.queryByText("Queued")).toBeNull();
    const after = await apiClient.getShoppingList();
    // Server and client agree: open, never resurrected back to done.
    expect(after.rows.find((r) => r.rowId === "row-chicken")?.status).toBe("open");
    expect(result.getByLabelText("Chicken breast, not checked off")).toBeTruthy();
  });

  it("F3: two presses of Add before the first settles append only one PURCHASE", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off"));
    await flushPending();

    const before = await apiClient.getInventoryItem("fixture-item-chicken");
    const historyLengthBefore = before!.history.length;

    // Two presses, no await/flush in between (before the first settles).
    fireEvent.press(result.getByLabelText("Add Chicken breast to inventory"));
    fireEvent.press(result.getByLabelText("Add Chicken breast to inventory"));
    await flushPending();

    const after = await apiClient.getInventoryItem("fixture-item-chicken");
    expect(after!.history.length).toBe(historyLengthBefore + 1);
  });

  it("F3: Add, uncheck, re-check, Add appends only one PURCHASE total (buyMicros is a fixed fact of the row, not a live remaining gap)", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Add Chicken breast to inventory"));
    await flushPending();

    const afterFirstAdd = await apiClient.getInventoryItem("fixture-item-chicken");
    const historyLengthAfterFirstAdd = afterFirstAdd!.history.length;

    fireEvent.press(result.getByLabelText("Chicken breast, checked off")); // uncheck
    await flushPending();
    fireEvent.press(result.getByLabelText("Chicken breast, not checked off")); // re-check
    await flushPending();
    fireEvent.press(result.getByLabelText("Add Chicken breast to inventory"));
    await flushPending();

    const after = await apiClient.getInventoryItem("fixture-item-chicken");
    expect(after!.history.length).toBe(historyLengthAfterFirstAdd);
  });

  it("F5: the rendered buy amount comes from buyMicros alone, not a client-computed need-minus-have (a deliberately mismatched DTO)", async () => {
    vi.spyOn(apiClient, "getShoppingList").mockResolvedValueOnce({
      rows: [
        {
          rowId: "row-mismatch",
          name: "Mismatch item",
          group: "Pantry",
          origin: { kind: "menu", label: "Tonight", recipeName: null },
          needMicros: "2000000",
          haveMicros: "1250000",
          haveTier: "KNOWN_FACT",
          // Deliberately NOT need - have (which would be 750000): a mutant
          // that swapped this back to a client-computed value must fail.
          buyMicros: "1000000",
          unit: "lb",
          itemId: null,
          status: "open",
          checkedOffBy: null,
          defaultLocation: "FRIDGE",
        },
      ],
      members: [],
      syncedAt: "2026-09-29T12:00:00.000Z",
    });
    const result = await renderScreen();
    expect(result.getByText("1 lb")).toBeTruthy();
    expect(result.queryByText("0.75 lb")).toBeNull();
  });

  it("F10: while offline, a no-itemId row's loop bar also refuses inline and never navigates", async () => {
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Simulate offline"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Broccoli, not checked off"));
    await flushPending();

    expect(result.getByText("Broccoli checked off · add it to the pantry?")).toBeTruthy();
    expect(result.getByText("Add when you're back online.")).toBeTruthy();
    expect(result.queryByLabelText("Add Broccoli to inventory")).toBeNull();
    expect(pushed).toEqual([]);
  });

  it("F9: a no-itemId row's Add passes the exact decimal amount to S9, never rounded or truncated", async () => {
    vi.spyOn(apiClient, "getShoppingList").mockResolvedValueOnce({
      rows: [
        {
          rowId: "row-half",
          name: "Half a pound of something",
          group: "Pantry",
          origin: { kind: "menu", label: "Tonight", recipeName: null },
          needMicros: "500000",
          haveMicros: "0",
          haveTier: null,
          buyMicros: "500000", // exactly 0.5 lb
          unit: "lb",
          itemId: null,
          status: "open",
          checkedOffBy: null,
          defaultLocation: "PANTRY",
        },
      ],
      members: [],
      syncedAt: "2026-09-29T12:00:00.000Z",
    });
    // "row-half" is not a row the real FixtureApiClient's own shoppingRows
    // map knows about (this test's list is a synthetic mock), so its
    // checkOffShoppingRow must be stubbed too, or the real fixture would
    // reject an unknown rowId and the optimistic check-off would revert.
    vi.spyOn(apiClient, "checkOffShoppingRow").mockResolvedValueOnce(undefined);
    const result = await renderScreen();
    fireEvent.press(result.getByLabelText("Half a pound of something, not checked off"));
    await flushPending();
    fireEvent.press(result.getByLabelText("Add Half a pound of something to inventory"));

    expect(pushed).toEqual([
      {
        pathname: "/add/manual",
        params: {
          name: "Half a pound of something",
          amount: "0.5",
          unit: "lb",
          location: "PANTRY",
        },
      },
    ]);
  });

  it("F11: the dev offline toggle is absent when __DEV__ is false (a release build)", async () => {
    const globalWithDev = globalThis as unknown as { __DEV__?: boolean };
    const original = globalWithDev.__DEV__;
    globalWithDev.__DEV__ = false;
    try {
      const result = await renderScreen();
      expect(result.queryByLabelText("Simulate offline")).toBeNull();
      expect(result.queryByLabelText("Simulate back online")).toBeNull();
    } finally {
      globalWithDev.__DEV__ = original;
    }
  });
});
