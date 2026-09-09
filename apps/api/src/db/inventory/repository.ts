/**
 * Inventory ledger persistence (M1-T2).
 *
 * The shape of the write path is the point of this module:
 *
 *   lock the item → read its ledger → let the **domain** decide → insert rows
 *
 * The domain decides. Nothing here computes a balance, trims an overshooting
 * decrease, or invents a compensating row — that arithmetic is safety-critical
 * (CLAUDE.md rule 7) and already lives in `appendTransaction`, property-tested.
 * This module's job is to make the domain's decision durable atomically, and to
 * hand back whatever the domain said.
 *
 * The `SELECT … FOR UPDATE` matters: the domain computes against the balance it
 * read, so two concurrent appends to one item must not both compute against the
 * same "before" state. The lock serialises them. The trigger in migration 0004
 * is the backstop — it re-checks the sequence under the same lock and raises
 * `40001` if a caller skipped the lock, so a missed lock is a retryable error
 * rather than a corrupted balance.
 *
 * The read path deliberately routes everything through
 * `rehydrateInventoryItem`, which recomputes snapshots from the rows instead of
 * trusting them and refuses anything `appendTransaction` could not have
 * written. Reading is therefore also an integrity check.
 */

import {
  appendTransaction as appendToDomainLedger,
  createInventoryItem,
  err,
  ok,
  rehydrateInventoryItem,
  type AppendResult,
  type CreateInventoryItemInput,
  type InventoryItem,
  type LotInput,
  type Outcome,
  type RecordedTransaction,
  type TransactionInput,
} from "@smart-kitchen/domain";
import type { ClientBase } from "pg";
import {
  canonicalizeInstant,
  toExpiryTier,
  toRecordedTransaction,
  toStorageLocation,
  type InventoryItemRow,
  type InventoryLotRow,
  type InventoryTransactionRow,
} from "./mapping.js";

/**
 * Identifiers are `uuid` columns (data-model.md §1: UUIDv7, client-generatable).
 * The domain treats ids as opaque strings, so this boundary is where the
 * narrower storage contract is stated — as a typed rejection rather than as a
 * driver-level `invalid input syntax for type uuid`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRANSACTION_COLUMNS = `
  household_id, item_id, lot_id, sequence, type, qty_delta, qty_delta_micros, unit, reason,
  actor_kind, actor_user_id, actor_component, actor_model_ref,
  occurred_at, recorded_at,
  provenance_tier, provenance_source, provenance_confidence, provenance_model_ref,
  provenance_observed_at, provenance_confirmed_by,
  correlation_kind, correlation_id, idempotency_key,
  system_flag_kind, system_flag_residual_micros,
  system_flag_caused_by_sequence, system_flag_caused_by_idempotency_key`;

function requireUuid(value: string, field: string): Outcome<string> {
  return UUID.test(value)
    ? ok(value)
    : err("INVALID_FIELD", `${field} must be a UUID to be persisted (got "${value}")`, field);
}

/** Postgres error code of a driver error, when it has one. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Constraint name a driver error names, when it names one. */
export function pgConstraint(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const constraint: unknown = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

/**
 * Normalises every instant on a transaction input to the exact form the
 * database will return, before the domain records it. See
 * {@link canonicalizeInstant}.
 */
export function canonicalizeTransactionInput(input: TransactionInput): TransactionInput {
  const provenance = input.provenance;
  return {
    ...input,
    occurredAt: canonicalizeInstant(input.occurredAt),
    recordedAt: canonicalizeInstant(input.recordedAt),
    ...(provenance.observedAt === undefined
      ? {}
      : {
          provenance: {
            ...provenance,
            observedAt: canonicalizeInstant(provenance.observedAt),
          },
        }),
  };
}

/**
 * Creates an item and its opening lots.
 *
 * Validated by the domain first so that a shell the ledger would refuse never
 * reaches storage. Snapshots start at zero and are never written here — only
 * the ledger trigger moves them.
 */
export async function insertInventoryItem(
  client: ClientBase,
  input: CreateInventoryItemInput,
  displayName?: string,
): Promise<Outcome<InventoryItem>> {
  const created = createInventoryItem(input);
  if (!created.ok) return created;

  const itemId = requireUuid(input.itemId, "itemId");
  if (!itemId.ok) return itemId;
  const householdId = requireUuid(input.householdId, "householdId");
  if (!householdId.ok) return householdId;
  for (const lot of input.lots ?? []) {
    const lotId = requireUuid(lot.lotId, "lotId");
    if (!lotId.ok) return lotId;
  }

  await client.query(
    `INSERT INTO inventory_items
       (id, household_id, unit, product_ref, ingredient_ref, display_name, storage_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.itemId,
      input.householdId,
      input.unit,
      input.productRef ?? null,
      input.ingredientRef ?? null,
      displayName ?? null,
      input.storageLocation ?? null,
    ],
  );

  for (const lot of input.lots ?? []) {
    await insertInventoryLot(client, input.householdId, input.itemId, lot);
  }

  return created;
}

/** Opens a lot on an existing item. */
export async function insertInventoryLot(
  client: ClientBase,
  householdId: string,
  itemId: string,
  lot: LotInput,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_lots
       (id, household_id, item_id, acquired_at, expires_at, expiry_tier, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      lot.lotId,
      householdId,
      itemId,
      lot.acquiredAt ?? null,
      lot.expiresAt ?? null,
      lot.expiryTier ?? null,
      lot.label ?? null,
    ],
  );
}

/** Inserts one recorded transaction exactly as the domain produced it. */
export async function insertRecordedTransaction(
  client: ClientBase,
  householdId: string,
  row: RecordedTransaction,
): Promise<void> {
  const actor = row.actor;
  const flag = row.systemFlag;
  await client.query(
    `INSERT INTO inventory_transactions (${TRANSACTION_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
    [
      householdId,
      row.itemId,
      row.lotId,
      row.sequence,
      row.type,
      // The decimal form is sent as the exact decimal text of the micros, never
      // as a float, so nothing is rounded on the way in.
      microsToDecimalText(row.qtyDeltaMicros),
      row.qtyDeltaMicros.toString(),
      row.unit,
      row.reason ?? null,
      actor.kind,
      actor.kind === "system" ? null : actor.userId,
      actor.kind === "system" ? actor.component : null,
      actor.kind === "ai-confirmed" ? actor.modelRef : null,
      row.occurredAt,
      row.recordedAt,
      row.provenance.tier,
      row.provenance.source,
      row.provenance.confidence ?? null,
      row.provenance.modelRef ?? null,
      row.provenance.observedAt ?? null,
      row.provenance.confirmedBy ?? null,
      row.correlationRef?.kind ?? null,
      row.correlationRef?.id ?? null,
      row.idempotencyKey,
      flag?.kind ?? null,
      flag === undefined ? null : flag.residualMicros.toString(),
      flag?.causedBySequence ?? null,
      flag?.causedByIdempotencyKey ?? null,
    ],
  );
}

/**
 * Exact decimal text for a micro-unit value — `1250000n` → `"1.25"`.
 *
 * Built with integer arithmetic and string assembly rather than division so
 * that no float ever touches the value on its way into `numeric`.
 */
export function microsToDecimalText(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const text =
    frac === 0n ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(6, "0")}`;
  return negative ? `-${text}` : text;
}

/**
 * Reads an item back and rebuilds the domain aggregate from its stored rows.
 *
 * Returns `CORRUPT_LEDGER`/`MIXED_UNITS`/… — whatever
 * `rehydrateInventoryItem` concludes — rather than a repaired aggregate.
 */
export async function loadInventoryItem(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<Outcome<InventoryItem>> {
  const items = await client.query<InventoryItemRow>(
    `SELECT id, household_id, unit, product_ref, ingredient_ref, storage_location,
            current_qty_micros, next_sequence
       FROM inventory_items
      WHERE id = $1 AND household_id = $2`,
    [itemId, householdId],
  );
  const itemRow = items.rows[0];
  if (itemRow === undefined) {
    return err(
      "ITEM_MISMATCH",
      `item ${itemId} is not visible in household ${householdId}`,
      itemId,
    );
  }

  const storageLocation = toStorageLocation(itemRow.storage_location);
  if (!storageLocation.ok) return storageLocation;

  const lots = await client.query<InventoryLotRow>(
    `SELECT id, item_id, acquired_at, expires_at, expiry_tier, label, current_qty_micros
       FROM inventory_lots
      WHERE item_id = $1 AND household_id = $2
      ORDER BY created_at, id`,
    [itemId, householdId],
  );

  const lotInputs: LotInput[] = [];
  for (const lot of lots.rows) {
    const expiryTier = toExpiryTier(lot.expiry_tier);
    if (!expiryTier.ok) return expiryTier;
    lotInputs.push({
      lotId: lot.id,
      ...(lot.acquired_at === null ? {} : { acquiredAt: lot.acquired_at.toISOString() }),
      ...(lot.expires_at === null ? {} : { expiresAt: lot.expires_at.toISOString() }),
      ...(expiryTier.value === undefined ? {} : { expiryTier: expiryTier.value }),
      ...(lot.label === null ? {} : { label: lot.label }),
    });
  }

  const transactions = await client.query<InventoryTransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS}
       FROM inventory_transactions
      WHERE item_id = $1 AND household_id = $2
      ORDER BY sequence`,
    [itemId, householdId],
  );

  const recorded: RecordedTransaction[] = [];
  for (const row of transactions.rows) {
    const mapped = toRecordedTransaction(row);
    if (!mapped.ok) return mapped;
    recorded.push(mapped.value);
  }

  const shell: CreateInventoryItemInput = {
    itemId: itemRow.id,
    householdId: itemRow.household_id,
    unit: itemRow.unit,
    lots: lotInputs,
    ...(itemRow.product_ref === null ? {} : { productRef: itemRow.product_ref }),
    ...(itemRow.ingredient_ref === null ? {} : { ingredientRef: itemRow.ingredient_ref }),
    ...(storageLocation.value === undefined ? {} : { storageLocation: storageLocation.value }),
  };

  const rehydrated = rehydrateInventoryItem(shell, recorded);
  if (!rehydrated.ok) return rehydrated;

  // The stored snapshots are read but never trusted — and, until now, never
  // *checked* either. Comparing them against the ledger the domain just
  // replayed is what turns "the trigger is the only writer of a snapshot" from
  // an assumption into something the read path verifies on every load. Drift
  // means something wrote a quantity outside a transaction append (ADR-008,
  // CLAUDE.md rule 10), so the read fails rather than returning a
  // plausible-looking aggregate; repair is an operator action with a flagged
  // ADJUSTMENT, never a silent overwrite (data-model.md §3).
  const drift = driftCheck(itemRow, lots.rows, rehydrated.value);
  return drift ?? rehydrated;
}

/** Compares stored snapshots with the ledger-derived aggregate. */
function driftCheck(
  itemRow: InventoryItemRow,
  lotRows: readonly InventoryLotRow[],
  derived: InventoryItem,
): Outcome<InventoryItem> | undefined {
  const storedMicros = BigInt(itemRow.current_qty_micros);
  if (storedMicros !== derived.currentQty.micros) {
    return err(
      "CORRUPT_LEDGER",
      `stored item snapshot ${storedMicros.toString()} != Σ deltas ${derived.currentQty.micros.toString()} (micro-units)`,
      itemRow.id,
    );
  }
  if (itemRow.next_sequence !== derived.nextSequence) {
    return err(
      "CORRUPT_LEDGER",
      `stored next_sequence ${String(itemRow.next_sequence)} does not follow ${String(derived.transactions.length)} recorded transactions`,
      itemRow.id,
    );
  }

  const derivedLots = new Map(derived.lots.map((lot) => [lot.lotId, lot.currentQty.micros]));
  for (const lotRow of lotRows) {
    const storedLotMicros = BigInt(lotRow.current_qty_micros);
    const derivedLotMicros = derivedLots.get(lotRow.id);
    if (derivedLotMicros === undefined || storedLotMicros !== derivedLotMicros) {
      return err(
        "CORRUPT_LEDGER",
        `stored lot snapshot ${storedLotMicros.toString()} != Σ deltas ${(derivedLotMicros ?? 0n).toString()} (micro-units)`,
        lotRow.id,
      );
    }
  }
  return undefined;
}

/**
 * Appends one transaction: locks the item, replays its ledger, asks the domain,
 * and persists whatever the domain accepted.
 *
 * Must be called inside a transaction (`withHouseholdTransaction`) — the lock
 * and the inserts are only atomic together.
 *
 * The two result layers are distinct on purpose. The outer `Outcome` answers
 * "could this aggregate be addressed at all" (does the item exist in this
 * household; is its stored history intact). The inner `AppendResult` is the
 * domain's verdict on the write itself — `appended`, an idempotent
 * `duplicate`, or `rejected`.
 */
export async function appendTransactionToDb(
  client: ClientBase,
  householdId: string,
  itemId: string,
  input: TransactionInput,
): Promise<Outcome<AppendResult>> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM inventory_items WHERE id = $1 AND household_id = $2 FOR UPDATE`,
    [itemId, householdId],
  );
  if (locked.rows.length === 0) {
    return err(
      "ITEM_MISMATCH",
      `item ${itemId} is not visible in household ${householdId}`,
      itemId,
    );
  }

  const loaded = await loadInventoryItem(client, householdId, itemId);
  if (!loaded.ok) return loaded;

  const result = appendToDomainLedger(loaded.value, canonicalizeTransactionInput(input));
  if (result.status !== "appended") return ok(result);

  try {
    await insertRecordedTransaction(client, householdId, result.transaction);
    if (result.clampAdjustment !== undefined) {
      await insertRecordedTransaction(client, householdId, result.clampAdjustment);
    }
  } catch (error) {
    // The database's idempotency index is household-scoped, which is stronger
    // than the domain's per-item uniqueness (architect ruling, M1-T1 §8.1): a
    // key already used on a *different* item in this household passes the
    // domain and is caught here. Surfaced as the same typed conflict the
    // domain would raise, not as a driver error.
    if (
      pgErrorCode(error) === "23505" &&
      pgConstraint(error) === "inventory_transactions_idempotency_key"
    ) {
      return ok({
        status: "rejected",
        item: loaded.value,
        error: {
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: `idempotencyKey ${input.idempotencyKey} is already used in this household`,
          field: "idempotencyKey",
        },
      });
    }
    throw error;
  }

  return ok(result);
}

/** One row of the `inventory_reconciliation` view. */
export interface ReconciliationRow {
  readonly item_id: string;
  readonly household_id: string;
  readonly snapshot_micros: string;
  readonly derived_micros: string;
  readonly drift_micros: string;
  readonly negative: boolean;
  readonly transaction_count: string;
  readonly next_sequence: number;
  readonly ok: boolean;
}

/** Runs the SQL reconciliation for one item (the mirror of domain `reconcile()`). */
export async function reconcileItemInDb(
  client: ClientBase,
  householdId: string,
  itemId: string,
): Promise<ReconciliationRow | undefined> {
  const result = await client.query<ReconciliationRow>(
    `SELECT item_id, household_id, snapshot_micros, derived_micros, drift_micros,
            negative, transaction_count, next_sequence, ok
       FROM inventory_reconciliation
      WHERE item_id = $1 AND household_id = $2`,
    [itemId, householdId],
  );
  return result.rows[0];
}
