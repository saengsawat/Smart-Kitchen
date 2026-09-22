/**
 * In-memory append-only fixture ledger (M3-T3, ADR-008, CLAUDE.md rule 10).
 *
 * `FixtureApiClient`'s write methods (`correctQuantity`, `removeQuantity`,
 * `undo`, `confirmAiProposal` — M2-T2 supplies the real endpoints) are backed
 * by this module. Nothing here mutates or deletes a row: every operation
 * appends a new {@link InventoryTransactionDto} to an item's `history` array,
 * and the on-hand quantity is always derived by summing `deltaMicros` in
 * `bigint` (never `Number`), the same rule the real ledger enforces
 * (domain-model.md §4 invariant 1).
 *
 * `history` is kept in the ledger's authoritative append order, oldest first
 * (domain-model.md §2: append order, not `recordedAt`, is authoritative). S5
 * displays it newest-first (`[...history].reverse()`), which is also how a
 * freshly appended correction or removal ends up "at the top" (BACKLOG.md
 * M3-T3 acceptance criterion) without the prototype's own inconsistency
 * between `prependHistoryRow` (corrections) and `appendHistoryRow` (removals)
 * pointing at two different ends of the list (flagged as an open follow-up in
 * BACKLOG.md's M3-E0-T1 accepted follow-ups: "consistent prepend/append
 * ordering in S5"; resolved here by always appending to the sequence and
 * always displaying it reversed).
 *
 * Lot balances are a static display snapshot, not recomputed per transaction:
 * the ticket's write methods are explicitly item-level ("derives the
 * quantity by summing deltas ... per item"), and per-lot consumption
 * (FEFU/FEFO allocation) is OQ-1, still open and out of this ticket's scope
 * (out-of-scope list: "FEFO shown as a multi-lot split"). Flagged in the
 * worker report.
 */

import type {
  FieldProvenanceDto,
  InventoryItemDetailDto,
  InventoryItemSummaryDto,
  InventoryLotDto,
  InventoryTransactionDto,
  ProvenanceTierDto,
  StorageLocationDto,
  TransactionActorDto,
  TransactionTypeDto,
} from "@smart-kitchen/contracts";
import { formatQuantityDisplay, microsToAmountText, parseMicros } from "./quantity";

/** Thrown for the one user-triggerable ledger error a fixture write can hit (copy-deck.md §8 ZERO_DELTA). */
export class ZeroDeltaError extends Error {
  constructor() {
    super("Enter an amount to record a change.");
    this.name = "ZeroDeltaError";
  }
}

export interface MutableItemFixture {
  readonly itemId: string;
  readonly displayName: string;
  readonly storageLocation: StorageLocationDto;
  readonly unit: string;
  /** Static display snapshot (see module doc comment); not recomputed per transaction. */
  readonly lots: readonly InventoryLotDto[];
  /** Append-only, oldest first (the ledger's authoritative sequence order). */
  history: InventoryTransactionDto[];
  /**
   * Fixture-only confirmation flag (`confirmAiProposal`): the real system
   * promotes an AI observation to a household fact through a different
   * mechanism than a ledger append (domain-model.md §2 `AIObservation`), so
   * this does not append a row, it just stops the item asking for
   * confirmation. Ticket text: "confirmAiProposal(itemId) flips the AI-tier
   * row to confirmed (fixture only)".
   */
  confirmed: boolean;
  /** Whether this row belongs in S4's "Needs your confirmation" tray while unconfirmed. */
  readonly needsConfirmWhenUnconfirmed: boolean;
}

let idCounter = 0;

/** Deterministic, collision-free within a session; real ids come from the server once M2-T2 lands. */
function nextTransactionId(itemId: string): string {
  idCounter += 1;
  return `${itemId}-tx-${idCounter}`;
}

/** BigInt sum of every row's `deltaMicros` — the only way this module computes an on-hand quantity. */
export function currentMicros(history: readonly InventoryTransactionDto[]): bigint {
  return history.reduce((sum, tx) => sum + parseMicros(tx.deltaMicros), 0n);
}

function buildRow(params: {
  itemId: string;
  type: TransactionTypeDto;
  deltaMicros: bigint;
  recordedAt: string;
  actor: TransactionActorDto;
  provenance: FieldProvenanceDto;
  systemFlag?: "OVER_CONSUMPTION";
  correlationLabel?: string;
}): InventoryTransactionDto {
  return {
    transactionId: nextTransactionId(params.itemId),
    type: params.type,
    deltaMicros: params.deltaMicros.toString(),
    amount: microsToAmountText(params.deltaMicros),
    recordedAt: params.recordedAt,
    actor: params.actor,
    provenance: params.provenance,
    ...(params.systemFlag ? { systemFlag: params.systemFlag } : {}),
    ...(params.correlationLabel ? { correlationLabel: params.correlationLabel } : {}),
  };
}

/**
 * Appends a decrease, clamping at zero with a system-authored compensating
 * `ADJUSTMENT` when the requested magnitude exceeds the current balance
 * (domain-model.md §4 invariant 2, ADR-008): the decrease is still recorded
 * at its full stated magnitude (never silently shrunk), and a second row
 * carrying `systemFlag: "OVER_CONSUMPTION"` restores the balance to exactly
 * zero. The flag is set only here, never by a caller.
 */
export function appendDecrease(
  item: MutableItemFixture,
  params: {
    type: TransactionTypeDto;
    magnitudeMicros: bigint;
    recordedAt: string;
    actor: TransactionActorDto;
    provenance: FieldProvenanceDto;
    correlationLabel?: string;
  },
): void {
  if (params.magnitudeMicros <= 0n) {
    throw new ZeroDeltaError();
  }
  const balance = currentMicros(item.history);
  item.history.push(
    buildRow({
      itemId: item.itemId,
      type: params.type,
      deltaMicros: -params.magnitudeMicros,
      recordedAt: params.recordedAt,
      actor: params.actor,
      provenance: params.provenance,
      correlationLabel: params.correlationLabel,
    }),
  );
  const overshoot = params.magnitudeMicros - balance;
  if (overshoot > 0n) {
    item.history.push(
      buildRow({
        itemId: item.itemId,
        type: "ADJUSTMENT",
        deltaMicros: overshoot,
        recordedAt: params.recordedAt,
        actor: { kind: "system" },
        // Review F11: never rendered directly today (the clamp row's
        // caption is always clampSentence(), never provenance.source), but
        // a plain, human-readable value future-proofs against that
        // changing silently.
        provenance: {
          tier: "ESTIMATED",
          source: "inventory correction",
          confidence: null,
          recordedAt: null,
        },
        systemFlag: "OVER_CONSUMPTION",
      }),
    );
  }
}

/** Appends an increase (purchase / initial stock). Used to seed fixture history, never zero. */
export function appendIncrease(
  item: MutableItemFixture,
  params: {
    type: Extract<TransactionTypeDto, "PURCHASE" | "INITIAL_STOCK">;
    amountMicros: bigint;
    recordedAt: string;
    actor: TransactionActorDto;
    provenance: FieldProvenanceDto;
    correlationLabel?: string;
  },
): void {
  if (params.amountMicros <= 0n) {
    throw new ZeroDeltaError();
  }
  item.history.push(
    buildRow({
      itemId: item.itemId,
      type: params.type,
      deltaMicros: params.amountMicros,
      recordedAt: params.recordedAt,
      actor: params.actor,
      provenance: params.provenance,
      correlationLabel: params.correlationLabel,
    }),
  );
}

/** `correctQuantity`: appends one `ADJUSTMENT` carrying the signed delta to reach `newAmountMicros`. */
export function appendCorrection(
  item: MutableItemFixture,
  newAmountMicros: bigint,
  recordedAt: string,
  actor: TransactionActorDto,
): InventoryTransactionDto {
  const delta = newAmountMicros - currentMicros(item.history);
  if (delta === 0n) {
    throw new ZeroDeltaError();
  }
  const row = buildRow({
    itemId: item.itemId,
    type: "ADJUSTMENT",
    deltaMicros: delta,
    recordedAt,
    actor,
    // Review F11: a plain, human-readable source (never a code-internal
    // token) — this is the one string a history row's caption can render
    // verbatim for a correction (why.ts's whoOrSource already renders "you"
    // for the why-line's own version of this row).
    provenance: {
      tier: "KNOWN_FACT",
      source: "one-tap correction",
      confidence: null,
      recordedAt: null,
    },
  });
  item.history.push(row);
  return row;
}

/**
 * `removeQuantity`: removes the full on-hand amount under the mapped
 * `TransactionType` (copy-deck.md §5). `reasonLabel` (the secondary reason
 * chip, e.g. "Spoiled") travels in `provenance.source`, never
 * `correlationLabel` (review F4 ruling: that field names a recipe, not a
 * removal reason).
 */
export function appendRemoval(
  item: MutableItemFixture,
  type: Extract<TransactionTypeDto, "CONSUME" | "DISCARD" | "EXPIRE" | "DONATE">,
  recordedAt: string,
  actor: TransactionActorDto,
  reasonLabel?: string,
): void {
  appendDecrease(item, {
    type,
    magnitudeMicros: currentMicros(item.history),
    recordedAt,
    actor,
    provenance: {
      tier: "KNOWN_FACT",
      source: reasonLabel ?? "manual entry",
      confidence: null,
      recordedAt: null,
    },
  });
}

/** `undo`: appends the exact compensating `ADJUSTMENT` for a previously recorded row. Never deletes it. */
export function appendUndo(
  item: MutableItemFixture,
  transactionId: string,
  recordedAt: string,
  actor: TransactionActorDto,
): InventoryTransactionDto {
  const original = item.history.find((tx) => tx.transactionId === transactionId);
  if (!original) {
    throw new Error(`undo: no transaction ${transactionId} on item ${item.itemId}`);
  }
  const row = buildRow({
    itemId: item.itemId,
    type: "ADJUSTMENT",
    deltaMicros: -parseMicros(original.deltaMicros),
    recordedAt,
    actor,
    provenance: { tier: "KNOWN_FACT", source: "undo", confidence: null, recordedAt: null },
  });
  item.history.push(row);
  return row;
}

/** Most recent row's provenance tier, or `null` for an item with no history (matches inventory-snapshot.ts). */
function latestProvenance(item: MutableItemFixture): FieldProvenanceDto | null {
  const last = item.history.at(-1);
  return last ? last.provenance : null;
}

function effectiveQuantityTier(item: MutableItemFixture): ProvenanceTierDto | null {
  if (item.confirmed) {
    return "KNOWN_FACT";
  }
  return latestProvenance(item)?.tier ?? null;
}

/** Whether the item currently belongs in S4's "Needs your confirmation" tray. */
export function needsConfirmation(item: MutableItemFixture): boolean {
  return (
    item.needsConfirmWhenUnconfirmed &&
    !item.confirmed &&
    effectiveQuantityTier(item) === "AI_INTERPRETATION"
  );
}

function activeLots(item: MutableItemFixture): readonly InventoryLotDto[] {
  return item.lots.filter((lot) => parseMicros(lot.quantity.micros) > 0n);
}

/** Builds the wire-shaped summary row for `GET /v1/inventory/items` from an item's current state. */
export function toSummaryDto(item: MutableItemFixture): InventoryItemSummaryDto {
  const micros = currentMicros(item.history);
  const lots = activeLots(item);
  const earliest = [...lots]
    .filter((lot) => lot.expiresAt !== null)
    .sort((a, b) => (a.expiresAt! < b.expiresAt! ? -1 : a.expiresAt! > b.expiresAt! ? 1 : 0))[0];
  const tier = effectiveQuantityTier(item);
  const base: FieldProvenanceDto | null = latestProvenance(item);
  return {
    itemId: item.itemId,
    displayName: item.displayName,
    productRef: null,
    ingredientRef: null,
    storageLocation: item.storageLocation,
    quantity: { unit: item.unit, micros: micros.toString(), amount: microsToAmountText(micros) },
    earliestExpiresAt: earliest?.expiresAt ?? null,
    provenance: {
      quantity:
        tier === null || base === null
          ? null
          : { tier, source: base.source, confidence: base.confidence, recordedAt: base.recordedAt },
      earliestExpiresAt: earliest?.expiresAtProvenance ?? null,
    },
    lots,
  };
}

/** Builds S5's payload: the summary plus full history, oldest first. */
export function toDetailDto(item: MutableItemFixture): InventoryItemDetailDto {
  return { summary: toSummaryDto(item), history: item.history };
}

/** Display string for an item's on-hand quantity (formatting module, BigInt-safe throughout). */
export function displayQuantity(item: MutableItemFixture): string {
  const summary = toSummaryDto(item);
  return formatQuantityDisplay(
    summary.quantity,
    summary.lots,
    summary.provenance.quantity?.tier ?? null,
  );
}
