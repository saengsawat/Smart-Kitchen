import { describe, expect, it } from "vitest";
import type { InventoryLotDto, QuantityDto } from "@smart-kitchen/contracts";
import {
  formatQuantityDisplay,
  formatSignedAmount,
  microsToAmountText,
  MICROS_PER_UNIT,
  parseMicros,
  trimAmountText,
} from "./quantity";

function qty(unit: string, micros: string, amount: string): QuantityDto {
  return { unit, micros, amount };
}

function lot(micros: string, amount: string, label: string | null = null): InventoryLotDto {
  return {
    lotId: `lot-${micros}`,
    label,
    acquiredAt: null,
    expiresAt: null,
    quantity: qty("oz", micros, amount),
    expiresAtProvenance: null,
  };
}

describe("microsToAmountText / parseMicros (BigInt round trip)", () => {
  it("whole numbers have no fraction", () => {
    expect(microsToAmountText(2_000_000n)).toBe("2");
  });

  it("a fraction is always written to six places, unrounded", () => {
    expect(microsToAmountText(1_250_000n)).toBe("1.250000");
    expect(microsToAmountText(250_000n)).toBe("0.250000");
  });

  it("negative micros keep the sign", () => {
    expect(microsToAmountText(-2_250_000n)).toBe("-2.250000");
  });

  it("round-trips through parseMicros", () => {
    expect(microsToAmountText(parseMicros("1250000"))).toBe("1.250000");
  });

  it("a float can misrepresent this exact case; BigInt does not (proves no float enters the path)", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754 doubles (0.30000000000000004). The same
    // statement in exact micro-units is exact.
    const floatSum = 0.1 + 0.2;
    expect(floatSum).not.toBe(0.3);

    const micros = parseMicros("100000") + parseMicros("200000");
    expect(micros).toBe(300_000n);
    expect(trimAmountText(microsToAmountText(micros))).toBe("0.3");
  });

  it("MICROS_PER_UNIT is one million (six decimal places)", () => {
    expect(MICROS_PER_UNIT).toBe(1_000_000n);
  });

  // Review F1: the prior float-discrimination test used a value small enough
  // that a `Number`-based mutation of the arithmetic still passed (both
  // sides fit in a double exactly). These values exceed
  // Number.MAX_SAFE_INTEGER (2^53 - 1 = 9_007_199_254_740_991), so a mutant
  // that routed the whole/frac split or the string build through `Number`
  // would corrupt digits here even though it happened to survive the
  // smaller fixture cases above.
  it("an integer beyond double precision stays exact through microsToAmountText", () => {
    expect(microsToAmountText(12345678901234567250000n)).toBe("12345678901234567.250000");
  });
});

describe("trimAmountText", () => {
  it("drops a trailing-zero fraction", () => {
    expect(trimAmountText("1.250000")).toBe("1.25");
    expect(trimAmountText("2.000000")).toBe("2");
    expect(trimAmountText("0.300000")).toBe("0.3");
  });

  it("passes an already-whole string through unchanged", () => {
    expect(trimAmountText("5")).toBe("5");
  });

  it("keeps a negative sign", () => {
    expect(trimAmountText("-0.250000")).toBe("-0.25");
  });

  // Review F1: same reasoning as the microsToAmountText case above, a value
  // beyond double precision so a `Number`-routed mutant would corrupt it.
  it("an integer beyond double precision stays exact when trimmed", () => {
    expect(trimAmountText("12345678901234567.250000")).toBe("12345678901234567.25");
  });
});

describe("formatSignedAmount", () => {
  it("renders a positive delta with a plus sign", () => {
    expect(formatSignedAmount("2.000000", "lb")).toBe("+2 lb");
  });

  it("renders a negative delta with the typographic minus sign (U+2212), never a hyphen", () => {
    const result = formatSignedAmount("-2.250000", "lb");
    expect(result).toBe("−2.25 lb");
    expect(result).not.toContain("-2.25");
  });

  it("pluralizes a whitelisted unit only when the magnitude is not exactly 1", () => {
    expect(formatSignedAmount("1.000000", "cup")).toBe("+1 cup");
    expect(formatSignedAmount("2.000000", "cup")).toBe("+2 cups");
  });
});

describe("formatQuantityDisplay (prototype v4 #scr-inventory fixture rows)", () => {
  it("a plain mass amount renders trimmed, no provenance prefix for a Known Fact", () => {
    expect(formatQuantityDisplay(qty("lb", "1250000", "1.250000"), [], "KNOWN_FACT")).toBe(
      "1.25 lb",
    );
  });

  it("Strawberries: 1 lb", () => {
    expect(formatQuantityDisplay(qty("lb", "1000000", "1.000000"), [], "AI_INTERPRETATION")).toBe(
      "1 lb",
    );
  });

  it("Spinach: 5 oz", () => {
    expect(formatQuantityDisplay(qty("oz", "5000000", "5.000000"), [], "KNOWN_FACT")).toBe("5 oz");
  });

  it("an Estimated-tier quantity is prefixed with a tilde (Basmati rice: ~4 cups)", () => {
    expect(formatQuantityDisplay(qty("cup", "4000000", "4.000000"), [], "ESTIMATED")).toBe(
      "~4 cups",
    );
  });

  it("Olive oil: 1 bottle, singular, no provenance prefix", () => {
    expect(formatQuantityDisplay(qty("bottle", "1000000", "1.000000"), [], "KNOWN_FACT")).toBe(
      "1 bottle",
    );
  });

  it("a uniform multi-lot pack renders as a count times the per-lot amount (Greek yogurt: 3 x 16 oz)", () => {
    const lots = [
      lot("16000000", "16.000000"),
      lot("16000000", "16.000000"),
      lot("16000000", "16.000000"),
    ];
    expect(formatQuantityDisplay(qty("oz", "48000000", "48.000000"), lots, "KNOWN_FACT")).toBe(
      "3 × 16 oz",
    );
  });

  it("Salmon fillets: 2 x 6 oz", () => {
    const lots = [lot("6000000", "6.000000"), lot("6000000", "6.000000")];
    expect(formatQuantityDisplay(qty("oz", "12000000", "12.000000"), lots, "KNOWN_FACT")).toBe(
      "2 × 6 oz",
    );
  });

  it("lots that differ in quantity are not treated as a uniform pack", () => {
    const lots = [lot("6000000", "6.000000"), lot("4000000", "4.000000")];
    expect(formatQuantityDisplay(qty("oz", "10000000", "10.000000"), lots, "KNOWN_FACT")).toBe(
      "10 oz",
    );
  });

  it("a single count lot whose label names a pack total renders N of M (Eggs: 8 of 12)", () => {
    const eggLot: InventoryLotDto = {
      lotId: "lot-eggs",
      label: "carton of 12",
      acquiredAt: null,
      expiresAt: null,
      quantity: qty("count", "8000000", "8.000000"),
      expiresAtProvenance: null,
    };
    expect(formatQuantityDisplay(qty("count", "8000000", "8.000000"), [eggLot], "KNOWN_FACT")).toBe(
      "8 of 12",
    );
  });

  it("a count lot with no pack-total label falls back to the plain amount", () => {
    const plainLot: InventoryLotDto = {
      lotId: "lot-plain",
      label: null,
      acquiredAt: null,
      expiresAt: null,
      quantity: qty("count", "2000000", "2.000000"),
      expiresAtProvenance: null,
    };
    expect(
      formatQuantityDisplay(qty("count", "2000000", "2.000000"), [plainLot], "KNOWN_FACT"),
    ).toBe("2 count");
  });
});
