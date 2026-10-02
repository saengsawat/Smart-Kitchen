/**
 * `moveItem` on both clients (M2-T6, D-024 row 1).
 *
 * `FixtureApiClient`: the in-memory move sets the location and appends a
 * `MOVED` history entry, and never touches a ledger row or a quantity.
 * `HttpApiClient`: the real `POST /v1/inventory/items/{id}/move` with a mocked
 * `fetch` (never a real network call): path, bearer, the body, one key reused
 * on the retry, coded refusals, and the summary cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InventoryItemDetailDto,
  InventoryItemSummaryDto,
  InventoryItemsResponseDto,
  InventoryMoveEntryDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import { INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import { isMoveEntry, ledgerRowsOf } from "../inventory/history";
import { LedgerRefusedError, messageForLedgerError } from "../inventory/errors";
import { FIXTURE_IDENTITY_TOKEN, FixtureApiClient, HttpApiClient } from "./client";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function moves(detail: InventoryItemDetailDto | null): InventoryMoveEntryDto[] {
  return (detail?.history ?? []).filter(isMoveEntry);
}

describe("FixtureApiClient.moveItem (M2-T6)", () => {
  it("moves the item: the location changes and the list shows it there", async () => {
    const client = FixtureApiClient.returningUser();
    await client.moveItem("fixture-item-eggs", "PANTRY");

    const detail = await client.getInventoryItem("fixture-item-eggs");
    expect(detail?.summary.storageLocation).toBe("PANTRY");
    const list = await client.getInventoryItems();
    expect(list.find((item) => item.itemId === "fixture-item-eggs")?.storageLocation).toBe(
      "PANTRY",
    );
  });

  it("appends one MOVED entry after the ledger rows, with initials and no amount", async () => {
    const client = FixtureApiClient.returningUser();
    const before = await client.getInventoryItem("fixture-item-eggs");
    await client.moveItem("fixture-item-eggs", "PANTRY");
    const after = await client.getInventoryItem("fixture-item-eggs");

    expect(after?.history).toHaveLength((before?.history.length ?? 0) + 1);
    const last = after?.history.at(-1);
    expect(last).toMatchObject({
      type: "MOVED",
      fromLocation: "FRIDGE",
      toLocation: "PANTRY",
      actor: { kind: "user", displayInitials: "DC" },
    });
    expect(Object.keys(last ?? {})).not.toContain("amount");
    expect(Object.keys(last ?? {})).not.toContain("deltaMicros");
  });

  it("changes no quantity and no ledger row: every ledger row and the summary quantity are unchanged", async () => {
    const client = FixtureApiClient.returningUser();
    const before = await client.getInventoryItem("fixture-item-eggs");
    await client.moveItem("fixture-item-eggs", "FREEZER");
    await client.moveItem("fixture-item-eggs", "OTHER");
    const after = await client.getInventoryItem("fixture-item-eggs");

    expect(ledgerRowsOf(after?.history ?? [])).toEqual(ledgerRowsOf(before?.history ?? []));
    expect(after?.summary.quantity).toEqual(before?.summary.quantity);
    expect(after?.summary.lots).toEqual(before?.summary.lots);
    expect(after?.summary.provenance).toEqual(before?.summary.provenance);
  });

  it("two moves leave two entries, each recording where it came from", async () => {
    const client = FixtureApiClient.returningUser();
    await client.moveItem("fixture-item-eggs", "PANTRY");
    await client.moveItem("fixture-item-eggs", "FREEZER");
    const detail = await client.getInventoryItem("fixture-item-eggs");
    expect(moves(detail).map((entry) => [entry.fromLocation, entry.toLocation])).toEqual([
      ["FRIDGE", "PANTRY"],
      ["PANTRY", "FREEZER"],
    ]);
  });

  it.each<StorageLocationDto>(["FRIDGE", "FREEZER", "PANTRY", "OTHER"])(
    "%s is a reachable destination",
    async (location) => {
      const client = FixtureApiClient.returningUser();
      // Olive oil lives in the Pantry; go via OTHER so every target differs from its start.
      await client.moveItem("fixture-item-olive-oil", "OTHER");
      if (location === "OTHER") return;
      await client.moveItem("fixture-item-olive-oil", location);
      expect(
        (await client.getInventoryItem("fixture-item-olive-oil"))?.summary.storageLocation,
      ).toBe(location);
    },
  );

  it("refuses a move to where the item already is with SAME_LOCATION, changing nothing", async () => {
    const client = FixtureApiClient.returningUser();
    const before = await client.getInventoryItem("fixture-item-eggs");
    const error = await client
      .moveItem("fixture-item-eggs", "FRIDGE")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LedgerRefusedError);
    expect((error as LedgerRefusedError).code).toBe("SAME_LOCATION");
    expect(await client.getInventoryItem("fixture-item-eggs")).toEqual(before);
  });

  it("rejects an unknown item", async () => {
    const client = FixtureApiClient.returningUser();
    await expect(client.moveItem("not-a-real-item", "PANTRY")).rejects.toThrow();
  });

  it("the Why narrative's input is unchanged: moves never reach the ledger rows a quantity is explained from", async () => {
    const client = FixtureApiClient.returningUser();
    await client.moveItem("fixture-item-chicken", "FREEZER");
    const detail = await client.getInventoryItem("fixture-item-chicken");
    expect(ledgerRowsOf(detail?.history ?? []).map((row) => row.amount)).toEqual([
      "2",
      "-2.250000",
      "0.250000",
      "1.250000",
    ]);
  });
});

describe("HttpApiClient.moveItem (M2-T6: real POST /v1/inventory/items/{id}/move, mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const FRIDGE_ROW: InventoryItemSummaryDto = {
    itemId: "item-corn",
    displayName: "Corn",
    productRef: null,
    ingredientRef: null,
    storageLocation: "FRIDGE",
    quantity: { unit: "each", micros: "3000000", amount: "3" },
    earliestExpiresAt: null,
    provenance: { quantity: null, earliestExpiresAt: null },
    lots: [],
  };
  const PANTRY_ROW: InventoryItemSummaryDto = { ...FRIDGE_ROW, storageLocation: "PANTRY" };
  const OTHER_ROW: InventoryItemSummaryDto = {
    ...FRIDGE_ROW,
    itemId: "item-other",
    displayName: "Rice",
  };
  const LIST: InventoryItemsResponseDto = { items: [OTHER_ROW, FRIDGE_ROW] };

  function movedResponse(): Response {
    return new Response(JSON.stringify({ item: { summary: PANTRY_ROW, history: [] } }), {
      status: 200,
    });
  }

  function refused(status: number, code: string, ledgerCode?: string): Response {
    return new Response(
      JSON.stringify({
        error: {
          code,
          message: "server sentence",
          correlationId: "c1",
          ...(ledgerCode === undefined ? {} : { ledgerCode }),
        },
      }),
      { status },
    );
  }

  function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
    return JSON.parse((init?.body as string | undefined) ?? "{}") as Record<string, unknown>;
  }

  it("POSTs the item's move path with the bearer and a body of only the destination and a fresh client key", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(movedResponse());
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.moveItem("item-corn", "PANTRY");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:4000/v1/inventory/items/item-corn/move");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
    );
    const body = bodyOf(calls[0]?.init);
    expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "toLocation"]);
    expect(body["toLocation"]).toBe("PANTRY");
    expect(body["idempotencyKey"]).toMatch(UUID_SHAPE);
  });

  it("mints a new key for each move", async () => {
    const keys: string[] = [];
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      keys.push(bodyOf(init)["idempotencyKey"] as string);
      return Promise.resolve(movedResponse());
    }) as typeof fetch;
    const client = new HttpApiClient("http://localhost:4000");
    await client.moveItem("item-corn", "PANTRY");
    await client.moveItem("item-corn", "FREEZER");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("goes to the network even for a fixture item id, never to the internal fixture delegate", async () => {
    let called = 0;
    globalThis.fetch = () => {
      called += 1;
      return Promise.resolve(refused(404, "NOT_FOUND"));
    };
    const client = new HttpApiClient("http://localhost:4000");
    const delegate = (client as unknown as { delegate: FixtureApiClient }).delegate;
    const delegateSpy = vi.spyOn(delegate, "moveItem");
    await expect(client.moveItem("fixture-item-eggs", "PANTRY")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(called).toBe(1);
    expect(delegateSpy).not.toHaveBeenCalled();
  });

  it("retries one network failure with the same client key", async () => {
    const keys: string[] = [];
    let attempt = 0;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      attempt += 1;
      keys.push(bodyOf(init)["idempotencyKey"] as string);
      if (attempt === 1) return Promise.reject(new TypeError("Network request failed"));
      return Promise.resolve(movedResponse());
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.moveItem("item-corn", "PANTRY");

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("gives up after the one retry and rejects with the network error", async () => {
    let attempt = 0;
    globalThis.fetch = () => {
      attempt += 1;
      return Promise.reject(new TypeError("Network request failed"));
    };
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.moveItem("item-corn", "PANTRY")).rejects.toThrow("Network request failed");
    expect(attempt).toBe(2);
  });

  it.each([
    ["409 SAME_LOCATION", 409, "SAME_LOCATION", undefined, "SAME_LOCATION"],
    [
      "409 CONFLICT carrying its ledger code",
      409,
      "CONFLICT",
      "IDEMPOTENCY_KEY_CONFLICT",
      "IDEMPOTENCY_KEY_CONFLICT",
    ],
    ["404 NOT_FOUND", 404, "NOT_FOUND", undefined, "NOT_FOUND"],
    ["401 UNAUTHENTICATED", 401, "UNAUTHENTICATED", undefined, "UNAUTHENTICATED"],
    ["400 BAD_REQUEST", 400, "BAD_REQUEST", undefined, "BAD_REQUEST"],
  ])(
    "a %s is thrown as LedgerRefusedError with only the code, never retried, never the server sentence",
    async (_case, status, code, ledgerCode, expected) => {
      let called = 0;
      globalThis.fetch = () => {
        called += 1;
        return Promise.resolve(refused(status, code, ledgerCode));
      };
      const client = new HttpApiClient("http://localhost:4000");

      const error = await client.moveItem("item-corn", "PANTRY").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LedgerRefusedError);
      expect((error as LedgerRefusedError).code).toBe(expected);
      expect(messageForLedgerError(error)).not.toContain("server sentence");
      expect(called).toBe(1);
    },
  );

  it("replaces the item's cached summary: an offline reload after a move regroups it under the new location", async () => {
    let online = true;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      if (init?.method === "POST") return Promise.resolve(movedResponse());
      expect(url).toBe(`http://localhost:4000${INVENTORY_ITEMS_PATH}`);
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    const before = await client.getInventoryItems();
    expect(before.find((item) => item.itemId === "item-corn")?.storageLocation).toBe("FRIDGE");

    await client.moveItem("item-corn", "PANTRY");
    online = false;
    const after = await client.getInventoryItems();

    expect(client.isInventoryStale()).toBe(true);
    expect(after.find((item) => item.itemId === "item-corn")).toEqual(PANTRY_ROW);
    // Every other cached row is left exactly as it was.
    expect(after.find((item) => item.itemId === "item-other")).toEqual(OTHER_ROW);
  });

  it("does not invent a cache when none was loaded yet", async () => {
    let online = true;
    globalThis.fetch = () => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      return Promise.resolve(movedResponse());
    };
    const client = new HttpApiClient("http://localhost:4000");
    await client.moveItem("item-corn", "PANTRY");
    online = false;
    await expect(client.getInventoryItems()).rejects.toThrow();
  });

  it("a malformed 200 body is an error and leaves the cache untouched", async () => {
    let online = true;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      if (init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.getInventoryItems();
    await expect(client.moveItem("item-corn", "PANTRY")).rejects.toThrow(
      "returned an unexpected response body",
    );
    online = false;
    const cached = await client.getInventoryItems();
    expect(cached.find((item) => item.itemId === "item-corn")).toEqual(FRIDGE_ROW);
  });
});
