import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addQuantities,
  compareQuantities,
  convert,
  convertWithBridge,
  makeBridge,
  neededQuantity,
  type ConversionResult,
} from "./convert.js";
import { lookupUnit, UNIT_ENTRIES, unitsOfKind, type UnitEntry } from "./registry.js";
import { divide, type Rational } from "./rational.js";

const MICRO = 1_000_000n;

function unwrap(result: { ok: boolean; value?: unknown; error?: unknown }): ConversionResult {
  if (!result.ok) throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  return result.value as ConversionResult;
}

describe("convert — same-kind exact conversion", () => {
  it("hand-verified exact MASS conversions", () => {
    expect(unwrap(convert(2n * MICRO, "lb", "oz"))).toMatchObject({
      micros: 32n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(16n * MICRO, "oz", "lb"))).toMatchObject({
      micros: 1n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "kg", "g"))).toMatchObject({
      micros: 1000n * MICRO,
      exact: true,
    });
    // 2500 g = 2.5 kg
    expect(unwrap(convert(2500n * MICRO, "g", "kg"))).toMatchObject({
      micros: 2_500_000n,
      exact: true,
    });
  });

  it("hand-verified exact VOLUME conversions (US culinary ratios)", () => {
    expect(unwrap(convert(1n * MICRO, "cup", "tbsp"))).toMatchObject({
      micros: 16n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "tbsp", "tsp"))).toMatchObject({
      micros: 3n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "cup", "tsp"))).toMatchObject({
      micros: 48n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "gal", "qt"))).toMatchObject({
      micros: 4n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "qt", "pt"))).toMatchObject({
      micros: 2n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "pt", "cup"))).toMatchObject({
      micros: 2n * MICRO,
      exact: true,
    });
    expect(unwrap(convert(1n * MICRO, "l", "ml"))).toMatchObject({
      micros: 1000n * MICRO,
      exact: true,
    });
  });

  it("identity conversion (same unit) is always exact regardless of magnitude", () => {
    expect(unwrap(convert(123_456_789n, "lb", "lb"))).toEqual({
      micros: 123_456_789n,
      unit: "lb",
      amount: 123.456789,
      exact: true,
    });
  });

  it("count units convert 1:1 (dimensionless)", () => {
    expect(unwrap(convert(5n * MICRO, "count", "each"))).toMatchObject({
      micros: 5n * MICRO,
      exact: true,
    });
  });

  it("real kitchen conversions may round, and say so honestly", () => {
    // 1 oz -> g is not representable at 1e-6 g (28.349523125 needs 9 places);
    // this must round, and must say exact: false rather than pretend.
    const result = unwrap(convert(1n * MICRO, "oz", "g"));
    expect(result.exact).toBe(false);
    expect(result.unit).toBe("g");
    // Never off by more than half a micro-unit from the true rational value
    // (28.349523125 g, i.e. 28_349_523.125 micro-g).
    const trueMicros = 28_349_523_125n; // *1000 to compare against milli-micros
    const diff = result.micros * 1000n - trueMicros;
    expect(diff < 500n && diff > -500n).toBe(true);
  });
});

describe("convert — unknown and incompatible units", () => {
  it("rejects an unknown unit on either side", () => {
    const badFrom = convert(1n * MICRO, "smidgen", "g");
    expect(badFrom.ok).toBe(false);
    if (!badFrom.ok) expect(badFrom.error.code).toBe("UNKNOWN_UNIT");

    const badTo = convert(1n * MICRO, "g", "smidgen");
    expect(badTo.ok).toBe(false);
    if (!badTo.ok) expect(badTo.error.code).toBe("UNKNOWN_UNIT");
  });

  it("rejects cross-kind conversion without a bridge, never guessing", () => {
    const result = convert(1n * MICRO, "lb", "cup");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INCOMPATIBLE_UNITS");
  });

  it("exhaustive kind-pair matrix: every unit pair converts iff same kind", () => {
    for (const from of UNIT_ENTRIES) {
      for (const to of UNIT_ENTRIES) {
        const result = convert(MICRO, from.symbol, to.symbol);
        if (from.kind === to.kind) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("INCOMPATIBLE_UNITS");
        }
      }
    }
  });
});

/** Ordered same-kind unit pairs whose (from -> to) factor is an exact integer. */
function losslessPairs(): ReadonlyArray<{ from: UnitEntry; to: UnitEntry; factor: bigint }> {
  const pairs: Array<{ from: UnitEntry; to: UnitEntry; factor: bigint }> = [];
  for (const kind of ["MASS", "VOLUME", "COUNT"] as const) {
    const entries = unitsOfKind(kind);
    for (const from of entries) {
      for (const to of entries) {
        if (from.symbol === to.symbol) continue;
        const factor: Rational = divide(from.factorToBase, to.factorToBase);
        if (factor.den === 1n) pairs.push({ from, to, factor: factor.num });
      }
    }
  }
  return pairs;
}

describe("convert — property: exact where exactly representable (tolerance-zero)", () => {
  const pairs = losslessPairs();

  it("finds at least the known lossless hops (sanity check the fixture, not just the code)", () => {
    const symbolPairs = pairs.map((p) => `${p.from.symbol}->${p.to.symbol}`);
    expect(symbolPairs).toEqual(
      expect.arrayContaining([
        "lb->oz",
        "kg->g",
        "l->ml",
        "cup->tbsp",
        "tbsp->tsp",
        "cup->tsp",
        "gal->qt",
      ]),
    );
  });

  it("property: a lossless hop is exact for every amount, and equals amount*factor", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...pairs),
        fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }),
        ({ from, to, factor }, amountMicros) => {
          const result = unwrap(convert(amountMicros, from.symbol, to.symbol));
          expect(result.exact).toBe(true);
          expect(result.micros).toBe(amountMicros * factor);
        },
      ),
    );
  });

  it("property: round-trip through a lossless hop and back is exact, always (tolerance-zero)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...pairs),
        fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }),
        ({ from, to }, amountMicros) => {
          const there = unwrap(convert(amountMicros, from.symbol, to.symbol));
          const back = unwrap(convert(there.micros, to.symbol, from.symbol));
          expect(back.exact).toBe(true);
          expect(back.micros).toBe(amountMicros);
        },
      ),
    );
  });

  it("property: scaling linearity — convert(k * amount) === k * convert(amount)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...pairs),
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.integer({ min: -1000, max: 1000 }),
        ({ from, to }, amountMicros, k) => {
          const base = unwrap(convert(amountMicros, from.symbol, to.symbol));
          const scaled = unwrap(convert(BigInt(k) * amountMicros, from.symbol, to.symbol));
          expect(scaled.micros).toBe(BigInt(k) * base.micros);
          expect(scaled.exact).toBe(true);
        },
      ),
    );
  });
});

describe("convert — property: path-independence through a lossless hop", () => {
  const triples: ReadonlyArray<[string, string, string]> = [
    ["lb", "oz", "g"],
    ["gal", "cup", "tbsp"],
    ["cup", "tbsp", "tsp"],
    ["kg", "g", "oz"],
  ];

  it("lb -> oz -> g equals lb -> g directly (brief §6's units, exactly)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), (amountMicros) => {
        const viaOz = unwrap(convert(unwrap(convert(amountMicros, "lb", "oz")).micros, "oz", "g"));
        const direct = unwrap(convert(amountMicros, "lb", "g"));
        expect(viaOz).toEqual(direct);
      }),
    );
  });

  it("property: chaining through any lossless first hop equals the direct conversion", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...triples),
        fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }),
        ([x, y, z], amountMicros) => {
          const first = unwrap(convert(amountMicros, x, y));
          expect(first.exact).toBe(true); // precondition: x->y must be lossless for this property
          const chained = unwrap(convert(first.micros, y, z));
          const direct = unwrap(convert(amountMicros, x, z));
          expect(chained).toEqual(direct);
        },
      ),
    );
  });
});

describe("convertWithBridge — explicit cross-kind conversion", () => {
  it("makeBridge rejects non-finite, zero, and negative ratios", () => {
    expect(makeBridge("VOLUME", "MASS", Number.NaN).ok).toBe(false);
    expect(makeBridge("VOLUME", "MASS", Number.POSITIVE_INFINITY).ok).toBe(false);
    const zero = makeBridge("VOLUME", "MASS", 0);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe("INVALID_BRIDGE_RATIO");
    const negative = makeBridge("VOLUME", "MASS", -0.92);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error.code).toBe("INVALID_BRIDGE_RATIO");
  });

  it("applies a caller-supplied density exactly (100 ml at 0.92 g/ml = 92 g)", () => {
    const bridge = makeBridge("VOLUME", "MASS", 0.92);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    const result = unwrap(convertWithBridge(100n * MICRO, "ml", "g", bridge.value));
    expect(result).toMatchObject({ micros: 92n * MICRO, unit: "g", exact: true });
  });

  it("applies the bridge in reverse via reciprocal, exactly", () => {
    const bridge = makeBridge("VOLUME", "MASS", 0.92);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    const result = unwrap(convertWithBridge(92n * MICRO, "g", "ml", bridge.value));
    expect(result).toMatchObject({ micros: 100n * MICRO, unit: "ml", exact: true });
  });

  it("applies a per-item weight bridge (COUNT<->MASS), e.g. 1 each = 62 g", () => {
    const bridge = makeBridge("COUNT", "MASS", 62);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    const result = unwrap(convertWithBridge(3n * MICRO, "count", "g", bridge.value));
    expect(result).toMatchObject({ micros: 186n * MICRO, exact: true });
  });

  it("rejects a bridge whose kind pair does not relate the requested units", () => {
    const bridge = makeBridge("COUNT", "MASS", 62);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    // Bridge relates COUNT<->MASS; asking it to relate VOLUME<->MASS is wrong.
    const result = convertWithBridge(1n * MICRO, "ml", "g", bridge.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BRIDGE_KIND_MISMATCH");
  });

  it("ignores an irrelevant bridge and behaves like convert() for same-kind units", () => {
    const bridge = makeBridge("VOLUME", "MASS", 0.92);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    const viaBridge = unwrap(convertWithBridge(2n * MICRO, "lb", "oz", bridge.value));
    const direct = unwrap(convert(2n * MICRO, "lb", "oz"));
    expect(viaBridge).toEqual(direct);
  });

  it("still rejects an unknown unit even with a bridge supplied", () => {
    const bridge = makeBridge("VOLUME", "MASS", 0.92);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    const result = convertWithBridge(1n * MICRO, "smidgen", "g", bridge.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_UNIT");
  });

  // --- F2 (review fix, 2026-09-09) ----------------------------------------
  // makeBridge used to build its rational via a private `String(value).split(".")`
  // parser with no exponent handling, so a finite ratio that `String()` renders
  // in exponential notation (anything < 1e-6 or >= 1e21) reached a bare
  // `BigInt("1e-7")`/`BigInt("1e+21")` and *threw* — violating this module's
  // own never-throws contract. Fixed by delegating to rational.ts's
  // `decimalToRational`, which already parses the exponent group. These
  // ratios must now resolve to `Outcome`s, never throw.
  it("does not throw on a finite ratio JS renders in exponential notation (1e-7)", () => {
    const bridge = makeBridge("VOLUME", "MASS", 1e-7);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    // 1000 ml at 1e-7 g/ml = 0.0001 g = 100 micro-g, exactly.
    const result = unwrap(convertWithBridge(1_000_000_000n, "ml", "g", bridge.value));
    expect(result).toMatchObject({ micros: 100n, unit: "g", exact: true });
  });

  it("does not throw on a finite ratio JS renders in exponential notation (1e21)", () => {
    const bridge = makeBridge("COUNT", "MASS", 1e21);
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    // 1 micro-count at 1e21 g/each = 1e21 micro-g, exactly.
    const result = unwrap(convertWithBridge(1n, "count", "g", bridge.value));
    expect(result).toMatchObject({ micros: 10n ** 21n, unit: "g", exact: true });
  });

  it("still rejects non-finite/zero/negative ratios that also happen to be exponential-shaped", () => {
    const tooSmallNegative = makeBridge("VOLUME", "MASS", -1e-7);
    expect(tooSmallNegative.ok).toBe(false);
    if (!tooSmallNegative.ok) expect(tooSmallNegative.error.code).toBe("INVALID_BRIDGE_RATIO");
  });
});

describe("compareQuantities / addQuantities", () => {
  it("compares across compatible units", () => {
    expect(compareQuantities(1n * MICRO, "lb", 16n * MICRO, "oz")).toEqual({ ok: true, value: 0 });
    expect(compareQuantities(1n * MICRO, "lb", 15n * MICRO, "oz")).toEqual({ ok: true, value: 1 });
    expect(compareQuantities(1n * MICRO, "lb", 17n * MICRO, "oz")).toEqual({ ok: true, value: -1 });
  });

  it("fails typed on incompatible units, never guessing a comparison", () => {
    const result = compareQuantities(1n * MICRO, "lb", 1n * MICRO, "cup");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INCOMPATIBLE_UNITS");
  });

  // --- F4 (review fix, 2026-09-09) ----------------------------------------
  // compareQuantities used to convert b into a's unit (rounding to the
  // nearest micro-unit of a) before comparing — which is not antisymmetric:
  // which side gets rounded depends on which unit was picked as the target,
  // so near a half-micro-unit boundary, compareQuantities(a,b) and
  // compareQuantities(b,a) (sign-flipped) could disagree. Fixed by comparing
  // both sides' exact rational value in the kind's base unit directly
  // (rational.ts's `compare`, i.e. cross-multiplication) — nothing to round.
  it("repro: 1 micro-tsp vs 0 cups is antisymmetric (used to report 1 forward, 0 reversed)", () => {
    expect(compareQuantities(1n, "tsp", 0n, "cup")).toEqual({ ok: true, value: 1 });
    expect(compareQuantities(0n, "cup", 1n, "tsp")).toEqual({ ok: true, value: -1 });
  });

  it("property: antisymmetric for every same-kind unit pair, at any micro amount", () => {
    const sameKindPairs: ReadonlyArray<readonly [UnitEntry, UnitEntry]> = UNIT_ENTRIES.flatMap(
      (a) => UNIT_ENTRIES.filter((b) => b.kind === a.kind).map((b) => [a, b] as const),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...sameKindPairs),
        fc.bigInt({ min: -10_000n, max: 10_000n }),
        fc.bigInt({ min: -10_000n, max: 10_000n }),
        ([aEntry, bEntry], aMicros, bMicros) => {
          const forward = compareQuantities(aMicros, aEntry.symbol, bMicros, bEntry.symbol);
          const backward = compareQuantities(bMicros, bEntry.symbol, aMicros, aEntry.symbol);
          expect(forward.ok).toBe(true);
          expect(backward.ok).toBe(true);
          if (!forward.ok || !backward.ok) return;
          if (forward.value === 0) {
            expect(backward.value).toBe(0);
          } else {
            expect(backward.value).toBe(forward.value === 1 ? -1 : 1);
          }
        },
      ),
    );
  });

  it("adds across compatible units, defaulting the result unit to the first operand's", () => {
    const result = unwrap(addQuantities(1n * MICRO, "lb", 16n * MICRO, "oz"));
    expect(result).toMatchObject({ unit: "lb", micros: 2n * MICRO, exact: true });
  });

  it("adds with an explicit result unit", () => {
    const result = unwrap(addQuantities(1n * MICRO, "lb", 16n * MICRO, "oz", "oz"));
    expect(result).toMatchObject({ unit: "oz", micros: 32n * MICRO, exact: true });
  });

  // --- F3 (review fix, 2026-09-09) ----------------------------------------
  // addQuantities/neededQuantity used to report the caller's raw unit string
  // back in `unit` (an alias, or a different case, e.g. "pounds"/"POUNDS")
  // instead of the canonical symbol the underlying conversion already
  // resolved to. Downstream the ledger compares units by exact string
  // equality, so a non-canonical `unit` here would cause spurious
  // MIXED_UNITS or a balance that silently stops matching a canonical one.
  it("reports the canonical unit even when the caller's aUnit/resultUnit is an alias or different case", () => {
    const aliasAUnit = unwrap(addQuantities(1n * MICRO, "pounds", 16n * MICRO, "oz"));
    expect(aliasAUnit.unit).toBe("lb");

    const upperCaseAUnit = unwrap(addQuantities(1n * MICRO, "LB", 16n * MICRO, "oz"));
    expect(upperCaseAUnit.unit).toBe("lb");

    const aliasResultUnit = unwrap(addQuantities(1n * MICRO, "lb", 16n * MICRO, "oz", "POUNDS"));
    expect(aliasResultUnit.unit).toBe("lb");
  });
});

describe("neededQuantity — INV-SHOP-1: needed = max(0, required - onHand)", () => {
  it("clamps at zero when on-hand already covers the requirement", () => {
    const result = unwrap(neededQuantity(2n * MICRO, "lb", 5n * MICRO, "lb"));
    expect(result).toMatchObject({ micros: 0n, unit: "lb" });
  });

  it("reports the exact gap when short", () => {
    const result = unwrap(neededQuantity(2n * MICRO, "lb", 1n * MICRO, "lb"));
    expect(result).toMatchObject({ micros: 1n * MICRO, unit: "lb", exact: true });
  });

  it("converts on-hand into the required unit before comparing", () => {
    // Need 2 lb, have 40 oz (2.5 lb) on hand -> already have enough.
    const result = unwrap(neededQuantity(2n * MICRO, "lb", 40n * MICRO, "oz"));
    expect(result).toMatchObject({ micros: 0n, unit: "lb" });
  });

  it("fails typed rather than silently treating incompatible units as zero on-hand", () => {
    const result = neededQuantity(2n * MICRO, "lb", 1n * MICRO, "cup");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INCOMPATIBLE_UNITS");
  });

  it("property: never negative, and equals the exact rational gap clamped at zero", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        (requiredMicros, onHandMicros) => {
          const result = unwrap(neededQuantity(requiredMicros, "g", onHandMicros, "g"));
          expect(result.micros >= 0n).toBe(true);
          const trueGap = requiredMicros - onHandMicros;
          expect(result.micros).toBe(trueGap > 0n ? trueGap : 0n);
        },
      ),
    );
  });

  // F3 (review fix, 2026-09-09) — see the matching addQuantities test above.
  it("reports the canonical unit even when requiredUnit is an alias or different case", () => {
    const aliasRequiredUnit = unwrap(neededQuantity(2n * MICRO, "pounds", 1n * MICRO, "lb"));
    expect(aliasRequiredUnit.unit).toBe("lb");

    const upperCaseRequiredUnit = unwrap(neededQuantity(2n * MICRO, "LB", 1n * MICRO, "oz"));
    expect(upperCaseRequiredUnit.unit).toBe("lb");
  });
});

describe("brief §6 worked example — computes exactly", () => {
  // Recipe requires: Chicken 2 lb; Rice 2 cups; Broccoli 2 lb; Olive oil 2 tbsp.
  // Inventory: Chicken 1 lb; Rice 5 cups; Broccoli 0; Olive oil "sufficient".
  // Expected shopping list: BUY chicken 1 lb, broccoli 2 lb; ALREADY HAVE rice, olive oil.

  it("chicken: need 2 lb, have 1 lb -> buy 1 lb", () => {
    const gap = unwrap(neededQuantity(2n * MICRO, "lb", 1n * MICRO, "lb"));
    expect(gap.micros).toBe(1n * MICRO);
    expect(gap.amount).toBe(1);
  });

  it("rice: need 2 cups, have 5 cups -> already have (needed = 0)", () => {
    const gap = unwrap(neededQuantity(2n * MICRO, "cup", 5n * MICRO, "cup"));
    expect(gap.micros).toBe(0n);
  });

  it("broccoli: need 2 lb, have 0 -> buy 2 lb", () => {
    const gap = unwrap(neededQuantity(2n * MICRO, "lb", 0n, "lb"));
    expect(gap.micros).toBe(2n * MICRO);
    expect(gap.amount).toBe(2);
  });

  it('olive oil: need 2 tbsp, "sufficient" on hand -> already have (needed = 0)', () => {
    // "Sufficient" is an inventory-layer statement with no exact quantity
    // attached (out of this module's scope — see docs/handoff/M1-T3.worker.md);
    // this module's contribution is that *any* on-hand amount at or above the
    // requirement clamps to zero needed, which is all "sufficient" requires.
    const onHandThatIsSufficient = 3n * MICRO; // 3 tbsp on hand, need 2
    const gap = unwrap(neededQuantity(2n * MICRO, "tbsp", onHandThatIsSufficient, "tbsp"));
    expect(gap.micros).toBe(0n);
  });

  it("end-to-end: the shopping list this example demands falls out of neededQuantity alone", () => {
    const lines = [
      {
        item: "chicken",
        requiredMicros: 2n * MICRO,
        unit: "lb",
        onHandMicros: 1n * MICRO,
        onHandUnit: "lb",
      },
      {
        item: "rice",
        requiredMicros: 2n * MICRO,
        unit: "cup",
        onHandMicros: 5n * MICRO,
        onHandUnit: "cup",
      },
      {
        item: "broccoli",
        requiredMicros: 2n * MICRO,
        unit: "lb",
        onHandMicros: 0n,
        onHandUnit: "lb",
      },
      {
        item: "olive oil",
        requiredMicros: 2n * MICRO,
        unit: "tbsp",
        onHandMicros: 3n * MICRO,
        onHandUnit: "tbsp",
      },
    ];
    const shoppingList = lines.map((line) => {
      const gap = unwrap(
        neededQuantity(line.requiredMicros, line.unit, line.onHandMicros, line.onHandUnit),
      );
      return {
        item: line.item,
        status: gap.micros > 0n ? "BUY" : "ALREADY HAVE",
        amount: gap.amount,
      };
    });
    expect(shoppingList).toEqual([
      { item: "chicken", status: "BUY", amount: 1 },
      { item: "rice", status: "ALREADY HAVE", amount: 0 },
      { item: "broccoli", status: "BUY", amount: 2 },
      { item: "olive oil", status: "ALREADY HAVE", amount: 0 },
    ]);
  });
});

describe("registry cross-check", () => {
  it("lookupUnit and convert agree on canonical symbols", () => {
    for (const entry of UNIT_ENTRIES) {
      const found = lookupUnit(entry.symbol);
      expect(found.ok).toBe(true);
    }
  });
});
