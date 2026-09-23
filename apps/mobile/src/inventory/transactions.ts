/**
 * Ledger transaction-type vocabulary shared by S5's reason chips, history
 * rows and the "why" line generator (M3-T3).
 *
 * The reason-chip -> `TransactionType` mapping is copy-deck.md §5's own table,
 * ratified as an ENGINEERING INFERENCE there (not sourced verbatim from
 * either the brief or the PRD): "Cooked" (`USE_IN_MEAL`) is shown
 * automatically by the recipe cook-confirm flow, out of this ticket's scope
 * (M3-T4/M6), so S5's manual reason row offers only the four chips prototype
 * v4 shows (`#reasonTop`): Consume, Discard, Mark expired, Donate.
 */

import type { TransactionTypeDto } from "@smart-kitchen/contracts";

/** `removeQuantity`'s `action`: the four manual removal reasons (`USE_IN_MEAL`/`ADJUSTMENT` are not manual reasons). */
export type RemovalAction = Extract<
  TransactionTypeDto,
  "CONSUME" | "DISCARD" | "EXPIRE" | "DONATE"
>;

/** S5's four manual removal-reason chips, prototype v4 labels, copy-deck.md §5 mapping. */
export const REMOVAL_REASON_CHIPS: readonly {
  readonly label: string;
  readonly type: RemovalAction;
}[] = [
  { label: "Consume", type: "CONSUME" },
  { label: "Discard", type: "DISCARD" },
  { label: "Mark expired", type: "EXPIRE" },
  { label: "Donate", type: "DONATE" },
];

/**
 * S5's secondary reason row (prototype v4 `#reasonChips`), shown once a top
 * chip is picked. The picked sub-reason travels in the row's own `reason`
 * field (M2-T2 added it to `InventoryTransactionDto`; M3-T4a wires the
 * client to it, removing the M3-T3 `provenance.source` workaround this
 * comment used to describe), never `correlationLabel` (review F4 ruling:
 * `correlationLabel` is for a recipe name only, so a removal row is never
 * rendered as "{action} in {reason}", which reads as if the reason were a
 * place; see `rowIsRemoval`/`why.ts`/`[itemId].tsx`, which render it as its
 * own "reason: {reason}" caption instead).
 */
export const REMOVAL_SUB_REASONS: readonly string[] = [
  "Spoiled",
  "Wrong item",
  "Used it all",
  "Other",
];

/** The four manual removal types, for telling a removal row apart from a recipe-correlated one (review F4). */
const REMOVAL_TYPES: ReadonlySet<TransactionTypeDto> = new Set<TransactionTypeDto>([
  "CONSUME",
  "DISCARD",
  "EXPIRE",
  "DONATE",
]);

/** True for a manual removal row (its `provenance.source`, if any, is a reason, never a recipe/correlation name). */
export function rowIsRemoval(type: TransactionTypeDto): boolean {
  return REMOVAL_TYPES.has(type);
}

/** History-row / "why" line action label per transaction type (copy-deck.md §5 template examples). */
export const ACTION_LABELS: Readonly<Record<TransactionTypeDto, string>> = {
  INITIAL_STOCK: "Initial stock",
  PURCHASE: "Purchased",
  CONSUME: "Used",
  USE_IN_MEAL: "Cooked",
  DISCARD: "Discarded",
  EXPIRE: "Expired",
  DONATE: "Donated",
  ADJUSTMENT: "Corrected",
};
