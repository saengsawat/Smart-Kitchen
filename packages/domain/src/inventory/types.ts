/**
 * Inventory ledger types (ADR-008, domain-model.md §2).
 *
 * Everything here is `readonly` by construction and deep-frozen at runtime once
 * recorded (see `freeze.ts`): a recorded transaction is a fact, and facts are
 * corrected by appending new facts (INV-LEDGER-2).
 */

import type { LedgerError } from "./errors.js";
import type { Quantity, Unit } from "./quantity.js";

/** ISO-8601 instant, e.g. `2026-03-06T18:30:00.000Z`. Offsets are accepted. */
export type Instant = string;

/**
 * Ledger transaction types (domain-model.md §2, superset of brief §7 reasons).
 * Order here is documentation only; the ledger orders by append sequence.
 */
export const TRANSACTION_TYPES = [
  "INITIAL_STOCK",
  "PURCHASE",
  "CONSUME",
  "USE_IN_MEAL",
  "DISCARD",
  "EXPIRE",
  "DONATE",
  "ADJUSTMENT",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * Sign a transaction type is allowed to carry.
 * - `increase` — must be > 0 (stock arriving)
 * - `decrease` — must be < 0 (stock leaving), expressed as a negative delta
 * - `signed` — either sign; `ADJUSTMENT` is the only correction instrument
 */
export type TransactionDirection = "increase" | "decrease" | "signed";

export const TRANSACTION_DIRECTIONS: Readonly<Record<TransactionType, TransactionDirection>> =
  Object.freeze({
    INITIAL_STOCK: "increase",
    PURCHASE: "increase",
    CONSUME: "decrease",
    USE_IN_MEAL: "decrease",
    DISCARD: "decrease",
    EXPIRE: "decrease",
    DONATE: "decrease",
    ADJUSTMENT: "signed",
  });

export function transactionDirection(type: TransactionType): TransactionDirection {
  return TRANSACTION_DIRECTIONS[type];
}

/** Confidence tier of a recorded fact (domain-model.md §1 principle 3). */
export type ProvenanceTier = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/**
 * Where a recorded value came from and how much it can be trusted.
 * `tier` and `source` are mandatory on every ledger row — a transaction whose
 * origin cannot be stated is not explainable, and explainability is the whole
 * point of the ledger (brief §14).
 */
export interface Provenance {
  readonly tier: ProvenanceTier;
  /** Stable identifier of the origin, e.g. `manual-entry`, `receipt:ocr-v2`. */
  readonly source: string;
  /** 0..1 where the source reports one. */
  readonly confidence?: number;
  readonly modelRef?: string;
  readonly observedAt?: Instant;
  /** User id that confirmed an AI/estimated value before it entered the ledger. */
  readonly confirmedBy?: string;
}

/** Who caused the transaction. */
export type Actor =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "system"; readonly component: string }
  | { readonly kind: "ai-confirmed"; readonly userId: string; readonly modelRef: string };

/** Link from a ledger row back to the artefact that produced it. */
export interface CorrelationRef {
  readonly kind: "receipt-line" | "meal-log" | "shopping-item";
  readonly id: string;
}

/** Storage location of an inventory item (brief §2A). */
export type StorageLocation = "FRIDGE" | "FREEZER" | "PANTRY" | "OTHER";

/**
 * Marker attached by the ledger itself (never by a caller) to a system-generated
 * correction, so the row is visibly not a user statement.
 */
export interface OverConsumptionFlag {
  readonly kind: "OVER_CONSUMPTION";
  /** Amount the requested decrease exceeded the recorded balance by, exact. */
  readonly residualMicros: bigint;
  /** Decimal view of {@link residualMicros}. */
  readonly residual: number;
  /** Sequence of the transaction that overshot. */
  readonly causedBySequence: number;
  /** Idempotency key of the transaction that overshot. */
  readonly causedByIdempotencyKey: string;
}

export type SystemFlag = OverConsumptionFlag;

/** A transaction as submitted by a caller. */
export interface TransactionInput {
  readonly lotId: string;
  readonly type: TransactionType;
  /** Signed change in the item's unit; sign must match {@link transactionDirection}. */
  readonly qtyDelta: number;
  readonly unit: Unit;
  /** Free-text/enumerated reason (brief §7 reason list). */
  readonly reason?: string;
  readonly actor: Actor;
  /** When it happened in the world. */
  readonly occurredAt: Instant;
  /** When the system recorded it — supplied by the caller; the domain has no clock. */
  readonly recordedAt: Instant;
  readonly provenance: Provenance;
  /** Caller-chosen key; replaying it is a no-op (INV-LEDGER-3). */
  readonly idempotencyKey: string;
  readonly correlationRef?: CorrelationRef;
}

/** A transaction after it has been accepted into an item's ledger. */
export interface RecordedTransaction extends TransactionInput {
  readonly itemId: string;
  /** 1-based position in this item's ledger; the ledger's authoritative order. */
  readonly sequence: number;
  /** Exact delta in micro-units — the value all ledger arithmetic uses. */
  readonly qtyDeltaMicros: bigint;
  /** Present only on ledger-generated correction rows. */
  readonly systemFlag?: SystemFlag;
}

/** Lot metadata supplied when a lot is opened on an item. */
export interface LotInput {
  readonly lotId: string;
  readonly acquiredAt?: Instant;
  /** Best-known expiry; pass-through metadata at this layer (no expiry engine here). */
  readonly expiresAt?: Instant;
  /** How `expiresAt` was obtained: printed date = KNOWN_FACT, shelf-life estimate = ESTIMATED. */
  readonly expiryTier?: ProvenanceTier;
  readonly label?: string;
}

/** A distinguishable acquisition of an item, with its maintained quantity snapshot. */
export interface InventoryLot extends LotInput {
  readonly currentQty: Quantity;
}

/**
 * The inventory aggregate: an item, its lots, its append-only ledger and the
 * derived snapshots maintained transactionally with every append (ADR-008).
 */
export interface InventoryItem {
  readonly itemId: string;
  readonly householdId: string;
  /** The single unit every lot and transaction on this item must use (M1-T1). */
  readonly unit: Unit;
  readonly productRef?: string;
  readonly ingredientRef?: string;
  readonly storageLocation?: StorageLocation;
  readonly lots: readonly InventoryLot[];
  /** Append-only, ordered by {@link RecordedTransaction.sequence}. */
  readonly transactions: readonly RecordedTransaction[];
  /** Maintained snapshot; always equal to Σ transaction deltas (INV-LEDGER-1). */
  readonly currentQty: Quantity;
  /** Sequence the next appended transaction will receive. */
  readonly nextSequence: number;
}

/** Item creation input. */
export interface CreateInventoryItemInput {
  readonly itemId: string;
  readonly householdId: string;
  readonly unit: Unit;
  readonly productRef?: string;
  readonly ingredientRef?: string;
  readonly storageLocation?: StorageLocation;
  readonly lots?: readonly LotInput[];
}

/** Outcome of {@link appendTransaction}. */
export type AppendResult =
  /** Accepted: `transaction` is the recorded row; `clampAdjustment` present iff the decrease overshot. */
  | {
      readonly status: "appended";
      readonly item: InventoryItem;
      readonly transaction: RecordedTransaction;
      readonly clampAdjustment?: RecordedTransaction;
    }
  /** Idempotent replay: nothing was written; `item` is the unchanged aggregate. */
  | {
      readonly status: "duplicate";
      readonly item: InventoryItem;
      readonly transaction: RecordedTransaction;
      readonly clampAdjustment?: RecordedTransaction;
    }
  /** Rejected: nothing was written; `item` is the unchanged aggregate. */
  | {
      readonly status: "rejected";
      readonly item: InventoryItem;
      readonly error: LedgerError;
    };

/** Per-lot line of a {@link ReconciliationReport}. */
export interface LotReconciliation {
  readonly lotId: string;
  readonly snapshotMicros: bigint;
  readonly derivedMicros: bigint;
  readonly driftMicros: bigint;
  readonly negative: boolean;
}

/** Result of re-deriving an aggregate's quantities from its ledger. */
export interface ReconciliationReport {
  readonly ok: boolean;
  readonly itemId: string;
  readonly snapshotMicros: bigint;
  readonly derivedMicros: bigint;
  readonly driftMicros: bigint;
  readonly lots: readonly LotReconciliation[];
  /** Empty when `ok`; otherwise every problem found, not just the first. */
  readonly problems: readonly LedgerError[];
}

export type { Quantity, Unit } from "./quantity.js";
