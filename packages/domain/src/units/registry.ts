/**
 * Unit registry: the supported kitchen units, their kind, and their exact
 * conversion factor to their kind's base unit.
 *
 * Scope (architect guidance, M1-T3): cover the brief §6 worked example's
 * units (lb, oz, g, kg, cups, tbsp, tsp, ml, l, count/each) plus the volume
 * units needed to make that set internally consistent (pt, qt, gal — a US
 * recipe's "cups" is one hop from "gallons" at the grocery store). No other
 * units are in scope; localization/display-unit choice is out of scope
 * (BACKLOG.md M1-T3).
 *
 * **`oz` is the avoirdupois *mass* ounce, not the fluid ounce.** The brief
 * lists `oz` alongside `lb`/`g`/`kg` (mass) and never alongside `cups`/`tbsp`
 * (volume) — e.g. domain-model.md's "Kirkland Greek Yogurt 32 oz" example is
 * a US package's printed *net weight*, the normal way dairy tubs are labeled.
 * Fluid ounces are intentionally unsupported: adding a second, differently-
 * valued `oz` would make unit lookup ambiguous, which is exactly the kind of
 * guess this module must never make. Documented as a proposed domain-model
 * note in docs/handoff/M1-T3.worker.md.
 *
 * All factors below are exact by definition, not measurement:
 * - MASS: the international avoirdupois pound is *defined* as exactly
 *   0.45359237 kg (1959 international yard-and-pound agreement); kg/g are
 *   decimal-exact.
 * - VOLUME: the US liquid gallon is *defined* as exactly 231 cubic inches,
 *   and the inch as exactly 2.54 cm, which multiplies out to exactly
 *   3.785411784 L. Cup/tbsp/tsp are the standard US *culinary* ratios
 *   (1 cup = 16 tbsp = 48 tsp, universal across US recipes) rather than the
 *   US federal (FDA nutrition-label) rounded units, since this module serves
 *   recipes and shopping, not label compliance.
 * - COUNT: dimensionless; "1 each" is exact by construction.
 */

import { divide, fromInt, makeRational, type Rational } from "./rational.js";
import { err, ok, type Outcome } from "./errors.js";

/** The three unit kinds this module knows how to convert within. */
export const UNIT_KINDS = ["MASS", "VOLUME", "COUNT"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** A registered unit: its canonical symbol, kind, and exact factor to base. */
export interface UnitEntry {
  readonly kind: UnitKind;
  /** Canonical symbol, e.g. `"lb"`. What {@link ConversionResult} reports back. */
  readonly symbol: string;
  /** Case-insensitive strings that resolve to this unit, `symbol` included. */
  readonly aliases: readonly string[];
  /** Exact amount of the kind's base unit equal to one of this unit. */
  readonly factorToBase: Rational;
}

/** Kind base units: MASS → gram, VOLUME → millilitre, COUNT → each. */
export const BASE_UNIT: Readonly<Record<UnitKind, string>> = Object.freeze({
  MASS: "g",
  VOLUME: "ml",
  COUNT: "count",
});

const GRAM = fromInt(1n);
const KILOGRAM = fromInt(1000n);
// International avoirdupois pound: exactly 0.45359237 kg = 453.59237 g.
const POUND = makeRational(45359237n, 100000n);
const OUNCE = divide(POUND, fromInt(16n));

const MILLILITRE = fromInt(1n);
const LITRE = fromInt(1000n);
// US liquid gallon: exactly 231 cubic inches = 3.785411784 L = 3785.411784 mL.
const GALLON = makeRational(3785411784n, 1000000n);
const QUART = divide(GALLON, fromInt(4n));
const PINT = divide(QUART, fromInt(2n));
const CUP = divide(PINT, fromInt(2n));
// US culinary ratios: 1 cup = 16 tbsp = 48 tsp.
const TABLESPOON = divide(CUP, fromInt(16n));
const TEASPOON = divide(TABLESPOON, fromInt(3n));

const EACH = fromInt(1n);

const MASS_UNITS: readonly UnitEntry[] = [
  { kind: "MASS", symbol: "g", aliases: ["g", "gram", "grams"], factorToBase: GRAM },
  { kind: "MASS", symbol: "kg", aliases: ["kg", "kilogram", "kilograms"], factorToBase: KILOGRAM },
  { kind: "MASS", symbol: "oz", aliases: ["oz", "ounce", "ounces"], factorToBase: OUNCE },
  { kind: "MASS", symbol: "lb", aliases: ["lb", "lbs", "pound", "pounds"], factorToBase: POUND },
];

const VOLUME_UNITS: readonly UnitEntry[] = [
  {
    kind: "VOLUME",
    symbol: "ml",
    aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
    factorToBase: MILLILITRE,
  },
  {
    kind: "VOLUME",
    symbol: "l",
    aliases: ["l", "liter", "liters", "litre", "litres"],
    factorToBase: LITRE,
  },
  {
    kind: "VOLUME",
    symbol: "tsp",
    aliases: ["tsp", "teaspoon", "teaspoons"],
    factorToBase: TEASPOON,
  },
  {
    kind: "VOLUME",
    symbol: "tbsp",
    aliases: ["tbsp", "tablespoon", "tablespoons"],
    factorToBase: TABLESPOON,
  },
  { kind: "VOLUME", symbol: "cup", aliases: ["cup", "cups"], factorToBase: CUP },
  { kind: "VOLUME", symbol: "pt", aliases: ["pt", "pint", "pints"], factorToBase: PINT },
  { kind: "VOLUME", symbol: "qt", aliases: ["qt", "quart", "quarts"], factorToBase: QUART },
  { kind: "VOLUME", symbol: "gal", aliases: ["gal", "gallon", "gallons"], factorToBase: GALLON },
];

const COUNT_UNITS: readonly UnitEntry[] = [
  {
    kind: "COUNT",
    symbol: "count",
    aliases: [
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
    ],
    factorToBase: EACH,
  },
];

/** Every registered unit, across all kinds. */
export const UNIT_ENTRIES: readonly UnitEntry[] = Object.freeze([
  ...MASS_UNITS,
  ...VOLUME_UNITS,
  ...COUNT_UNITS,
]);

const ALIAS_INDEX: ReadonlyMap<string, UnitEntry> = new Map(
  UNIT_ENTRIES.flatMap((entry) =>
    entry.aliases.map((alias) => [alias.toLowerCase(), entry] as const),
  ),
);

/**
 * Resolves a unit string (case-insensitive) to its registered {@link UnitEntry}.
 * Unknown input is a typed `UNKNOWN_UNIT` error — this module never guesses
 * at what an unrecognised unit might mean.
 */
export function lookupUnit(unit: string): Outcome<UnitEntry> {
  const normalized = typeof unit === "string" ? unit.trim().toLowerCase() : "";
  const entry = normalized === "" ? undefined : ALIAS_INDEX.get(normalized);
  if (entry === undefined) {
    return err("UNKNOWN_UNIT", `"${unit}" is not a registered unit`, "unit");
  }
  return ok(entry);
}

/** Convenience: the {@link UnitKind} of a unit string. */
export function unitKind(unit: string): Outcome<UnitKind> {
  const found = lookupUnit(unit);
  return found.ok ? ok(found.value.kind) : found;
}

/** Lists the registered units of one kind (canonical symbols only). */
export function unitsOfKind(kind: UnitKind): readonly UnitEntry[] {
  return UNIT_ENTRIES.filter((entry) => entry.kind === kind);
}
