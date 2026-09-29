import { describe, expect, it } from "vitest";
import { parseOffQuantity } from "./parse-quantity.js";

describe("parseOffQuantity (M2-T4a (b)): clean single amounts only", () => {
  it.each([
    ["793.8 g", { qty: 793.8, unit: "g" }],
    ["20.5 oz", { qty: 20.5, unit: "oz" }],
    ["3.5 OZ (100g)", { qty: 3.5, unit: "oz" }],
    ["12 oz (340g)", { qty: 12, unit: "oz" }],
    ["1 portion (32 g)", { qty: 32, unit: "g" }],
    ["0.5 Cup (52 g)", { qty: 0.5, unit: "cup" }],
    ["1 serving (240 ml)", { qty: 240, unit: "ml" }],
    ["500 g ℮", { qty: 500, unit: "g" }],
    ["2 lbs", { qty: 2, unit: "lb" }],
    ["1 kg", { qty: 1, unit: "kg" }],
    ["1.5l", { qty: 1.5, unit: "l" }],
    ["12 ct", { qty: 12, unit: "each" }],
    ["2.40 oz", { qty: 2.4, unit: "oz" }],
  ])("%s -> %o", (raw, expected) => {
    expect(parseOffQuantity(raw)).toEqual(expected);
  });

  it.each([
    "48 fl oz",
    "2 x 60 g",
    "13 oz, 6 muffins",
    "35.3 oz (2 lb 3.3 oz) 1 kg",
    "Net Wt 3.5 Oz (100g)",
    "1,5 kg",
    "6 eggs",
    "0 g",
    "",
    "   ",
    "g",
    "2041.165665",
    "1 portion (1 slice)",
  ])("%s -> absent", (raw) => {
    expect(parseOffQuantity(raw)).toBeUndefined();
  });

  it("anything that is not a string is absent", () => {
    for (const raw of [undefined, null, 12, { qty: 1 }, ["1 g"]]) {
      expect(parseOffQuantity(raw)).toBeUndefined();
    }
  });
});
