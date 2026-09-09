/**
 * The append-only inventory ledger (ADR-008 / D-003).
 *
 * Rules this module exists to make unbreakable:
 * - **Append-only.** Nothing here mutates a recorded transaction; every write
 *   returns a new, deep-frozen aggregate (INV-LEDGER-2).
 * - **Derived quantities.** `currentQty` on the item and each lot is maintained
 *   with the append and is always exactly Σ deltas (INV-LEDGER-1).
 * - **Idempotent writes.** Replaying an identical payload under the same
 *   idempotency key changes nothing and returns the original row (INV-LEDGER-3).
 * - **Never negative.** A decrease that overshoots the recorded balance is
 *   recorded in full and immediately compensated by a *flagged, system-authored*
 *   `ADJUSTMENT` carrying the residual, leaving the balance at exactly zero
 *   (INV-LEDGER-4). See {@link CLAMP_REASON}.
 *
 * The module is pure: no clock, no randomness, no I/O. `recordedAt` and all
 * identifiers come from the caller, so the same inputs always produce the same
 * ledger.
 */

import { err, ledgerError, ok, type LedgerError, type Outcome } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import {
  amountToMicros,
  makeQuantity,
  microsToAmount,
  zeroQuantity,
  MAX_QUANTITY_MICROS,
} from "./quantity.js";
import {
  TRANSACTION_TYPES,
  transactionDirection,
  type Actor,
  type AppendResult,
  type CorrelationRef,
  type CreateInventoryItemInput,
  type InventoryItem,
  type InventoryLot,
  type LotInput,
  type Provenance,
  type ProvenanceTier,
  type RecordedTransaction,
  type TransactionInput,
} from "./types.js";

/**
 * Separator reserved for ledger-generated idempotency keys. Caller-supplied
 * keys may not contain it, which keeps system rows from ever colliding with
 * user rows.
 */
export const RESERVED_KEY_SEPARATOR = "::";

/** Suffix appended to the overshooting transaction's key for its clamp row. */
export const CLAMP_KEY_SUFFIX = `${RESERVED_KEY_SEPARATOR}over-consumption-clamp`;

/** `reason` recorded on a clamp adjustment. */
export const CLAMP_REASON = "over-consumption-clamp";

/** `provenance.source` recorded on a clamp adjustment. */
export const CLAMP_SOURCE = "inventory-ledger:over-consumption-clamp";

/** `actor.component` for rows the ledger authors itself. */
export const LEDGER_COMPONENT = "inventory-ledger";

const PROVENANCE_TIERS: readonly ProvenanceTier[] = [
  "KNOWN_FACT",
  "ESTIMATED",
  "AI_INTERPRETATION",
];

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function nonEmptyString(value: unknown, field: string): Outcome<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return err("INVALID_FIELD", `${field} must be a non-empty string`, field);
  }
  return ok(value);
}

function instantMillis(value: unknown, field: string): Outcome<number> {
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value)) {
    return err("INVALID_TIMESTAMP", `${field} must be an ISO-8601 instant`, field);
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    return err("INVALID_TIMESTAMP", `${field} is not a valid instant`, field);
  }
  return ok(millis);
}

function validateOptionalInstant(value: unknown, field: string): LedgerError | null {
  if (value === undefined) return null;
  const parsed = instantMillis(value, field);
  return parsed.ok ? null : parsed.error;
}

function validateActor(input: TransactionInput): LedgerError | null {
  // Deliberately treated as untrusted: callers reach this from JSON/HTTP
  // boundaries where the compile-time union guarantees nothing.
  const actor: unknown = input.actor;
  if (typeof actor !== "object" || actor === null) {
    return ledgerError("INVALID_FIELD", "actor is required", "actor");
  }
  const candidate = actor as {
    kind?: unknown;
    userId?: unknown;
    component?: unknown;
    modelRef?: unknown;
  };
  switch (candidate.kind) {
    case "user": {
      const parsed = nonEmptyString(candidate.userId, "actor.userId");
      return parsed.ok ? null : parsed.error;
    }
    case "system": {
      const parsed = nonEmptyString(candidate.component, "actor.component");
      return parsed.ok ? null : parsed.error;
    }
    case "ai-confirmed": {
      const user = nonEmptyString(candidate.userId, "actor.userId");
      if (!user.ok) return user.error;
      const model = nonEmptyString(candidate.modelRef, "actor.modelRef");
      return model.ok ? null : model.error;
    }
    default:
      return ledgerError("INVALID_FIELD", "actor.kind is not a known actor kind", "actor.kind");
  }
}

function validateProvenance(input: TransactionInput): LedgerError | null {
  const provenance = input.provenance;
  if (typeof provenance !== "object" || provenance === null) {
    return ledgerError("INVALID_FIELD", "provenance is required", "provenance");
  }
  if (!PROVENANCE_TIERS.includes(provenance.tier)) {
    return ledgerError("INVALID_FIELD", "provenance.tier is not a known tier", "provenance.tier");
  }
  const source = nonEmptyString(provenance.source, "provenance.source");
  if (!source.ok) return source.error;
  if (
    provenance.confidence !== undefined &&
    (!Number.isFinite(provenance.confidence) ||
      provenance.confidence < 0 ||
      provenance.confidence > 1)
  ) {
    return ledgerError(
      "INVALID_FIELD",
      "provenance.confidence must be between 0 and 1",
      "provenance.confidence",
    );
  }
  return validateOptionalInstant(provenance.observedAt, "provenance.observedAt");
}

function validateCorrelationRef(input: TransactionInput): LedgerError | null {
  const ref = input.correlationRef;
  if (ref === undefined) return null;
  if (ref.kind !== "receipt-line" && ref.kind !== "meal-log" && ref.kind !== "shopping-item") {
    return ledgerError(
      "INVALID_FIELD",
      "correlationRef.kind is not a known kind",
      "correlationRef.kind",
    );
  }
  const id = nonEmptyString(ref.id, "correlationRef.id");
  return id.ok ? null : id.error;
}

function validateLotInput(lot: LotInput): LedgerError | null {
  const lotId = nonEmptyString(lot.lotId, "lotId");
  if (!lotId.ok) return lotId.error;
  const acquired = validateOptionalInstant(lot.acquiredAt, "acquiredAt");
  if (acquired !== null) return acquired;
  const expires = validateOptionalInstant(lot.expiresAt, "expiresAt");
  if (expires !== null) return expires;
  if (lot.expiryTier !== undefined && !PROVENANCE_TIERS.includes(lot.expiryTier)) {
    return ledgerError("INVALID_FIELD", "expiryTier is not a known tier", "expiryTier");
  }
  return null;
}

function toLot(input: LotInput, unit: string): InventoryLot {
  return { ...input, currentQty: zeroQuantity(unit) };
}

/**
 * Creates an empty item aggregate.
 *
 * The item declares the one unit every lot and transaction on it must use;
 * mixed units are rejected at append time rather than converted (conversion is
 * M1-T3's job and must never be guessed).
 */
export function createInventoryItem(input: CreateInventoryItemInput): Outcome<InventoryItem> {
  const itemId = nonEmptyString(input.itemId, "itemId");
  if (!itemId.ok) return itemId;
  const householdId = nonEmptyString(input.householdId, "householdId");
  if (!householdId.ok) return householdId;
  const unit = nonEmptyString(input.unit, "unit");
  if (!unit.ok) return unit;

  const lots: InventoryLot[] = [];
  const seen = new Set<string>();
  for (const lotInput of input.lots ?? []) {
    const problem = validateLotInput(lotInput);
    if (problem !== null) return { ok: false, error: problem };
    if (seen.has(lotInput.lotId)) {
      return err("DUPLICATE_LOT", `lot ${lotInput.lotId} is already open`, lotInput.lotId);
    }
    seen.add(lotInput.lotId);
    lots.push(toLot(lotInput, input.unit));
  }

  const item: InventoryItem = {
    ...input,
    lots,
    transactions: [],
    currentQty: zeroQuantity(input.unit),
    nextSequence: 1,
  };
  return ok(deepFreeze(item));
}

/** Opens a new (empty) lot on an item. Existing lots and rows are untouched. */
export function openLot(item: InventoryItem, lot: LotInput): Outcome<InventoryItem> {
  const problem = validateLotInput(lot);
  if (problem !== null) return { ok: false, error: problem };
  if (item.lots.some((existing) => existing.lotId === lot.lotId)) {
    return err("DUPLICATE_LOT", `lot ${lot.lotId} is already open`, lot.lotId);
  }
  const next: InventoryItem = {
    ...item,
    lots: [...item.lots, toLot(lot, item.unit)],
  };
  return ok(deepFreeze(next));
}

/**
 * Returns the recorded transaction written under `key`, if any.
 *
 * Deliberately a linear scan: the aggregate carries no key index, which keeps
 * it a plain frozen structure with nothing mutable to protect. That makes
 * {@link appendTransactions} O(n²) in the number of rows on one item — fine at
 * household scale (tens to low thousands of rows per item), but do **not** push
 * a 10k-line bulk import through it. Bulk paths should dedupe against a
 * database unique index instead (M1-T2).
 */
export function findByIdempotencyKey(
  item: InventoryItem,
  key: string,
): RecordedTransaction | undefined {
  return item.transactions.find((transaction) => transaction.idempotencyKey === key);
}

/** Returns the clamp adjustment generated for `key`, if one was. */
export function findClampFor(item: InventoryItem, key: string): RecordedTransaction | undefined {
  return findByIdempotencyKey(item, `${key}${CLAMP_KEY_SUFFIX}`);
}

/**
 * Rebuilds an actor as a fresh object.
 *
 * Two reasons the ledger never stores the caller's own nested objects:
 * unknown/forged fields are dropped (only the union's declared fields survive),
 * and the caller keeps an unfrozen object of its own — recording a transaction
 * must not silently freeze structures the caller still owns and may reuse.
 */
function copyActor(actor: Actor): Actor {
  if (actor.kind === "user") return { kind: "user", userId: actor.userId };
  if (actor.kind === "system") return { kind: "system", component: actor.component };
  return { kind: "ai-confirmed", userId: actor.userId, modelRef: actor.modelRef };
}

/** Rebuilds provenance as a fresh object, keeping only declared fields. */
function copyProvenance(provenance: Provenance): Provenance {
  const copy: Provenance = { tier: provenance.tier, source: provenance.source };
  return {
    ...copy,
    ...(provenance.confidence === undefined ? {} : { confidence: provenance.confidence }),
    ...(provenance.modelRef === undefined ? {} : { modelRef: provenance.modelRef }),
    ...(provenance.observedAt === undefined ? {} : { observedAt: provenance.observedAt }),
    ...(provenance.confirmedBy === undefined ? {} : { confirmedBy: provenance.confirmedBy }),
  };
}

/** Rebuilds a correlation reference as a fresh object. */
function copyCorrelationRef(ref: CorrelationRef): CorrelationRef {
  return { kind: ref.kind, id: ref.id };
}

/**
 * Builds the row that goes into the ledger, field by field.
 *
 * **Never spread the caller's input here.** A spread would let a caller forge
 * `systemFlag` — the marker that says "the ledger itself wrote this row" —
 * and would persist arbitrary unknown fields into the append-only history.
 * Only the fields listed below can ever reach a recorded transaction;
 * `systemFlag` is assignable exclusively by {@link buildClamp}.
 */
function buildRecorded(
  item: InventoryItem,
  input: TransactionInput,
  micros: bigint,
  sequence: number,
): RecordedTransaction {
  const recorded: RecordedTransaction = {
    itemId: item.itemId,
    sequence,
    lotId: input.lotId,
    type: input.type,
    // Canonicalised from the exact value, so `qtyDelta` and `qtyDeltaMicros`
    // cannot disagree by construction (and -0 becomes 0).
    qtyDelta: microsToAmount(micros),
    qtyDeltaMicros: micros,
    unit: input.unit,
    actor: copyActor(input.actor),
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    provenance: copyProvenance(input.provenance),
    idempotencyKey: input.idempotencyKey,
  };
  return {
    ...recorded,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.correlationRef === undefined
      ? {}
      : { correlationRef: copyCorrelationRef(input.correlationRef) }),
  };
}

/** Canonical string form of an actor, for payload comparison. */
function actorKey(actor: Actor): string {
  if (actor.kind === "user") return `user:${actor.userId}`;
  if (actor.kind === "system") return `system:${actor.component}`;
  if (actor.kind === "ai-confirmed") {
    return `ai-confirmed:${actor.userId}:${actor.modelRef}`;
  }
  return "unknown";
}

/**
 * Whether a resubmission is a true replay of the stored row.
 *
 * `recordedAt` is deliberately excluded: a retry legitimately arrives later.
 * Everything else — including provenance and correlation — must match, so a key
 * reused for a *different* write is reported as a conflict instead of being
 * silently swallowed as a duplicate.
 */
function isSamePayload(
  stored: RecordedTransaction,
  input: TransactionInput,
  micros: bigint,
): boolean {
  return (
    stored.lotId === input.lotId &&
    stored.type === input.type &&
    stored.qtyDeltaMicros === micros &&
    stored.unit === input.unit &&
    stored.reason === input.reason &&
    stored.occurredAt === input.occurredAt &&
    actorKey(stored.actor) === actorKey(input.actor) &&
    stored.provenance.tier === input.provenance.tier &&
    stored.provenance.source === input.provenance.source &&
    stored.provenance.confidence === input.provenance.confidence &&
    stored.provenance.modelRef === input.provenance.modelRef &&
    stored.provenance.observedAt === input.provenance.observedAt &&
    stored.provenance.confirmedBy === input.provenance.confirmedBy &&
    stored.correlationRef?.kind === input.correlationRef?.kind &&
    stored.correlationRef?.id === input.correlationRef?.id
  );
}

function validateInput(item: InventoryItem, input: TransactionInput): Outcome<bigint> {
  if (typeof input !== "object" || input === null) {
    return err("INVALID_FIELD", "transaction input is required");
  }
  if (!(TRANSACTION_TYPES as readonly string[]).includes(input.type)) {
    return err("INVALID_FIELD", `${String(input.type)} is not a transaction type`, "type");
  }
  const key = nonEmptyString(input.idempotencyKey, "idempotencyKey");
  if (!key.ok) return key;
  if (input.idempotencyKey.includes(RESERVED_KEY_SEPARATOR)) {
    return err(
      "INVALID_IDEMPOTENCY_KEY",
      `idempotencyKey may not contain the reserved separator "${RESERVED_KEY_SEPARATOR}"`,
      "idempotencyKey",
    );
  }

  const lotId = nonEmptyString(input.lotId, "lotId");
  if (!lotId.ok) return lotId;
  if (!item.lots.some((lot) => lot.lotId === input.lotId)) {
    return err("UNKNOWN_LOT", `lot ${input.lotId} is not open on this item`, "lotId");
  }

  const unit = nonEmptyString(input.unit, "unit");
  if (!unit.ok) return unit;
  if (input.unit !== item.unit) {
    return err(
      "MIXED_UNITS",
      `transaction unit "${input.unit}" differs from item unit "${item.unit}"; conversion is not performed here`,
      "unit",
    );
  }

  const occurredAt = instantMillis(input.occurredAt, "occurredAt");
  if (!occurredAt.ok) return occurredAt;
  const recordedAt = instantMillis(input.recordedAt, "recordedAt");
  if (!recordedAt.ok) return recordedAt;
  if (recordedAt.value < occurredAt.value) {
    return err("TIMESTAMP_ORDER", "recordedAt precedes occurredAt", "recordedAt");
  }

  const actorProblem = validateActor(input);
  if (actorProblem !== null) return { ok: false, error: actorProblem };
  const provenanceProblem = validateProvenance(input);
  if (provenanceProblem !== null) return { ok: false, error: provenanceProblem };
  const correlationProblem = validateCorrelationRef(input);
  if (correlationProblem !== null) return { ok: false, error: correlationProblem };
  if (input.reason !== undefined && input.reason.trim() === "") {
    return err("INVALID_FIELD", "reason must be omitted or non-empty", "reason");
  }

  const micros = amountToMicros(input.qtyDelta);
  if (!micros.ok) return micros;
  if (micros.value === 0n) {
    return err("ZERO_DELTA", "a transaction must change the quantity", "qtyDelta");
  }
  const direction = transactionDirection(input.type);
  if (direction === "increase" && micros.value < 0n) {
    return err("WRONG_SIGN", `${input.type} must carry a positive qtyDelta`, "qtyDelta");
  }
  if (direction === "decrease" && micros.value > 0n) {
    return err(
      "WRONG_SIGN",
      `${input.type} must carry a negative qtyDelta (stock leaving)`,
      "qtyDelta",
    );
  }
  return ok(micros.value);
}

function buildClamp(cause: RecordedTransaction, residualMicros: bigint): RecordedTransaction {
  const clamp: RecordedTransaction = {
    itemId: cause.itemId,
    lotId: cause.lotId,
    type: "ADJUSTMENT",
    qtyDelta: microsToAmount(residualMicros),
    qtyDeltaMicros: residualMicros,
    unit: cause.unit,
    reason: CLAMP_REASON,
    actor: { kind: "system", component: LEDGER_COMPONENT },
    occurredAt: cause.occurredAt,
    recordedAt: cause.recordedAt,
    provenance: {
      tier: "ESTIMATED",
      source: CLAMP_SOURCE,
      observedAt: cause.occurredAt,
    },
    idempotencyKey: `${cause.idempotencyKey}${CLAMP_KEY_SUFFIX}`,
    sequence: cause.sequence + 1,
    systemFlag: {
      kind: "OVER_CONSUMPTION",
      residualMicros,
      residual: microsToAmount(residualMicros),
      causedBySequence: cause.sequence,
      causedByIdempotencyKey: cause.idempotencyKey,
    },
  };
  return cause.correlationRef === undefined
    ? clamp
    : { ...clamp, correlationRef: cause.correlationRef };
}

/**
 * Appends one transaction to an item's ledger.
 *
 * Never throws and never mutates `item`; the outcome is one of:
 * - `appended` — the row (and, on over-consumption, its clamp adjustment) is in
 *   the returned aggregate;
 * - `duplicate` — the key was already used by an identical payload: nothing was
 *   written and the *same* aggregate instance is returned (INV-LEDGER-3);
 * - `rejected` — a validation failure, including a key reused by a materially
 *   different payload (`IDEMPOTENCY_KEY_CONFLICT`).
 *
 * **Over-consumption (INV-LEDGER-4).** When a decrease exceeds the lot's
 * recorded balance the request is *not* trimmed: the user's statement is
 * recorded at full magnitude, and the ledger immediately appends its own
 * `ADJUSTMENT` for the residual, flagged `OVER_CONSUMPTION` and attributed to
 * the system. Both rows land in the same operation, so no observable state is
 * ever negative, the shortfall is explicit ("we believed 0.75, you used 1.0 —
 * our record was 0.25 short") and the correction rate stays measurable.
 */
export function appendTransaction(item: InventoryItem, input: TransactionInput): AppendResult {
  const validated = validateInput(item, input);
  if (!validated.ok) {
    return { status: "rejected", item, error: validated.error };
  }
  const micros = validated.value;

  const existing = findByIdempotencyKey(item, input.idempotencyKey);
  if (existing !== undefined) {
    if (!isSamePayload(existing, input, micros)) {
      return {
        status: "rejected",
        item,
        error: ledgerError(
          "IDEMPOTENCY_KEY_CONFLICT",
          `idempotencyKey ${input.idempotencyKey} was already used by a different transaction`,
          "idempotencyKey",
        ),
      };
    }
    const clamp = findClampFor(item, input.idempotencyKey);
    return clamp === undefined
      ? { status: "duplicate", item, transaction: existing }
      : { status: "duplicate", item, transaction: existing, clampAdjustment: clamp };
  }

  const recorded = buildRecorded(item, input, micros, item.nextSequence);

  const lotBalance = item.lots.find((lot) => lot.lotId === input.lotId)?.currentQty.micros ?? 0n;
  const projected = lotBalance + micros;
  const clamp = projected < 0n ? buildClamp(recorded, -projected) : undefined;

  const appended: RecordedTransaction[] = clamp === undefined ? [recorded] : [recorded, clamp];
  const netMicros = clamp === undefined ? micros : micros + clamp.qtyDeltaMicros;

  const next: InventoryItem = {
    ...item,
    lots: item.lots.map((lot) =>
      lot.lotId === input.lotId
        ? { ...lot, currentQty: makeQuantity(item.unit, lot.currentQty.micros + netMicros) }
        : lot,
    ),
    transactions: [...item.transactions, ...appended],
    currentQty: makeQuantity(item.unit, item.currentQty.micros + netMicros),
    nextSequence: item.nextSequence + appended.length,
  };
  deepFreeze(next);

  return clamp === undefined
    ? { status: "appended", item: next, transaction: recorded }
    : { status: "appended", item: next, transaction: recorded, clampAdjustment: clamp };
}

/**
 * Folds a batch of transactions onto an item, keeping every per-append result.
 * A rejection does not abort the batch — the caller decides what to do with the
 * rejected entries (useful for receipt/meal batches where one bad line should
 * not discard the rest).
 */
export function appendTransactions(
  item: InventoryItem,
  inputs: readonly TransactionInput[],
): { readonly item: InventoryItem; readonly results: readonly AppendResult[] } {
  let current = item;
  const results: AppendResult[] = [];
  for (const input of inputs) {
    const result = appendTransaction(current, input);
    results.push(result);
    current = result.item;
  }
  return { item: current, results };
}

/**
 * Per-row integrity checks for stored history.
 *
 * A row that `appendTransaction` could never have produced means the storage
 * layer (or something writing behind it) is corrupt, so rehydration refuses it
 * rather than deriving a plausible-looking balance from it. Checked here:
 * the two delta representations agree exactly; the delta is non-zero, within
 * range, and signed the way its type requires; and the ledger's own markers —
 * `systemFlag` and the reserved `::` key namespace — appear only on rows the
 * ledger itself could have authored.
 */
function validateStoredRow(row: RecordedTransaction): LedgerError | null {
  const restated = amountToMicros(row.qtyDelta);
  if (!restated.ok) {
    return ledgerError(
      "CORRUPT_LEDGER",
      `stored qtyDelta ${String(row.qtyDelta)} is not a representable ledger quantity`,
      row.idempotencyKey,
    );
  }
  if (restated.value !== row.qtyDeltaMicros) {
    return ledgerError(
      "CORRUPT_LEDGER",
      `stored qtyDelta ${String(row.qtyDelta)} (= ${restated.value.toString()} micro-units) disagrees with qtyDeltaMicros ${row.qtyDeltaMicros.toString()}`,
      row.idempotencyKey,
    );
  }
  if (row.qtyDeltaMicros === 0n) {
    return ledgerError("CORRUPT_LEDGER", "stored transaction has a zero delta", row.idempotencyKey);
  }
  if (row.qtyDeltaMicros > MAX_QUANTITY_MICROS || row.qtyDeltaMicros < -MAX_QUANTITY_MICROS) {
    return ledgerError(
      "CORRUPT_LEDGER",
      "stored qtyDeltaMicros exceeds the representable ledger range",
      row.idempotencyKey,
    );
  }

  const direction = transactionDirection(row.type);
  if (direction === "increase" && row.qtyDeltaMicros < 0n) {
    return ledgerError(
      "WRONG_SIGN",
      `stored ${row.type} carries a negative qtyDelta`,
      row.idempotencyKey,
    );
  }
  if (direction === "decrease" && row.qtyDeltaMicros > 0n) {
    return ledgerError(
      "WRONG_SIGN",
      `stored ${row.type} carries a positive qtyDelta`,
      row.idempotencyKey,
    );
  }

  // Ledger-authored markers must match a row the ledger could have written.
  const ledgerAuthored = row.actor.kind === "system" && row.actor.component === LEDGER_COMPONENT;
  const reservedKey = row.idempotencyKey.endsWith(CLAMP_KEY_SUFFIX);
  if (row.systemFlag !== undefined || reservedKey) {
    if (!ledgerAuthored) {
      return ledgerError(
        "CORRUPT_LEDGER",
        "stored row claims a ledger-authored marker but is not attributed to the ledger",
        row.idempotencyKey,
      );
    }
    if (row.systemFlag === undefined || !reservedKey) {
      return ledgerError(
        "CORRUPT_LEDGER",
        "stored clamp row is missing either its systemFlag or its reserved idempotency key",
        row.idempotencyKey,
      );
    }
    if (row.type !== "ADJUSTMENT" || row.qtyDeltaMicros !== row.systemFlag.residualMicros) {
      return ledgerError(
        "CORRUPT_LEDGER",
        "stored clamp row does not match its own flag (type or residual)",
        row.idempotencyKey,
      );
    }
  } else if (row.idempotencyKey.includes(RESERVED_KEY_SEPARATOR)) {
    return ledgerError(
      "INVALID_IDEMPOTENCY_KEY",
      `stored idempotencyKey uses the reserved separator "${RESERVED_KEY_SEPARATOR}"`,
      row.idempotencyKey,
    );
  }
  return null;
}

/**
 * Rebuilds an aggregate from stored ledger rows (for persistence read paths).
 *
 * Snapshots are recomputed from the rows rather than trusted, and the rows are
 * replayed in their stored sequence order. Clamp rows are *not* re-generated —
 * they are already part of the stored history — so rehydration is exact.
 * Validation failures here mean the stored ledger is corrupt, not that a caller
 * made a mistake: this is the corruption detector the persistence layer (M1-T2)
 * leans on, so it rejects anything `appendTransaction` could not have written
 * (see {@link validateStoredRow}), not merely structural problems.
 */
export function rehydrateInventoryItem(
  shell: CreateInventoryItemInput,
  transactions: readonly RecordedTransaction[],
): Outcome<InventoryItem> {
  const base = createInventoryItem(shell);
  if (!base.ok) return base;

  const ordered = [...transactions].sort((a, b) => a.sequence - b.sequence);
  const knownLots = new Set(base.value.lots.map((lot) => lot.lotId));
  const lotMicros = new Map<string, bigint>();
  const seenKeys = new Set<string>();
  let total = 0n;

  for (const [index, transaction] of ordered.entries()) {
    if (transaction.sequence !== index + 1) {
      return err(
        "CORRUPT_LEDGER",
        `stored transactions are not a contiguous 1..n sequence (found ${String(transaction.sequence)} at position ${String(index + 1)})`,
        transaction.idempotencyKey,
      );
    }
    if (transaction.itemId !== shell.itemId) {
      return err(
        "ITEM_MISMATCH",
        `transaction belongs to item ${transaction.itemId}`,
        transaction.idempotencyKey,
      );
    }
    if (transaction.unit !== shell.unit) {
      return err(
        "MIXED_UNITS",
        `stored transaction unit "${transaction.unit}" differs from item unit "${shell.unit}"`,
        transaction.idempotencyKey,
      );
    }
    if (!knownLots.has(transaction.lotId)) {
      return err(
        "UNKNOWN_LOT",
        `stored transaction references unopened lot ${transaction.lotId}`,
        transaction.idempotencyKey,
      );
    }
    if (seenKeys.has(transaction.idempotencyKey)) {
      return err(
        "IDEMPOTENCY_KEY_CONFLICT",
        "stored ledger repeats an idempotency key",
        transaction.idempotencyKey,
      );
    }
    const rowProblem = validateStoredRow(transaction);
    if (rowProblem !== null) return { ok: false, error: rowProblem };

    seenKeys.add(transaction.idempotencyKey);
    lotMicros.set(
      transaction.lotId,
      (lotMicros.get(transaction.lotId) ?? 0n) + transaction.qtyDeltaMicros,
    );
    total += transaction.qtyDeltaMicros;
  }

  if (total < 0n) {
    return err("CORRUPT_LEDGER", "stored ledger derives a negative item quantity", shell.itemId);
  }
  for (const [lotId, micros] of lotMicros) {
    if (micros < 0n) {
      return err(
        "CORRUPT_LEDGER",
        `stored ledger derives a negative quantity for lot ${lotId}`,
        lotId,
      );
    }
  }

  const item: InventoryItem = {
    ...base.value,
    lots: base.value.lots.map((lot) => ({
      ...lot,
      currentQty: makeQuantity(shell.unit, lotMicros.get(lot.lotId) ?? 0n),
    })),
    transactions: ordered,
    currentQty: makeQuantity(shell.unit, total),
    nextSequence: ordered.length + 1,
  };
  return ok(deepFreeze(item));
}
