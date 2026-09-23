/**
 * The inventory write path (M2-T2).
 *
 * One request becomes one database transaction, and inside it:
 *
 *   lock the item -> read its ledger -> let the **domain** decide how the
 *   quantity is split across lots -> append each row through the repository ->
 *   read the item back
 *
 * Everything load bearing about that sentence is deliberate.
 *
 * **The lock comes first.** `SELECT … FOR UPDATE` on the item row, before
 * anything is read or planned, because every decision below is computed
 * against a balance: which lots a decrease comes out of, what delta reaches a
 * target quantity, whether a decrease overshoots. Two concurrent writes to one
 * item must not both plan against the same "before" state. `appendTransaction
 * ToDb` takes the same lock again per row (already held, so it costs nothing),
 * and migration 0004's trigger is the backstop that turns a *missed* lock into
 * a retryable `40001` rather than a wrong balance.
 *
 * **The domain decides the arithmetic.** Nothing here adds, subtracts or
 * clamps a quantity of its own accord: the split across lots is
 * `planLotConsumption` (M1-T8, FEFO), the rows are built by
 * `consumptionInputsFromPlan` where the type allows it, and the clamp on an
 * overshoot is `appendTransaction`'s (INV-LEDGER-4). That arithmetic is
 * safety-critical (CLAUDE.md rule 7) and already property-tested; a second
 * implementation here would be a second thing to get wrong.
 *
 * **Every row this module writes carries a derived key** `<clientKey>/lot/<n>`,
 * the planner's own namespace (`PLAN_KEY_INFIX`), even when there is only one
 * row. Uniformity is what makes the rest simple: a write's rows are exactly the
 * rows under its prefix, a replay is decided per row by the ledger, and undo
 * can find a multi-row write again from any one of its rows. The client's own
 * key is never used as a ledger key directly.
 *
 * **A replay is recomputed, not remembered.** When rows already exist under the
 * client's key, the write is planned again against the item as it stood
 * *immediately before those rows* (rehydrated from the prefix of the ledger),
 * and the resulting inputs are fed to the ledger exactly as a first attempt
 * would be. The ledger then answers `duplicate` if the payload matches and
 * `IDEMPOTENCY_KEY_CONFLICT` if it does not. That is what makes a replay of
 * `targetAmount` work: the target is relative to a balance, and the balance has
 * moved, so the only honest question is "does this request still describe the
 * rows it wrote", and the ledger's own comparison is the one that answers it.
 *
 * **A refusal throws.** The rows of one write are appended one at a time, so a
 * rejection on the third row must not leave the first two committed. Returning
 * a rejection from inside the transaction callback would do exactly that, so
 * every non-success leaves this module as an exception and
 * `withHouseholdTransaction` rolls the whole thing back (M1-T11: the savepoint
 * inside `appendTransactionToDb` is what keeps the transaction usable up to
 * that point, and the `COMMIT` tag check is what would catch it if it were
 * not).
 */

import { randomUUID } from "node:crypto";
import type {
  InventoryItemDetailDto,
  InventoryTransactionDto,
  InventoryWriteTypeDto,
} from "@smart-kitchen/contracts";
import {
  consumptionInputsFromPlan,
  ledgerError,
  microsToAmount,
  planLotConsumption,
  rehydrateInventoryItem,
  PLAN_KEY_INFIX,
  RESERVED_KEY_SEPARATOR,
  type CreateInventoryItemInput,
  type InventoryItem,
  type InventoryLot,
  type LedgerError,
  type LotSelectionPolicy,
  type TransactionInput,
  type TransactionType,
} from "@smart-kitchen/domain";
import type { ClientBase } from "pg";
import {
  readInventoryItemDetail,
  readInventoryHistory,
  type LedgerHistoryEntry,
} from "./detail.js";
import { decimalTextToMicros } from "./quantity-text.js";
import { appendTransactionToDb, insertInventoryLot, loadInventoryItem } from "./repository.js";

/**
 * Lot-selection policy for every decrease written through the API.
 *
 * FEFO is domain-model.md OQ-1's **PROPOSED** default, on the grounds that it
 * minimises waste, which is the product's stated purpose. It is stated here as
 * one named constant rather than threaded through the request, because it is a
 * product decision and not a per-call option: a client that could choose the
 * policy could choose to consume the freshest stock first.
 */
export const LOT_SELECTION_POLICY: LotSelectionPolicy = "FEFO";

/** Provenance source recorded on a row a person wrote through the API. */
export const MANUAL_ENTRY_SOURCE = "manual-entry";

/** Reason prefix reserved for the rows the undo endpoint writes. */
export const UNDO_REASON_PREFIX = "undo:";

/**
 * Client idempotency keys: letters, digits, dot, underscore, hyphen.
 *
 * Narrow on purpose. It excludes `::`, which the ledger reserves for the rows
 * it authors itself, and `/`, which keeps every client key outside the
 * `<key>/lot/<n>` namespace this module derives into. Without the second
 * exclusion a key ending in `/lot` would derive into another key's namespace,
 * and "the rows of this write" would stop being a well-defined set.
 */
const CLIENT_KEY = /^[A-Za-z0-9._-]{1,128}$/;

/** Longest reason a caller may attach to a row. */
const MAX_REASON_LENGTH = 200;

/** What the caller asked for, with identity already resolved from the session. */
export interface InventoryWriteCommand {
  readonly idempotencyKey: string;
  readonly type: InventoryWriteTypeDto;
  readonly occurredAt: string;
  /** Server clock. Excluded from the ledger's replay comparison, by design. */
  readonly recordedAt: string;
  /** The session's user. Never a request field (INV-TENANT-1). */
  readonly actorUserId: string;
  readonly targetAmount?: string;
  readonly deltaAmount?: string;
  readonly amount?: string;
  readonly reason?: string;
}

/** What the undo endpoint asked for. */
export interface InventoryUndoCommand {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorUserId: string;
}

export interface InventoryWriteResult {
  /** The rows this write is responsible for, in sequence order, clamps included. */
  readonly transactions: readonly InventoryTransactionDto[];
  readonly detail: InventoryItemDetailDto;
  /** True when nothing was appended because every row was already recorded. */
  readonly replayed: boolean;
}

/**
 * The item is not visible to this session: no such item, or an item in another
 * household. One exception for both, because telling them apart is itself
 * information about another household.
 */
export class InventoryItemNotVisibleError extends Error {
  constructor() {
    super("the addressed inventory item is not visible to this session");
    this.name = "InventoryItemNotVisibleError";
  }
}

/** The ledger (or this module's own boundary checks) refused the write. */
export class LedgerWriteRejectedError extends Error {
  readonly ledgerError: LedgerError;

  constructor(error: LedgerError) {
    super(`ledger write rejected: ${error.code}`);
    this.name = "LedgerWriteRejectedError";
    this.ledgerError = error;
  }
}

/**
 * The named transaction cannot be reversed, because the stock it added is no
 * longer there.
 *
 * Deliberately not a `LedgerError`. The ledger would have taken the
 * compensating row happily and clamped it, and that clamp would be a lie: an
 * `OVER_CONSUMPTION` row says "our record was short", and here the record was
 * fine and the undo was simply too late. It would also be attributed to the
 * person who pressed undo and would count against the correction-rate metric
 * (ARCHITECTURE.md §8). So this refusal belongs to the API, which is why its
 * code lives in `ApiErrorCode` rather than in the domain's union.
 */
export class UndoNotPossibleError extends Error {
  constructor() {
    super("the stock this transaction added has already been used, so it cannot be undone");
    this.name = "UndoNotPossibleError";
  }
}

/**
 * Stored rows are not what the domain would have written: a corrupt ledger, a
 * unit that disagrees with its item, a snapshot that has drifted. Never the
 * caller's fault, so it is not a 4xx and it does not become a `LedgerError` a
 * client could be handed.
 */
export class LedgerIntegrityError extends Error {
  readonly ledgerError: LedgerError;

  constructor(error: LedgerError) {
    super(`stored inventory rows failed the integrity check: ${error.code} ${error.message}`);
    this.name = "LedgerIntegrityError";
    this.ledgerError = error;
  }
}

function reject(code: LedgerError["code"], message: string, field?: string): never {
  throw new LedgerWriteRejectedError(ledgerError(code, message, field));
}

/** Takes the item's write lock, or reports it as invisible. */
async function lockItem(client: ClientBase, householdId: string, itemId: string): Promise<void> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE id = $1 AND household_id = $2 FOR UPDATE`,
    [itemId, householdId],
  );
  if (locked.rows.length === 0) throw new InventoryItemNotVisibleError();
}

/** Loads the aggregate, turning "not mine" and "corrupt" into their own failures. */
async function loadLockedItem(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<InventoryItem> {
  const loaded = await loadInventoryItem(client, householdId, itemId);
  if (loaded.ok) return loaded.value;
  if (loaded.error.code === "ITEM_MISMATCH") throw new InventoryItemNotVisibleError();
  throw new LedgerIntegrityError(loaded.error);
}

/** The item's shape without its history, for rehydrating a prefix of its ledger. */
function shellOf(item: InventoryItem): CreateInventoryItemInput {
  return {
    itemId: item.itemId,
    householdId: item.householdId,
    unit: item.unit,
    lots: item.lots.map((lot) => ({
      lotId: lot.lotId,
      ...(lot.acquiredAt === undefined ? {} : { acquiredAt: lot.acquiredAt }),
      ...(lot.expiresAt === undefined ? {} : { expiresAt: lot.expiresAt }),
      ...(lot.expiryTier === undefined ? {} : { expiryTier: lot.expiryTier }),
      ...(lot.label === undefined ? {} : { label: lot.label }),
    })),
    ...(item.productRef === undefined ? {} : { productRef: item.productRef }),
    ...(item.ingredientRef === undefined ? {} : { ingredientRef: item.ingredientRef }),
    ...(item.storageLocation === undefined ? {} : { storageLocation: item.storageLocation }),
  };
}

/**
 * The item as it stood immediately before `sequence`.
 *
 * The lots are the item's *current* lots, because that is the only lot list
 * there is; a lot opened after `sequence` appears with a zero balance, which
 * the planner skips. The one case that leaves is a lot opened *between* the
 * original write and its replay by some other write path, which could change
 * which lot an increase picks and so turn a replay into a 409. That is a false
 * conflict, never a double apply, and no endpoint in this milestone opens a lot
 * on an item that already has one.
 */
function stateBefore(item: InventoryItem, sequence: number): InventoryItem {
  const prefix = item.transactions.filter((row) => row.sequence < sequence);
  const rehydrated = rehydrateInventoryItem(shellOf(item), prefix);
  if (!rehydrated.ok) throw new LedgerIntegrityError(rehydrated.error);
  return rehydrated.value;
}

/** Everything a derived row needs except the lot and the delta. */
interface RowBase {
  readonly type: TransactionType;
  readonly unit: string;
  readonly actorUserId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

/**
 * Builds one ledger input, field by explicit field.
 *
 * Never a spread of anything a caller handed us: the ledger's `buildRecorded`
 * refuses to spread its input so that `systemFlag` cannot be forged and no
 * unknown field is persisted, and `consumptionInputsFromPlan` applies the same
 * rule one layer earlier. This is that rule in this module.
 */
function inputFor(
  base: RowBase,
  lotId: string,
  deltaMicros: bigint,
  index: number,
): TransactionInput {
  return {
    lotId,
    type: base.type,
    qtyDelta: microsToAmount(deltaMicros),
    unit: base.unit,
    actor: { kind: "user", userId: base.actorUserId },
    occurredAt: base.occurredAt,
    recordedAt: base.recordedAt,
    provenance: { tier: "KNOWN_FACT", source: MANUAL_ENTRY_SOURCE },
    idempotencyKey: `${base.idempotencyKey}${PLAN_KEY_INFIX}${String(index)}`,
    ...(base.reason === undefined ? {} : { reason: base.reason }),
  };
}

/**
 * The lot an increase lands on: the most recently acquired lot that still holds
 * something, falling back to the most recently acquired lot of any balance.
 *
 * "Most recently acquired" is `acquiredAt` descending with undated lots last
 * (the same ordering rule the FEFO planner uses for unknown dates), ties broken
 * by the later lot in the item's own lot order. An increase is stock arriving,
 * and the newest batch is the one a person is holding when they correct a
 * number upward.
 */
export function increaseLot(item: InventoryItem): InventoryLot | undefined {
  const open = item.lots.filter((lot) => lot.currentQty.micros > 0n);
  const pool = open.length > 0 ? open : item.lots;

  let best: InventoryLot | undefined;
  let bestMillis: number | undefined;
  for (const lot of pool) {
    const millis = acquiredMillis(lot);
    if (best === undefined) {
      best = lot;
      bestMillis = millis;
      continue;
    }
    // A dated lot always beats an undated one (an unknown date is not a claim
    // of recency); between two dated lots the later one wins; a tie, and two
    // undated lots, fall to the later lot in the item's own order, which is
    // creation order.
    const betterDate = millis !== undefined && (bestMillis === undefined || millis >= bestMillis);
    const bothUndated = millis === undefined && bestMillis === undefined;
    if (betterDate || bothUndated) {
      best = lot;
      bestMillis = millis;
    }
  }
  return best;
}

/** A lot's `acquiredAt` in milliseconds, or `undefined` when absent or unparseable. */
function acquiredMillis(lot: InventoryLot): number | undefined {
  if (lot.acquiredAt === undefined) return undefined;
  const millis = Date.parse(lot.acquiredAt);
  return Number.isNaN(millis) ? undefined : millis;
}

export interface PlannedWrite {
  readonly inputs: readonly TransactionInput[];
  /** A lot to open before the rows are appended, when the item has none. */
  readonly newLot?: { readonly lotId: string; readonly acquiredAt: string };
}

/**
 * Validates the command's shape and quantity fields, then plans the rows.
 *
 * Exported for `write-service.test.ts`. It is a pure function of an aggregate
 * and a command, and every branch in it is a refusal a client can trigger, so
 * the cheapest honest way to cover them is to call it directly with an
 * in-memory item rather than to reach each one through a database round trip.
 * Nothing outside this module and that suite calls it.
 */
export function planWrite(item: InventoryItem, command: InventoryWriteCommand): PlannedWrite {
  const base: RowBase = {
    type: command.type,
    unit: item.unit,
    actorUserId: command.actorUserId,
    occurredAt: command.occurredAt,
    recordedAt: command.recordedAt,
    idempotencyKey: command.idempotencyKey,
    ...(command.reason === undefined ? {} : { reason: command.reason }),
  };

  if (command.type === "ADJUSTMENT") {
    if (command.amount !== undefined) {
      reject(
        "INVALID_FIELD",
        "amount states a magnitude to remove; an ADJUSTMENT states targetAmount or deltaAmount",
        "amount",
      );
    }
    const hasTarget = command.targetAmount !== undefined;
    const hasDelta = command.deltaAmount !== undefined;
    if (hasTarget === hasDelta) {
      reject(
        "INVALID_FIELD",
        "an ADJUSTMENT states exactly one of targetAmount or deltaAmount",
        "targetAmount",
      );
    }
    const micros = hasTarget
      ? targetDelta(item, command.targetAmount ?? "")
      : parseOrReject(command.deltaAmount ?? "", "deltaAmount");
    if (micros === 0n) {
      reject("ZERO_DELTA", "a transaction must change the quantity", "targetAmount");
    }
    if (micros > 0n) return planIncrease(item, base, micros);
    return planDecrease(item, base, -micros);
  }

  if (command.targetAmount !== undefined || command.deltaAmount !== undefined) {
    reject(
      "INVALID_FIELD",
      "targetAmount and deltaAmount belong to an ADJUSTMENT; a removal states amount",
      "targetAmount",
    );
  }
  const magnitude =
    command.amount === undefined ? item.currentQty.micros : parseOrReject(command.amount, "amount");
  if (magnitude === 0n) {
    reject(
      "ZERO_DELTA",
      command.amount === undefined
        ? "there is nothing on hand to remove"
        : "a transaction must change the quantity",
      "amount",
    );
  }
  if (magnitude < 0n) {
    reject(
      "WRONG_SIGN",
      "amount is a positive magnitude; the transaction type says stock is leaving",
      "amount",
    );
  }
  return planDecrease(item, base, magnitude);
}

/**
 * The signed delta that reaches `targetAmount`, refusing a negative target.
 *
 * A target is a statement about what is on hand, and nothing is ever on hand a
 * negative number of times. Without this check (M2-T2 review F2) a malformed
 * `targetAmount: "-5"` on an item holding 8 became a *decrease of 13*: the
 * planner would drain every lot, the uncovered 5 would be recorded as an
 * overshoot, and the ledger would mint an `OVER_CONSUMPTION` clamp. That row
 * is not a harmless extra: the correction-rate KPI (ARCHITECTURE.md §8) counts
 * clamps as evidence that our record was wrong, and a client bug would have
 * been inflating the product's primary metric.
 *
 * `QUANTITY_OUT_OF_RANGE` rather than `WRONG_SIGN`, because the request is not
 * a sign mistake on a delta: it names a quantity outside the range a quantity
 * can take. `deltaAmount` stays signed, which is the whole reason it exists.
 */
function targetDelta(item: InventoryItem, targetAmount: string): bigint {
  const target = parseOrReject(targetAmount, "targetAmount");
  if (target < 0n) {
    reject(
      "QUANTITY_OUT_OF_RANGE",
      "targetAmount is the quantity the item should hold afterwards, which cannot be negative",
      "targetAmount",
    );
  }
  return target - item.currentQty.micros;
}

function parseOrReject(value: string, field: string): bigint {
  const parsed = decimalTextToMicros(value, field);
  if (!parsed.ok) throw new LedgerWriteRejectedError(parsed.error);
  return parsed.value;
}

/** One row, on the lot an increase belongs to, opening a lot if the item has none. */
function planIncrease(item: InventoryItem, base: RowBase, micros: bigint): PlannedWrite {
  const lot = increaseLot(item);
  if (lot !== undefined) return { inputs: [inputFor(base, lot.lotId, micros, 0)] };
  // No lot at all: the increase opens one, acquired when the caller says the
  // change happened. A uuid is generated here rather than accepted from the
  // request, so a caller cannot choose (or collide with) a lot id.
  const lotId = randomUUID();
  return {
    inputs: [inputFor(base, lotId, micros, 0)],
    newLot: { lotId, acquiredAt: base.occurredAt },
  };
}

/**
 * A decrease, split across lots by the FEFO planner.
 *
 * `planLotConsumption` never allocates more than a lot holds, so the rows it
 * produces cannot clamp. What it *does* report is a `shortfallMicros`: the part
 * of the request the lots cannot cover. That part is recorded too, as one more
 * row against the last lot the plan touched, at its full magnitude, which is
 * what makes the ledger append its own `OVER_CONSUMPTION` correction
 * (INV-LEDGER-4). The alternative, silently recording only what was on hand,
 * would make the user's statement disagree with the ledger and would erase the
 * correction-rate signal that says our belief was wrong (ARCHITECTURE.md §8).
 * domain-model.md OQ-1 left this choice to the caller; this ticket's acceptance
 * criteria make it "record the overshoot" for the manual write path, and M8
 * decides it again for meal-log decrements.
 */
function planDecrease(item: InventoryItem, base: RowBase, magnitude: bigint): PlannedWrite {
  const plan = planLotConsumption(item, { policy: LOT_SELECTION_POLICY, qtyMicros: magnitude });
  if (!plan.ok) throw new LedgerWriteRejectedError(plan.error);

  const inputs: TransactionInput[] = [];
  if (base.type === "ADJUSTMENT") {
    // `consumptionInputsFromPlan` refuses a signed type on purpose (it exists
    // so a correction is never split behind the caller's back). A negative
    // ADJUSTMENT still has to come out of real lots, so its rows are built
    // here with the planner's own key derivation and the same explicit field
    // list, from the same allocations.
    for (const [index, allocation] of plan.value.allocations.entries()) {
      inputs.push(inputFor(base, allocation.lotId, allocation.qtyDeltaMicros, index));
    }
  } else {
    const derived = consumptionInputsFromPlan(plan.value, {
      type: base.type,
      unit: base.unit,
      actor: { kind: "user", userId: base.actorUserId },
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      provenance: { tier: "KNOWN_FACT", source: MANUAL_ENTRY_SOURCE },
      idempotencyKey: base.idempotencyKey,
      ...(base.reason === undefined ? {} : { reason: base.reason }),
    });
    if (!derived.ok) throw new LedgerWriteRejectedError(derived.error);
    inputs.push(...derived.value);
  }

  if (plan.value.shortfallMicros > 0n) {
    const last = plan.value.allocations[plan.value.allocations.length - 1];
    const lotId = last?.lotId ?? increaseLot(item)?.lotId;
    if (lotId === undefined) {
      reject("UNKNOWN_LOT", "this item has no lot to record the change against", "itemId");
    }
    inputs.push(inputFor(base, lotId, -plan.value.shortfallMicros, inputs.length));
  }

  if (inputs.length === 0) {
    reject("ZERO_DELTA", "a transaction must change the quantity", "amount");
  }
  return { inputs };
}

/** Rows belonging to one client key: everything under its derived namespace. */
function belongsToKey(idempotencyKey: string, clientKey: string): boolean {
  return idempotencyKey.startsWith(`${clientKey}${PLAN_KEY_INFIX}`);
}

function validateClientKey(key: string): void {
  if (!CLIENT_KEY.test(key)) {
    reject(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 1 to 128 characters of letters, digits, dot, underscore or hyphen",
      "idempotencyKey",
    );
  }
  // Belt and braces with the pattern above, and the check that states the
  // reason: `::` is the ledger's own namespace for rows it authors.
  if (key.includes(RESERVED_KEY_SEPARATOR) || key.includes(PLAN_KEY_INFIX)) {
    reject(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey may not contain a reserved key separator",
      "idempotencyKey",
    );
  }
}

function validateReason(reason: string | undefined): void {
  if (reason === undefined) return;
  if (reason.trim() === "") {
    reject("INVALID_FIELD", "reason must be omitted or non-empty", "reason");
  }
  if (reason.length > MAX_REASON_LENGTH) {
    reject(
      "INVALID_FIELD",
      `reason may not be longer than ${String(MAX_REASON_LENGTH)} characters`,
      "reason",
    );
  }
  if (reason.startsWith(UNDO_REASON_PREFIX)) {
    reject(
      "INVALID_FIELD",
      `reason may not start with "${UNDO_REASON_PREFIX}", which the undo endpoint reserves`,
      "reason",
    );
  }
}

/**
 * Appends the planned rows, one at a time, and reports whether anything was
 * actually written.
 *
 * A rejection from any row aborts the whole write by throwing: the rows of one
 * request are one fact, and half of one is not a smaller fact.
 */
async function appendAll(
  client: ClientBase,
  householdId: string,
  itemId: string,
  inputs: readonly TransactionInput[],
): Promise<{ readonly replayed: boolean }> {
  let appended = 0;
  for (const input of inputs) {
    const outcome = await appendTransactionToDb(client, householdId, itemId, input);
    if (!outcome.ok) {
      if (outcome.error.code === "ITEM_MISMATCH") throw new InventoryItemNotVisibleError();
      throw new LedgerIntegrityError(outcome.error);
    }
    const result = outcome.value;
    if (result.status === "rejected") throw new LedgerWriteRejectedError(result.error);
    if (result.status === "appended") appended += 1;
  }
  return { replayed: appended === 0 };
}

/** Reads the item back and projects the rows this write is responsible for. */
async function resultFor(
  client: ClientBase,
  householdId: string,
  itemId: string,
  clientKey: string,
  replayed: boolean,
): Promise<InventoryWriteResult> {
  const read = await readInventoryItemDetail(client, householdId, itemId);
  if (read === undefined) throw new InventoryItemNotVisibleError();
  const transactions = read.history
    .filter((entry) => belongsToKey(entry.idempotencyKey, clientKey))
    .map((entry) => entry.dto);
  return { transactions, detail: read.detail, replayed };
}

/**
 * Applies one write. Must be called inside a household-scoped transaction
 * (`withRetriedHouseholdTransaction`), which is also what makes re-running it
 * after a `40001` safe: every read it depends on happens inside this function,
 * so a retried attempt re-derives everything and lands as an idempotent replay
 * of itself at worst.
 */
export async function applyInventoryWrite(
  client: ClientBase,
  householdId: string,
  itemId: string,
  command: InventoryWriteCommand,
): Promise<InventoryWriteResult> {
  validateClientKey(command.idempotencyKey);
  validateReason(command.reason);

  await lockItem(client, householdId, itemId);
  const item = await loadLockedItem(client, householdId, itemId);

  const existing = item.transactions.filter((row) =>
    belongsToKey(row.idempotencyKey, command.idempotencyKey),
  );
  const first = existing[0];
  const planningState = first === undefined ? item : stateBefore(item, first.sequence);

  const planned = planWrite(planningState, command);
  if (planned.newLot !== undefined) {
    await insertInventoryLot(client, householdId, itemId, {
      lotId: planned.newLot.lotId,
      acquiredAt: planned.newLot.acquiredAt,
    });
  }
  const { replayed } = await appendAll(client, householdId, itemId, planned.inputs);
  return resultFor(client, householdId, itemId, command.idempotencyKey, replayed);
}

/**
 * Appends the compensating rows for one earlier write.
 *
 * Three rules make an undo exact rather than approximate.
 *
 * 1. **The group, not the row.** A decrease can be several rows (one per lot,
 *    plus an overshoot row), and every one of them has to be reversed or the
 *    item ends up somewhere in between. From the named row's key, the whole
 *    group is `<clientKey>/lot/*` plus any clamp the ledger attached to those
 *    rows.
 * 2. **The net per lot, clamps included.** A statement that overshot moved the
 *    balance by less than it says, because the ledger corrected it. Reversing
 *    the statement's face value would invent stock. So each lot is compensated
 *    by the negation of what the group actually did to it.
 * 3. **A clamp is not undoable.** It is the ledger's own correction, not a
 *    person's statement, and "undo" on it would mean asking the ledger to
 *    un-notice that our record was wrong (copy-deck.md §5). Refused.
 *
 * Undoing twice under two different keys appends twice: each undo is its own
 * statement, and the client key is what makes a retried tap a no-op.
 */
export async function undoInventoryTransaction(
  client: ClientBase,
  householdId: string,
  itemId: string,
  command: InventoryUndoCommand,
): Promise<InventoryWriteResult> {
  validateClientKey(command.idempotencyKey);

  await lockItem(client, householdId, itemId);
  const history = await readInventoryHistory(client, householdId, itemId);

  const named = history.find((entry) => entry.transactionId === command.transactionId);
  if (named === undefined) throw new InventoryItemNotVisibleError();
  if (named.dto.systemFlag !== undefined) {
    reject(
      "INVALID_FIELD",
      "that row is the ledger's own correction, not a statement that can be undone",
      "transactionId",
    );
  }

  const group = groupOf(history, named);
  const item = await loadLockedItem(client, householdId, itemId);
  const base: RowBase = {
    type: "ADJUSTMENT",
    unit: item.unit,
    actorUserId: command.actorUserId,
    occurredAt: command.occurredAt,
    recordedAt: command.recordedAt,
    idempotencyKey: command.idempotencyKey,
    reason: `${UNDO_REASON_PREFIX}${command.transactionId}`,
  };

  const inputs: TransactionInput[] = [];
  for (const [lotId, net] of netByLot(group)) {
    if (net === 0n) continue;
    // An undo that would overdraw the lot is refused, not clamped (M2-T2
    // review F4). Undoing a purchase whose stock has since been eaten is not
    // an over-consumption event: nobody consumed more than they thought. If
    // the compensating row were simply appended, the ledger would do its job
    // and clamp it, and the resulting OVER_CONSUMPTION row would be attributed
    // to a user who only pressed undo and would count against the
    // correction-rate metric (ARCHITECTURE.md §8). Refusing keeps the metric
    // about what it measures and tells the caller the truth.
    // `net > 0` is a group that added stock, so its compensation is a decrease
    // of exactly `net`, and it fits only if the lot still holds that much.
    const lotBalance = item.lots.find((lot) => lot.lotId === lotId)?.currentQty.micros ?? 0n;
    if (net > 0n && net > lotBalance) {
      throw new UndoNotPossibleError();
    }
    inputs.push(inputFor(base, lotId, -net, inputs.length));
  }
  if (inputs.length === 0) {
    reject(
      "ZERO_DELTA",
      "that statement did not change the quantity, so there is nothing to undo",
      "transactionId",
    );
  }

  const { replayed } = await appendAll(client, householdId, itemId, inputs);
  return resultFor(client, householdId, itemId, command.idempotencyKey, replayed);
}

/** The named row's whole write: its sibling rows and the clamps attached to them. */
function groupOf(
  history: readonly LedgerHistoryEntry[],
  named: LedgerHistoryEntry,
): readonly LedgerHistoryEntry[] {
  const infixAt = named.idempotencyKey.indexOf(PLAN_KEY_INFIX);
  const baseKey = infixAt === -1 ? named.idempotencyKey : named.idempotencyKey.slice(0, infixAt);
  const statements = history.filter(
    (entry) => entry.idempotencyKey === baseKey || belongsToKey(entry.idempotencyKey, baseKey),
  );
  const statementKeys = new Set(statements.map((entry) => entry.idempotencyKey));
  const clamps = history.filter(
    (entry) => entry.clampCauseKey !== null && statementKeys.has(entry.clampCauseKey),
  );
  return [...statements, ...clamps.filter((clamp) => !statementKeys.has(clamp.idempotencyKey))];
}

/** Net effect per lot, in the order the lots first appear in the group. */
function netByLot(group: readonly LedgerHistoryEntry[]): ReadonlyMap<string, bigint> {
  const nets = new Map<string, bigint>();
  for (const entry of [...group].sort((left, right) => left.sequence - right.sequence)) {
    nets.set(entry.lotId, (nets.get(entry.lotId) ?? 0n) + entry.deltaMicros);
  }
  return nets;
}
