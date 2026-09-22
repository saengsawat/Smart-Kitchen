import { describe, expect, it } from "vitest";
import { chipAccessibilityLabel, LEGEND_LINES, tierRowAnnouncement } from "./provenance";

describe("chipAccessibilityLabel (copy-deck.md §2)", () => {
  it("is '{chip label}. {legend text}' for each tier", () => {
    for (const line of LEGEND_LINES) {
      expect(chipAccessibilityLabel(line.tier)).toBe(`${line.chipLabel}. ${line.legendText}`);
    }
  });
});

describe("tierRowAnnouncement (review F8: a list row's own accessibility label must announce its tier)", () => {
  it("Known Fact and Estimated use the legend's chip label", () => {
    expect(tierRowAnnouncement("KNOWN_FACT")).toBe("Known Fact");
    expect(tierRowAnnouncement("ESTIMATED")).toBe("Estimated");
  });

  it("AI carries 'needs confirmation', since the chip doubles as the Confirm action on a row (review F9)", () => {
    expect(tierRowAnnouncement("AI_INTERPRETATION")).toBe("AI, needs confirmation");
  });
});
