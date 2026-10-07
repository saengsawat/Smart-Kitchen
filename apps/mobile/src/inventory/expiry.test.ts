import { describe, expect, it } from "vitest";
import {
  daysUntil,
  expiryDisplayText,
  expiryUrgencyText,
  freshnessRing,
  lotCaptionExpiry,
} from "./expiry";

/** A local-time instant: dayOffset days from 7 Oct 2026, at hh:mm local. */
function local(dayOffset: number, hh: number, mm: number): string {
  return new Date(2026, 9, 7 + dayOffset, hh, mm).toISOString();
}

describe("daysUntil (local calendar days, not a rolling 24h)", () => {
  const NOW = local(0, 12, 0);

  it.each([
    ["later today", local(0, 18, 0), 0],
    ["23:59 today", local(0, 23, 59), 0],
    ["earlier today", local(0, 0, 5), 0],
    ["00:01 tomorrow", local(1, 0, 1), 1],
    ["23:59 tomorrow", local(1, 23, 59), 1],
    ["two days out", local(2, 9, 0), 2],
    ["yesterday", local(-1, 23, 59), -1],
  ] as const)("%s is day %i", (_name, expiresAt, expected) => {
    expect(daysUntil(NOW, expiresAt)).toBe(expected);
  });

  it("a date-only string is that local calendar date, not UTC midnight", () => {
    expect(daysUntil(NOW, "2026-10-07")).toBe(0);
    expect(daysUntil(NOW, "2026-10-08")).toBe(1);
    expect(daysUntil(NOW, "2026-10-06")).toBe(-1);
    expect(daysUntil("2026-10-07", "2026-10-09")).toBe(2);
  });

  it("earlier today is day 0 (use today), not expired", () => {
    const days = daysUntil(NOW, local(0, 0, 5));
    expect(expiryDisplayText(days, "KNOWN_FACT")).toBe("use today");
    expect(expiryDisplayText(days, "ESTIMATED")).toBe("use today");
  });

  it("yesterday is past: expired for Known Fact, may be expired otherwise", () => {
    const days = daysUntil(NOW, local(-1, 23, 59));
    expect(expiryDisplayText(days, "KNOWN_FACT")).toBe("expired");
    expect(expiryDisplayText(days, "ESTIMATED")).toBe("may be expired");
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
  it("0 days is 'use today' and 1 day is 'tomorrow'", () => {
    expect(expiryUrgencyText(0)).toBe("use today");
    expect(expiryUrgencyText(1)).toBe("tomorrow");
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
  it("freshness ring for a past date stays 'now'", () => {
    expect(freshnessRing(-3)).toBe("now");
  });

  it.each(["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION", null, undefined] as const)(
    "days 0, 1, 2 read 'use today', 'tomorrow', '2 days' for tier %s",
    (tier) => {
      expect(expiryDisplayText(0, tier)).toBe("use today");
      expect(expiryDisplayText(1, tier)).toBe("tomorrow");
      expect(expiryDisplayText(2, tier)).toBe("2 days");
    },
  );

  it.each(["ESTIMATED", "AI_INTERPRETATION", null, undefined] as const)(
    "day -1 reads 'may be expired' for tier %s",
    (tier) => {
      expect(expiryDisplayText(-1, tier)).toBe("may be expired");
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
    expect(lotCaptionExpiry("tomorrow")).toBe("expires tomorrow");
    expect(lotCaptionExpiry("2 days")).toBe("expires in 2 days");
    expect(lotCaptionExpiry("3 days")).toBe("expires in 3 days");
  });
});
