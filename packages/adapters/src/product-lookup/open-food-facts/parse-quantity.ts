/**
 * Parses OFF's free-text `quantity` and `serving_size` fields (M2-T4a (b)).
 *
 * OFF documents both as text a contributor typed ("We expect a quantity +
 * unit but the user is free to input any string"). This parser accepts only
 * text that reads unambiguously as one amount in one unit the domain's unit
 * registry knows, and answers `undefined` for everything else, so the field
 * is absent rather than guessed:
 *
 * | Accepted | Result |
 * | --- | --- |
 * | `793.8 g`, `20.5 oz`, `3.5 OZ`, `500 g ℮` | that amount in the registry's unit |
 * | `12 oz (340g)` | the first amount (both describe one package) |
 * | `1 portion (32 g)` | the bracketed amount, when the first unit is not a registry unit |
 *
 * | Refused (absent) | Why |
 * | --- | --- |
 * | `48 fl oz` | fluid ounces are deliberately not in the registry (M1-T3) |
 * | `2 x 60 g`, `13 oz, 6 muffins`, `35.3 oz (2 lb 3.3 oz) 1 kg` | more than one amount |
 * | `Net Wt 3.5 Oz (100g)` | leading words |
 * | `1,5 kg` | a comma could be a decimal or a thousands separator |
 * | `0 g`, empty, not a string | nothing to record |
 *
 * Amounts are at most 7 integer and 3 fractional digits, so the number this
 * returns prints back as exactly the text it was read from (`String(n)` of
 * a short decimal literal is that literal), which is what lets the API send
 * it on as `PackageSizeDto.qty` decimal text without rounding.
 */

import { lookupUnit } from "@smart-kitchen/domain";

export interface ParsedQuantity {
  readonly qty: number;
  /** The registry's canonical symbol, or `each` for a count (the household-facing count word, `UNITS_BY_KIND_DTO.COUNT`). */
  readonly unit: string;
}

const AMOUNT = String.raw`(\d{1,7}(?:\.\d{1,3})?)`;
const UNIT = String.raw`([A-Za-z]+(?: [A-Za-z]+)?)\.?`;
const SIMPLE = new RegExp(String.raw`^${AMOUNT}\s*${UNIT}$`);
const WITH_EQUIVALENT = new RegExp(
  String.raw`^${AMOUNT}\s*${UNIT}\s*\(\s*${AMOUNT}\s*${UNIT}\s*\)$`,
);

function resolve(
  amountText: string | undefined,
  unitText: string | undefined,
): ParsedQuantity | undefined {
  if (amountText === undefined || unitText === undefined) return undefined;
  const qty = Number(amountText);
  if (!Number.isFinite(qty) || qty <= 0) return undefined;
  const unit = lookupUnit(unitText);
  if (!unit.ok) return undefined;
  return { qty, unit: unit.value.kind === "COUNT" ? "each" : unit.value.symbol };
}

export function parseOffQuantity(raw: unknown): ParsedQuantity | undefined {
  if (typeof raw !== "string") return undefined;
  // The EU estimated-quantity mark is a legal marking, not part of the amount.
  const text = raw.replace(/\s*℮\s*$/u, "").trim();
  if (text === "") return undefined;

  const simple = SIMPLE.exec(text);
  if (simple) return resolve(simple[1], simple[2]);

  const pair = WITH_EQUIVALENT.exec(text);
  if (pair) return resolve(pair[1], pair[2]) ?? resolve(pair[3], pair[4]);

  return undefined;
}
