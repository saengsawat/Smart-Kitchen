import { describe, expect, it } from "vitest";
import type { InventoryTransactionDto } from "@smart-kitchen/contracts";
import { buildWhyLine, clampSentence, formatRowTimestamp } from "./why";

describe("formatRowTimestamp (S5 history row style, e.g. 'Wed 6:04 pm')", () => {
  it("renders a weekday and a lowercase time", () => {
    const result = formatRowTimestamp("2026-09-16T18:04:00.000Z");
    expect(result).toMatch(new RegExp("^[A-Z][a-z]{2} \\d{1,2}:\\d{2}\\u00a0(am|pm)$"));
  });
});

/** The Chen household chicken-breast history, prototype v4 #scr-item / BACKLOG.md M3-T3. */
const CHICKEN_BREAST_HISTORY: readonly InventoryTransactionDto[] = [
  {
    transactionId: "tx-purchase-1",
    type: "PURCHASE",
    deltaMicros: "2000000",
    amount: "2.000000",
    recordedAt: "2026-09-16T18:04:00.000Z",
    actor: { kind: "user", displayInitials: "DC" },
    provenance: {
      tier: "KNOWN_FACT",
      source: "scanned barcode",
      confidence: null,
      recordedAt: null,
    },
  },
  {
    transactionId: "tx-stirfry",
    type: "USE_IN_MEAL",
    deltaMicros: "-2250000",
    amount: "-2.250000",
    recordedAt: "2026-09-17T19:20:00.000Z",
    actor: { kind: "user", displayInitials: "DC" },
    provenance: {
      tier: "KNOWN_FACT",
      source: "cook confirm, FEFO plan",
      confidence: null,
      recordedAt: null,
    },
    correlationLabel: "Chicken & spinach stir-fry",
  },
  {
    transactionId: "tx-clamp",
    type: "ADJUSTMENT",
    deltaMicros: "250000",
    amount: "0.250000",
    recordedAt: "2026-09-17T19:21:00.000Z",
    actor: { kind: "system" },
    provenance: { tier: "ESTIMATED", source: "ledger-clamp", confidence: null, recordedAt: null },
    systemFlag: "OVER_CONSUMPTION",
  },
  {
    transactionId: "tx-purchase-2",
    type: "PURCHASE",
    deltaMicros: "1250000",
    amount: "1.250000",
    recordedAt: "2026-09-19T17:40:00.000Z",
    actor: { kind: "user", displayInitials: "DC" },
    provenance: {
      tier: "KNOWN_FACT",
      source: "scanned barcode",
      confidence: null,
      recordedAt: null,
    },
  },
];

describe("clampSentence (copy-deck.md §5 'The clamp', verbatim)", () => {
  it("interpolates the trimmed residual and unit", () => {
    expect(clampSentence("0.250000", "lb")).toBe(
      "Our record was 0.25 lb short of what you used. Inventory corrected to match.",
    );
  });
});

describe("buildWhyLine (copy-deck.md §5 template, prototype v4 chicken-breast example)", () => {
  const line = buildWhyLine("1.25 lb", "lb", CHICKEN_BREAST_HISTORY);

  it("opens with the heading naming the current quantity", () => {
    expect(line.startsWith("Why 1.25 lb?")).toBe(true);
  });

  it("renders the purchase rows per the §5 template", () => {
    expect(line).toContain("Purchased · +2 lb · Sep 16 · scanned barcode.");
    expect(line).toContain("Purchased · +1.25 lb · Sep 19 · scanned barcode.");
  });

  it("renders the cooked row with its correlation label, not the raw source", () => {
    expect(line).toContain("Cooked · −2.25 lb · Sep 17 · used in Chicken & spinach stir-fry.");
  });

  it("renders the clamp row as the clamp sentence, not the generic template", () => {
    expect(line).toContain(
      "Our record was 0.25 lb short of what you used. Inventory corrected to match.",
    );
    expect(line).not.toContain("Corrected · +0.25 lb");
  });

  it("rows render in the order given (sequence order), not re-sorted by date", () => {
    const purchaseIndex = line.indexOf("Purchased · +2 lb");
    const cookedIndex = line.indexOf("Cooked");
    const clampIndex = line.indexOf("Our record was");
    const secondPurchaseIndex = line.indexOf("Purchased · +1.25 lb");
    expect(purchaseIndex).toBeLessThan(cookedIndex);
    expect(cookedIndex).toBeLessThan(clampIndex);
    expect(clampIndex).toBeLessThan(secondPurchaseIndex);
  });

  it("a one-tap correction by a person renders 'you' as the source", () => {
    const correction: InventoryTransactionDto = {
      transactionId: "tx-correction",
      type: "ADJUSTMENT",
      deltaMicros: "250000",
      amount: "0.250000",
      recordedAt: "2026-09-20T12:00:00.000Z",
      actor: { kind: "user", displayInitials: "DC" },
      provenance: {
        tier: "KNOWN_FACT",
        source: "one-tap-correction",
        confidence: null,
        recordedAt: null,
      },
    };
    const result = buildWhyLine("1.50 lb", "lb", [correction]);
    expect(result).toContain("Corrected · +0.25 lb · Sep 20 · you.");
  });

  it("a removal renders its reason as its own clause, never folded into 'used in' (review F4)", () => {
    const removal: InventoryTransactionDto = {
      transactionId: "tx-discard",
      type: "DISCARD",
      deltaMicros: "-1000000",
      amount: "-1.000000",
      recordedAt: "2026-09-20T12:00:00.000Z",
      actor: { kind: "user", displayInitials: "DC" },
      provenance: { tier: "KNOWN_FACT", source: "Spoiled", confidence: null, recordedAt: null },
    };
    const result = buildWhyLine("0 lb", "lb", [removal]);
    expect(result).toContain("Discarded · −1 lb · Sep 20 · reason: spoiled.");
    expect(result).not.toContain("used in Spoiled");
  });
});
