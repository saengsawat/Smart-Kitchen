/**
 * The shopping gap for one row (M7-T1 (b)), as a pure function.
 *
 * Three rules, each one an invariant of the ticket:
 *
 * - **The subtraction is the domain's.** `buyMicros` is `neededQuantity`
 *   (INV-SHOP-1: `max(0, need - have)`), called on every path, including the
 *   ones where nothing is on hand. This module never subtracts, clamps or
 *   compares a quantity itself (CLAUDE.md rule 7).
 * - **No conversion, ever.** The on-hand amount counts against the row only
 *   when the item's unit is the row's unit, compared as the exact stored
 *   symbol, which is also the comparison the ledger makes when the PURCHASE
 *   lands (`MIXED_UNITS`). A row in `each` over an item in `count` is a
 *   mismatch here even though the registry lists `each` as an alias of
 *   `count`, because the ledger would refuse that PURCHASE too. A mismatch
 *   answers "nothing on hand" (`haveMicros: "0"`, `haveTier: null`) and
 *   `buy = need`, never a converted number. `neededQuantity` is still what
 *   produces that `buy`, called with the row's own unit on both sides, so the
 *   domain's identity conversion is the only one that ever runs.
 * - **The tier is the snapshot's.** When an amount is counted, its tier is
 *   the item's current quantity tier exactly as S4 shows it (the tier of the
 *   latest ledger statement, `snapshot.ts`), passed through, `null` included.
 *   Nothing here invents one.
 */

import type { ProvenanceTierDto } from "@smart-kitchen/contracts";
import { neededQuantity } from "@smart-kitchen/domain";

/** What the gap needs from the row. */
export interface GapRowInput {
  readonly needMicros: bigint;
  readonly unit: string;
}

/** What the gap needs from the row's item, when it has one. */
export interface GapItemInput {
  readonly unit: string;
  readonly currentMicros: bigint;
  readonly quantityTier: ProvenanceTierDto | null;
}

export interface RowGap {
  readonly haveMicros: bigint;
  readonly haveTier: ProvenanceTierDto | null;
  readonly buyMicros: bigint;
}

/** The domain refused a unit the database CHECK admitted: a registry drift, never the caller's fault. */
export class ShoppingGapIntegrityError extends Error {
  constructor(unit: string, code: string) {
    super(`neededQuantity refused the stored shopping unit "${unit}": ${code}`);
    this.name = "ShoppingGapIntegrityError";
  }
}

/**
 * The gap for one row.
 *
 * `item` is `undefined` for a row with no item. A row whose `item_id` points
 * at an item is always given that item: the foreign key guarantees it exists.
 */
export function computeRowGap(row: GapRowInput, item: GapItemInput | undefined): RowGap {
  const counted = item !== undefined && item.unit === row.unit;
  const haveMicros = counted ? item.currentMicros : 0n;
  const haveTier = counted ? item.quantityTier : null;

  const needed = neededQuantity(row.needMicros, row.unit, haveMicros, row.unit);
  if (!needed.ok) throw new ShoppingGapIntegrityError(row.unit, needed.error.code);
  return { haveMicros, haveTier, buyMicros: needed.value.micros };
}
