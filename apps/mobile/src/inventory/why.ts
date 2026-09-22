/**
 * S5's "Why {qty}?" plain-language line, built deterministically from ledger
 * history (BACKLOG.md M3-T3 Objective (b), copy-deck.md §5 "Why does the app
 * think this?" template: "{action label} · {signed qty} {unit} · {date} ·
 * {who or source}"). A row carrying `systemFlag` (the clamp) renders the §5
 * clamp sentence instead of the generic template, never mistaken for a user
 * statement (copy-deck.md §5 "The clamp").
 *
 * Rows render oldest first here (a narrative building up to the current
 * total reads naturally in that order), independent of the history list's
 * own newest-first display order (see `src/inventory/ledger.ts`'s doc
 * comment on that choice).
 */

import type { InventoryTransactionDto } from "@smart-kitchen/contracts";
import { formatSignedAmount, trimAmountText } from "./quantity";
import { ACTION_LABELS, rowIsRemoval } from "./transactions";

/** copy-deck.md §5 "The clamp" sentence, verbatim, interpolating the residual and unit. */
export function clampSentence(residualAmount: string, unit: string): string {
  return `Our record was ${trimAmountText(residualAmount)} ${unit} short of what you used. Inventory corrected to match.`;
}

function formatShortDate(recordedAt: string): string {
  const date = new Date(recordedAt);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** S5 history row timestamp, prototype v4 style ("Wed 6:04 pm"). */
export function formatRowTimestamp(recordedAt: string): string {
  const date = new Date(recordedAt);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase()
    .replace(" ", String.fromCharCode(160)); // non-breaking space between time and am/pm
  return `${weekday} ${time}`;
}

/**
 * copy-deck.md §5 template's "{who or source}" clause. Review F4 ruling: a
 * removal's `provenance.source` is a reason ("Spoiled"), never a place, so
 * it renders as its own "reason: {lowercased}" clause (prototype wording),
 * distinct from `correlationLabel`, which names a recipe ("used in
 * {recipe}") and is never set on a removal row.
 */
function whoOrSource(tx: InventoryTransactionDto): string {
  if (tx.type === "ADJUSTMENT" && tx.actor.kind === "user") {
    return "you";
  }
  if (rowIsRemoval(tx.type) && tx.provenance.source) {
    return `reason: ${tx.provenance.source.toLowerCase()}`;
  }
  if (tx.correlationLabel) {
    return `used in ${tx.correlationLabel}`;
  }
  if (tx.provenance.source) {
    return tx.provenance.source;
  }
  return tx.actor.kind === "user" ? "you" : "the system";
}

/** One §5-template sentence, or the clamp sentence for a system-flagged row. */
function rowSentence(tx: InventoryTransactionDto, unit: string): string {
  if (tx.systemFlag === "OVER_CONSUMPTION") {
    return clampSentence(tx.amount, unit);
  }
  const label = ACTION_LABELS[tx.type];
  const signed = formatSignedAmount(tx.amount, unit);
  const date = formatShortDate(tx.recordedAt);
  return `${label} · ${signed} · ${date} · ${whoOrSource(tx)}.`;
}

/**
 * Builds the full "Why {qty}?" narrative from an item's history.
 * `history` must already be in the ledger's authoritative sequence order,
 * oldest first (domain-model.md §2: sequence, not `recordedAt`, is
 * authoritative — this function does not re-sort by timestamp, the same rule
 * the read model itself follows). `currentQuantityDisplay` is the
 * already-formatted on-hand amount (`formatQuantityDisplay`'s output), not
 * recomputed here.
 */
export function buildWhyLine(
  currentQuantityDisplay: string,
  unit: string,
  history: readonly InventoryTransactionDto[],
): string {
  const sentences = history.map((tx) => rowSentence(tx, unit));
  return [`Why ${currentQuantityDisplay}?`, ...sentences].join(" ");
}
