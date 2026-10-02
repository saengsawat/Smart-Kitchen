/**
 * S5 component tests (M3-T4a Objective (e)): `app/inventory/[itemId].tsx`
 * against a real `HttpApiClient` with a mocked global `fetch` (never a real
 * network call), covering the pre-redirect frame, a correction round trip
 * (request body, idempotency-key reuse on a simulated retry, the success
 * toast surviving into the shared `ToastHost`, and the failure copy), and
 * Confirm reachable from S5 for an AI-tier item.
 *
 * `.test.ts`, not `.test.tsx`: every element below is built with
 * `React.createElement`, matching the root `vitest.config.ts` include glob
 * with no changes to it.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InventoryItemDetailDto,
  InventoryWriteRequestDto,
  InventoryWriteResponseDto,
} from "@smart-kitchen/contracts";
import { GENERIC_LEDGER_ERROR_MESSAGE } from "./errors";
import { flushPending } from "../test-support/flush";
import { ToastHost, ToastProvider } from "./Toast";
import { setMockBottomInset } from "../test-support/safe-area-mock";
import { tabBarClearanceFor } from "../navigation/TabBar";

const ITEM_ID = "fixture-item-strawberries"; // known to the HttpApiClient's internal fixture delegate too (confirmAiProposal)

let searchParams: { itemId: string } = { itemId: ITEM_ID };

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => searchParams,
}));

// Forces the screen (which imports the module-level `apiClient` singleton
// directly) onto a real HttpApiClient for this file, without touching
// `process.env` (apps/mobile's eslint config restricts the bare `process`
// global to `src/config/env.ts`/`src/lint-rules/**` only — this sidesteps
// that entirely rather than adding a further exempted file).
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, apiClient: new actual.HttpApiClient("http://localhost:4000") };
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  searchParams = { itemId: ITEM_ID };
});

function sampleDetail(tier: "KNOWN_FACT" | "AI_INTERPRETATION"): InventoryItemDetailDto {
  return {
    summary: {
      itemId: ITEM_ID,
      displayName: "Strawberries",
      productRef: null,
      ingredientRef: null,
      storageLocation: "FRIDGE",
      quantity: { unit: "lb", micros: "1250000", amount: "1.250000" },
      earliestExpiresAt: null,
      provenance: {
        quantity: { tier, source: "vision-estimate", confidence: null, recordedAt: null },
        earliestExpiresAt: null,
      },
      lots: [],
    },
    history: [
      {
        transactionId: "tx-initial",
        type: "PURCHASE",
        deltaMicros: "1250000",
        amount: "1.250000",
        recordedAt: "2026-09-16T18:04:00.000Z",
        actor: { kind: "user", displayInitials: "DC" },
        provenance: { tier, source: "vision-estimate", confidence: null, recordedAt: null },
        reason: null,
      },
    ],
  };
}

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: Screen } = await import("../../app/inventory/[itemId]");
  return render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(Screen),
      React.createElement(ToastHost),
    ),
  );
}

describe("S5 · item detail (component)", () => {
  it("renders safely on the pre-redirect frame, never crashing before the detail GET resolves", async () => {
    globalThis.fetch = () => new Promise(() => {}); // never resolves in this test
    await expect(renderScreen()).resolves.toBeTruthy();
  });

  it("shows real history once the detail GET resolves", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }));
    const result = await renderScreen();
    await flushPending();
    expect(result.getByText("Strawberries")).toBeTruthy();
    // The "why" line is one Text node holding the whole narrative
    // (buildWhyLine), so this matches a substring of it, not the node's
    // full (exact) text content.
    expect(result.getByText(/Purchased · \+1\.25 lb · Sep 16 · vision-estimate\./)).toBeTruthy();
  });

  describe("correction round trip", () => {
    it("a correction lands as one ADJUSTMENT, reuses the same idempotency key on a simulated retry, and shows the success toast", async () => {
      const bodies: string[] = [];
      let postCalls = 0;
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postCalls += 1;
          bodies.push(init.body as string);
          if (postCalls === 1) {
            return Promise.reject(new Error("network down"));
          }
          const row = {
            transactionId: "tx-correction",
            type: "ADJUSTMENT" as const,
            deltaMicros: "250000",
            amount: "0.250000",
            recordedAt: "2026-09-20T12:00:00.000Z",
            actor: { kind: "user" as const, displayInitials: "DC" },
            provenance: {
              tier: "KNOWN_FACT" as const,
              source: "one-tap correction",
              confidence: null,
              recordedAt: null,
            },
            reason: null,
          };
          const response: InventoryWriteResponseDto = {
            transactions: [row],
            item: { summary: sampleDetail("KNOWN_FACT").summary, history: [row] },
            replayed: false,
          };
          return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }),
        );
      }) as typeof fetch;

      const result = await renderScreen();
      await flushPending();

      fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
      fireEvent.press(result.getByLabelText("Save correction"));
      await flushPending();

      expect(postCalls).toBe(2); // one network failure, one retry
      const keys = bodies.map((b) => (JSON.parse(b) as { idempotencyKey: string }).idempotencyKey);
      expect(keys[0]).toBe(keys[1]); // never re-minted on retry
      const firstBody = JSON.parse(bodies[0]!) as { type: string; targetAmount: string };
      expect(firstBody.type).toBe("ADJUSTMENT");
      expect(firstBody.targetAmount).toBe("1.500000");

      expect(result.getByText("Corrected. Undo")).toBeTruthy();
    });

    it("a coded refusal (e.g. ZERO_DELTA) renders its copy-deck.md §8 sentence, never the domain message", async () => {
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "BAD_REQUEST",
                  message: "internal domain message, never shown",
                  correlationId: "c1",
                  ledgerCode: "ZERO_DELTA",
                },
              }),
              { status: 400 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }),
        );
      }) as typeof fetch;

      const result = await renderScreen();
      await flushPending();
      fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
      fireEvent.press(result.getByLabelText("Save correction"));
      await flushPending();

      expect(result.getByText("Enter an amount to record a change.")).toBeTruthy();
      expect(result.queryByText("internal domain message, never shown")).toBeNull();
    });

    it("a persistent network failure renders the generic fallback copy", async () => {
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.reject(new Error("network down"));
        }
        return Promise.resolve(
          new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }),
        );
      }) as typeof fetch;

      const result = await renderScreen();
      await flushPending();
      fireEvent.press(result.getByLabelText("Increase quantity by 0.25"));
      fireEvent.press(result.getByLabelText("Save correction"));
      await flushPending();

      expect(
        result.getByText(
          "Something went wrong saving that. Try again, and tell us if it keeps happening.",
        ),
      ).toBeTruthy();
    });
  });

  describe("removal + Undo toast survives the S5 to S4 navigation (Objective (f))", () => {
    it("appends the mapped type, and the toast (with a working Undo) survives a simulated navigation away from S5", async () => {
      const postBodies: { url: string; body: InventoryWriteRequestDto }[] = [];
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postBodies.push({
            url,
            body: JSON.parse(init.body as string) as InventoryWriteRequestDto,
          });
          const isUndo = url.endsWith("/undo");
          const row = {
            transactionId: isUndo ? "tx-undo" : "tx-discard",
            type: isUndo ? ("ADJUSTMENT" as const) : ("DISCARD" as const),
            deltaMicros: isUndo ? "1250000" : "-1250000",
            amount: isUndo ? "1.250000" : "-1.250000",
            recordedAt: "2026-09-20T12:00:00.000Z",
            actor: { kind: "user" as const, displayInitials: "DC" },
            provenance: {
              tier: "KNOWN_FACT" as const,
              source: "manual-entry",
              confidence: null,
              recordedAt: null,
            },
            reason: isUndo ? "undo:tx-discard" : "Spoiled",
          };
          const response: InventoryWriteResponseDto = {
            transactions: [row],
            item: { summary: sampleDetail("KNOWN_FACT").summary, history: [row] },
            replayed: false,
          };
          return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }),
        );
      }) as typeof fetch;

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

      fireEvent.press(result.getByLabelText("Discard"));
      fireEvent.press(result.getByLabelText("Spoiled"));
      await flushPending();

      const removalCall = postBodies.find((c) => !c.url.endsWith("/undo"));
      expect(removalCall?.body.type).toBe("DISCARD");
      expect(removalCall?.body.reason).toBe("Spoiled");
      expect(removalCall?.body.amount).toBeUndefined(); // whole on-hand quantity

      expect(result.getByText("Discarded. Undo")).toBeTruthy();

      // Simulated route change: S5 unmounts (the removal navigates back to
      // S4), but ToastProvider/ToastHost are the layout's, not the screen's.
      result.rerender(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(Text, null, "Screen S4 (stand-in)"),
          React.createElement(ToastHost),
        ),
      );
      expect(result.queryByLabelText("Discard")).toBeNull(); // S5 is gone
      expect(result.getByText("Discarded. Undo")).toBeTruthy(); // toast survived

      fireEvent.press(result.getByLabelText("Undo"));
      await flushPending();

      const undoCall = postBodies.find((c) => c.url.endsWith("/undo"));
      expect(undoCall?.url).toContain(`/items/${ITEM_ID}/transactions/tx-discard/undo`);
    });
  });

  describe("Confirm (Objective (g))", () => {
    it("is reachable from S5 for an AI-tier item, same label as the tray", async () => {
      let getCalls = 0;
      const confirmUrls: string[] = [];
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        // M2-T5: Confirm is a real POST now (`{ item }` envelope), no longer
        // the fixture delegate (BUG-004 stubbed it while there was no endpoint).
        if (init?.method === "POST") {
          confirmUrls.push(url);
          return Promise.resolve(
            new Response(JSON.stringify({ item: sampleDetail("KNOWN_FACT") }), { status: 200 }),
          );
        }
        getCalls += 1;
        const tier = getCalls === 1 ? "AI_INTERPRETATION" : "KNOWN_FACT";
        return Promise.resolve(new Response(JSON.stringify(sampleDetail(tier)), { status: 200 }));
      }) as typeof fetch;

      const result = await renderScreen();
      await flushPending();
      expect(result.getByText("Needs your confirmation")).toBeTruthy();
      const confirmButton = result.getByLabelText("Confirm Strawberries");
      fireEvent.press(confirmButton);
      await flushPending();

      expect(confirmUrls).toEqual([
        `http://localhost:4000/v1/inventory/items/${encodeURIComponent(ITEM_ID)}/confirm`,
      ]);
      expect(result.queryByText("Needs your confirmation")).toBeNull();
    });

    it("a failed confirm shows the generic ledger fallback, marks nothing confirmed, does not re-read, leaks no rejection (BUG-004)", async () => {
      let getCalls = 0;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        // M2-T5: the real endpoint refuses (here a 409 NOT_A_PROPOSAL, the
        // answer a stale screen gets); the client rejects with the code.
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "NOT_A_PROPOSAL", message: "server sentence", correlationId: "c1" },
              }),
              { status: 409 },
            ),
          );
        }
        getCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify(sampleDetail("AI_INTERPRETATION")), { status: 200 }),
        );
      }) as typeof fetch;

      // vitest fails the run on an unhandled rejection (apps/mobile lint bans
      // the `process` global for our own listener).
      const result = await renderScreen();
      await flushPending();
      expect(result.getByText("Needs your confirmation")).toBeTruthy();
      const getsBefore = getCalls;

      fireEvent.press(result.getByLabelText("Confirm Strawberries"));
      await flushPending(5);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(result.getByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeTruthy();
      expect(result.queryByText("server sentence")).toBeNull();
      expect(result.getByText("Needs your confirmation")).toBeTruthy();
      expect(getCalls).toBe(getsBefore);
    });
  });
});

/** BUG-003: the clearance helpers shared by the per-screen padding tests. */
function contentPaddingBottom(result: ReturnType<typeof render>): unknown {
  const scroll = result.UNSAFE_getByType("ScrollView" as unknown as React.ComponentType);
  const list: readonly unknown[] = Array.isArray(scroll.props.contentContainerStyle)
    ? scroll.props.contentContainerStyle
    : [scroll.props.contentContainerStyle];
  const flat: Record<string, unknown> = {};
  for (const entry of list) {
    if (entry && typeof entry === "object") Object.assign(flat, entry);
  }
  return flat.paddingBottom;
}

describe("S5 · tab bar clearance (BUG-003)", () => {
  it("pads the scroll content by the tab bar's footprint for a non-zero bottom inset", async () => {
    setMockBottomInset(34);
    try {
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(sampleDetail("KNOWN_FACT")), { status: 200 }));
      const result = await renderScreen();
      await flushPending();
      expect(contentPaddingBottom(result)).toBe(tabBarClearanceFor(34));
      expect(tabBarClearanceFor(34)).toBe(134);
    } finally {
      setMockBottomInset(0);
    }
  });
});
