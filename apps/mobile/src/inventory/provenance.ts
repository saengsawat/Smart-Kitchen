/**
 * Provenance chip copy and the legend (M3-T3, copy-deck.md §4, verbatim).
 *
 * The AI tier's chip is the `Confirm` action itself, never a static label
 * (copy-deck.md §4: "rendered as the `Confirm` action, not a static chip").
 * Every fallible fact wears one of these three; there is no "no chip" state.
 */

import type { ProvenanceTierDto } from "@smart-kitchen/contracts";

export interface LegendLine {
  readonly tier: ProvenanceTierDto;
  /** The legend screen's full chip label ("Known Fact", "Estimated", "AI"). */
  readonly chipLabel: string;
  readonly legendText: string;
}

/** copy-deck.md §4, tier order, verbatim. */
export const LEGEND_LINES: readonly LegendLine[] = [
  {
    tier: "KNOWN_FACT",
    chipLabel: "Known Fact",
    legendText: "Confirmed by a barcode scan, a printed date, or your own entry.",
  },
  {
    tier: "ESTIMATED",
    chipLabel: "Estimated",
    legendText: "A reasonable estimate, not a confirmed fact. Tap to correct it.",
  },
  {
    tier: "AI_INTERPRETATION",
    chipLabel: "AI",
    legendText: "Read by AI from a photo or receipt. Confirm it before it's counted as fact.",
  },
];

/** copy-deck.md §4's closing line, verbatim. */
export const LEGEND_CLOSING_LINE = "You can always tap a fact to see where it came from.";

/**
 * S4/S5's compact row chip text, prototype v4 `.prov` classes (`✓ Fact`,
 * `≈ Est.`, `AI · confirm`). Review F9 ruling: rows keep this compact form
 * (the reviewed visual) with the deck's full label as the accessibility
 * label (`chipAccessibilityLabel`), not the legend screen's spelled-out
 * chips; the architect amends copy-deck §4 at acceptance to record the
 * compact row form as binding alongside the legend's full one.
 */
export const ROW_CHIP_TEXT: Readonly<Record<ProvenanceTierDto, string>> = {
  KNOWN_FACT: "✓ Fact",
  ESTIMATED: "≈ Est.",
  AI_INTERPRETATION: "AI · confirm",
};

/** copy-deck.md §2: "each provenance chip's accessibility label is '{tier}. {legend line}.'". */
export function chipAccessibilityLabel(tier: ProvenanceTierDto): string {
  const line = LEGEND_LINES.find((entry) => entry.tier === tier);
  if (!line) {
    return tier;
  }
  return `${line.chipLabel}. ${line.legendText}`;
}

/**
 * Review F8: the short tier phrase a list row's own accessibility label
 * appends, so the tier is announced even though the chip itself is a
 * separate element the outer row label does not otherwise include. The
 * AI-tier phrasing also carries "needs confirmation" (copy-deck.md §6's
 * tray heading), since on a row the AI chip doubles as that action
 * (review F9).
 */
export function tierRowAnnouncement(tier: ProvenanceTierDto): string {
  if (tier === "AI_INTERPRETATION") {
    return "AI, needs confirmation";
  }
  const line = LEGEND_LINES.find((entry) => entry.tier === tier);
  return line?.chipLabel ?? tier;
}
