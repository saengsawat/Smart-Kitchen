import { describe, expect, it } from "vitest";
import {
  FIXTURE_IDENTITY_TOKEN,
  FIXTURE_JOIN_CODE,
  FixtureApiClient,
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

    it("joining the fixture household starts with stock already in it", async () => {
      const client = FixtureApiClient.newUser();
      await client.joinHousehold(FIXTURE_JOIN_CODE);
      const items = await client.getInventoryItems();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.householdId).toBe("hh-fixture-chen");
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

    it("starts with existing inventory (an established household, not a first run), every row scoped to the Chen household", async () => {
      const client = FixtureApiClient.returningUser();
      const items = await client.getInventoryItems();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.householdId).toBe("hh-fixture-chen");
      }
    });
  });
});
