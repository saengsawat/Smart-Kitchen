/**
 * Exact quantity formatting (M3-T3, CLAUDE.md rule 7).
 *
 * No quantity is ever a JavaScript `number` anywhere in this module or its
 * callers. `QuantityDto.micros` and `InventoryTransactionDto.deltaMicros`
 * arrive as decimal text; they are parsed with `BigInt` (`parseMicros`) and
 * every arithmetic step (rounding, comparison, summation) stays in `bigint`.
 * `QuantityDto.amount`/`InventoryTransactionDto.amount` arrive as the
 * server's own exact decimal text (packages/contracts/src/inventory.ts: "the
 * exact decimal text of those micros ... never re-derive it through a
 * float"); this module only ever *trims* that string (drops a trailing-zero
 * fraction) or builds an equivalent string straight from a `bigint`. Nothing
 * here calls `Number(...)`, `parseFloat`, `.toFixed`, or arithmetic on a
 * `number` quantity.
 */

import type { InventoryLotDto, ProvenanceTierDto, QuantityDto } from "@smart-kitchen/contracts";

/** Micro-units per whole unit (ADR-008, domain-model.md §2). */
export const MICROS_PER_UNIT = 1_000_000n;

/** Parses a DTO's decimal-text micros field. The one sanctioned use of `BigInt(text)` for a quantity. */
export function parseMicros(text: string): bigint {
  return BigInt(text);
}

/**
 * Exact decimal text of a `bigint` micros value: `2000000n` -> `"2"`,
 * `250000n` -> `"0.250000"`. Mirrors `apps/api/src/db/inventory/repository.ts`'s
 * `microsToDecimalText` exactly (that function cannot be imported here —
 * `apps/mobile` never imports server code — so the algorithm is restated,
 * pinned by this module's own tests against the same fixture values).
 */
export function microsToAmountText(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const text =
    frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(6, "0")}`;
  return negative ? `-${text}` : text;
}

/**
 * Trims a DTO amount string's trailing zero fraction for display:
 * `"1.250000"` -> `"1.25"`, `"2.000000"` -> `"2"`, `"-0.250000"` -> `"-0.25"`.
 * Pure string manipulation on an already-exact decimal; never touches a
 * `number`. A string with no `.` (already whole) passes through unchanged.
 */
export function trimAmountText(amount: string): string {
  if (!amount.includes(".")) {
    return amount;
  }
  const trimmed = amount.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

/**
 * `"+2 lb" | "−2.25 lb"` — a signed magnitude for a ledger row's `amt`
 * column, from exact decimal text. Uses the typographic minus sign (U+2212),
 * matching the prototype's `.amt.neg` rows, never a hyphen or the forbidden
 * em dash (P11; U+2212 and U+2014 are different code points).
 */
export function formatSignedAmount(amount: string, unit: string): string {
  const trimmed = trimAmountText(amount);
  const isNegative = trimmed.startsWith("-");
  const magnitude = isNegative ? trimmed.slice(1) : trimmed;
  const sign = isNegative ? "−" : "+";
  return `${sign}${magnitude} ${pluralizeUnit(unit, magnitude)}`;
}

/**
 * Units that pluralize for display (ENGINEERING INFERENCE: no unit registry
 * publishes display pluralization; this is a small whitelist covering the
 * units the S4/S5 fixture set actually uses, flagged in the worker report).
 * Unlisted units (lb, oz, g, ml, l, tsp, tbsp, bottle at qty 1, count) render
 * invariant, matching the prototype's own usage (`5 oz`, `1.25 lb`, `1 bottle`).
 */
const PLURAL_UNITS: Readonly<Record<string, string>> = { cup: "cups" };

function pluralizeUnit(unit: string, trimmedMagnitude: string): string {
  const isOne = trimmedMagnitude === "1";
  if (isOne) {
    return unit;
  }
  return PLURAL_UNITS[unit] ?? unit;
}

/** True when every lot shares the same positive quantity (a uniform pack: "3 lots of 16 oz each"). */
function isUniformPack(lots: readonly InventoryLotDto[]): boolean {
  if (lots.length < 2) {
    return false;
  }
  const first = lots[0]!.quantity.micros;
  if (parseMicros(first) <= 0n) {
    return false;
  }
  return lots.every((lot) => lot.quantity.micros === first);
}

/** Total from a lot's `label`, for a partial-pack count ("8 of 12"). See the module doc comment below for scope. */
function packTotalFromLabel(label: string | null): string | null {
  if (label === null) {
    return null;
  }
  const match = /\bof\s+(\d+)\b/i.exec(label);
  return match ? match[1]! : null;
}

/**
 * Renders an item's on-hand quantity the way S4/S5 show it, per prototype v4:
 *
 * - A uniform multi-lot pack renders as a count times the per-lot amount
 *   ("3 × 16 oz" for three identical 16 oz Greek-yogurt tubs), not the summed
 *   total, because the pack breakdown is the fact a shopper reads off the
 *   shelf.
 * - A single `count`-unit lot whose `label` names a pack total ("carton of
 *   12") renders as "N of M" ("8 of 12" for eggs). This is a fixture-authoring
 *   convention this ticket introduces on the existing `InventoryLotDto.label`
 *   field (packages/contracts/src/inventory.ts: "A distinguishable
 *   acquisition ... optional user label"), not a new wire field: no DTO in
 *   this ticket's scope carries a pack-size total, and inventing one would be
 *   guessing a product decision (CLAUDE.md rule 3). Flagged in the worker
 *   report as a proposed follow-up if a real pack-size field is wanted later.
 * - Otherwise, the exact trimmed amount plus the unit, prefixed `~` when the
 *   quantity's provenance tier is `ESTIMATED` (prototype's own convention:
 *   "~4 cups" next to the Estimated chip for pantry rice derived from meals
 *   logged, never asserted as a fact — design-principles P2).
 */
export function formatQuantityDisplay(
  quantity: QuantityDto,
  lots: readonly InventoryLotDto[],
  provenanceTier: ProvenanceTierDto | null,
): string {
  if (isUniformPack(lots)) {
    const each = trimAmountText(lots[0]!.quantity.amount);
    return `${lots.length} × ${each} ${pluralizeUnit(quantity.unit, each)}`;
  }

  if (quantity.unit === "count" && lots.length === 1) {
    const total = packTotalFromLabel(lots[0]!.label);
    if (total !== null) {
      return `${trimAmountText(quantity.amount)} of ${total}`;
    }
  }

  const trimmed = trimAmountText(quantity.amount);
  const prefix = provenanceTier === "ESTIMATED" ? "~" : "";
  return `${prefix}${trimmed} ${pluralizeUnit(quantity.unit, trimmed)}`;
}
