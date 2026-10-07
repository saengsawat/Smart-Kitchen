import { describe, expect, it } from "vitest";
import {
  daysUntil,
  expiryDisplayText,
  expiryUrgencyText,
  freshnessRing,
  lotCaptionExpiry,
} from "./expiry";

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

describe("D-030 expired wording", () => {
  const NOW = "2026-10-07T12:00:00.000Z";

  it("day boundary: later today is not past, a day behind is -1", () => {
    expect(daysUntil(NOW, "2026-10-08T00:00:00.000Z")).toBe(1);
    expect(daysUntil(NOW, "2026-10-07T00:00:00.000Z") < 0).toBe(false);
    expect(daysUntil(NOW, "2026-10-06T12:00:00.000Z")).toBe(-1);
  });

  it("freshness ring for a past date stays 'now'", () => {
    expect(freshnessRing(-3)).toBe("now");
  });

  it.each(["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION", null, undefined] as const)(
    "a date that is today reads 'use today' for tier %s",
    (tier) => {
      expect(expiryDisplayText(0, tier)).toBe("use today");
      expect(expiryDisplayText(1, tier)).toBe("use today");
    },
  );

  it("a past Known Fact reads 'expired'", () => {
    expect(expiryDisplayText(-1, "KNOWN_FACT")).toBe("expired");
    expect(expiryDisplayText(-30, "KNOWN_FACT")).toBe("expired");
  });

  it.each(["ESTIMATED", "AI_INTERPRETATION", null, undefined] as const)(
    "a past date with tier %s reads 'may be expired'",
    (tier) => {
      expect(expiryDisplayText(-1, tier)).toBe("may be expired");
    },
  );

  it("future dates and no expiry are unchanged", () => {
    expect(expiryDisplayText(3, "ESTIMATED")).toBe("3 days");
    expect(expiryDisplayText(14, "KNOWN_FACT")).toBe("2 weeks");
    expect(expiryDisplayText(null, "KNOWN_FACT")).toBeNull();
  });

  it("S5 lot caption wording", () => {
    expect(lotCaptionExpiry("expired")).toBe("expired");
    expect(lotCaptionExpiry("may be expired")).toBe("may be expired");
    expect(lotCaptionExpiry("use today")).toBe("expires today");
    expect(lotCaptionExpiry("3 days")).toBe("expires in 3 days");
  });
});
