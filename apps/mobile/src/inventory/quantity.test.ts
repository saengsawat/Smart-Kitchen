import { describe, expect, it } from "vitest";
import type { InventoryLotDto, QuantityDto } from "@smart-kitchen/contracts";
import {
  classifyTypedAmount,
  COUNT_NOT_WHOLE_HINT,
  COUNT_UNIT_ALIASES,
  isCountUnit,
  isWholeMicros,
  stepAmountMicros,
  stepSizeMicros,
  formatQuantityDisplay,
  formatSignedAmount,
  MAX_TYPED_QUANTITY_MICROS,
  microsToAmountText,
  microsToTypedText,
  MICROS_PER_UNIT,
  parseMicros,
  parseTypedAmount,
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

describe("parseTypedAmount (M3-T7)", () => {
  it.each([
    ["9", 9_000_000n],
    ["9.25", 9_250_000n],
    [" 9.25 ", 9_250_000n],
    [".5", 500_000n],
    ["9.", 9_000_000n],
    ["0", 0n],
    ["007.5", 7_500_000n],
    ["0.000001", 1n],
    ["519.354399", 519_354_399n],
    ["100000000", MAX_TYPED_QUANTITY_MICROS],
  ])("parses %j exactly", (text, micros) => {
    expect(parseTypedAmount(text)).toBe(micros);
  });

  it.each([
    "",
    " ",
    ".",
    "abc",
    "1.1234567",
    "-1",
    "+1",
    "1e3",
    "1,5",
    "1.2.3",
    "1 g",
    "0x10",
    "Infinity",
    "NaN",
    "100000000.000001",
    "99999999999999999999999",
  ])("refuses %j", (text) => {
    expect(parseTypedAmount(text)).toBeNull();
  });

  it("pins the maximum to the domain's MAX_QUANTITY_MICROS (100 million units)", () => {
    expect(MAX_TYPED_QUANTITY_MICROS).toBe(100_000_000n * MICROS_PER_UNIT);
  });

  it("property: canonical typed text round-trips through parseTypedAmount and microsToTypedText (6-decimal inputs)", () => {
    // Seeded LCG in bigint: deterministic, no Math.random, no float.
    let state = 0x2545f4914f6cdd1dn;
    const next = (): bigint => {
      state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
      return state >> 11n;
    };
    for (let i = 0; i < 2000; i += 1) {
      const whole = next() % 100_000_000n;
      const fractionDigits = Number(next() % 7n); // 0..6 decimals
      let fraction = "";
      for (let d = 0; d < fractionDigits; d += 1) {
        fraction += (next() % 10n).toString();
      }
      fraction = fraction.replace(/0+$/, ""); // canonical: no trailing zero
      const text = fraction === "" ? whole.toString() : `${whole.toString()}.${fraction}`;
      const micros = parseTypedAmount(text);
      expect(micros).not.toBeNull();
      expect(microsToTypedText(micros!)).toBe(text);
      // And the server-shaped text parses back to the same micros.
      expect(parseMicros(micros!.toString())).toBe(micros);
      expect(parseTypedAmount(microsToAmountText(micros!))).toBe(micros);
    }
  });

  it("property: boundary micros values survive text and back", () => {
    for (const micros of [0n, 1n, 999_999n, 1_000_000n, 1_000_001n, 123_456_789_012n]) {
      expect(parseTypedAmount(microsToTypedText(micros))).toBe(micros);
    }
  });
});

describe("count units take whole numbers (M2-T8, D-029)", () => {
  it("uses the contracts' published COUNT aliases (spelling set pinned here)", () => {
    // Equality with the domain registry is proved in packages/adapters (count-aliases-consistency.test.ts).
    expect(COUNT_UNIT_ALIASES).toEqual([
      "count",
      "counts",
      "ct",
      "each",
      "ea",
      "unit",
      "units",
      "pc",
      "pcs",
      "piece",
      "pieces",
    ]);
  });

  it.each([...COUNT_UNIT_ALIASES, "EACH", " Count ", "Pieces"])("%j is a count unit", (unit) => {
    expect(isCountUnit(unit)).toBe(true);
  });

  it.each(["lb", "oz", "g", "kg", "ml", "l", "cup", "tsp", "tbsp", "bottle", "", "dozen"])(
    "%j is not a count unit",
    (unit) => {
      expect(isCountUnit(unit)).toBe(false);
    },
  );

  it("isWholeMicros is exact", () => {
    expect(isWholeMicros(0n)).toBe(true);
    expect(isWholeMicros(12_000_000n)).toBe(true);
    expect(isWholeMicros(12_500_000n)).toBe(false);
    expect(isWholeMicros(1n)).toBe(false);
    expect(isWholeMicros(999_999n)).toBe(false);
  });

  it.each([
    ["2", "each", { kind: "valid", micros: 2_000_000n }],
    ["2.000000", "each", { kind: "valid", micros: 2_000_000n }],
    ["2.", "each", { kind: "valid", micros: 2_000_000n }],
    ["2.5", "each", { kind: "fraction", micros: 2_500_000n }],
    [".5", "count", { kind: "fraction", micros: 500_000n }],
    ["0.000001", "ct", { kind: "fraction", micros: 1n }],
    ["abc", "each", { kind: "unusable" }],
    ["", "each", { kind: "unusable" }],
    ["2.5", "lb", { kind: "valid", micros: 2_500_000n }],
    ["0.25", "cup", { kind: "valid", micros: 250_000n }],
    ["abc", "lb", { kind: "unusable" }],
  ])("classifyTypedAmount(%j, %j)", (text, unit, expected) => {
    expect(classifyTypedAmount(text, unit)).toEqual(expected);
  });

  it("steps by 1 for a count unit and 0.25 otherwise", () => {
    expect(stepSizeMicros("each")).toBe(MICROS_PER_UNIT);
    expect(stepSizeMicros("lb")).toBe(250_000n);
  });

  it.each([
    [8_000_000n, 1, 9_000_000n],
    [8_000_000n, -1, 7_000_000n],
    [12_500_000n, -1, 12_000_000n],
    [12_500_000n, 1, 13_000_000n],
    [1n, 1, 1_000_000n],
    [999_999n, -1, 0n],
    [0n, -1, 0n],
    [MAX_TYPED_QUANTITY_MICROS, 1, MAX_TYPED_QUANTITY_MICROS],
  ] as const)("count: step from %s by %s is %s", (from, direction, to) => {
    expect(stepAmountMicros(from, direction, "count")).toBe(to);
  });

  it("mass and volume step by 0.25 from wherever they are, as before", () => {
    expect(stepAmountMicros(12_500_000n, 1, "lb")).toBe(12_750_000n);
    expect(stepAmountMicros(12_100_000n, -1, "cup")).toBe(11_850_000n);
    expect(stepAmountMicros(100_000n, -1, "g")).toBe(0n);
  });

  it("carries the proposed strings verbatim", () => {
    expect(COUNT_NOT_WHOLE_HINT).toBe("Use a whole number, like 2.");
  });
});
