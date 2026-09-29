/**
 * S8/S9 quantity math (M3-T4b, CLAUDE.md rule 7): every quantity is exact
 * `bigint` micros, never a `number` carrying a fraction. `count` (the number
 * of packages on S8, or the whole-unit stepper value on S9) is always a
 * plain non-negative integer, so converting it with `BigInt(count)` loses
 * nothing; the only place a fraction can appear is a package's printed size
 * (`ScannedProductDto.packageSize.value.qty`), which arrives as exact
 * decimal text (`packages/contracts/src/products.ts`'s own rule, mirroring
 * `QuantityDto.amount`) and is parsed digit-by-digit into micros here, the
 * same discipline `src/inventory/quantity.ts`'s `parseMicros` uses for
 * already-micros text.
 */

import { CREATE_ITEM_UNITS_DTO, type ProvenanceTierDto } from "@smart-kitchen/contracts";
import { MICROS_PER_UNIT } from "../inventory/quantity";

/**
 * Parses exact decimal text (e.g. `"16"`, `"0.5"`, `"-2.250000"`) into
 * micro-units. The sanctioned way to turn a printed amount into a `bigint`
 * without ever routing through `Number`/`parseFloat`. Throws on more than
 * six fractional digits (this app's micros resolution) rather than
 * silently truncating precision it was not asked to drop.
 */
export function decimalAmountToMicros(text: string): bigint {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  const wholePart = parts[0] ?? "";
  const fracPart = parts[1] ?? "";
  if (parts.length > 2 || !/^\d*$/.test(wholePart) || !/^\d*$/.test(fracPart)) {
    throw new RangeError(`decimalAmountToMicros: "${text}" is not a plain decimal amount`);
  }
  if (fracPart.length > 6) {
    throw new RangeError(
      `decimalAmountToMicros: "${text}" has more than 6 fractional digits, exceeding micro-unit precision`,
    );
  }
  const whole = wholePart === "" ? 0n : BigInt(wholePart);
  const frac = fracPart === "" ? 0n : BigInt(fracPart.padEnd(6, "0"));
  const micros = whole * MICROS_PER_UNIT + frac;
  return negative ? -micros : micros;
}

/**
 * S8's item quantity: `count` whole packages of `packageSizeQty` each, in
 * exact micros. `count` must be a positive integer (S8's stepper never lets
 * it reach zero — "Add {n} to {location}" implies at least one package).
 */
export function packageQuantityMicros(count: number, packageSizeQty: string): bigint {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(
      `packageQuantityMicros: count must be a positive integer, got ${String(count)}`,
    );
  }
  return decimalAmountToMicros(packageSizeQty) * BigInt(count);
}

/** S9's item quantity: a plain whole-unit count in the chosen unit, in exact micros. */
export function wholeUnitQuantityMicros(count: number): bigint {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `wholeUnitQuantityMicros: count must be a non-negative integer, got ${String(count)}`,
    );
  }
  return BigInt(count) * MICROS_PER_UNIT;
}

/** A scanned product's package size, its unit already normalized (e.g. OFF/corpus "ct" -> this app's "each"). */
export interface ScanPackageSizeInput {
  readonly qty: string;
  readonly unit: string;
  readonly tier: ProvenanceTierDto;
}

/** S8's Add quantity plan: the exact micros to send, the unit to send it in, and the resulting quantity's tier. */
export interface ScanQuantityPlan {
  readonly amountMicros: bigint;
  readonly unit: string;
  readonly tier: "KNOWN_FACT" | "ESTIMATED";
}

/**
 * Whether `POST /v1/inventory/items` accepts this (already-normalized) unit
 * (BACKLOG.md M3-T4e Objective (e)). {@link CREATE_ITEM_UNITS_DTO} is the
 * household-facing whitelist (`packages/contracts/src/units.ts`), a strict
 * subset of the domain registry: `pt`, `qt` and `gal` resolve in the
 * registry but are not on this list, and `fl oz` resolves in neither — both
 * are "the registry refuses" in the ticket's shorthand for "this app's
 * ledger cannot record it as its own unit". Never a registry lookup
 * client-side (the client has no domain import, M3-T1/M3-T3 invariant);
 * this list is the one client-visible source of truth for what a package's
 * unit can become on the wire.
 */
export function isCreateItemUnit(unit: string): boolean {
  return CREATE_ITEM_UNITS_DTO.includes(unit);
}

/**
 * S8's item quantity (BACKLOG.md M3-T4e Objectives (d)/(e)): `count` whole
 * packages of `packageSize` each, when a package size exists and its
 * (already-normalized) unit is one `POST /v1/inventory/items` accepts
 * ({@link CREATE_ITEM_UNITS_DTO} — a strict subset of the domain registry,
 * so `pt`/`qt`/`gal` and anything unparsed by the source fall through here
 * even though some of them resolve in the registry itself). The quantity's
 * tier is the lowest tier among its inputs (rule: never raise a tier on the
 * client): `count` is always Known Fact (the user physically counted whole
 * packages), so the tier is `packageSize`'s own tier when its unit is used
 * directly.
 *
 * When the unit cannot be used (present but not accepted, e.g. "qt"), the
 * item is recorded as the chosen count of packages, unit `each` — never an
 * invented conversion (CLAUDE.md rule 7) — and the quantity tier is fixed
 * `ESTIMATED`, because the count of packages is honest but the record no
 * longer states the item's real size, only how many of them there are.
 * When there is no package size at all, the only input is `count` itself,
 * so the quantity stays Known Fact, same as S9's manual entries.
 */
export function planScanQuantity(
  packageSize: ScanPackageSizeInput | undefined,
  count: number,
): ScanQuantityPlan {
  if (packageSize && isCreateItemUnit(packageSize.unit)) {
    return {
      amountMicros: packageQuantityMicros(count, packageSize.qty),
      unit: packageSize.unit,
      // AI_INTERPRETATION never reaches this path in practice (OFF and the
      // fixture corpus only ever carry KNOWN_FACT/ESTIMATED package sizes,
      // and createItem refuses AI_INTERPRETATION outright), but a defensive
      // fallback to ESTIMATED is still correct if one ever did: never treat
      // an unconfirmed AI figure as a Known Fact quantity.
      tier: packageSize.tier === "KNOWN_FACT" ? "KNOWN_FACT" : "ESTIMATED",
    };
  }
  return {
    amountMicros: wholeUnitQuantityMicros(count),
    unit: "each",
    tier: packageSize ? "ESTIMATED" : "KNOWN_FACT",
  };
}
