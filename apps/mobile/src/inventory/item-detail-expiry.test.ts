/**
 * M3-T9 (D-030): S5 lot caption wording for a passed best-by, over a real
 * `HttpApiClient` with a mocked `fetch`.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InventoryItemDetailDto, ProvenanceTierDto } from "@smart-kitchen/contracts";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "./Toast";

const ITEM_ID = "fixture-item-strawberries";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: "fixture-item-strawberries" }),
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

function detail(daysFromNow: number, tier: ProvenanceTierDto | null): InventoryItemDetailDto {
  const expiresAt = new Date(Date.now() + daysFromNow * DAY).toISOString();
  const expiresAtProvenance = tier
    ? { tier, source: "label", confidence: null, recordedAt: "2026-09-01T12:00:00.000Z" }
    : null;
  return {
    summary: {
      itemId: ITEM_ID,
      displayName: "Strawberries",
      productRef: null,
      ingredientRef: null,
      storageLocation: "FRIDGE",
      quantity: { unit: "lb", micros: "1000000", amount: "1" },
      earliestExpiresAt: expiresAt,
      provenance: {
        quantity: {
          tier: "KNOWN_FACT",
          source: "manual",
          confidence: null,
          recordedAt: "2026-09-01T12:00:00.000Z",
        },
        earliestExpiresAt: expiresAtProvenance,
      },
      lots: [
        {
          lotId: "lot-1",
          label: "Bought Sep 1",
          acquiredAt: "2026-09-01T12:00:00.000Z",
          quantity: { unit: "lb", micros: "1000000", amount: "1" },
          expiresAt,
          expiresAtProvenance,
        },
      ],
    },
    history: [],
  };
}

async function renderWith(d: InventoryItemDetailDto): Promise<ReturnType<typeof render>> {
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(d), { status: 200 }));
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

describe("S5 · lot expiry wording (M3-T9, D-030)", () => {
  it("a past Known Fact lot reads '{label} · expired'", async () => {
    const result = await renderWith(detail(-3, "KNOWN_FACT"));
    expect(result.getByText("Bought Sep 1 · expired")).toBeTruthy();
  });

  it.each(["ESTIMATED", "AI_INTERPRETATION", null] as const)(
    "a past %s lot reads '{label} · may be expired'",
    async (tier) => {
      const result = await renderWith(detail(-3, tier));
      expect(result.getByText("Bought Sep 1 · may be expired")).toBeTruthy();
    },
  );

  it("a lot expiring later today still reads 'expires today'", async () => {
    const result = await renderWith(detail(0.5, "ESTIMATED"));
    expect(result.getByText("Bought Sep 1 · expires today")).toBeTruthy();
  });
});
