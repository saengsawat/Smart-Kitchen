/**
 * The seed's data, checked against the client fixture it copies (M2-T2).
 *
 * `apps/api` cannot import `apps/mobile`, so the copy is checked by pinning the
 * numbers the client's own tests and the M3-T3 ticket assert: nine items, the
 * quantities prototype v4 draws, and the chicken breast's 2.0 / 2.25 / 1.25
 * worked example whose net is 1.25 lb only because the ledger clamps the
 * overshoot. If somebody edits one of these lists, this file is where the two
 * fixtures being out of step shows up.
 *
 * The id derivation is pinned too. Deterministic ids are the whole basis of the
 * seed being re-runnable, so a change in how they are computed would silently
 * duplicate an entire household's inventory rather than skip it.
 */

import { describe, expect, it } from "vitest";
import { fixtureSeedUuid } from "./fixture-ids.js";
import {
  CHEN_SEED_ITEMS,
  FIXTURE_NOW,
  seedItemId,
  seedLotId,
  seedRowKey,
} from "./fixture-inventory.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Net micro-units the item ends at, with the ledger's clamp accounted for. */
function netMicros(rows: readonly { readonly deltaMicros: bigint }[]): bigint {
  let total = 0n;
  for (const row of rows) total += row.deltaMicros;
  return total;
}

describe("the Chen seed data", () => {
  it("has the prototype's nine items, in its order", () => {
    expect(CHEN_SEED_ITEMS.map((item) => item.displayName)).toEqual([
      "Strawberries",
      "Chicken breast",
      "Spinach",
      "Mushrooms",
      "Greek yogurt",
      "Eggs",
      "Salmon fillets",
      "Basmati rice",
      "Olive oil",
    ]);
  });

  it.each([
    ["strawberries", "lb", 1_000_000n, 1],
    ["spinach", "oz", 5_000_000n, 1],
    ["mushrooms", "oz", 8_000_000n, 1],
    ["yogurt", "oz", 48_000_000n, 3],
    ["eggs", "count", 8_000_000n, 1],
    ["salmon", "oz", 12_000_000n, 2],
    ["rice", "cup", 4_000_000n, 1],
    ["olive-oil", "bottle", 1_000_000n, 1],
  ])("%s holds %s %s across %s lot(s)", (key, unit, micros, lots) => {
    const item = CHEN_SEED_ITEMS.find((candidate) => candidate.key === key);
    expect(item?.unit).toBe(unit);
    expect(item?.lots).toHaveLength(lots);
    expect(netMicros(item?.rows ?? [])).toBe(micros);
  });

  it("gives every lot of a multi-lot item its own opening row", () => {
    // A lot's balance can only come from rows against that lot, so a single
    // row for the total would leave two of the yogurt's three lots empty.
    const yogurt = CHEN_SEED_ITEMS.find((item) => item.key === "yogurt");
    expect(yogurt?.rows.map((row) => row.lotKey)).toEqual(["lot-1", "lot-2", "lot-3"]);
    for (const row of yogurt?.rows ?? []) expect(row.deltaMicros).toBe(16_000_000n);
  });

  it("states the chicken breast's worked example, and leaves the clamp to the ledger", () => {
    const chicken = CHEN_SEED_ITEMS.find((item) => item.key === "chicken");
    expect(chicken?.rows.map((row) => row.deltaMicros)).toEqual([
      2_000_000n,
      -2_250_000n,
      1_250_000n,
    ]);
    // The rows as written sum to 1.0; the item holds 1.25 because the ledger
    // appends its own +0.25 correction for the quarter pound that was used but
    // never there (INV-LEDGER-4). Seeding that row as data would have faked
    // the one row whose meaning is that the system wrote it.
    expect(netMicros(chicken?.rows ?? [])).toBe(1_000_000n);
    expect(chicken?.rows.every((row) => row.actorUser === "dean")).toBe(true);
  });

  it("records the over-consumption against the lot that could not cover it", () => {
    const chicken = CHEN_SEED_ITEMS.find((item) => item.key === "chicken");
    expect(chicken?.rows[1]?.lotKey).toBe("lot-1");
    expect(chicken?.rows[1]?.type).toBe("USE_IN_MEAL");
  });

  it("carries the client fixture's provenance sources verbatim, tiers included", () => {
    const sources = CHEN_SEED_ITEMS.flatMap((item) =>
      item.rows.map((row) => `${row.tier}:${row.source}`),
    );
    expect(sources).toContain("AI_INTERPRETATION:receipt read “ORG STRWB 1LB”");
    expect(sources).toContain("AI_INTERPRETATION:receipt read “CREMINI MUSHRM 8OZ”");
    expect(sources).toContain("ESTIMATED:estimated from meals logged");
    expect(sources).toContain("KNOWN_FACT:cook confirm, FEFO plan");
  });

  it("pins its own clock, because a moving timestamp breaks a re-run", () => {
    expect(FIXTURE_NOW).toBe("2026-09-22T12:00:00.000Z");
  });

  it("gives no two rows the same idempotency key", () => {
    const keys = CHEN_SEED_ITEMS.flatMap((item) =>
      item.rows.map((_row, index) => seedRowKey(item.key, index)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every seed key outside the reserved ledger namespaces", () => {
    for (const item of CHEN_SEED_ITEMS) {
      for (const [index] of item.rows.entries()) {
        expect(seedRowKey(item.key, index)).not.toContain("::");
        expect(seedRowKey(item.key, index)).not.toContain("/lot/");
      }
    }
  });
});

describe("derived seed ids", () => {
  it("are uuids, version 8, with the RFC variant", () => {
    expect(seedItemId("chicken")).toMatch(UUID);
    expect(seedLotId("chicken", "lot-2")).toMatch(UUID);
  });

  it("are stable, which is what makes the seed re-runnable", () => {
    // Pinned values, not just "equal to itself": a change in the derivation
    // would make a second run insert a second copy of the whole household.
    expect(seedItemId("chicken")).toBe(fixtureSeedUuid("item:chicken"));
    expect(seedLotId("chicken", "lot-2")).toBe(fixtureSeedUuid("lot:chicken:lot-2"));
    expect(fixtureSeedUuid("item:chicken")).toBe(fixtureSeedUuid("item:chicken"));
  });

  it("are all distinct across every item and lot", () => {
    const ids = CHEN_SEED_ITEMS.flatMap((item) => [
      seedItemId(item.key),
      ...item.lots.map((lot) => seedLotId(item.key, lot.key)),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("namespaces its names, so an item and a lot of the same name differ", () => {
    expect(fixtureSeedUuid("item:x")).not.toBe(fixtureSeedUuid("lot:x"));
  });
});
