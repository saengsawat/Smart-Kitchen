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

export type FreshnessRing = "now" | "soon" | "fresh" | "none";

/** Whole days from `takenAt` to `expiresAt`, rounded up (a same-day expiry is day 0, "use today"). */
export function daysUntil(takenAt: string, expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - new Date(takenAt).getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
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
 * Expiry urgency text, prototype v4 exact wording ("use today", "2 days",
 * "2 weeks", "2 months"). `null` (no known expiry) renders no text; the
 * caller (S4 row) shows the qty-derivation note instead, as the prototype's
 * pantry rows do.
 */
export function expiryUrgencyText(days: number | null): string | null {
  if (days === null) {
    return null;
  }
  if (days <= 1) {
    return "use today";
  }
  if (days < 14) {
    return `${days} days`;
  }
  if (days < 60) {
    return `${Math.round(days / 7)} weeks`;
  }
  return `${Math.round(days / 30)} months`;
}
