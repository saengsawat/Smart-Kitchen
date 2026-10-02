/**
 * M2-T6 (d): S5's "Move to" over the real `HttpApiClient` with a mocked global
 * `fetch` (never a real network call): the POST path and body, the header and
 * history updating from the server's own answer, the toast, and the refusals.
 *
 * The mocked server keeps one piece of state, where the item is, so the
 * re-read after the move returns what a real server would.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import type {
  InventoryItemDetailDto,
  InventoryMoveEntryDto,
  MoveItemRequestDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { GENERIC_LEDGER_ERROR_MESSAGE, GENERIC_READ_ERROR_MESSAGE } from "./errors";
import { ToastHost, ToastProvider } from "./Toast";

const ITEM_ID = "0190f0a0-0000-7000-8000-0000000000c1";

vi.mock("react-native-safe-area-context", () => import("../test-support/safe-area-mock"));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, canGoBack: () => false, back: () => {} }),
  useLocalSearchParams: () => ({ itemId: "0190f0a0-0000-7000-8000-0000000000c1" }),
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

function detailAt(
  location: StorageLocationDto,
  moves: readonly InventoryMoveEntryDto[],
): InventoryItemDetailDto {
  return {
    summary: {
      itemId: ITEM_ID,
      displayName: "Corn",
      productRef: null,
      ingredientRef: null,
      storageLocation: location,
      quantity: { unit: "each", micros: "3000000", amount: "3" },
      earliestExpiresAt: null,
      provenance: {
        quantity: {
          tier: "KNOWN_FACT",
          source: "manual-entry",
          confidence: null,
          recordedAt: null,
        },
        earliestExpiresAt: null,
      },
      lots: [],
    },
    history: [
      {
        transactionId: "tx-initial",
        type: "INITIAL_STOCK",
        deltaMicros: "3000000",
        amount: "3",
        recordedAt: "2026-09-16T18:04:00.000Z",
        actor: { kind: "user", displayInitials: "DC" },
        provenance: {
          tier: "KNOWN_FACT",
          source: "manual-entry",
          confidence: null,
          recordedAt: null,
        },
        reason: null,
      },
      ...moves,
    ],
  };
}

const MOVED_TO_PANTRY: InventoryMoveEntryDto = {
  type: "MOVED",
  moveId: "move-1",
  fromLocation: "FRIDGE",
  toLocation: "PANTRY",
  recordedAt: "2026-10-01T12:00:00.000Z",
  actor: { kind: "user", displayInitials: "DC" },
};

interface FakeServer {
  readonly posts: { url: string; body: MoveItemRequestDto }[];
}

/** GET the detail (wherever the item is now) and POST the move. */
function installServer(options: { readonly refuse?: Response } = {}): FakeServer {
  let location: StorageLocationDto = "FRIDGE";
  const posts: { url: string; body: MoveItemRequestDto }[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string) as MoveItemRequestDto;
      posts.push({ url, body });
      if (options.refuse) return Promise.resolve(options.refuse);
      location = body.toLocation;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: detailAt(location, [{ ...MOVED_TO_PANTRY, toLocation: location }]),
          }),
          { status: 200 },
        ),
      );
    }
    const moves = location === "FRIDGE" ? [] : [{ ...MOVED_TO_PANTRY, toLocation: location }];
    return Promise.resolve(
      new Response(JSON.stringify(detailAt(location, moves)), { status: 200 }),
    );
  }) as typeof fetch;
  return { posts };
}

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

function locationLine(result: ReturnType<typeof render>): string {
  const node = result.getByText(/on hand/);
  const children = (node.props as { children: unknown }).children;
  return (Array.isArray(children) ? children : [children]).join("");
}

describe("S5 · Move to, HTTP path (M2-T6)", () => {
  it("Move to Pantry POSTs the move endpoint with the destination and a key, then shows the server's answer", async () => {
    const server = installServer();
    const result = await renderScreen();
    expect(locationLine(result)).toContain("Fridge");

    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();

    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.url).toBe(`http://localhost:4000/v1/inventory/items/${ITEM_ID}/move`);
    expect(Object.keys(server.posts[0]!.body).sort()).toEqual(["idempotencyKey", "toLocation"]);
    expect(server.posts[0]?.body.toLocation).toBe("PANTRY");
    expect(locationLine(result)).toContain("Pantry");
    expect(result.getAllByText("Moved to Pantry")).toHaveLength(2); // toast and history row
    expect(result.getByText("from Fridge")).toBeTruthy();
    expect(result.getByText("Initial stock")).toBeTruthy(); // the ledger row is still there
  });

  it("a history that already carries a MOVED entry renders it without any amount", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(detailAt("PANTRY", [MOVED_TO_PANTRY])), { status: 200 }),
      );
    const result = await renderScreen();
    expect(result.getByText("Moved to Pantry")).toBeTruthy();
    expect(result.getByText("from Fridge")).toBeTruthy();
    expect(locationLine(result)).toContain("Pantry");
    // The Why line narrates quantity from ledger rows only.
    const why = result.getByText(/^Why /).props as { children: unknown };
    expect(String(why.children)).toContain("Initial stock");
    expect(String(why.children)).not.toContain("Moved");
  });

  it.each([
    ["409 SAME_LOCATION", 409, { code: "SAME_LOCATION" }],
    ["404 NOT_FOUND", 404, { code: "NOT_FOUND" }],
    ["409 CONFLICT", 409, { code: "CONFLICT", ledgerCode: "IDEMPOTENCY_KEY_CONFLICT" }],
  ])(
    "a %s shows a toast, never the server sentence, and leaves the screen as it was",
    async (_case, status, error) => {
      installServer({
        refuse: new Response(
          JSON.stringify({ error: { ...error, message: "server sentence", correlationId: "c1" } }),
          { status },
        ),
      });
      const result = await renderScreen();

      fireEvent.press(result.getByLabelText("Move to Pantry"));
      await flushPending();

      expect(result.queryByText("server sentence")).toBeNull();
      expect(result.queryByText("Moved to Pantry")).toBeNull();
      expect(locationLine(result)).toContain("Fridge");
      expect(result.getByLabelText("Move to Pantry")).toBeTruthy();
      // Every code here maps to a fixed sentence from the §8 table, never the raw message.
      const shown =
        result.queryByText(GENERIC_LEDGER_ERROR_MESSAGE) ??
        result.queryByText(/That request was already used|Not found/);
      expect(shown).toBeTruthy();
    },
  );

  it("when the move lands but the re-read fails, says the read failed instead of claiming a failed save", async () => {
    let posted = false;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = true;
        return Promise.resolve(
          new Response(JSON.stringify({ item: detailAt("PANTRY", [MOVED_TO_PANTRY]) }), {
            status: 200,
          }),
        );
      }
      if (posted) return Promise.reject(new TypeError("Network request failed"));
      return Promise.resolve(new Response(JSON.stringify(detailAt("FRIDGE", [])), { status: 200 }));
    }) as typeof fetch;
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Move to Pantry"));
    await flushPending();

    expect(result.getByText(GENERIC_READ_ERROR_MESSAGE)).toBeTruthy();
    expect(result.queryByText(GENERIC_LEDGER_ERROR_MESSAGE)).toBeNull();
  });
});
