/**
 * Public API of the units module (M1-T3).
 *
 * Standalone, pure, zero-I/O — beside the inventory ledger, not inside it
 * (architect guidance: OQ-2 resolved this way; the ledger keeps its
 * pass-through `Unit` string, unchanged by this module). Wiring conversion
 * into services (so a ledger `Unit` string actually gets validated/converted
 * at a service boundary) is M2's job, not this ticket's.
 *
 * Typical use:
 * ```ts
 * const gap = neededQuantity(2_000_000n, "lb", 1_000_000n, "lb");
 * if (gap.ok) console.log(gap.value.amount); // 1 (need 1 more lb)
 *
 * const density = makeBridge("VOLUME", "MASS", 0.92); // g per mL, caller-supplied
 * if (density.ok) {
 *   const grams = convertWithBridge(250_000_000n, "ml", "g", density.value);
 * }
 * ```
 */

export {
  addQuantities,
  compareQuantities,
  convert,
  convertWithBridge,
  makeBridge,
  neededQuantity,
} from "./convert.js";
export type { ConversionBridge, ConversionResult } from "./convert.js";

export {
  BASE_UNIT,
  lookupUnit,
  unitKind,
  unitsOfKind,
  UNIT_ENTRIES,
  UNIT_KINDS,
} from "./registry.js";
export type { UnitEntry, UnitKind } from "./registry.js";

export {
  add,
  compare,
  decimalToRational,
  divide,
  fromInt,
  isNegative,
  isPositive,
  isZero,
  makeRational,
  maxRational,
  multiply,
  negate,
  RATIONAL_ONE,
  RATIONAL_ZERO,
  rationalToNumber,
  reciprocal,
  roundHalfEven,
  subtract,
} from "./rational.js";
export type { Rational, RoundedInt } from "./rational.js";

export { err, isUnitError, ok } from "./errors.js";
export type { Outcome as UnitOutcome, UnitError, UnitErrorCode } from "./errors.js";
