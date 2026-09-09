import { describe, expect, it } from "vitest";
import {
  BASE_UNIT,
  lookupUnit,
  unitKind,
  unitsOfKind,
  UNIT_ENTRIES,
  UNIT_KINDS,
} from "./registry.js";

describe("registry — supported unit set", () => {
  it("covers the brief §6 worked example's units, plus the volume units that make cups internally consistent", () => {
    const symbols = UNIT_ENTRIES.map((entry) => entry.symbol).sort();
    expect(symbols).toEqual(
      ["cup", "g", "gal", "kg", "l", "lb", "ml", "oz", "pt", "qt", "tbsp", "tsp", "count"].sort(),
    );
  });

  it("declares exactly the three documented kinds", () => {
    expect(UNIT_KINDS).toEqual(["MASS", "VOLUME", "COUNT"]);
  });

  it("names a base unit per kind", () => {
    expect(BASE_UNIT.MASS).toBe("g");
    expect(BASE_UNIT.VOLUME).toBe("ml");
    expect(BASE_UNIT.COUNT).toBe("count");
  });

  it("resolves canonical symbols", () => {
    for (const entry of UNIT_ENTRIES) {
      const found = lookupUnit(entry.symbol);
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.value.symbol).toBe(entry.symbol);
    }
  });

  it("resolves every declared alias, case-insensitively, and trims whitespace", () => {
    for (const entry of UNIT_ENTRIES) {
      for (const alias of entry.aliases) {
        for (const candidate of [alias, alias.toUpperCase(), ` ${alias} `]) {
          const found = lookupUnit(candidate);
          expect(found.ok).toBe(true);
          if (found.ok) expect(found.value.symbol).toBe(entry.symbol);
        }
      }
    }
  });

  it("rejects unknown units with a typed error, never a guess", () => {
    for (const bogus of ["", "  ", "floz", "fl oz", "smidgen", "bushel", "lbz", "cupz"]) {
      const found = lookupUnit(bogus);
      expect(found.ok).toBe(false);
      if (!found.ok) expect(found.error.code).toBe("UNKNOWN_UNIT");
    }
  });

  it("does not register a fluid ounce (oz is mass-only by design)", () => {
    const flOz = lookupUnit("fl oz");
    expect(flOz.ok).toBe(false);
    // "oz" itself resolves, but only to the mass unit.
    const oz = lookupUnit("oz");
    expect(oz.ok).toBe(true);
    if (oz.ok) expect(oz.value.kind).toBe("MASS");
  });

  it("exposes unitKind as a lookupUnit convenience", () => {
    expect(unitKind("lb")).toEqual({ ok: true, value: "MASS" });
    expect(unitKind("cup")).toEqual({ ok: true, value: "VOLUME" });
    expect(unitKind("each")).toEqual({ ok: true, value: "COUNT" });
    const bogus = unitKind("bogus");
    expect(bogus.ok).toBe(false);
  });

  it("groups units by kind", () => {
    expect(
      unitsOfKind("MASS")
        .map((entry) => entry.symbol)
        .sort(),
    ).toEqual(["g", "kg", "lb", "oz"]);
    expect(unitsOfKind("COUNT").map((entry) => entry.symbol)).toEqual(["count"]);
    expect(unitsOfKind("VOLUME")).toHaveLength(8);
  });

  it("has no alias claimed by two different units", () => {
    const seen = new Map<string, string>();
    for (const entry of UNIT_ENTRIES) {
      for (const alias of entry.aliases) {
        const key = alias.toLowerCase();
        const owner = seen.get(key);
        expect(owner === undefined || owner === entry.symbol).toBe(true);
        seen.set(key, entry.symbol);
      }
    }
  });

  it("gives every unit a positive conversion factor", () => {
    for (const entry of UNIT_ENTRIES) {
      expect(entry.factorToBase.den > 0n).toBe(true);
      expect(entry.factorToBase.num > 0n).toBe(true);
    }
  });

  // --- F1 (review fix, 2026-09-09) ---------------------------------------
  // The tests above only prove internal self-consistency (e.g. cup=16*tbsp)
  // — none of them pin the *anchor* constants (the pound, the gallon) to
  // anything outside this codebase. The reviewer demonstrated that swapping
  // the US liquid gallon for the imperial gallon (a ~20% difference) passes
  // every other test in this file/convert.test.ts, because they're all
  // relative. These literals are transcribed independently, by hand, from
  // the definitional facts cited in registry.ts's module comment — never
  // copied from or derived through this module's own constants — and
  // cross-multiplied against `factorToBase` (rather than assuming either
  // side is already reduced) so this test fails if the registry's anchor
  // drifts from the real-world definition, in either direction.
  describe("absolute ground-truth factors (independent literals, not derived from this module)", () => {
    function expectFactor(symbol: string, expectedNum: bigint, expectedDen: bigint): void {
      const found = lookupUnit(symbol);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      const { num, den } = found.value.factorToBase;
      // Cross-multiply: num/den == expectedNum/expectedDen  <=>  num*expectedDen == expectedNum*den
      expect(num * expectedDen).toBe(expectedNum * den);
    }

    it("MASS: pins the avoirdupois pound/ounce/kilogram/gram to their defined gram values", () => {
      // 1 lb = 0.45359237 kg exactly (1959 international pound definition).
      expectFactor("lb", 45359237n, 100000n);
      // 1 oz = 1 lb / 16 = 28.349523125 g exactly.
      expectFactor("oz", 28349523125n, 1000000000n);
      // 1 kg = 1000 g exactly.
      expectFactor("kg", 1000n, 1n);
      // 1 g = 1 g (base unit).
      expectFactor("g", 1n, 1n);
    });

    it("VOLUME: pins the US liquid gallon ladder to its defined millilitre values", () => {
      // 1 US liquid gallon = 231 cubic inches = 3.785411784 L exactly.
      expectFactor("gal", 3785411784n, 1000000n);
      expectFactor("qt", 946352946n, 1000000n);
      expectFactor("pt", 473176473n, 1000000n);
      expectFactor("cup", 2365882365n, 10000000n);
      expectFactor("tbsp", 1478676478125n, 100000000000n);
      expectFactor("tsp", 492892159375n, 100000000000n);
      // 1 L = 1000 mL exactly; 1 mL = 1 mL (base unit).
      expectFactor("l", 1000n, 1n);
      expectFactor("ml", 1n, 1n);
    });

    it("COUNT: pins count to dimensionless 1", () => {
      expectFactor("count", 1n, 1n);
    });

    it("does NOT use the imperial (UK) gallon (4546.09 mL) for gal", () => {
      const gal = lookupUnit("gal");
      expect(gal.ok).toBe(true);
      if (!gal.ok) return;
      const { num, den } = gal.value.factorToBase;
      const imperialNum = 454609000n; // 4546.09 mL * 100000, matched denominator below
      const imperialDen = 100000n;
      expect(num * imperialDen).not.toBe(imperialNum * den);
    });

    it("does NOT use a metric cup (250 mL, exactly) for cup", () => {
      const cup = lookupUnit("cup");
      expect(cup.ok).toBe(true);
      if (!cup.ok) return;
      const { num, den } = cup.value.factorToBase;
      expect(num * 1n).not.toBe(250n * den); // 250/1
    });

    it("does NOT use the imperial (UK) cup (284.130625 mL) for cup", () => {
      const cup = lookupUnit("cup");
      expect(cup.ok).toBe(true);
      if (!cup.ok) return;
      const { num, den } = cup.value.factorToBase;
      const imperialNum = 284130625n; // 284.130625 mL * 1_000_000
      const imperialDen = 1000000n;
      expect(num * imperialDen).not.toBe(imperialNum * den);
    });
  });
});
