import { describe, expect, it } from "vitest";
import { loadInventoryList, type InventoryListSource } from "./load-inventory";

describe("loadInventoryList (review F5: a cold-start rejection must not leave the caller hanging)", () => {
  it("resolves ok with the items and stale flag on success", async () => {
    const client: InventoryListSource = {
      getInventoryItems: () => Promise.resolve([]),
      isInventoryStale: () => false,
    };
    const result = await loadInventoryList(client);
    expect(result).toEqual({ ok: true, items: [], stale: false });
  });

  it("resolves ok:false, never rejects, when the client rejects with no prior cache", async () => {
    const client: InventoryListSource = {
      getInventoryItems: () => Promise.reject(new Error("network down")),
      isInventoryStale: () => false,
    };
    await expect(loadInventoryList(client)).resolves.toEqual({ ok: false });
  });

  it("reports stale:true when the client served a cached result after a failure", async () => {
    const client: InventoryListSource = {
      getInventoryItems: () => Promise.resolve([]),
      isInventoryStale: () => true,
    };
    const result = await loadInventoryList(client);
    expect(result).toEqual({ ok: true, items: [], stale: true });
  });
});
