/**
 * M3-T9 (D-030): S4 row wording for a passed best-by, over a real
 * `HttpApiClient` with a mocked `fetch`. `.test.ts` with `createElement`, like
 * the sibling S4 tests.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InventoryItemSummaryDto, ProvenanceTierDto } from "@smart-kitchen/contracts";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "./Toast";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
}));
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, apiClient: new actual.HttpApiClient("http://localhost:4000") };
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const DAY = 24 * 60 * 60 * 1000;

/** A local-time instant: dayOffset calendar days from today at hh:mm local. */
function localAt(dayOffset: number, hh: number, mm: number): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + dayOffset, hh, mm).toISOString();
}

function milk(
  daysFromNow: number | string,
  tier: ProvenanceTierDto | null,
): InventoryItemSummaryDto {
  return {
    itemId: "0190f0a0-0000-7000-8000-0000000000b1",
    displayName: "Milk",
    productRef: null,
    ingredientRef: null,
    storageLocation: "FRIDGE",
    quantity: { unit: "l", micros: "1000000", amount: "1" },
    earliestExpiresAt:
      typeof daysFromNow === "string"
        ? daysFromNow
        : new Date(Date.now() + daysFromNow * DAY).toISOString(),
    provenance: {
      quantity: {
        tier: "KNOWN_FACT",
        source: "manual",
        confidence: null,
        recordedAt: "2026-09-01T12:00:00.000Z",
      },
      earliestExpiresAt: tier
        ? { tier, source: "label", confidence: null, recordedAt: "2026-09-01T12:00:00.000Z" }
        : null,
    },
    lots: [],
  };
}

async function renderWith(item: InventoryItemSummaryDto): Promise<ReturnType<typeof render>> {
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ items: [item] }), { status: 200 }));
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

describe("S4 · expiry wording (M3-T9, D-030)", () => {
  it("a past Known Fact date reads 'expired' (text and accessibility label)", async () => {
    const result = await renderWith(milk(-3, "KNOWN_FACT"));
    expect(result.getByText(/ · expired$/)).toBeTruthy();
    expect(result.getByLabelText(/^Milk, .*, expired,/)).toBeTruthy();
    expect(result.queryByText(/may be expired/)).toBeNull();
  });

  it.each(["ESTIMATED", "AI_INTERPRETATION", null] as const)(
    "a past %s date reads 'may be expired'",
    async (tier) => {
      const result = await renderWith(milk(-3, tier));
      expect(result.getByText(/ · may be expired$/)).toBeTruthy();
      expect(result.getByLabelText(/^Milk, .*, may be expired,/)).toBeTruthy();
    },
  );

  it.each([
    ["earlier today", localAt(0, 0, 1)],
    ["later today", localAt(0, 18, 0)],
    ["23:59 today", localAt(0, 23, 59)],
  ])("a best-by %s reads 'use today' (text and accessibility label)", async (_n, at) => {
    const result = await renderWith(milk(at, "ESTIMATED"));
    expect(result.getByText(/ · use today$/)).toBeTruthy();
    expect(result.getByLabelText(/^Milk, .*, use today,/)).toBeTruthy();
    expect(result.queryByText(/expired/)).toBeNull();
  });

  it.each([
    ["00:01 tomorrow", localAt(1, 0, 1)],
    ["23:59 tomorrow", localAt(1, 23, 59)],
  ])("a best-by %s reads 'tomorrow' (text and accessibility label)", async (_n, at) => {
    const result = await renderWith(milk(at, "ESTIMATED"));
    expect(result.getByText(/ · tomorrow$/)).toBeTruthy();
    expect(result.getByLabelText(/^Milk, .*, tomorrow,/)).toBeTruthy();
    expect(result.queryByText(/use today/)).toBeNull();
  });

  it("a best-by yesterday is past", async () => {
    const result = await renderWith(milk(localAt(-1, 23, 59), "KNOWN_FACT"));
    expect(result.getByText(/ · expired$/)).toBeTruthy();
  });
});
