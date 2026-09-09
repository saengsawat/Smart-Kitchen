/**
 * Public API of the inventory ledger (M1-T1, ADR-008).
 *
 * Typical use:
 * ```ts
 * const created = createInventoryItem({ itemId, householdId, unit: "lb", lots: [{ lotId }] });
 * if (!created.ok) return created.error;
 * const result = appendTransaction(created.value, purchaseInput);
 * if (result.status === "appended") console.log(formatQuantity(result.item.currentQty));
 * ```
 */

export {
  appendTransaction,
  appendTransactions,
  createInventoryItem,
  findByIdempotencyKey,
  findClampFor,
  openLot,
  rehydrateInventoryItem,
  CLAMP_KEY_SUFFIX,
  CLAMP_REASON,
  CLAMP_SOURCE,
  LEDGER_COMPONENT,
  RESERVED_KEY_SEPARATOR,
} from "./ledger.js";

export {
  deriveItemQuantity,
  deriveLotQuantity,
  reconcile,
  sumDeltaMicros,
  sumLotDeltaMicros,
} from "./derive.js";

export {
  amountToMicros,
  formatQuantity,
  makeQuantity,
  microsToAmount,
  zeroQuantity,
  MAX_QUANTITY_MICROS,
  MICROS_PER_UNIT,
  QUANTITY_SCALE,
} from "./quantity.js";

export { deepFreeze, isDeeplyFrozen } from "./freeze.js";

export { err, isLedgerError, ledgerError, ok } from "./errors.js";

export { transactionDirection, TRANSACTION_DIRECTIONS, TRANSACTION_TYPES } from "./types.js";

export type { LedgerError, LedgerErrorCode, Outcome } from "./errors.js";
export type { Quantity, Unit } from "./quantity.js";
export type {
  Actor,
  AppendResult,
  CorrelationRef,
  CreateInventoryItemInput,
  Instant,
  InventoryItem,
  InventoryLot,
  LotInput,
  LotReconciliation,
  OverConsumptionFlag,
  Provenance,
  ProvenanceTier,
  ReconciliationReport,
  RecordedTransaction,
  StorageLocation,
  SystemFlag,
  TransactionDirection,
  TransactionInput,
  TransactionType,
} from "./types.js";
