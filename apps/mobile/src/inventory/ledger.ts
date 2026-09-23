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

/**
 * Provenance source recorded on a row a person wrote through this fixture,
 * matching `apps/api/src/db/inventory/write-service.ts`'s `MANUAL_ENTRY_SOURCE`
 * constant exactly (restated, not imported: `apps/mobile` never imports
 * server code). The picked reason chip ("Spoiled", "Wrong item", …) now
 * travels in the row's own `reason` field (M3-T4a; previously reused this
 * field, the M3-T3 `provenance.source` workaround this ticket removes).
 */
const MANUAL_ENTRY_SOURCE = "manual-entry";

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
  reason: string | null;
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
    reason: params.reason,
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
    reason: string | null;
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
      reason: params.reason,
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
        // Matches the domain's own clamp constants exactly
        // (packages/domain/src/inventory/ledger.ts CLAMP_SOURCE/CLAMP_REASON,
        // restated rather than imported: apps/mobile never imports
        // @smart-kitchen/domain, M3-T1 invariant). Review F11: never
        // rendered directly today (the clamp row's caption is always
        // clampSentence(), never provenance.source/reason), but matching the
        // real server's exact strings future-proofs against that changing.
        provenance: {
          tier: "ESTIMATED",
          source: "inventory-ledger:over-consumption-clamp",
          confidence: null,
          recordedAt: null,
        },
        reason: "over-consumption-clamp",
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
      reason: null,
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
    reason: null,
  });
  item.history.push(row);
  return row;
}

/**
 * `removeQuantity`: removes the full on-hand amount under the mapped
 * `TransactionType` (copy-deck.md §5). `reasonLabel` (the secondary reason
 * chip, e.g. "Spoiled") travels in the row's own `reason` field, matching
 * `InventoryWriteRequestDto.reason` on the real endpoint exactly (M3-T4a:
 * this replaces the M3-T3 `provenance.source` workaround, which stood in for
 * a wire field that did not exist yet). `provenance.source` reverts to the
 * fixed manual-entry source the real API records, the same for every manual
 * write regardless of reason. Returns the appended row (review F3's rule,
 * extended to removals): the caller needs the *actual* new row to offer an
 * undo, never an assumption like "the last row in history".
 */
export function appendRemoval(
  item: MutableItemFixture,
  type: Extract<TransactionTypeDto, "CONSUME" | "DISCARD" | "EXPIRE" | "DONATE">,
  recordedAt: string,
  actor: TransactionActorDto,
  reasonLabel?: string,
): InventoryTransactionDto {
  appendDecrease(item, {
    type,
    magnitudeMicros: currentMicros(item.history),
    recordedAt,
    actor,
    provenance: {
      tier: "KNOWN_FACT",
      source: MANUAL_ENTRY_SOURCE,
      confidence: null,
      recordedAt: null,
    },
    reason: reasonLabel ?? null,
  });
  // appendDecrease always pushes the removal row itself first (a clamp row,
  // if any, is a second, later push), so it is always the row immediately
  // before wherever history now ends minus however many clamp rows followed
  // — but a full-balance removal (this function's only call shape) can never
  // overshoot, so there is never a clamp row to skip past.
  return item.history.at(-1)!;
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
    // Matches the real endpoint's own convention exactly
    // (apps/api/src/db/inventory/write-service.ts UNDO_REASON_PREFIX):
    // relates the compensating row back to what it undoes, and is refused as
    // a normal write's own `reason` (a client cannot forge it).
    reason: `undo:${transactionId}`,
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
