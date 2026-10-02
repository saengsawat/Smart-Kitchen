/**
 * S4 component tests, HTTP path (BACKLOG.md M2-T5 (c)): `app/inventory.tsx`
 * against a real `HttpApiClient` with a mocked global `fetch` (never a real
 * network call), the counterpart to `inventory-screen.test.ts`'s fixture
 * path. Pins the phone acceptance criterion: Confirm on Strawberries calls
 * the confirm endpoint, the tray drops the row on reload, and the toast reads
 * "Strawberries confirmed".
 *
 * The mocked server keeps one piece of state, whether the confirm has landed,
 * so the reload after Confirm reads what a real server would answer.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import type { InventoryItemSummaryDto, InventoryItemsResponseDto } from "@smart-kitchen/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "./Toast";

// Forces the screen (which imports the module-level `apiClient` singleton
// directly) onto a real HttpApiClient for this file, same pattern as
// item-detail-screen.test.ts / profile-screen-http.test.ts.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, apiClient: new actual.HttpApiClient("http://localhost:4000") };
});

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const STRAWBERRIES_ID = "0190f0a0-0000-7000-8000-0000000000a1";

function strawberries(confirmed: boolean): InventoryItemSummaryDto {
  return {
    itemId: STRAWBERRIES_ID,
    displayName: "Strawberries",
    productRef: null,
    ingredientRef: null,
    storageLocation: "FRIDGE",
    quantity: { unit: "lb", micros: "1000000", amount: "1" },
    earliestExpiresAt: null,
    provenance: {
      quantity: confirmed
        ? {
            tier: "KNOWN_FACT",
            source: "receipt read “ORG STRWB 1LB” · confirmed by DC",
            confidence: null,
            recordedAt: "2026-09-01T12:00:00.000Z",
          }
        : {
            tier: "AI_INTERPRETATION",
            source: "receipt read “ORG STRWB 1LB”",
            confidence: null,
            recordedAt: "2026-09-01T12:00:00.000Z",
          },
      earliestExpiresAt: null,
    },
    lots: [],
  };
}

interface FakeServer {
  readonly confirmCalls: string[];
  readonly listCalls: () => number;
}

/** GET the list (reflecting whether the confirm landed) and POST the confirm. */
function installServer(): FakeServer {
  let confirmed = false;
  let lists = 0;
  const confirmCalls: string[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      confirmCalls.push(url);
      confirmed = true;
      return Promise.resolve(
        new Response(JSON.stringify({ item: { summary: strawberries(true), history: [] } }), {
          status: 200,
        }),
      );
    }
    lists += 1;
    const body: InventoryItemsResponseDto = { items: [strawberries(confirmed)] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  return { confirmCalls, listCalls: () => lists };
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

describe("S4 · inventory list, HTTP path (M2-T5)", () => {
  it("shows the seeded receipt read in the confirmation tray before anything is confirmed", async () => {
    installServer();
    const result = await renderScreen();
    expect(result.getByText("Needs your confirmation")).toBeTruthy();
    expect(result.getAllByLabelText("Confirm Strawberries").length).toBeGreaterThan(0);
  });

  it("Confirm on Strawberries calls the confirm endpoint, drops the row from the tray on reload and toasts", async () => {
    const server = installServer();
    const result = await renderScreen();
    const listsBefore = server.listCalls();

    fireEvent.press(result.getAllByLabelText("Confirm Strawberries")[0]!);
    await flushPending();

    expect(server.confirmCalls).toEqual([
      `http://localhost:4000/v1/inventory/items/${STRAWBERRIES_ID}/confirm`,
    ]);
    expect(server.listCalls()).toBe(listsBefore + 1);
    expect(result.queryByText("Needs your confirmation")).toBeNull();
    expect(result.queryAllByLabelText("Confirm Strawberries")).toEqual([]);
    expect(result.getByText("Strawberries confirmed")).toBeTruthy();
    // The row itself stays on the list; only the tray (and its AI chip) go.
    expect(result.getAllByText("Strawberries").length).toBeGreaterThan(0);
  });
});
