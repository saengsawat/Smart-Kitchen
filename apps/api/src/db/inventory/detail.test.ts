/**
 * Actor initials (M2-T2).
 *
 * The one piece of `detail.ts` that is a decision rather than a projection: a
 * person's name enters this function and only two letters leave. Everything
 * else in that module is asserted end to end over real rows in
 * `http/inventory-writes.db.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { displayInitials } from "./detail.js";

describe("displayInitials", () => {
  it.each([
    ["Dean Chen", "DC"],
    ["Maya Chen", "MC"],
    ["Ada Okafor", "AO"],
    ["dean chen", "DC"],
    ["Dean", "D"],
    ["  Dean   Chen  ", "DC"],
    ["Mary Jane Watson", "MW"],
    ["Ólafur Árnason", "ÓÁ"],
  ])("renders %s as %s", (name, chip) => {
    expect(displayInitials(name)).toBe(chip);
  });

  it("has nothing to render for a missing name", () => {
    expect(displayInitials(null)).toBeUndefined();
  });

  it("has nothing to render for a blank name, rather than an empty chip", () => {
    expect(displayInitials("   ")).toBeUndefined();
  });

  it("takes whole code points, so a name outside the BMP is not cut in half", () => {
    // A single astral code point: `[...name][0]` keeps it whole where
    // `name[0]` would return a lone surrogate.
    expect(displayInitials("\u{1D4D3}ean \u{1D4D2}hen")).toBe("\u{1D4D3}\u{1D4D2}");
  });
});
