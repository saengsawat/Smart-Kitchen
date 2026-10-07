/**
 * Freshness-ring and expiry-urgency text (M3-T3, tokens.md §4.6: the ramp is
 * green/amber/rose, `danger` never appears here).
 *
 * Day counts are calendar arithmetic (`Date` subtraction, day granularity),
 * not ledger quantities, so plain `number` math is fine here (CLAUDE.md rule
 * 7 governs quantity/allergen/nutrition/shopping-gap arithmetic, not a
 * calendar countdown). `takenAt` is passed in rather than read from the
 * clock so this stays a pure, testable function.
 */

import type { ProvenanceTierDto } from "@smart-kitchen/contracts";

export type FreshnessRing = "now" | "soon" | "fresh" | "none";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Day number of a local calendar date. A date-only string ("2026-10-08") is
 * that local date as written (never parsed as UTC midnight, which would shift
 * a day west of UTC); a full instant is read in the device's local zone.
 */
function localDayNumber(value: string): number {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) / DAY_MS;
  }
  const d = new Date(value);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

/**
 * Local calendar days from `takenAt` to `expiresAt`: later today (even 23:59)
 * and earlier today are 0 ("use today"), the next calendar day is 1
 * ("tomorrow"), any earlier calendar day is negative. Not a rolling 24h count.
 */
export function daysUntil(takenAt: string, expiresAt: string): number {
  return localDayNumber(expiresAt) - localDayNumber(takenAt);
}

/**
 * tokens.md §4.6 ramp, thresholds an ENGINEERING INFERENCE from prototype v4's
 * fixture `data-days` values (1 -> rose, 2/3 -> amber, 10/14/60 -> green; no
 * value between 3 and 10 is shown, so the amber/green boundary is inferred
 * from "expiring within a week" as a plain reading of the ramp's intent, not
 * measured from a fifth data point). `null` (no known expiry, e.g. a pantry
 * staple) renders no ring at all, matching the prototype's pantry rows.
 */
export function freshnessRing(days: number | null): FreshnessRing {
  if (days === null) {
    return "none";
  }
  if (days <= 1) {
    return "now";
  }
  if (days <= 7) {
    return "soon";
  }
  return "fresh";
}

/**
 * Raw urgency wording ("use today", "tomorrow", "2 days", "2 weeks",
 * "2 months"). It knows nothing about provenance, so a past date always reads
 * "expired" here. Screens must call `expiryDisplayText` instead, which applies
 * the D-030 "may be expired" rule for non-Known-Fact tiers. `null` (no known
 * expiry) renders no text; the caller (S4 row) shows the qty-derivation note
 * instead, as the prototype's pantry rows do.
 */
export function expiryUrgencyText(days: number | null): string | null {
  if (days === null) {
    return null;
  }
  if (days < 0) {
    return "expired";
  }
  if (days === 0) {
    return "use today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days < 14) {
    return `${days} days`;
  }
  if (days < 60) {
    return `${Math.round(days / 7)} weeks`;
  }
  return `${Math.round(days / 30)} months`;
}

/**
 * D-030 display text for an expiry. A date that is today (day 0) reads
 * "use today", one day out reads "tomorrow"; a past date (`days < 0`) reads "expired" only when the date is a
 * Known Fact, and "may be expired" for Estimated, AI-interpreted or missing
 * provenance, so an estimate never reads as certain. Future dates are
 * unchanged. `null` days means no known expiry and renders no text.
 */
export function expiryDisplayText(
  days: number | null,
  tier: ProvenanceTierDto | null | undefined,
): string | null {
  if (days !== null && days < 0) {
    return tier === "KNOWN_FACT" ? "expired" : "may be expired";
  }
  return expiryUrgencyText(days);
}

/** S5 lot caption wording: "expires today" / "expires tomorrow" / "expires in 3 days" / "expired" / "may be expired". */
export function lotCaptionExpiry(urgency: string): string {
  if (urgency === "expired" || urgency === "may be expired") {
    return urgency;
  }
  if (urgency === "use today") {
    return "expires today";
  }
  if (urgency === "tomorrow") {
    return "expires tomorrow";
  }
  return `expires in ${urgency}`;
}
