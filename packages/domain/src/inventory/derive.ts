/**
 * Quantity derivation and reconciliation (ADR-008, INV-LEDGER-1).
 *
 * The ledger is the truth; `currentQty` on the item and its lots is a
 * maintained snapshot. These functions recompute the truth from the rows so the
 * snapshot can be proved correct — in tests (INV-LEDGER-1) and, later, by the
 * persistence-layer reconciliation query M1-T2 mirrors.
 */

import { ledgerError, type LedgerError } from "./errors.js";
import { makeQuantity, type Quantity } from "./quantity.js";
import type {
  InventoryItem,
  LotReconciliation,
  ReconciliationReport,
  RecordedTransaction,
} from "./types.js";

/** Σ of every delta in `transactions`, exact. */
export function sumDeltaMicros(transactions: readonly RecordedTransaction[]): bigint {
  let total = 0n;
  for (const transaction of transactions) {
    total += transaction.qtyDeltaMicros;
  }
  return total;
}

/** Σ of the deltas belonging to one lot, exact. */
export function sumLotDeltaMicros(
  transactions: readonly RecordedTransaction[],
  lotId: string,
): bigint {
  let total = 0n;
  for (const transaction of transactions) {
    if (transaction.lotId === lotId) total += transaction.qtyDeltaMicros;
  }
  return total;
}

/** Item-level quantity derived from the ledger (ignores the snapshot). */
export function deriveItemQuantity(item: InventoryItem): Quantity {
  return makeQuantity(item.unit, sumDeltaMicros(item.transactions));
}

/** Lot-level quantity derived from the ledger (ignores the snapshot). */
export function deriveLotQuantity(item: InventoryItem, lotId: string): Quantity {
  return makeQuantity(item.unit, sumLotDeltaMicros(item.transactions, lotId));
}

/**
 * Re-derives every quantity from the ledger and reports all discrepancies.
 *
 * Checks, in one pass over the aggregate:
 * - item snapshot == Σ all deltas, and each lot snapshot == Σ its deltas (INV-LEDGER-1);
 * - no snapshot is negative (INV-LEDGER-4);
 * - every transaction is attributable: known lot, matching item id, matching unit;
 * - sequences are 1..n, unique and contiguous, and `nextSequence` follows them;
 * - idempotency keys are unique (INV-LEDGER-3's precondition).
 *
 * Returns every problem found rather than the first, so a corrupted aggregate
 * can be diagnosed in one look.
 */
export function reconcile(item: InventoryItem): ReconciliationReport {
  const problems: LedgerError[] = [];

  const derivedMicros = sumDeltaMicros(item.transactions);
  const snapshotMicros = item.currentQty.micros;
  const driftMicros = snapshotMicros - derivedMicros;
  if (driftMicros !== 0n) {
    problems.push(
      ledgerError(
        "CORRUPT_LEDGER",
        `item snapshot ${snapshotMicros.toString()} != Σ deltas ${derivedMicros.toString()} (micro-units)`,
        item.itemId,
      ),
    );
  }
  if (snapshotMicros < 0n) {
    problems.push(ledgerError("CORRUPT_LEDGER", "item quantity is negative", item.itemId));
  }
  if (item.currentQty.unit !== item.unit) {
    problems.push(
      ledgerError("MIXED_UNITS", "item snapshot unit differs from the item unit", item.itemId),
    );
  }

  const knownLotIds = new Set(item.lots.map((lot) => lot.lotId));
  const lots: LotReconciliation[] = item.lots.map((lot) => {
    const lotDerived = sumLotDeltaMicros(item.transactions, lot.lotId);
    const lotDrift = lot.currentQty.micros - lotDerived;
    if (lotDrift !== 0n) {
      problems.push(
        ledgerError(
          "CORRUPT_LEDGER",
          `lot snapshot ${lot.currentQty.micros.toString()} != Σ deltas ${lotDerived.toString()} (micro-units)`,
          lot.lotId,
        ),
      );
    }
    if (lot.currentQty.micros < 0n) {
      problems.push(ledgerError("CORRUPT_LEDGER", "lot quantity is negative", lot.lotId));
    }
    return {
      lotId: lot.lotId,
      snapshotMicros: lot.currentQty.micros,
      derivedMicros: lotDerived,
      driftMicros: lotDrift,
      negative: lot.currentQty.micros < 0n,
    };
  });

  const seenKeys = new Set<string>();
  item.transactions.forEach((transaction, index) => {
    const position = index + 1;
    if (transaction.sequence !== position) {
      problems.push(
        ledgerError(
          "CORRUPT_LEDGER",
          `transaction at position ${String(position)} carries sequence ${String(transaction.sequence)}`,
          transaction.idempotencyKey,
        ),
      );
    }
    if (transaction.itemId !== item.itemId) {
      problems.push(
        ledgerError(
          "ITEM_MISMATCH",
          `transaction belongs to item ${transaction.itemId}`,
          transaction.idempotencyKey,
        ),
      );
    }
    if (transaction.unit !== item.unit) {
      problems.push(
        ledgerError(
          "MIXED_UNITS",
          `transaction unit ${transaction.unit} != item unit ${item.unit}`,
          transaction.idempotencyKey,
        ),
      );
    }
    if (!knownLotIds.has(transaction.lotId)) {
      problems.push(
        ledgerError(
          "UNKNOWN_LOT",
          `transaction references unopened lot ${transaction.lotId}`,
          transaction.idempotencyKey,
        ),
      );
    }
    if (seenKeys.has(transaction.idempotencyKey)) {
      problems.push(
        ledgerError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "idempotency key appears more than once in the ledger",
          transaction.idempotencyKey,
        ),
      );
    }
    seenKeys.add(transaction.idempotencyKey);
  });

  if (item.nextSequence !== item.transactions.length + 1) {
    problems.push(
      ledgerError(
        "CORRUPT_LEDGER",
        `nextSequence ${String(item.nextSequence)} does not follow ${String(item.transactions.length)} recorded transactions`,
        item.itemId,
      ),
    );
  }

  return Object.freeze({
    ok: problems.length === 0,
    itemId: item.itemId,
    snapshotMicros,
    derivedMicros,
    driftMicros,
    lots: Object.freeze(lots),
    problems: Object.freeze(problems),
  });
}
