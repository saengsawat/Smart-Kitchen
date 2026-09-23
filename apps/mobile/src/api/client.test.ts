import { afterEach, describe, expect, it } from "vitest";
import { INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import type {
  InventoryItemDetailDto,
  InventoryItemsResponseDto,
  InventoryWriteRequestDto,
  InventoryWriteResponseDto,
  UndoRequestDto,
} from "@smart-kitchen/contracts";
import {
  createApiClient,
  FIXTURE_IDENTITY_TOKEN,
  FIXTURE_JOIN_CODE,
  FixtureApiClient,
  HttpApiClient,
  JOIN_CODE_ERROR_MESSAGE,
} from "./client";

/** Typed parse of a mocked `fetch`'s captured request body (test-only convenience). */
function parsedBody<T>(init: RequestInit | undefined): T {
  return JSON.parse(init?.body as string) as T;
}

/** Shared list-read fixture, reused by the detail/write describe blocks below. */
const SAMPLE_RESPONSE: InventoryItemsResponseDto = {
  items: [
    {
      itemId: "item-1",
      displayName: "Whole milk",
      productRef: null,
      ingredientRef: null,
      storageLocation: "FRIDGE",
      quantity: { unit: "count", micros: "2000000", amount: "2" },
      earliestExpiresAt: null,
      provenance: {
        quantity: {
          tier: "KNOWN_FACT",
          source: "barcode-scan",
          confidence: null,
          recordedAt: null,
        },
        earliestExpiresAt: null,
      },
      lots: [],
    },
  ],
};

describe("FixtureApiClient (M3-T1/M3-T2, no network, no persistence)", () => {
  it("supplies the fixture identity token documented in tests/fixtures/identity/README.md", () => {
    const client = FixtureApiClient.newUser();
    expect(client.getIdentityToken()).toBe("fixture.dean.chen");
    expect(client.getIdentityToken()).toBe(FIXTURE_IDENTITY_TOKEN);
  });

  it("never touches the network (no global fetch call recorded)", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (...args: Parameters<typeof fetch>): never => {
      called = true;
      throw new Error(`FixtureApiClient must never call fetch (args: ${JSON.stringify(args)})`);
    };
    try {
      const client = FixtureApiClient.newUser();
      await client.getInventoryItems();
      await client.createHousehold("The Chens");
      await client.joinHousehold(FIXTURE_JOIN_CODE);
      client.getIdentityToken();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("a brand-new user", () => {
    it("has no household and an empty kitchen before creating or joining one", async () => {
      const client = FixtureApiClient.newUser();
      const state = await client.getOnboardingState();
      expect(state.household).toBeNull();
      expect(await client.getInventoryItems()).toEqual([]);
    });
  });

  describe("createHousehold", () => {
    it("creates a household with the given name, Dean as owner and Maya as member, gate unfinished", async () => {
      const client = FixtureApiClient.newUser();
      const household = await client.createHousehold("The Ostrowskis");
      expect(household.name).toBe("The Ostrowskis");
      expect(household.members).toHaveLength(2);
      expect(household.members.map((m) => m.role)).toEqual(["owner", "member"]);
      for (const member of household.members) {
        expect(member.restrictions).toEqual([]);
        expect(member.noneConfirmed).toBe(false);
      }
    });

    it("starts an empty kitchen (true first run)", async () => {
      const client = FixtureApiClient.newUser();
      await client.createHousehold("The Ostrowskis");
      expect(await client.getInventoryItems()).toEqual([]);
    });

    it("is reflected by getOnboardingState immediately after", async () => {
      const client = FixtureApiClient.newUser();
      await client.createHousehold("The Ostrowskis");
      const state = await client.getOnboardingState();
      expect(state.household?.name).toBe("The Ostrowskis");
    });
  });

  describe("joinHousehold", () => {
    it("succeeds only with the exact fixture code CHEN-482", async () => {
      const client = FixtureApiClient.newUser();
      const result = await client.joinHousehold(FIXTURE_JOIN_CODE);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.household.members).toHaveLength(2);
      }
    });

    it("trims surrounding whitespace before comparing", async () => {
      const client = FixtureApiClient.newUser();
      const result = await client.joinHousehold("  CHEN-482  ");
      expect(result.ok).toBe(true);
    });

    it("rejects any other code with the exact honest error", async () => {
      const client = FixtureApiClient.newUser();
      const result = await client.joinHousehold("WRONG-000");
      expect(result).toEqual({
        ok: false,
        message: "That code didn't match a household. Check it with whoever invited you.",
      });
      expect(result.ok ? "" : result.message).toBe(JOIN_CODE_ERROR_MESSAGE);
    });

    it("rejects a code that only differs in case (exact match required)", async () => {
      const client = FixtureApiClient.newUser();
      const result = await client.joinHousehold("chen-482");
      expect(result.ok).toBe(false);
    });

    it("leaves the client in the new-user state after a wrong code", async () => {
      const client = FixtureApiClient.newUser();
      await client.joinHousehold("WRONG-000");
      const state = await client.getOnboardingState();
      expect(state.household).toBeNull();
    });

    it("joining the fixture household starts with stock already in it (no householdId on the wire)", async () => {
      const client = FixtureApiClient.newUser();
      await client.joinHousehold(FIXTURE_JOIN_CODE);
      const items = await client.getInventoryItems();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).not.toHaveProperty("householdId");
      }
    });
  });

  describe("saveMemberRestrictions / savePreferences (state transitions)", () => {
    it("saves a member's restrictions and they appear in the next getOnboardingState read", async () => {
      const client = FixtureApiClient.newUser();
      const household = await client.createHousehold("The Ostrowskis");
      const dean = household.members[0]!;
      await client.saveMemberRestrictions(
        dean.memberId,
        [{ kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" }],
        { noneConfirmed: false },
      );
      const state = await client.getOnboardingState();
      const savedDean = state.household?.members.find((m) => m.memberId === dean.memberId);
      expect(savedDean?.restrictions).toEqual([
        { kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" },
      ]);
      expect(savedDean?.noneConfirmed).toBe(false);
    });

    it("an explicit noneConfirmed with an empty restriction list is accepted and recorded", async () => {
      const client = FixtureApiClient.newUser();
      const household = await client.createHousehold("The Ostrowskis");
      const maya = household.members[1]!;
      await client.saveMemberRestrictions(maya.memberId, [], { noneConfirmed: true });
      const state = await client.getOnboardingState();
      const savedMaya = state.household?.members.find((m) => m.memberId === maya.memberId);
      expect(savedMaya?.restrictions).toEqual([]);
      expect(savedMaya?.noneConfirmed).toBe(true);
    });

    it("architect ruling (M3-T2 review F9): an empty array with noneConfirmed false is rejected, never inferred as none", async () => {
      const client = FixtureApiClient.newUser();
      await client.createHousehold("The Ostrowskis");
      await expect(
        client.saveMemberRestrictions("member-dean", [], { noneConfirmed: false }),
      ).rejects.toThrow();
    });

    it("rejects restrictions and noneConfirmed both set (not mutually exclusive)", async () => {
      const client = FixtureApiClient.newUser();
      await client.createHousehold("The Ostrowskis");
      await expect(
        client.saveMemberRestrictions(
          "member-dean",
          [{ kind: "MAJOR", code: "peanut", label: "peanut", severity: "standard" }],
          { noneConfirmed: true },
        ),
      ).rejects.toThrow();
    });

    it("saving one member's restrictions never touches another member's state", async () => {
      const client = FixtureApiClient.newUser();
      const household = await client.createHousehold("The Ostrowskis");
      const [dean, maya] = household.members;
      await client.saveMemberRestrictions(dean!.memberId, [], { noneConfirmed: true });
      const state = await client.getOnboardingState();
      const savedMaya = state.household?.members.find((m) => m.memberId === maya!.memberId);
      expect(savedMaya?.noneConfirmed).toBe(false);
      expect(savedMaya?.restrictions).toEqual([]);
    });

    it("saves preferences per member", async () => {
      const client = FixtureApiClient.newUser();
      const household = await client.createHousehold("The Ostrowskis");
      const dean = household.members[0]!;
      await client.savePreferences(dean.memberId, ["Vegetarian", "Kid-friendly"]);
      const state = await client.getOnboardingState();
      const savedDean = state.household?.members.find((m) => m.memberId === dean.memberId);
      expect(savedDean?.preferences).toEqual(["Vegetarian", "Kid-friendly"]);
    });

    it("rejects an unknown memberId", async () => {
      const client = FixtureApiClient.newUser();
      await client.createHousehold("The Ostrowskis");
      await expect(
        client.saveMemberRestrictions("not-a-real-member", [], { noneConfirmed: true }),
      ).rejects.toThrow();
    });

    it("rejects saving restrictions before any household exists", async () => {
      const client = FixtureApiClient.newUser();
      await expect(
        client.saveMemberRestrictions("member-dean", [], { noneConfirmed: true }),
      ).rejects.toThrow();
    });
  });

  describe("FixtureApiClient.returningUser", () => {
    it("starts with a household whose gate is already satisfied for every member", async () => {
      const client = FixtureApiClient.returningUser();
      const state = await client.getOnboardingState();
      expect(state.household).not.toBeNull();
      for (const member of state.household?.members ?? []) {
        expect(member.restrictions.length > 0 || member.noneConfirmed).toBe(true);
      }
    });

    it("starts with existing inventory (an established household, not a first run)", async () => {
      const client = FixtureApiClient.returningUser();
      const items = await client.getInventoryItems();
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe("inventory write methods (M3-T3, fixture only, append-only)", () => {
    it("correctQuantity appends an ADJUSTMENT and updates the exact quantity", async () => {
      const client = FixtureApiClient.returningUser();
      const items = await client.getInventoryItems();
      const chicken = items.find((i) => i.itemId === "fixture-item-chicken")!;
      expect(chicken.quantity.amount).toBe("1.250000");

      const result = await client.correctQuantity("fixture-item-chicken", "1500000");
      const detail = await client.getInventoryItem("fixture-item-chicken");
      expect(detail?.summary.quantity.micros).toBe("1500000");
      expect(detail?.history.at(-1)?.type).toBe("ADJUSTMENT");
      expect(detail?.history.at(-1)?.deltaMicros).toBe("250000");
      // Review F3: the resolved transactionId is the row this call actually
      // appended, so a caller never has to assume "the last row in history"
      // (which a concurrent write could make wrong).
      expect(result.transactionId).toBe(detail?.history.at(-1)?.transactionId);
    });

    it("correctQuantity's resolved transactionId still names the right row even if another write lands after it (review F3)", async () => {
      const client = FixtureApiClient.returningUser();
      const result = await client.correctQuantity("fixture-item-chicken", "1500000");
      // A second, unrelated write on the same item happens before the caller
      // gets around to reading history back.
      await client.correctQuantity("fixture-item-chicken", "2000000");
      const detail = await client.getInventoryItem("fixture-item-chicken");
      const namedRow = detail?.history.find((tx) => tx.transactionId === result.transactionId);
      expect(namedRow?.deltaMicros).toBe("250000"); // the first correction's own delta
      expect(namedRow).not.toBe(detail?.history.at(-1)); // NOT the same row as "last in history"
    });

    it("correctQuantity rejects a no-op correction (zero delta)", async () => {
      const client = FixtureApiClient.returningUser();
      await expect(client.correctQuantity("fixture-item-chicken", "1250000")).rejects.toThrow();
    });

    it("removeQuantity zeroes the item under the mapped TransactionType and records the reason", async () => {
      const client = FixtureApiClient.returningUser();
      await client.removeQuantity("fixture-item-spinach", "DISCARD", "Spoiled");
      const detail = await client.getInventoryItem("fixture-item-spinach");
      expect(detail?.summary.quantity.micros).toBe("0");
      const last = detail?.history.at(-1);
      expect(last?.type).toBe("DISCARD");
      // M3-T4a: the reason lives in the row's own `reason` field, matching
      // the real endpoint (review F4 ruling: never correlationLabel, which
      // is reserved for a recipe name; provenance.source stays the fixed
      // manual-entry source every manual write carries).
      expect(last?.reason).toBe("Spoiled");
      expect(last?.provenance.source).toBe("manual-entry");
      expect(last?.correlationLabel).toBeUndefined();
    });

    it("removeQuantity at an already-zero balance rejects rather than appending a zero-delta row (review F7)", async () => {
      const client = FixtureApiClient.returningUser();
      await client.removeQuantity("fixture-item-spinach", "DISCARD", "Spoiled");
      await expect(
        client.removeQuantity("fixture-item-spinach", "DISCARD", "Other"),
      ).rejects.toThrow();
    });

    it("undo appends the compensating row rather than removing the original", async () => {
      const client = FixtureApiClient.returningUser();
      await client.correctQuantity("fixture-item-chicken", "1500000");
      const beforeUndo = await client.getInventoryItem("fixture-item-chicken");
      const correctionId = beforeUndo!.history.at(-1)!.transactionId;
      const historyLengthBefore = beforeUndo!.history.length;

      await client.undo("fixture-item-chicken", correctionId);
      const afterUndo = await client.getInventoryItem("fixture-item-chicken");
      expect(afterUndo?.history).toHaveLength(historyLengthBefore + 1);
      expect(afterUndo?.summary.quantity.micros).toBe("1250000");
      expect(afterUndo?.history.some((tx) => tx.transactionId === correctionId)).toBe(true);
    });

    it("undo rejects an unknown transaction id", async () => {
      const client = FixtureApiClient.returningUser();
      await expect(client.undo("fixture-item-chicken", "not-a-real-transaction")).rejects.toThrow();
    });

    it("undo rejects a transaction id that belongs to a different item", async () => {
      const client = FixtureApiClient.returningUser();
      const result = await client.correctQuantity("fixture-item-chicken", "1500000");
      await expect(client.undo("fixture-item-spinach", result.transactionId)).rejects.toThrow();
    });

    it("confirmAiProposal promotes an AI-tier row to Known Fact", async () => {
      const client = FixtureApiClient.returningUser();
      const before = await client.getInventoryItem("fixture-item-strawberries");
      expect(before?.summary.provenance.quantity?.tier).toBe("AI_INTERPRETATION");

      await client.confirmAiProposal("fixture-item-strawberries");
      const after = await client.getInventoryItem("fixture-item-strawberries");
      expect(after?.summary.provenance.quantity?.tier).toBe("KNOWN_FACT");
    });

    it("getInventoryItem returns null for an unknown item", async () => {
      const client = FixtureApiClient.returningUser();
      expect(await client.getInventoryItem("not-a-real-item")).toBeNull();
    });

    it("isInventoryStale is always false (no network, ever)", async () => {
      const client = FixtureApiClient.returningUser();
      await client.getInventoryItems();
      expect(client.isInventoryStale()).toBe(false);
    });
  });
});

describe("createApiClient (M3-T3 Objective (d): HTTP when a base URL is set, fixture otherwise)", () => {
  it("returns a FixtureApiClient when no base URL is configured", () => {
    expect(createApiClient(null)).toBeInstanceOf(FixtureApiClient);
  });

  it("returns an HttpApiClient when a base URL is configured", () => {
    expect(createApiClient("http://localhost:4000")).toBeInstanceOf(HttpApiClient);
  });
});

describe("HttpApiClient (M3-T3, mocked fetch, no real network)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches GET /v1/inventory/items with the fixture bearer token", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    const items = await client.getInventoryItems();

    expect(capturedUrl).toBe(`http://localhost:4000${INVENTORY_ITEMS_PATH}`);
    expect(capturedHeaders).toEqual({ Authorization: `Bearer ${FIXTURE_IDENTITY_TOKEN}` });
    expect(items).toEqual(SAMPLE_RESPONSE.items);
    expect(client.isInventoryStale()).toBe(false);
  });

  it("parses the DTO's quantity as exact text, never through Number", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    const client = new HttpApiClient("http://localhost:4000");
    const [item] = await client.getInventoryItems();
    expect(typeof item!.quantity.amount).toBe("string");
    expect(item!.quantity.micros).toBe("2000000");
  });

  it("a network failure with no prior cache rejects (no stale data to fall back to)", async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.getInventoryItems()).rejects.toThrow();
  });

  it("a network failure after a prior success falls back to the cached result and reports stale (copy-deck.md §7 S4)", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    const client = new HttpApiClient("http://localhost:4000");
    const first = await client.getInventoryItems();
    expect(client.isInventoryStale()).toBe(false);

    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const second = await client.getInventoryItems();
    expect(second).toEqual(first);
    expect(client.isInventoryStale()).toBe(true);
  });

  it("a non-ok HTTP status is treated as a failure the same way a network error is", async () => {
    globalThis.fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.getInventoryItems()).rejects.toThrow();
  });

  describe("malformed response body (review F15)", () => {
    it.each([
      ["an empty object", {}],
      ["items not an array", { items: "not-an-array" }],
      ["null", null],
      ["a bare array", []],
    ])("rejects when the body is %s, never caches or returns garbage", async (_label, payload) => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.getInventoryItems()).rejects.toThrow();
      expect(client.isInventoryStale()).toBe(false);
    });

    it("a malformed body after a prior success falls back to the cached result and reports stale", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
      const client = new HttpApiClient("http://localhost:4000");
      const first = await client.getInventoryItems();

      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      const second = await client.getInventoryItems();
      expect(second).toEqual(first);
      expect(client.isInventoryStale()).toBe(true);
    });
  });

  it("onboarding/household state still delegates to a fixture client (no endpoint yet, M2-T3)", async () => {
    const client = new HttpApiClient("http://localhost:4000");
    const state = await client.getOnboardingState();
    expect(state.household).not.toBeNull();
  });
});

describe("HttpApiClient.getInventoryItem (M3-T4a: real GET /v1/inventory/items/{id})", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const SAMPLE_DETAIL: InventoryItemDetailDto = {
    summary: SAMPLE_RESPONSE.items[0]!,
    history: [
      {
        transactionId: "tx-1",
        type: "PURCHASE",
        deltaMicros: "2000000",
        amount: "2.000000",
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
    ],
  };

  it("fetches the detail endpoint with the fixture bearer token and returns it parsed", async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    const detail = await client.getInventoryItem("item-1");

    expect(capturedUrl).toBe("http://localhost:4000/v1/inventory/items/item-1");
    expect(capturedHeaders).toEqual({ Authorization: `Bearer ${FIXTURE_IDENTITY_TOKEN}` });
    expect(detail).toEqual(SAMPLE_DETAIL);
  });

  it("a 404 resolves null, indistinguishable from an item that does not exist", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "Not found.", correlationId: "c1" },
          }),
          {
            status: 404,
          },
        ),
      );
    const client = new HttpApiClient("http://localhost:4000");
    expect(await client.getInventoryItem("item-1")).toBeNull();
  });

  it("rejects a malformed response body rather than returning garbage", async () => {
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.getInventoryItem("item-1")).rejects.toThrow();
  });

  it("a non-404 non-ok status rejects", async () => {
    globalThis.fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.getInventoryItem("item-1")).rejects.toThrow();
  });
});

describe("HttpApiClient writes/undo (M3-T4a: real POST endpoints, mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function sampleWriteResponse(
    transactions: readonly InventoryWriteResponseDto["transactions"][number][],
  ): InventoryWriteResponseDto {
    return {
      transactions,
      item: {
        summary: SAMPLE_RESPONSE.items[0]!,
        history: transactions,
      },
      replayed: false,
    };
  }

  const SAMPLE_ROW: InventoryWriteResponseDto["transactions"][number] = {
    transactionId: "tx-new",
    type: "ADJUSTMENT",
    deltaMicros: "250000",
    amount: "0.250000",
    recordedAt: "2026-09-20T12:00:00.000Z",
    actor: { kind: "user", displayInitials: "DC" },
    provenance: {
      tier: "KNOWN_FACT",
      source: "one-tap correction",
      confidence: null,
      recordedAt: null,
    },
    reason: null,
  };

  describe("correctQuantity", () => {
    it("POSTs the transactions endpoint with method, bearer, and a well-formed body", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return Promise.resolve(
          new Response(JSON.stringify(sampleWriteResponse([SAMPLE_ROW])), { status: 200 }),
        );
      }) as typeof fetch;

      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.correctQuantity("item-1", "1500000");

      expect(capturedUrl).toBe("http://localhost:4000/v1/inventory/items/item-1/transactions");
      expect(capturedInit?.method).toBe("POST");
      expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
      );
      const body = parsedBody<InventoryWriteRequestDto>(capturedInit);
      expect(body.type).toBe("ADJUSTMENT");
      expect(body.targetAmount).toBe("1.500000");
      expect(body.idempotencyKey).toMatch(UUID_SHAPE);
      expect(typeof body.occurredAt).toBe("string");
      expect(result.transactionId).toBe("tx-new");
    });

    it("a simulated retry (network failure then success) reuses the same idempotency key", async () => {
      const capturedKeys: string[] = [];
      let calls = 0;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        calls += 1;
        const body = parsedBody<InventoryWriteRequestDto>(init);
        capturedKeys.push(body.idempotencyKey);
        if (calls === 1) {
          return Promise.reject(new Error("network down"));
        }
        return Promise.resolve(
          new Response(JSON.stringify(sampleWriteResponse([SAMPLE_ROW])), { status: 200 }),
        );
      }) as typeof fetch;

      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.correctQuantity("item-1", "1500000");

      expect(calls).toBe(2);
      expect(capturedKeys).toHaveLength(2);
      expect(capturedKeys[0]).toBe(capturedKeys[1]); // never re-minted on retry
      expect(result.transactionId).toBe("tx-new");
    });

    it("gives up and rejects after exhausting its retries against a persistent network failure", async () => {
      globalThis.fetch = () => Promise.reject(new Error("network down"));
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.correctQuantity("item-1", "1500000")).rejects.toThrow();
    });

    it("a 409 idempotency conflict throws LedgerRefusedError('IDEMPOTENCY_KEY_CONFLICT'), never retried", async () => {
      let calls = 0;
      globalThis.fetch = () => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "CONFLICT",
                message: "conflict",
                correlationId: "c1",
                ledgerCode: "IDEMPOTENCY_KEY_CONFLICT",
              },
            }),
            { status: 409 },
          ),
        );
      };
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.correctQuantity("item-1", "1500000")).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_CONFLICT",
      });
      expect(calls).toBe(1); // a well-formed refusal is never retried
    });

    it("a 400 ledger refusal throws LedgerRefusedError keyed off ledgerCode (e.g. ZERO_DELTA)", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "BAD_REQUEST",
                message: "refused",
                correlationId: "c1",
                ledgerCode: "ZERO_DELTA",
              },
            }),
            { status: 400 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.correctQuantity("item-1", "1500000")).rejects.toMatchObject({
        code: "ZERO_DELTA",
      });
    });

    it("a 404 throws LedgerRefusedError('NOT_FOUND') (no ledgerCode on this path)", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "NOT_FOUND", message: "Not found.", correlationId: "c1" },
            }),
            { status: 404 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.correctQuantity("item-1", "1500000")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("removeQuantity", () => {
    it("POSTs the mapped type, the optional reason, and omits amount (whole balance)", async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(
          new Response(JSON.stringify(sampleWriteResponse([{ ...SAMPLE_ROW, type: "DISCARD" }])), {
            status: 200,
          }),
        );
      }) as typeof fetch;

      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.removeQuantity("item-1", "DISCARD", "Spoiled");

      const body = parsedBody<InventoryWriteRequestDto>(capturedInit);
      expect(body.type).toBe("DISCARD");
      expect(body.reason).toBe("Spoiled");
      expect(body.amount).toBeUndefined();
      expect(result.transactionId).toBe("tx-new");
    });

    it("omits reason entirely when none is given", async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(
          new Response(JSON.stringify(sampleWriteResponse([SAMPLE_ROW])), { status: 200 }),
        );
      }) as typeof fetch;
      const client = new HttpApiClient("http://localhost:4000");
      await client.removeQuantity("item-1", "CONSUME");
      const body = parsedBody<InventoryWriteRequestDto>(capturedInit);
      expect(body.reason).toBeUndefined();
    });
  });

  describe("undo", () => {
    it("POSTs the item-scoped undo path with its own idempotency key", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return Promise.resolve(
          new Response(JSON.stringify(sampleWriteResponse([SAMPLE_ROW])), { status: 200 }),
        );
      }) as typeof fetch;

      const client = new HttpApiClient("http://localhost:4000");
      await client.undo("item-1", "tx-original");

      expect(capturedUrl).toBe(
        "http://localhost:4000/v1/inventory/items/item-1/transactions/tx-original/undo",
      );
      const body = parsedBody<UndoRequestDto & { transactionId?: unknown }>(capturedInit);
      expect(body.idempotencyKey).toMatch(UUID_SHAPE);
      expect(body.transactionId).toBeUndefined(); // named in the path, never the body
    });

    it("a 409 UNDO_NOT_POSSIBLE throws LedgerRefusedError('UNDO_NOT_POSSIBLE')", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "UNDO_NOT_POSSIBLE",
                message: "That change can't be undone. The stock it added has already been used.",
                correlationId: "c1",
              },
            }),
            { status: 409 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.undo("item-1", "tx-original")).rejects.toMatchObject({
        code: "UNDO_NOT_POSSIBLE",
      });
    });
  });
});

describe("lookupProduct / createItem (M3-T4b)", () => {
  describe("FixtureApiClient", () => {
    it("resolves a fixture barcode to a hit with its (engine-generated) screening", async () => {
      const client = FixtureApiClient.newUser();
      const result = await client.lookupProduct("060000100810");
      expect(result.status).toBe("hit");
      if (result.status === "hit") {
        expect(result.product.name.value).toBe("Stone-Ground Tahini");
        expect(result.product.screening.verdict).toBe("BLOCKED");
      }
    });

    it("resolves an unrecognised code as not-found", async () => {
      const result = await FixtureApiClient.newUser().lookupProduct("000000000000");
      expect(result.status).toBe("not-found");
    });

    it("createItem (BARCODE) appends a PURCHASE row and the item is readable afterward", async () => {
      const client = FixtureApiClient.newUser();
      const summary = await client.createItem({
        idempotencyKey: "key-1",
        source: "BARCODE",
        displayName: "Sunrise Greek Yogurt Plain",
        storageLocation: "FRIDGE",
        unit: "oz",
        amount: "64.000000",
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: "manufacturer-label",
          confidence: null,
          recordedAt: null,
        },
        productRef: "dairy-003",
      });
      expect(summary.displayName).toBe("Sunrise Greek Yogurt Plain");
      expect(summary.quantity.amount).toBe("64");

      const items = await client.getInventoryItems();
      expect(items).toHaveLength(1);
      const detail = await client.getInventoryItem(summary.itemId);
      expect(detail?.history).toHaveLength(1);
      expect(detail?.history[0]?.type).toBe("PURCHASE");
    });

    it("createItem (MANUAL) appends an INITIAL_STOCK row", async () => {
      const client = FixtureApiClient.newUser();
      const summary = await client.createItem({
        idempotencyKey: "key-2",
        source: "MANUAL",
        displayName: "Trader Joe's frozen dumplings",
        storageLocation: "FREEZER",
        unit: "count",
        amount: "12",
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: "manual-entry",
          confidence: null,
          recordedAt: null,
        },
      });
      const detail = await client.getInventoryItem(summary.itemId);
      expect(detail?.history[0]?.type).toBe("INITIAL_STOCK");
      expect(detail?.summary.quantity.amount).toBe("12");
    });
  });

  describe("HttpApiClient", () => {
    it("lookupProduct rejects clearly (no endpoint until M2-T3)", async () => {
      const client = new HttpApiClient("http://localhost:4000");
      await expect(client.lookupProduct("060000100025")).rejects.toThrow(/not available yet/);
    });

    it("createItem rejects clearly (no endpoint until M2-T3)", async () => {
      const client = new HttpApiClient("http://localhost:4000");
      await expect(
        client.createItem({
          idempotencyKey: "key-1",
          source: "MANUAL",
          displayName: "x",
          storageLocation: "PANTRY",
          unit: "count",
          amount: "1",
          quantityProvenance: {
            tier: "KNOWN_FACT",
            source: "manual-entry",
            confidence: null,
            recordedAt: null,
          },
        }),
      ).rejects.toThrow(/not available yet/);
    });
  });
});
