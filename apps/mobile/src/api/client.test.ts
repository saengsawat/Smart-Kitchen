import { afterEach, describe, expect, it } from "vitest";
import { INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import type { InventoryItemsResponseDto } from "@smart-kitchen/contracts";
import {
  createApiClient,
  FIXTURE_IDENTITY_TOKEN,
  FIXTURE_JOIN_CODE,
  FixtureApiClient,
  HttpApiClient,
  JOIN_CODE_ERROR_MESSAGE,
} from "./client";

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
      // Review F4 ruling: the reason lives in provenance.source, not
      // correlationLabel (reserved for a recipe name).
      expect(last?.provenance.source).toBe("Spoiled");
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

      await client.undo(correctionId);
      const afterUndo = await client.getInventoryItem("fixture-item-chicken");
      expect(afterUndo?.history).toHaveLength(historyLengthBefore + 1);
      expect(afterUndo?.summary.quantity.micros).toBe("1250000");
      expect(afterUndo?.history.some((tx) => tx.transactionId === correctionId)).toBe(true);
    });

    it("undo rejects an unknown transaction id", async () => {
      const client = FixtureApiClient.returningUser();
      await expect(client.undo("not-a-real-transaction")).rejects.toThrow();
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

  it("getInventoryItem finds the row from the cached list with an empty history (no history endpoint yet)", async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    const client = new HttpApiClient("http://localhost:4000");
    await client.getInventoryItems();
    const detail = await client.getInventoryItem("item-1");
    expect(detail?.summary.itemId).toBe("item-1");
    expect(detail?.history).toEqual([]);
  });

  it("getInventoryItem returns null before any list has been fetched", async () => {
    const client = new HttpApiClient("http://localhost:4000");
    expect(await client.getInventoryItem("item-1")).toBeNull();
  });

  it("household/onboarding and write methods delegate to a fixture client (no endpoint yet)", async () => {
    const client = new HttpApiClient("http://localhost:4000");
    const state = await client.getOnboardingState();
    expect(state.household).not.toBeNull();
  });
});
