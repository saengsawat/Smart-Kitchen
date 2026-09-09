/**
 * `@smart-kitchen/domain` — the deterministic core.
 *
 * Pure TypeScript: zero runtime dependencies, zero I/O, no clock, no
 * randomness (ARCHITECTURE.md §2, CLAUDE.md rule 7; enforced by the
 * dependency-boundary lint in `eslint.config.js`). Safety-critical arithmetic
 * lives here and nowhere else.
 *
 * Modules:
 * - `inventory` — the append-only inventory ledger (M1-T1, ADR-008).
 * - `units` — unit kinds/conversion, standalone beside the ledger (M1-T3).
 *   Re-exported explicitly (not `export *`) below because both modules
 *   define their own `ok`/`err`/`Outcome` result helpers under those exact
 *   names by design (each module is meant to be self-contained) — an
 *   `export *` from both would make those specific names ambiguous at this
 *   barrel. Beyond that unavoidable rename, this barrel deliberately re-exports
 *   only the units module's *domain-facing* API (unit strings in, converted
 *   quantities/errors out) — its internal `Rational` (exact-fraction)
 *   arithmetic primitives are implementation detail nothing outside
 *   `units/**` needs yet, and stay available only via
 *   `packages/domain/src/units/index.ts` (architect-endorsed review fix,
 *   M1-T3 PASS WITH FIXES: narrower root surface now, since nothing depends
 *   on the raw Rational helpers).
 */

export const DOMAIN_PACKAGE_NAME = "@smart-kitchen/domain";

export * from "./inventory/index.js";

export {
  addQuantities,
  compareQuantities,
  convert,
  convertWithBridge,
  makeBridge,
  neededQuantity,
  BASE_UNIT,
  lookupUnit,
  unitKind,
  unitsOfKind,
  UNIT_ENTRIES,
  UNIT_KINDS,
  isUnitError,
} from "./units/index.js";
export type {
  ConversionBridge,
  ConversionResult,
  UnitEntry,
  UnitError,
  UnitErrorCode,
  UnitKind,
  UnitOutcome,
} from "./units/index.js";
