import { describe, expect, it } from "vitest";
import { FIXTURE_IDENTITY_TOKEN, FixtureApiClient } from "./client";

describe("FixtureApiClient (M3-T1, no network)", () => {
  it("supplies the fixture identity token documented in tests/fixtures/identity/README.md", () => {
    const client = new FixtureApiClient();
    expect(client.getIdentityToken()).toBe("fixture.dean.chen");
    expect(client.getIdentityToken()).toBe(FIXTURE_IDENTITY_TOKEN);
  });

  it("getInventoryItems resolves to the Chen household's fixture rows", async () => {
    const client = new FixtureApiClient();
    const items = await client.getInventoryItems();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.householdId).toBe("hh-fixture-chen");
    }
  });

  it("never touches the network (no global fetch call recorded)", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (...args: Parameters<typeof fetch>): never => {
      called = true;
      throw new Error(`FixtureApiClient must never call fetch (args: ${JSON.stringify(args)})`);
    };
    try {
      const client = new FixtureApiClient();
      await client.getInventoryItems();
      client.getIdentityToken();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
