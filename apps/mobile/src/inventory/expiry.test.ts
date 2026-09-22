import { describe, expect, it } from "vitest";
import { daysUntil, expiryUrgencyText, freshnessRing } from "./expiry";

describe("daysUntil", () => {
  it("rounds a same-day expiry up to 0 (not negative)", () => {
    expect(daysUntil("2026-09-22T08:00:00.000Z", "2026-09-22T20:00:00.000Z")).toBe(1);
  });

  it("counts whole days ahead", () => {
    expect(daysUntil("2026-09-22T12:00:00.000Z", "2026-09-24T12:00:00.000Z")).toBe(2);
  });
});

describe("freshnessRing (tokens.md §4.6 ramp, green/amber/rose, never danger)", () => {
  it.each([
    [1, "now"],
    [2, "soon"],
    [3, "soon"],
    [7, "soon"],
    [10, "fresh"],
    [14, "fresh"],
    [60, "fresh"],
  ] as const)("%i days -> %s", (days, expected) => {
    expect(freshnessRing(days)).toBe(expected);
  });

  it("null (no known expiry) renders no ring", () => {
    expect(freshnessRing(null)).toBe("none");
  });
});

describe("expiryUrgencyText (prototype v4 exact wording)", () => {
  it("1 day is 'use today'", () => {
    expect(expiryUrgencyText(1)).toBe("use today");
  });

  it("2 and 3 days render as plain day counts", () => {
    expect(expiryUrgencyText(2)).toBe("2 days");
    expect(expiryUrgencyText(3)).toBe("3 days");
  });

  it("10 days stays a day count (below the 14-day weeks threshold)", () => {
    expect(expiryUrgencyText(10)).toBe("10 days");
  });

  it("14 days renders as 2 weeks", () => {
    expect(expiryUrgencyText(14)).toBe("2 weeks");
  });

  it("60 days renders as 2 months", () => {
    expect(expiryUrgencyText(60)).toBe("2 months");
  });

  it("null renders no text", () => {
    expect(expiryUrgencyText(null)).toBeNull();
  });
});
