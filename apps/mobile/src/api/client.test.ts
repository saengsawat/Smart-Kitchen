import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerRowsOf } from "../inventory/history";
import {
  INVENTORY_ITEMS_PATH,
  SHOPPING_PATH,
  shoppingRowAddToInventoryPath,
  shoppingRowCheckPath,
  shoppingRowRemovePath,
} from "@smart-kitchen/contracts";
import {
  GENERIC_LEDGER_ERROR_MESSAGE,
  GENERIC_READ_ERROR_MESSAGE,
  LedgerRefusedError,
  messageForLedgerError,
} from "../inventory/errors";
import { ShoppingCheckOffQueue } from "../shopping/queue";
import { messageForLookupError, ProductLookupRefusedError } from "../scan/product-lookup-errors";
import type {
  AddShoppingRowToInventoryRequestDto,
  CheckShoppingRowRequestDto,
  CreateItemRequestDto,
  InventoryItemDetailDto,
  InventoryItemsResponseDto,
  InventoryItemSummaryDto,
  InventoryWriteRequestDto,
  InventoryWriteResponseDto,
  ProductLookupResultDto,
  ScannedProductDto,
  ShoppingListDto,
  UndoRequestDto,
} from "@smart-kitchen/contracts";
import {
  assertShoppingRowUnitMatchesItem,
  type ApiClient,
  createApiClient,
  FIXTURE_IDENTITY_TOKEN,
  FIXTURE_JOIN_CODE,
  FixtureApiClient,
  hasDevOfflineToggle,
  hasHouseholdCallerActions,
  householdSyncInputFromSummary,
  HttpApiClient,
  JOIN_CODE_ERROR_MESSAGE,
  NOT_OWNER_MESSAGE,
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
      expect(ledgerRowsOf(detail?.history ?? []).at(-1)?.type).toBe("ADJUSTMENT");
      expect(ledgerRowsOf(detail?.history ?? []).at(-1)?.deltaMicros).toBe("250000");
      // Review F3: the resolved transactionId is the row this call actually
      // appended, so a caller never has to assume "the last row in history"
      // (which a concurrent write could make wrong).
      expect(result.transactionId).toBe(ledgerRowsOf(detail?.history ?? []).at(-1)?.transactionId);
    });

    it("correctQuantity's resolved transactionId still names the right row even if another write lands after it (review F3)", async () => {
      const client = FixtureApiClient.returningUser();
      const result = await client.correctQuantity("fixture-item-chicken", "1500000");
      // A second, unrelated write on the same item happens before the caller
      // gets around to reading history back.
      await client.correctQuantity("fixture-item-chicken", "2000000");
      const detail = await client.getInventoryItem("fixture-item-chicken");
      const namedRow = ledgerRowsOf(detail?.history ?? []).find(
        (tx) => tx.transactionId === result.transactionId,
      );
      expect(namedRow?.deltaMicros).toBe("250000"); // the first correction's own delta
      expect(namedRow).not.toBe(ledgerRowsOf(detail?.history ?? []).at(-1)); // NOT the same row as "last in history"
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
      const last = ledgerRowsOf(detail?.history ?? []).at(-1);
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
      const correctionId = ledgerRowsOf(beforeUndo!.history).at(-1)!.transactionId;
      const historyLengthBefore = beforeUndo!.history.length;

      await client.undo("fixture-item-chicken", correctionId);
      const afterUndo = await client.getInventoryItem("fixture-item-chicken");
      expect(afterUndo?.history).toHaveLength(historyLengthBefore + 1);
      expect(afterUndo?.summary.quantity.micros).toBe("1250000");
      expect(
        ledgerRowsOf(afterUndo?.history ?? []).some((tx) => tx.transactionId === correctionId),
      ).toBe(true);
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

describe("householdSyncInputFromSummary (M3-T4d, pure mapping)", () => {
  it("maps each member's displayInitials into displayName, dropping isCaller", () => {
    const result = householdSyncInputFromSummary({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [
        { memberId: "mem-1", displayInitials: "AO", role: "owner", isCaller: true },
        { memberId: "mem-2", displayInitials: "?", role: "member", isCaller: false },
      ],
    });
    expect(result).toEqual({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [
        { memberId: "mem-1", displayName: "AO", role: "owner" },
        { memberId: "mem-2", displayName: "?", role: "member" },
      ],
    });
  });
});

describe("FixtureApiClient.syncHouseholdFromServer (M3-T4d)", () => {
  it("replaces identity/members/roles wholesale but keeps no restrictions for a brand-new member", () => {
    const client = FixtureApiClient.newUser();
    const household = client.syncHouseholdFromServer({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [{ memberId: "mem-1", displayName: "AO", role: "owner" }],
    });
    expect(household).toEqual({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [
        {
          memberId: "mem-1",
          displayName: "AO",
          role: "owner",
          restrictions: [],
          noneConfirmed: false,
          preferences: [],
        },
      ],
    });
  });

  it("preserves a member's restrictions/preferences already saved this session across a resync", async () => {
    const client = FixtureApiClient.newUser();
    client.syncHouseholdFromServer({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [{ memberId: "mem-1", displayName: "AO", role: "owner" }],
    });
    await client.saveMemberRestrictions(
      "mem-1",
      [{ kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" }],
      { noneConfirmed: false },
    );
    await client.savePreferences("mem-1", ["Vegetarian"]);

    // Same member id, name/role unchanged (a later GET /v1/households/me).
    const resynced = client.syncHouseholdFromServer({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [{ memberId: "mem-1", displayName: "AO", role: "owner" }],
    });
    expect(resynced.members[0]?.restrictions).toEqual([
      { kind: "MAJOR", code: "peanut", label: "peanut", severity: "severe" },
    ]);
    expect(resynced.members[0]?.preferences).toEqual(["Vegetarian"]);
  });

  it("a member no longer present in the server response is dropped, never left as a stale row", () => {
    const client = FixtureApiClient.newUser();
    client.syncHouseholdFromServer({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [
        { memberId: "mem-1", displayName: "AO", role: "owner" },
        { memberId: "mem-2", displayName: "BX", role: "member" },
      ],
    });
    const resynced = client.syncHouseholdFromServer({
      householdId: "hh-1",
      name: "The Ostrowskis",
      members: [{ memberId: "mem-1", displayName: "AO", role: "owner" }],
    });
    expect(resynced.members.map((m) => m.memberId)).toEqual(["mem-1"]);
  });
});

describe("HttpApiClient.clearHouseholdUntilServerSaysOtherwise (M3-T4d review F6, pinned)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("saveMemberRestrictions on a fresh HttpApiClient, before any server read, rejects (never assumes a household)", async () => {
    globalThis.fetch = () => {
      throw new Error("must not call fetch");
    };
    const client = new HttpApiClient("http://localhost:4000");
    // Review round 2 pin: "member-dean" (tests/fixtures/identity/README.md),
    // not an arbitrary id like "mem-1" — the internal delegate starts from
    // `FixtureApiClient.returningUser()` (kept only for `confirmAiProposal`'s
    // inventory, see the module doc comment), whose *un-cleared* household
    // really does have a "member-dean". A made-up id would reject either
    // way (an "unknown memberId" refusal, same as a cleared household's "no
    // household yet" one), so it cannot tell "the household was cleared"
    // apart from "the id doesn't exist"; deleting
    // `clearHouseholdUntilServerSaysOtherwise()` must make this one resolve
    // instead of reject.
    await expect(
      client.saveMemberRestrictions("member-dean", [], { noneConfirmed: true }),
    ).rejects.toThrow();
  });

  it("savePreferences on a fresh HttpApiClient, before any server read, rejects the same way", async () => {
    globalThis.fetch = () => {
      throw new Error("must not call fetch");
    };
    const client = new HttpApiClient("http://localhost:4000");
    // Same "member-dean", same reasoning as the test above.
    await expect(client.savePreferences("member-dean", ["Vegetarian"])).rejects.toThrow();
  });

  it("saveMemberRestrictions and savePreferences never call fetch, on a fresh client or after a real household sync", async () => {
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            household: {
              householdId: "hh-1",
              name: "The Ostrowskis",
              members: [
                { memberId: "mem-1", displayInitials: "AO", role: "owner", isCaller: true },
              ],
            },
            joinCode: { code: "ABCD-234", issuedAt: "2026-09-29T00:00:00.000Z" },
          }),
          { status: 201 },
        ),
      );
    };
    const client = new HttpApiClient("http://localhost:4000");

    // A fresh client, no server read yet: rejects, no fetch call.
    await expect(
      client.saveMemberRestrictions("mem-1", [], { noneConfirmed: true }).catch(() => undefined),
    ).resolves.toBeUndefined();
    expect(fetchCalls).toBe(0);

    // After a real household sync (one fetch call), the two restriction
    // calls still make zero fetch calls of their own — purely local.
    await client.createHousehold("The Ostrowskis");
    expect(fetchCalls).toBe(1);
    await client.saveMemberRestrictions("mem-1", [], { noneConfirmed: true });
    await client.savePreferences("mem-1", ["Vegetarian"]);
    expect(fetchCalls).toBe(1);
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

  it("authenticates as EXPO_PUBLIC_IDENTITY_TOKEN when set (M3-T4d Objective (e))", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.new.user");
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
    }) as typeof fetch;

    try {
      const client = new HttpApiClient("http://localhost:4000");
      await client.getInventoryItems();
      expect(capturedHeaders).toEqual({ Authorization: "Bearer fixture.new.user" });
      expect(client.getIdentityToken()).toBe("fixture.new.user");
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("a brand-new HttpApiClient has no household until the server says otherwise (never assumes one, M3-T4d)", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: "FORBIDDEN", message: "no", correlationId: "c1" } }),
          { status: 403 },
        ),
      );
    const client = new HttpApiClient("http://localhost:4000");
    const state = await client.getOnboardingState();
    expect(state.household).toBeNull();
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
        status: 400,
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
        expect(result.product.screening).toMatchObject({
          status: "RUN",
          result: { verdict: "BLOCKED" },
        });
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

    describe("createItem lot label and quantity origin (M2-T7, fixture mirrors the server)", () => {
      const scan: CreateItemRequestDto = {
        idempotencyKey: "key-label",
        source: "BARCODE",
        displayName: "Rice",
        storageLocation: "PANTRY",
        unit: "g",
        amount: "248",
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: "user-entry",
          confidence: null,
          recordedAt: null,
        },
        productRef: "dairy-003",
      };

      it("stores the trimmed label on the lot", async () => {
        const client = FixtureApiClient.newUser();
        const summary = await client.createItem({
          ...scan,
          lotLabel: "  248 g ",
          quantityOrigin: "USER_TYPED",
        });
        expect(summary.lots[0]?.label).toBe("248 g");
      });

      it("no label leaves the lot label null", async () => {
        const summary = await FixtureApiClient.newUser().createItem(scan);
        expect(summary.lots[0]?.label).toBeNull();
      });

      it.each([
        ["an empty label", { lotLabel: "   " }],
        ["a 65-character label", { lotLabel: "x".repeat(65) }],
        ["a control character", { lotLabel: "a\nb" }],
        ["an unknown origin", { quantityOrigin: "OTHER" as never }],
        [
          "an origin on a manual create",
          { source: "MANUAL", productRef: undefined, quantityOrigin: "USER_TYPED" },
        ],
      ] as const)("refuses %s with INVALID_FIELD", async (_case, override) => {
        const client = FixtureApiClient.newUser();
        await expect(client.createItem({ ...scan, ...override })).rejects.toMatchObject({
          code: "INVALID_FIELD",
        });
        expect(await client.getInventoryItems()).toHaveLength(0);
      });

      it("the real client sends both fields verbatim on the typed path and neither on the product path", async () => {
        const bodies: CreateItemRequestDto[] = [];
        globalThis.fetch = ((_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(init?.body as string) as CreateItemRequestDto);
          return Promise.resolve(new Response("{}", { status: 500 }));
        }) as typeof fetch;
        const client = new HttpApiClient("http://localhost:4000");
        await client
          .createItem({ ...scan, lotLabel: "248 g", quantityOrigin: "USER_TYPED" })
          .catch(() => undefined);
        await client.createItem(scan).catch(() => undefined);
        expect(bodies[0]).toMatchObject({ lotLabel: "248 g", quantityOrigin: "USER_TYPED" });
        expect("lotLabel" in bodies[1]!).toBe(false);
        expect("quantityOrigin" in bodies[1]!).toBe(false);
      });
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
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    describe("lookupProduct (M3-T4e: real GET /v1/products/{code})", () => {
      const SAMPLE_PRODUCT: ScannedProductDto = {
        productId: "096619555505",
        codes: [{ codeType: "UPC_A", code: "096619555505" }],
        name: {
          value: "Organic Creamy Peanut Butter",
          provenance: {
            tier: "ESTIMATED",
            source: "open-food-facts",
            confidence: null,
            recordedAt: "2026-09-29T13:02:12.000Z",
          },
        },
        nutrition: [],
        bestBy: null,
        screening: { status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" },
      };

      it("M2-T4c: puts the scanned symbology on the URL as the type query parameter, and omits it for a typed code", async () => {
        const urls: string[] = [];
        globalThis.fetch = ((url: string) => {
          urls.push(url);
          const answer: ProductLookupResultDto = { status: "not-found", code: "04016007" };
          return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        await client.lookupProduct("04016007", "upc_e");
        await client.lookupProduct("04016007");

        expect(urls).toEqual([
          "http://localhost:4000/v1/products/04016007?type=upc_e",
          "http://localhost:4000/v1/products/04016007",
        ]);
      });

      it("M2-T4c: the fixture client accepts and ignores the hint", async () => {
        const client: ApiClient = FixtureApiClient.newUser();
        const withHint = await client.lookupProduct("060000100810", "upc_a");
        const without = await client.lookupProduct("060000100810");
        expect(withHint).toEqual(without);
      });

      it("GETs the product-lookup path with the fixture bearer token, and a hit passes through unchanged", async () => {
        let capturedUrl: string | undefined;
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          const answer: ProductLookupResultDto = {
            status: "hit",
            code: "096619555505",
            product: SAMPLE_PRODUCT,
          };
          return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.lookupProduct("096619555505");

        expect(capturedUrl).toBe("http://localhost:4000/v1/products/096619555505");
        expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
        );
        expect(result).toEqual({
          status: "hit",
          code: "096619555505",
          product: SAMPLE_PRODUCT,
        });
      });

      it("screening passes through exactly as the server sent it, never re-derived (NOT_RUN case)", async () => {
        globalThis.fetch = () => {
          const answer: ProductLookupResultDto = {
            status: "hit",
            code: "096619555505",
            product: SAMPLE_PRODUCT,
          };
          return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        };
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.lookupProduct("096619555505");
        expect(result.status === "hit" && result.product.screening).toEqual({
          status: "NOT_RUN",
          reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED",
        });
      });

      it("a not-found outcome passes through unchanged", async () => {
        globalThis.fetch = () => {
          const answer: ProductLookupResultDto = { status: "not-found", code: "000000000000" };
          return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        };
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.lookupProduct("000000000000");
        expect(result).toEqual({ status: "not-found", code: "000000000000" });
      });

      it("a 200 error outcome passes through with its own code/message fields (the screen never shows .message)", async () => {
        globalThis.fetch = () => {
          const answer: ProductLookupResultDto = {
            status: "error",
            code: "096619555505",
            message: "this exact sentence must never reach the screen",
          };
          return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
        };
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.lookupProduct("096619555505");
        expect(result.status).toBe("error");
      });

      it("a 400 PLU_NOT_SUPPORTED throws ProductLookupRefusedError with that code, never the server message", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "PLU_NOT_SUPPORTED",
                  message: "this exact sentence must never reach the screen",
                  correlationId: "c1",
                },
              }),
              { status: 400 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.lookupProduct("04061")).rejects.toMatchObject({
          code: "PLU_NOT_SUPPORTED",
        });
        try {
          await client.lookupProduct("04061");
          expect.unreachable();
        } catch (error) {
          expect(messageForLookupError(error)).toBe(
            "Produce codes can't be looked up by barcode yet. Add this item by hand.",
          );
        }
      });

      it("a 400 BAD_REQUEST throws ProductLookupRefusedError with that code", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "BAD_REQUEST", message: "bad", correlationId: "c1" },
              }),
              { status: 400 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        try {
          await client.lookupProduct("not-a-code");
          expect.unreachable();
        } catch (error) {
          expect(messageForLookupError(error)).toBe("That isn't a barcode number we can look up.");
        }
      });

      it("a 401 throws ProductLookupRefusedError rendering the generic fallback", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: "UNAUTHORIZED", message: "no session" } }),
              { status: 401 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        try {
          await client.lookupProduct("096619555505");
          expect.unreachable();
        } catch (error) {
          expect(error).toBeInstanceOf(ProductLookupRefusedError);
          expect(messageForLookupError(error)).toBe(GENERIC_READ_ERROR_MESSAGE);
        }
      });

      it("a 500 throws ProductLookupRefusedError rendering the read fallback (review round 1 F2/R2: a lookup is a read)", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
              status: 500,
            }),
          );
        const client = new HttpApiClient("http://localhost:4000");
        try {
          await client.lookupProduct("096619555505");
          expect.unreachable();
        } catch (error) {
          expect(messageForLookupError(error)).toBe(GENERIC_READ_ERROR_MESSAGE);
        }
      });

      it("rejects a malformed 2xx response body rather than returning garbage", async () => {
        globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.lookupProduct("096619555505")).rejects.toThrow();
      });
    });

    const SAMPLE_ITEM_INPUT: CreateItemRequestDto = {
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
    };

    const SAMPLE_ITEM_SUMMARY: InventoryItemSummaryDto = SAMPLE_RESPONSE.items[0]!;

    describe("createItem (M3-T4d: real POST /v1/inventory/items)", () => {
      it("POSTs to the items path with the fixture bearer token and the input verbatim, returning the created summary", async () => {
        let capturedUrl: string | undefined;
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return Promise.resolve(
            new Response(JSON.stringify(SAMPLE_ITEM_SUMMARY), { status: 201 }),
          );
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.createItem(SAMPLE_ITEM_INPUT);

        expect(capturedUrl).toBe(`http://localhost:4000${INVENTORY_ITEMS_PATH}`);
        expect(capturedInit?.method).toBe("POST");
        expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
        );
        expect(parsedBody<CreateItemRequestDto>(capturedInit)).toEqual(SAMPLE_ITEM_INPUT);
        expect(result).toEqual(SAMPLE_ITEM_SUMMARY);
      });

      it("a 200 replay resolves the same way as a 201 create", async () => {
        globalThis.fetch = () =>
          Promise.resolve(new Response(JSON.stringify(SAMPLE_ITEM_SUMMARY), { status: 200 }));
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.createItem(SAMPLE_ITEM_INPUT);
        expect(result).toEqual(SAMPLE_ITEM_SUMMARY);
      });

      it("a simulated retry (network failure then success) reuses the same request body, never mints a second idempotencyKey", async () => {
        const capturedKeys: string[] = [];
        let calls = 0;
        globalThis.fetch = ((_url: string, init?: RequestInit) => {
          calls += 1;
          capturedKeys.push(parsedBody<CreateItemRequestDto>(init).idempotencyKey);
          if (calls === 1) {
            return Promise.reject(new Error("network down"));
          }
          return Promise.resolve(
            new Response(JSON.stringify(SAMPLE_ITEM_SUMMARY), { status: 201 }),
          );
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.createItem(SAMPLE_ITEM_INPUT);

        expect(calls).toBe(2);
        expect(capturedKeys).toEqual(["key-1", "key-1"]); // reused, never re-minted
        expect(result).toEqual(SAMPLE_ITEM_SUMMARY);
      });

      it("gives up and rejects after exhausting its retries against a persistent network failure", async () => {
        globalThis.fetch = () => Promise.reject(new Error("network down"));
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.createItem(SAMPLE_ITEM_INPUT)).rejects.toThrow();
      });

      it("a 409 IDEMPOTENCY_KEY_CONFLICT throws LedgerRefusedError, never retried, rendering its §8 sentence (review F9)", async () => {
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
        await expect(client.createItem(SAMPLE_ITEM_INPUT)).rejects.toMatchObject({
          code: "IDEMPOTENCY_KEY_CONFLICT",
        });
        expect(calls).toBe(1);
        try {
          await client.createItem(SAMPLE_ITEM_INPUT);
          expect.unreachable();
        } catch (error) {
          expect(messageForLedgerError(error)).toBe(
            "That request was already used for a different change, so it was not applied again.",
          );
        }
      });

      it("a 400 validation refusal (e.g. INVALID_FIELD) throws LedgerRefusedError, rendering the generic fallback (review F9)", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "BAD_REQUEST",
                  message: "bad",
                  correlationId: "c1",
                  ledgerCode: "INVALID_FIELD",
                },
              }),
              { status: 400 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.createItem(SAMPLE_ITEM_INPUT)).rejects.toMatchObject({
          code: "INVALID_FIELD",
        });
        try {
          await client.createItem(SAMPLE_ITEM_INPUT);
          expect.unreachable();
        } catch (error) {
          expect(messageForLedgerError(error)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
        }
      });

      it("rejects a malformed 2xx response body rather than returning garbage", async () => {
        globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.createItem(SAMPLE_ITEM_INPUT)).rejects.toThrow();
      });
    });

    describe("createHousehold (M3-T4d: real POST /v1/households)", () => {
      const SAMPLE_CREATE_RESPONSE = {
        household: {
          householdId: "hh-1",
          name: "The Ostrowskis",
          members: [{ memberId: "mem-1", displayInitials: "NH", role: "owner", isCaller: true }],
        },
        joinCode: { code: "ABCD-234", issuedAt: "2026-09-29T00:00:00.000Z" },
      };

      it("POSTs the trimmed name, returns the mapped household plus the one-time join code", async () => {
        let capturedUrl: string | undefined;
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return Promise.resolve(
            new Response(JSON.stringify(SAMPLE_CREATE_RESPONSE), { status: 201 }),
          );
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.createHousehold("  The Ostrowskis  ");

        expect(capturedUrl).toBe("http://localhost:4000/v1/households");
        expect(capturedInit?.method).toBe("POST");
        expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
          `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
        );
        expect(parsedBody<{ name: string }>(capturedInit)).toEqual({ name: "The Ostrowskis" });
        expect(result.householdId).toBe("hh-1");
        expect(result.name).toBe("The Ostrowskis");
        expect(result.joinCode).toBe("ABCD-234");
        // Server sends only initials (M2-T3, never a full name); mapped through
        // as this client's stand-in displayName, restrictions/preferences local.
        expect(result.members).toEqual([
          {
            memberId: "mem-1",
            displayName: "NH",
            role: "owner",
            restrictions: [],
            noneConfirmed: false,
            preferences: [],
          },
        ]);
      });

      it("a 400 BAD_REQUEST (invalid name) throws LedgerRefusedError", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "BAD_REQUEST", message: "bad", correlationId: "c1" },
              }),
              { status: 400 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        await expect(client.createHousehold("The Ostrowskis")).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      });

      it("feeds getOnboardingState's household half afterward, restrictions saved locally survive a later resync", async () => {
        globalThis.fetch = () =>
          Promise.resolve(new Response(JSON.stringify(SAMPLE_CREATE_RESPONSE), { status: 201 }));
        const client = new HttpApiClient("http://localhost:4000");
        await client.createHousehold("The Ostrowskis");

        await client.saveMemberRestrictions("mem-1", [], { noneConfirmed: true });

        // A later GET /v1/households/me for the same household+members
        // must not wipe the restriction just saved.
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(JSON.stringify(SAMPLE_CREATE_RESPONSE.household), { status: 200 }),
          );
        const state = await client.getOnboardingState();
        expect(state.household?.members[0]?.noneConfirmed).toBe(true);
      });
    });

    describe("joinHousehold (M3-T4d: real POST /v1/households/join)", () => {
      const SAMPLE_JOIN_RESPONSE = {
        household: {
          householdId: "hh-chen",
          name: "The Chens",
          members: [
            { memberId: "mem-dean", displayInitials: "DC", role: "owner", isCaller: false },
            { memberId: "mem-maya", displayInitials: "MC", role: "member", isCaller: true },
          ],
        },
        alreadyMember: false,
      };

      it("POSTs the code, returns ok:true with the mapped household and alreadyMember", async () => {
        let capturedUrl: string | undefined;
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = ((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return Promise.resolve(
            new Response(JSON.stringify(SAMPLE_JOIN_RESPONSE), { status: 200 }),
          );
        }) as typeof fetch;

        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("CHEN-482");

        expect(capturedUrl).toBe("http://localhost:4000/v1/households/join");
        expect(parsedBody<{ code: string }>(capturedInit)).toEqual({ code: "CHEN-482" });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.household.householdId).toBe("hh-chen");
          expect(result.household.members).toHaveLength(2);
          expect(result.alreadyMember).toBe(false);
        }
      });

      it("a repeat join maps alreadyMember: true", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(JSON.stringify({ ...SAMPLE_JOIN_RESPONSE, alreadyMember: true }), {
              status: 200,
            }),
          );
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("CHEN-482");
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.alreadyMember).toBe(true);
        }
      });

      it("a 404 JOIN_CODE_INVALID resolves ok:false with the exact S1 string, never the server message", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  code: "JOIN_CODE_INVALID",
                  message: "this exact sentence must never reach the screen",
                  correlationId: "c1",
                },
              }),
              { status: 404 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("WRONG-000");
        expect(result).toEqual({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });
      });

      it("a 429 RATE_LIMITED resolves ok:false with the §8 rate-limit string", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "RATE_LIMITED", message: "too many", correlationId: "c1" },
              }),
              { status: 429 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("CHEN-482");
        expect(result).toEqual({
          ok: false,
          message: "Too many tries. Wait a few minutes and try again.",
        });
      });

      it("any other failure (e.g. a 500, or a network failure) resolves ok:false with the generic fallback", async () => {
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: "INTERNAL", message: "boom", correlationId: "c1" } }),
              { status: 500 },
            ),
          );
        const client = new HttpApiClient("http://localhost:4000");
        const serverErrorResult = await client.joinHousehold("CHEN-482");
        expect(serverErrorResult.ok).toBe(false);

        globalThis.fetch = () => Promise.reject(new Error("network down"));
        const networkFailureResult = await client.joinHousehold("CHEN-482");
        expect(networkFailureResult.ok).toBe(false);
      });

      it("a malformed 2xx body resolves ok:false with the generic fallback, never an unhandled rejection (review F10)", async () => {
        globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("CHEN-482");
        expect(result).toEqual({ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE });
      });

      it("an unparsable 2xx body (not JSON at all) resolves ok:false the same way (review F10)", async () => {
        globalThis.fetch = () => Promise.resolve(new Response("not json", { status: 200 }));
        const client = new HttpApiClient("http://localhost:4000");
        const result = await client.joinHousehold("CHEN-482");
        expect(result).toEqual({ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE });
      });
    });
  });
});

describe("FixtureApiClient shopping methods (M3-T5)", () => {
  it("getShoppingList returns the fixture Chen list, grouped and ordered as the JSON authors it", async () => {
    const client = FixtureApiClient.returningUser();
    const list = await client.getShoppingList();
    expect(list.rows.map((r) => r.rowId)).toEqual([
      "row-chicken",
      "row-broccoli",
      "row-garlic",
      "row-granola",
      "row-paper-towels",
      "row-olive-oil",
      "row-rice",
      "row-soy-sauce",
    ]);
    expect(list.members.map((m) => m.initials)).toEqual(["DC", "MC"]);
  });

  it("checkOffShoppingRow(true) marks a row done and records the checker's initials", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "key-1");
    const list = await client.getShoppingList();
    const row = list.rows.find((r) => r.rowId === "row-chicken")!;
    expect(row.status).toBe("done");
    expect(row.checkedOffBy).toBe("DC");
  });

  it("checkOffShoppingRow(false) reopens a row and clears checkedOffBy", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "key-1");
    await client.checkOffShoppingRow("row-chicken", false, "key-2");
    const list = await client.getShoppingList();
    const row = list.rows.find((r) => r.rowId === "row-chicken")!;
    expect(row.status).toBe("open");
    expect(row.checkedOffBy).toBeNull();
  });

  it("checkOffShoppingRow rejects an unknown rowId", async () => {
    const client = FixtureApiClient.returningUser();
    await expect(client.checkOffShoppingRow("not-a-row", true, "key-1")).rejects.toThrow();
  });

  it("removeShoppingSuggestion deletes the row entirely", async () => {
    const client = FixtureApiClient.returningUser();
    await client.removeShoppingSuggestion("row-garlic");
    const list = await client.getShoppingList();
    expect(list.rows.some((r) => r.rowId === "row-garlic")).toBe(false);
  });

  it("removeShoppingSuggestion rejects an unknown rowId", async () => {
    const client = FixtureApiClient.returningUser();
    await expect(client.removeShoppingSuggestion("not-a-row")).rejects.toThrow();
  });

  it("addCheckedOffToInventory appends exactly one PURCHASE of buyMicros, Known Fact, in the item's own unit", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "check-key-1");
    const before = await client.getInventoryItem("fixture-item-chicken");
    const beforeMicros = before!.summary.quantity.micros;

    const result = await client.addCheckedOffToInventory("row-chicken", "key-add-1");
    const after = await client.getInventoryItem("fixture-item-chicken");

    expect(after?.summary.quantity.micros).toBe((BigInt(beforeMicros) + 750_000n).toString());
    const appended = ledgerRowsOf(after!.history).at(-1)!;
    expect(appended.type).toBe("PURCHASE");
    expect(appended.deltaMicros).toBe("750000");
    // Review F6: not just the delta/type — the row's declared unit ("lb")
    // must be the one the PURCHASE actually lands in, and its provenance
    // must be Known Fact, never left to default to whatever `appendIncrease`
    // happens to accept.
    expect(appended.provenance.tier).toBe("KNOWN_FACT");
    expect(after?.summary.quantity.unit).toBe("lb");
    expect(result.transactionId).toBe(appended.transactionId);
  });

  it("addCheckedOffToInventory refuses a row that has not been checked off (review F3)", async () => {
    const client = FixtureApiClient.returningUser();
    // row-chicken starts "open" in the fixture; never checked off here.
    await expect(client.addCheckedOffToInventory("row-chicken", "key-1")).rejects.toThrow();
  });

  it("addCheckedOffToInventory replayed with the same idempotency key does not append a second PURCHASE (CLAUDE.md rule 10)", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "check-key-1");
    const first = await client.addCheckedOffToInventory("row-chicken", "same-key");
    const before = await client.getInventoryItem("fixture-item-chicken");
    const historyLengthBefore = before!.history.length;

    const second = await client.addCheckedOffToInventory("row-chicken", "same-key");
    const after = await client.getInventoryItem("fixture-item-chicken");

    expect(second.transactionId).toBe(first.transactionId);
    expect(after!.history.length).toBe(historyLengthBefore);
  });

  it("addCheckedOffToInventory with a different idempotency key for the same row's check-off does NOT append again (review F3, replaces the old 'enshrining' test)", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "check-key-1");
    const first = await client.addCheckedOffToInventory("row-chicken", "key-a");
    const before = await client.getInventoryItem("fixture-item-chicken");
    const historyLengthBefore = before!.history.length;

    // A different idempotency key, same row, same check-off episode
    // (never unchecked in between): dedup is per-row, not per-key.
    const second = await client.addCheckedOffToInventory("row-chicken", "key-b");
    const after = await client.getInventoryItem("fixture-item-chicken");
    expect(after!.history.length).toBe(historyLengthBefore);
    expect(second.transactionId).toBe(first.transactionId);
  });

  it("Add, uncheck, re-check, Add: still only one PURCHASE total (review F3, buyMicros is a fixed fact of the row, not a live remaining gap)", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-chicken", true, "check-key-1");
    await client.addCheckedOffToInventory("row-chicken", "key-a");
    const afterFirstAdd = await client.getInventoryItem("fixture-item-chicken");
    const historyLengthAfterFirstAdd = afterFirstAdd!.history.length;

    await client.checkOffShoppingRow("row-chicken", false, "check-key-2"); // uncheck
    await client.checkOffShoppingRow("row-chicken", true, "check-key-3"); // re-check
    await client.addCheckedOffToInventory("row-chicken", "key-c");

    const after = await client.getInventoryItem("fixture-item-chicken");
    expect(after!.history.length).toBe(historyLengthAfterFirstAdd);
  });

  it("assertShoppingRowUnitMatchesItem refuses a unit mismatch and accepts a match (review F6)", () => {
    expect(() => assertShoppingRowUnitMatchesItem("row-x", "item-x", "lb", "lb")).not.toThrow();
    expect(() => assertShoppingRowUnitMatchesItem("row-x", "item-x", "lb", "each")).toThrow(
      /row unit "lb" does not match item "item-x"'s unit "each"/,
    );
  });

  it("addCheckedOffToInventory rejects a row with no itemId (must route through S9 instead)", async () => {
    const client = FixtureApiClient.returningUser();
    await client.checkOffShoppingRow("row-broccoli", true, "check-key-1");
    await expect(client.addCheckedOffToInventory("row-broccoli", "key-1")).rejects.toThrow();
  });

  it("isOffline starts false and setOfflineForDev flips it, notifying subscribers exactly once per change", () => {
    const client = FixtureApiClient.returningUser();
    expect(client.isOffline()).toBe(false);

    const seen: boolean[] = [];
    const unsubscribe = client.subscribeOffline((value) => seen.push(value));

    client.setOfflineForDev(true);
    client.setOfflineForDev(true); // no-op: already offline, must not notify again
    client.setOfflineForDev(false);

    expect(seen).toEqual([true, false]);
    unsubscribe();
    client.setOfflineForDev(true);
    expect(seen).toEqual([true, false]); // no further notification after unsubscribe
  });
});

describe("HttpApiClient shopping methods (M7-T1, fake fetch, no real network)", () => {
  const originalFetch = globalThis.fetch;
  const BASE = "http://localhost:4000";
  const ROW_ID = "0190f0a0-0000-7000-8000-000000000001";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  interface Captured {
    readonly url: string;
    readonly init: RequestInit | undefined;
  }

  /** Fake fetch answering each call from `answers` in order; records every request. */
  function fakeFetch(answers: ReadonlyArray<() => Promise<Response>>): Captured[] {
    const calls: Captured[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const answer = answers[calls.length - 1];
      if (answer === undefined) throw new Error(`unexpected fetch #${String(calls.length)}`);
      return answer();
    }) as typeof fetch;
    return calls;
  }

  const ok =
    (body: unknown, status = 200) =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
  const refused = (status: number, code: string, ledgerCode?: string) => () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            code,
            message: "a server sentence that must never reach a screen",
            correlationId: "c-1",
            ...(ledgerCode === undefined ? {} : { ledgerCode }),
          },
        }),
        { status },
      ),
    );
  const networkDown = () => Promise.reject(new Error("network down"));
  const noContent = () => Promise.resolve(new Response(null, { status: 204 }));

  const LIST: ShoppingListDto = {
    rows: [
      {
        rowId: ROW_ID,
        name: "Chicken breast",
        group: "Meat & seafood",
        origin: { kind: "member", memberId: "m-dean", initials: "DC", displayName: "Dean Chen" },
        needMicros: "2000000",
        haveMicros: "1250000",
        haveTier: "KNOWN_FACT",
        buyMicros: "750000",
        unit: "lb",
        itemId: "item-chicken",
        status: "open",
        checkedOffBy: null,
        defaultLocation: "FRIDGE",
      },
    ],
    members: [{ memberId: "m-dean", initials: "DC", displayName: "Dean Chen" }],
    syncedAt: "2026-09-29T12:00:00.000Z",
  };

  const PURCHASE = {
    transactionId: "tx-purchase",
    type: "PURCHASE",
    deltaMicros: "750000",
    amount: "0.750000",
    recordedAt: "2026-09-29T12:00:00.000Z",
    actor: { kind: "user", displayInitials: "DC" },
    provenance: {
      tier: "KNOWN_FACT",
      source: "shopping-check-off",
      confidence: null,
      recordedAt: "2026-09-29T12:00:00.000Z",
    },
    reason: null,
  };
  const ADD_RESPONSE = {
    transactions: [PURCHASE],
    item: { summary: {}, history: [PURCHASE] },
    replayed: false,
  };

  it("getShoppingList GETs /v1/shopping with the bearer token and passes the server's rows through, buy included", async () => {
    const calls = fakeFetch([ok(LIST)]);
    const client = new HttpApiClient(BASE);
    const list = await client.getShoppingList();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}${SHOPPING_PATH}`);
    expect(calls[0]?.init?.headers).toEqual({ Authorization: `Bearer ${FIXTURE_IDENTITY_TOKEN}` });
    expect(list).toEqual(LIST);
  });

  it("getShoppingList never recomputes the buy: a server buy that is not need minus have comes back as sent", async () => {
    const odd: ShoppingListDto = {
      ...LIST,
      rows: [{ ...LIST.rows[0]!, buyMicros: "1000000" }],
    };
    fakeFetch([ok(odd)]);
    const list = await new HttpApiClient(BASE).getShoppingList();
    expect(list.rows[0]?.buyMicros).toBe("1000000");
  });

  it.each([
    ["a non-2xx status", refused(500, "INTERNAL")],
    ["a malformed body", ok({ rows: "nope" })],
    [
      "a row whose micros are not decimal text",
      ok({ ...LIST, rows: [{ ...LIST.rows[0]!, buyMicros: 0.75 }] }),
    ],
    [
      "a row with an unknown status",
      ok({ ...LIST, rows: [{ ...LIST.rows[0]!, status: "bought" }] }),
    ],
    ["a network failure", networkDown],
  ])("getShoppingList rejects on %s, so S11 shows the read fallback", async (_label, answer) => {
    const calls = fakeFetch([answer]);
    await expect(new HttpApiClient(BASE).getShoppingList()).rejects.toThrow();
    // A read is never retried by the client; S11's Try again is the retry.
    expect(calls).toHaveLength(1);
  });

  it("checkOffShoppingRow POSTs { checked, idempotencyKey } to the row's check path with the caller's key", async () => {
    const calls = fakeFetch([ok(LIST.rows[0])]);
    await new HttpApiClient(BASE).checkOffShoppingRow(ROW_ID, true, "k-tap-1");
    expect(calls[0]?.url).toBe(`${BASE}${shoppingRowCheckPath(ROW_ID)}`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(parsedBody<CheckShoppingRowRequestDto>(calls[0]?.init)).toEqual({
      checked: true,
      idempotencyKey: "k-tap-1",
    });
  });

  it("checkOffShoppingRow retries a lost request once with the same key, never a new one", async () => {
    const calls = fakeFetch([networkDown, ok(LIST.rows[0])]);
    await new HttpApiClient(BASE).checkOffShoppingRow(ROW_ID, false, "k-tap-2");
    expect(calls).toHaveLength(2);
    const keys = calls.map((call) => parsedBody<CheckShoppingRowRequestDto>(call.init));
    expect(keys).toEqual([
      { checked: false, idempotencyKey: "k-tap-2" },
      { checked: false, idempotencyKey: "k-tap-2" },
    ]);
  });

  it("the in-session queue replays through the real endpoint with the key minted at tap time", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue({ rowId: ROW_ID, checked: true, idempotencyKey: "k-offline-1" });
    const calls = fakeFetch([ok(LIST.rows[0])]);
    const client = new HttpApiClient(BASE);
    await queue.replay((entry) =>
      client.checkOffShoppingRow(entry.rowId, entry.checked, entry.idempotencyKey),
    );
    expect(queue.size).toBe(0);
    expect(calls).toHaveLength(1);
    expect(parsedBody<CheckShoppingRowRequestDto>(calls[0]?.init).idempotencyKey).toBe(
      "k-offline-1",
    );
  });

  it("a 409 IDEMPOTENCY_KEY_CONFLICT renders its §8 sentence, never the server's message", async () => {
    fakeFetch([refused(409, "CONFLICT", "IDEMPOTENCY_KEY_CONFLICT")]);
    const error: unknown = await new HttpApiClient(BASE)
      .checkOffShoppingRow(ROW_ID, true, "k-1")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LedgerRefusedError);
    expect((error as LedgerRefusedError).code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(messageForLedgerError(error)).toBe(
      "That request was already used for a different change, so it was not applied again.",
    );
  });

  it.each([
    ["404 NOT_FOUND", refused(404, "NOT_FOUND")],
    ["409 ROW_HAS_NO_ITEM", refused(409, "ROW_HAS_NO_ITEM")],
    [
      "400 ZERO_DELTA (S5's sentence would be wrong here)",
      refused(400, "BAD_REQUEST", "ZERO_DELTA"),
    ],
    ["400 MIXED_UNITS", refused(400, "BAD_REQUEST", "MIXED_UNITS")],
    ["500 with an HTML body", () => Promise.resolve(new Response("<html>", { status: 500 }))],
  ])("any other write refusal (%s) renders the generic save fallback", async (_label, answer) => {
    fakeFetch([answer]);
    const error: unknown = await new HttpApiClient(BASE)
      .addCheckedOffToInventory(ROW_ID, "k-add")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LedgerRefusedError);
    expect(messageForLedgerError(error)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });

  it("addCheckedOffToInventory POSTs the caller's key and resolves the row's PURCHASE id, for 201 and 200 alike", async () => {
    const calls = fakeFetch([ok(ADD_RESPONSE, 201), ok({ ...ADD_RESPONSE, replayed: true })]);
    const client = new HttpApiClient(BASE);
    const first = await client.addCheckedOffToInventory(ROW_ID, "k-bar-1");
    const second = await client.addCheckedOffToInventory(ROW_ID, "k-bar-1");
    expect(first).toEqual({ transactionId: "tx-purchase" });
    expect(second).toEqual({ transactionId: "tx-purchase" });
    expect(calls[0]?.url).toBe(`${BASE}${shoppingRowAddToInventoryPath(ROW_ID)}`);
    expect(parsedBody<AddShoppingRowToInventoryRequestDto>(calls[0]?.init)).toEqual({
      idempotencyKey: "k-bar-1",
    });
    expect(parsedBody<AddShoppingRowToInventoryRequestDto>(calls[1]?.init)).toEqual({
      idempotencyKey: "k-bar-1",
    });
  });

  it("addCheckedOffToInventory retries a lost request once with the same key", async () => {
    const calls = fakeFetch([networkDown, ok(ADD_RESPONSE, 201)]);
    await new HttpApiClient(BASE).addCheckedOffToInventory(ROW_ID, "k-bar-2");
    expect(calls.map((call) => parsedBody<{ idempotencyKey: string }>(call.init))).toEqual([
      { idempotencyKey: "k-bar-2" },
      { idempotencyKey: "k-bar-2" },
    ]);
  });

  it("addCheckedOffToInventory rejects a 2xx body with no transaction rather than inventing an id", async () => {
    fakeFetch([ok({ ...ADD_RESPONSE, transactions: [] })]);
    await expect(new HttpApiClient(BASE).addCheckedOffToInventory(ROW_ID, "k")).rejects.toThrow(
      /unexpected response body/,
    );
  });

  it("removeShoppingSuggestion POSTs an empty body to the row's remove path and accepts 204", async () => {
    const calls = fakeFetch([noContent]);
    await new HttpApiClient(BASE).removeShoppingSuggestion(ROW_ID);
    expect(calls[0]?.url).toBe(`${BASE}${shoppingRowRemovePath(ROW_ID)}`);
    expect(parsedBody<Record<string, never>>(calls[0]?.init)).toEqual({});
  });

  it("removeShoppingSuggestion maps a refusal to the generic fallback", async () => {
    fakeFetch([refused(404, "NOT_FOUND")]);
    const error: unknown = await new HttpApiClient(BASE)
      .removeShoppingSuggestion(ROW_ID)
      .catch((caught: unknown) => caught);
    expect(messageForLedgerError(error)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });

  it("shopping requests feed the connectivity signal: unreachable marks offline, any answer marks online", async () => {
    const client = new HttpApiClient(BASE);
    const seen: boolean[] = [];
    client.subscribeOffline((value) => seen.push(value));

    fakeFetch([networkDown, networkDown]);
    await expect(client.checkOffShoppingRow(ROW_ID, true, "k-1")).rejects.toThrow();
    expect(client.isOffline()).toBe(true);

    // A refusal is still an answer from the server: online.
    fakeFetch([refused(409, "CONFLICT", "IDEMPOTENCY_KEY_CONFLICT")]);
    await expect(client.checkOffShoppingRow(ROW_ID, true, "k-1")).rejects.toThrow();
    expect(client.isOffline()).toBe(false);

    fakeFetch([networkDown]);
    await expect(client.getShoppingList()).rejects.toThrow();
    expect(client.isOffline()).toBe(true);
    fakeFetch([ok(LIST)]);
    await client.getShoppingList();
    expect(client.isOffline()).toBe(false);

    expect(seen).toEqual([true, false, true, false]);
  });

  it("isOffline still reuses the same signal isInventoryStale tracks", async () => {
    const client = new HttpApiClient(BASE);
    expect(client.isOffline()).toBe(false);
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await client.getInventoryItems();
    expect(client.isOffline()).toBe(false);
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    await client.getInventoryItems();
    expect(client.isOffline()).toBe(true);
  });
});

describe("hasDevOfflineToggle (M3-T5)", () => {
  it("is true for FixtureApiClient, false for HttpApiClient", () => {
    expect(hasDevOfflineToggle(FixtureApiClient.returningUser())).toBe(true);
    expect(hasDevOfflineToggle(new HttpApiClient("http://localhost:4000"))).toBe(false);
  });
});

describe("hasHouseholdCallerActions (M3-T6)", () => {
  it("is true for HttpApiClient, false for FixtureApiClient", () => {
    expect(hasHouseholdCallerActions(new HttpApiClient("http://localhost:4000"))).toBe(true);
    expect(hasHouseholdCallerActions(FixtureApiClient.returningUser())).toBe(false);
  });
});

describe("FixtureApiClient.signOut (M3-T6)", () => {
  it("returns to newUser()'s exact starting state: no household, empty inventory", async () => {
    const client = FixtureApiClient.returningUser();
    expect((await client.getOnboardingState()).household).not.toBeNull();
    expect((await client.getInventoryItems()).length).toBeGreaterThan(0);

    await client.signOut();

    expect((await client.getOnboardingState()).household).toBeNull();
    expect(await client.getInventoryItems()).toEqual([]);
  });

  it("a fresh join after sign-out works exactly as it would for a brand-new user", async () => {
    const client = FixtureApiClient.returningUser();
    await client.signOut();
    const result = await client.joinHousehold(FIXTURE_JOIN_CODE);
    expect(result.ok).toBe(true);
  });
});

describe("HttpApiClient.getCallerSummary / signOut / rotateJoinCode (M3-T6)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const SAMPLE_HOUSEHOLD_SUMMARY = {
    householdId: "hh-chen",
    name: "The Chens",
    members: [
      { memberId: "mem-dean", displayInitials: "DC", role: "owner", isCaller: true },
      { memberId: "mem-maya", displayInitials: "MC", role: "member", isCaller: false },
    ],
  };

  describe("getCallerSummary", () => {
    it("is null before any household read", () => {
      const client = new HttpApiClient("http://localhost:4000");
      expect(client.getCallerSummary()).toBeNull();
    });

    it("getOnboardingState reads the caller's own row (isCaller) off the wire, initials plus role only", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(SAMPLE_HOUSEHOLD_SUMMARY), { status: 200 }));
      const client = new HttpApiClient("http://localhost:4000");
      await client.getOnboardingState();
      expect(client.getCallerSummary()).toEqual({ displayInitials: "DC", role: "owner" });
    });

    it("createHousehold's response also feeds it", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              household: SAMPLE_HOUSEHOLD_SUMMARY,
              joinCode: { code: "ABCD-234", issuedAt: "2026-09-29T00:00:00.000Z" },
            }),
            { status: 201 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      await client.createHousehold("The Chens");
      expect(client.getCallerSummary()).toEqual({ displayInitials: "DC", role: "owner" });
    });

    it("joinHousehold's response also feeds it, for the joining member's own role", async () => {
      const mayaIsCaller = {
        ...SAMPLE_HOUSEHOLD_SUMMARY,
        members: SAMPLE_HOUSEHOLD_SUMMARY.members.map((m) => ({
          ...m,
          isCaller: m.memberId === "mem-maya",
        })),
      };
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ household: mayaIsCaller, alreadyMember: true }), {
            status: 200,
          }),
        );
      const client = new HttpApiClient("http://localhost:4000");
      await client.joinHousehold("CHEN-482");
      expect(client.getCallerSummary()).toEqual({ displayInitials: "MC", role: "member" });
    });
  });

  describe("signOut", () => {
    it("forgets both the delegate's household and the cached caller identity", async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(SAMPLE_HOUSEHOLD_SUMMARY), { status: 200 }));
      const client = new HttpApiClient("http://localhost:4000");
      await client.getOnboardingState();
      expect(client.getCallerSummary()).not.toBeNull();

      await client.signOut();

      expect(client.getCallerSummary()).toBeNull();
      // The delegate's own household is gone too, not just this client's
      // cached caller row: saving a restriction for a member id that
      // existed before sign-out now rejects the same "no household yet"
      // way a client that never read one in the first place would.
      await expect(
        client.saveMemberRestrictions("mem-dean", [], { noneConfirmed: true }),
      ).rejects.toThrow(/no household yet/);
    });

    it("drops the cached inventory read too (review round 1, F3): a failed read after sign-out never serves the previous household's items", async () => {
      const client = new HttpApiClient("http://localhost:4000");
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
      await client.getInventoryItems();
      expect(client.isInventoryStale()).toBe(false);

      await client.signOut();

      // Before any post-sign-out read, the stale flag must already read
      // false (a fresh client's own starting value), not whatever the
      // previous household's last successful read left it at.
      expect(client.isInventoryStale()).toBe(false);

      globalThis.fetch = () => Promise.reject(new Error("network down"));
      await expect(client.getInventoryItems()).rejects.toThrow("network down");
    });

    it("clears the stale flag itself (review round 2, F3): go stale first, then sign out", async () => {
      const client = new HttpApiClient("http://localhost:4000");
      globalThis.fetch = () =>
        Promise.resolve(new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }));
      await client.getInventoryItems();
      // A failed read with a cache present serves the cache and goes stale.
      globalThis.fetch = () => Promise.reject(new Error("network down"));
      await client.getInventoryItems();
      expect(client.isInventoryStale()).toBe(true);
      expect(client.isOffline()).toBe(true);

      await client.signOut();

      expect(client.isInventoryStale()).toBe(false);
      expect(client.isOffline()).toBe(false);
    });
  });

  describe("rotateJoinCode", () => {
    it("POSTs with no body, returns ok:true with the new one-time code", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = ((url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              joinCode: { code: "WXYZ-999", issuedAt: "2026-09-30T00:00:00.000Z" },
            }),
            { status: 200 },
          ),
        );
      }) as typeof fetch;

      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.rotateJoinCode();

      expect(capturedUrl).toBe("http://localhost:4000/v1/households/me/join-code");
      expect(capturedInit?.method).toBe("POST");
      expect(capturedInit?.body).toBeUndefined();
      expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
      );
      expect(result).toEqual({ ok: true, code: "WXYZ-999" });
    });

    it("a 403 NOT_OWNER resolves ok:false with the exact §8 string, never the server message", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "NOT_OWNER",
                message: "this exact sentence must never reach the screen",
                correlationId: "c1",
              },
            }),
            { status: 403 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.rotateJoinCode();
      expect(result).toEqual({ ok: false, message: NOT_OWNER_MESSAGE });
    });

    it("any other failure (a 500, or a network failure) resolves ok:false with the generic fallback", async () => {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "INTERNAL", message: "boom", correlationId: "c1" } }),
            { status: 500 },
          ),
        );
      const client = new HttpApiClient("http://localhost:4000");
      const serverErrorResult = await client.rotateJoinCode();
      expect(serverErrorResult).toEqual({ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE });

      globalThis.fetch = () => Promise.reject(new Error("network down"));
      const networkFailureResult = await client.rotateJoinCode();
      expect(networkFailureResult).toEqual({ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE });
    });

    it("a malformed 2xx body resolves ok:false with the generic fallback, never an unhandled rejection", async () => {
      globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      const client = new HttpApiClient("http://localhost:4000");
      const result = await client.rotateJoinCode();
      expect(result).toEqual({ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE });
    });
  });
});

describe("HttpApiClient.confirmAiProposal (M2-T5: real POST /v1/inventory/items/{id}/confirm, mocked fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const AI_ROW: InventoryItemSummaryDto = {
    ...SAMPLE_RESPONSE.items[0]!,
    itemId: "item-ai",
    displayName: "Strawberries",
    provenance: {
      quantity: {
        tier: "AI_INTERPRETATION",
        source: "receipt read “ORG STRWB 1LB”",
        confidence: null,
        recordedAt: null,
      },
      earliestExpiresAt: null,
    },
  };

  const CONFIRMED_ROW: InventoryItemSummaryDto = {
    ...AI_ROW,
    provenance: {
      quantity: {
        tier: "KNOWN_FACT",
        source: "receipt read “ORG STRWB 1LB” · confirmed by DC",
        confidence: null,
        recordedAt: null,
      },
      earliestExpiresAt: null,
    },
  };

  const LIST: InventoryItemsResponseDto = { items: [SAMPLE_RESPONSE.items[0]!, AI_ROW] };

  function confirmedResponse(): Response {
    return new Response(JSON.stringify({ item: { summary: CONFIRMED_ROW, history: [] } }), {
      status: 200,
    });
  }

  function refused(status: number, code: string): Response {
    return new Response(
      JSON.stringify({ error: { code, message: "server sentence", correlationId: "c1" } }),
      { status },
    );
  }

  it("POSTs the item's confirm path with the bearer and a body carrying only a fresh client key", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(confirmedResponse());
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.confirmAiProposal("item-ai");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:4000/v1/inventory/items/item-ai/confirm");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${FIXTURE_IDENTITY_TOKEN}`,
    );
    const body = parsedBody<Record<string, unknown>>(calls[0]?.init);
    expect(Object.keys(body)).toEqual(["idempotencyKey"]);
    expect(body["idempotencyKey"]).toMatch(UUID_SHAPE);
  });

  it("goes to the network even for a fixture item id, never to the internal fixture delegate", async () => {
    let called = 0;
    globalThis.fetch = () => {
      called += 1;
      return Promise.resolve(refused(404, "NOT_FOUND"));
    };
    const client = new HttpApiClient("http://localhost:4000");
    const delegate = (client as unknown as { delegate: FixtureApiClient }).delegate;
    const delegateSpy = vi.spyOn(delegate, "confirmAiProposal");
    // The delegate starts from `returningUser()`, which knows this id; the
    // HTTP client must not resolve it locally (the property BUG-004 pinned).
    await expect(client.confirmAiProposal("fixture-item-strawberries")).rejects.toMatchObject({
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
      keys.push(parsedBody<{ idempotencyKey: string }>(init).idempotencyKey);
      if (attempt === 1) return Promise.reject(new TypeError("Network request failed"));
      return Promise.resolve(confirmedResponse());
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.confirmAiProposal("item-ai");

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
    await expect(client.confirmAiProposal("item-ai")).rejects.toThrow("Network request failed");
    expect(attempt).toBe(2);
  });

  it.each([
    ["409 NOT_A_PROPOSAL", 409, "NOT_A_PROPOSAL"],
    ["404 NOT_FOUND", 404, "NOT_FOUND"],
    ["401 UNAUTHENTICATED", 401, "UNAUTHENTICATED"],
  ])(
    "a %s is thrown as LedgerRefusedError with only the code, never retried, never the server sentence",
    async (_case, status, code) => {
      let called = 0;
      globalThis.fetch = () => {
        called += 1;
        return Promise.resolve(refused(status, code));
      };
      const client = new HttpApiClient("http://localhost:4000");

      const error = await client.confirmAiProposal("item-ai").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(LedgerRefusedError);
      expect((error as LedgerRefusedError).code).toBe(code);
      expect(messageForLedgerError(error)).not.toContain("server sentence");
      expect(called).toBe(1);
    },
  );

  it("a 400 with a ledger code surfaces the ledger code", async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "BAD_REQUEST",
              message: "That change could not be recorded.",
              correlationId: "c1",
              ledgerCode: "INVALID_IDEMPOTENCY_KEY",
            },
          }),
          { status: 400 },
        ),
      );
    const client = new HttpApiClient("http://localhost:4000");
    await expect(client.confirmAiProposal("item-ai")).rejects.toMatchObject({
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  });

  it("invalidates the summary cache: an offline reload after a confirm serves the confirmed row, never the AI tier", async () => {
    let online = true;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      if (init?.method === "POST") return Promise.resolve(confirmedResponse());
      expect(url).toBe(`http://localhost:4000${INVENTORY_ITEMS_PATH}`);
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    const before = await client.getInventoryItems();
    expect(before.find((item) => item.itemId === "item-ai")?.provenance.quantity?.tier).toBe(
      "AI_INTERPRETATION",
    );

    await client.confirmAiProposal("item-ai");
    online = false;
    const after = await client.getInventoryItems();

    expect(client.isInventoryStale()).toBe(true);
    expect(after.find((item) => item.itemId === "item-ai")).toEqual(CONFIRMED_ROW);
    // Every other cached row is left exactly as it was.
    expect(after.find((item) => item.itemId === "item-1")).toEqual(SAMPLE_RESPONSE.items[0]);
  });

  it("does not invent a cache when none was loaded yet", async () => {
    let online = true;
    globalThis.fetch = () => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      return Promise.resolve(confirmedResponse());
    };
    const client = new HttpApiClient("http://localhost:4000");
    await client.confirmAiProposal("item-ai");
    online = false;
    await expect(client.getInventoryItems()).rejects.toThrow();
  });

  it("a malformed 200 body is an error and leaves the cache untouched", async () => {
    let confirmCalls = 0;
    let online = true;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (!online) return Promise.reject(new TypeError("Network request failed"));
      if (init?.method === "POST") {
        confirmCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }));
    }) as typeof fetch;

    const client = new HttpApiClient("http://localhost:4000");
    await client.getInventoryItems();
    await expect(client.confirmAiProposal("item-ai")).rejects.toThrow(/unexpected response body/);
    expect(confirmCalls).toBe(1);
    online = false;
    const cached = await client.getInventoryItems();
    expect(cached.find((item) => item.itemId === "item-ai")).toEqual(AI_ROW);
  });
});
