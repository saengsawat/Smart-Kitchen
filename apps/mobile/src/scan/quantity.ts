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
  /** The record's own provenance source for the size field (e.g. "open-food-facts", "manufacturer-label"). */
  readonly source: string;
  /** M2-T7: true when `qty` is a size the user typed on S8, not the record's own. */
  readonly userTyped?: boolean;
}

/** The quantity's provenance source when the amount is just the count the user entered, no size involved. */
export const SCANNED_BARCODE_QUANTITY_SOURCE = "scanned barcode";

/** S8's Add quantity plan: the exact micros to send, the unit to send it in, and the resulting quantity's tier/source. */
export interface ScanQuantityPlan {
  readonly amountMicros: bigint;
  readonly unit: string;
  readonly tier: "KNOWN_FACT" | "ESTIMATED";
  /** `quantityProvenance.source` for `createItem` — see {@link planScanQuantity}'s doc comment. */
  readonly source: string;
  /**
   * M2-T7: what `createItem` sends beyond the quantity. A typed package size
   * (used, so its unit was a supported one) sends `quantityOrigin:
   * "USER_TYPED"` and the lot label "{qty} {unit}"; every other plan sends
   * neither (`undefined`), so a product-data scan lands as before.
   */
  readonly origin?: ScanQuantityOrigin;
}

/** The two extra `createItem` fields a typed package size adds (M2-T7). */
export interface ScanQuantityOrigin {
  readonly quantityOrigin: "USER_TYPED";
  readonly lotLabel: string;
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
 * S8's item quantity (BACKLOG.md M3-T4e Objectives (d)/(e), review round 1
 * F3 ruling). `count` whole packages of `packageSize` each, when a package
 * size exists and its (already-normalized) unit is one `POST
 * /v1/inventory/items` accepts ({@link CREATE_ITEM_UNITS_DTO} — a strict
 * subset of the domain registry, so `pt`/`qt`/`gal` and anything unparsed
 * by the source fall through to the count-only branch below even though
 * some of them resolve in the registry itself): the amount is `count ×
 * size`, exact micros, and the quantity's tier/source both come from the
 * package size record itself — it is the fact the quantity is built from.
 *
 * **Otherwise (F3 ruling, reversing this function's original wording): the
 * amount is just `count`, the number of packages the user counted with
 * their own eyes, unit `each`.** That count is the user's own fact —
 * Known Fact — every time, whether there was no package size at all, or
 * one that named a unit this ledger cannot accept (e.g. a "qt" carton):
 * an unparsed or unsupported size does not make the *count* any less
 * certain, and never invents a conversion either way (CLAUDE.md rule 7).
 * The quantity's source is `"scanned barcode"` in this branch — never the
 * package size's own source, since the size was not used to build the
 * amount. The package size record, when present, is still shown on S8 as
 * its own text with its own tier chip (`ConfirmSheet`'s package-size row):
 * an Estimated OFF size sitting next to a Known Fact quantity is exactly
 * the point — two different facts, two different tiers, never conflated.
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
      source: packageSize.source,
      ...(packageSize.userTyped === true
        ? {
            origin: {
              quantityOrigin: "USER_TYPED" as const,
              lotLabel: `${packageSize.qty} ${packageSize.unit}`,
            },
          }
        : {}),
    };
  }
  return {
    amountMicros: wholeUnitQuantityMicros(count),
    unit: "each",
    tier: "KNOWN_FACT",
    source: SCANNED_BARCODE_QUANTITY_SOURCE,
  };
}
