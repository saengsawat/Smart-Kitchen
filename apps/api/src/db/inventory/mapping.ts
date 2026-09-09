/**
 * Row ↔ domain mapping for the inventory ledger (M1-T2).
 *
 * This is deliberately a *thin* mapper, not an ORM layer: it converts column
 * values to the shapes `packages/domain` already defines and then hands the
 * rows to `rehydrateInventoryItem`, which is the corruption detector for
 * anything read back (M1-T1). Nothing here re-derives a quantity or repairs a
 * row — a stored row that the domain would refuse must surface as an error,
 * not as a plausible-looking balance.
 *
 * Two representation notes that matter for exactness:
 *
 * - **bigints stay strings on the wire.** `pg` returns `bigint` columns as
 *   decimal strings precisely because `number` cannot hold them; they are
 *   converted with `BigInt()`, never with `Number()`.
 * - **`qty_delta` is read from the database, not recomputed from the micros.**
 *   Recomputing it would make the round-trip test tautological. Reading both
 *   columns independently is what lets `validateStoredRow` catch the case
 *   where they disagree.
 */

import {
  TRANSACTION_TYPES,
  err,
  microsToAmount,
  ok,
  type Actor,
  type CorrelationRef,
  type Instant,
  type Outcome,
  type Provenance,
  type ProvenanceTier,
  type RecordedTransaction,
  type StorageLocation,
  type SystemFlag,
  type TransactionType,
} from "@smart-kitchen/domain";

/** Columns of `inventory_transactions` as `pg` returns them. */
export interface InventoryTransactionRow {
  readonly household_id: string;
  readonly item_id: string;
  readonly lot_id: string;
  readonly sequence: number;
  readonly type: string;
  readonly qty_delta: string;
  readonly qty_delta_micros: string;
  readonly unit: string;
  readonly reason: string | null;
  readonly actor_kind: string;
  readonly actor_user_id: string | null;
  readonly actor_component: string | null;
  readonly actor_model_ref: string | null;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
  readonly provenance_tier: string;
  readonly provenance_source: string;
  readonly provenance_confidence: string | null;
  readonly provenance_model_ref: string | null;
  readonly provenance_observed_at: Date | null;
  readonly provenance_confirmed_by: string | null;
  readonly correlation_kind: string | null;
  readonly correlation_id: string | null;
  readonly idempotency_key: string;
  readonly system_flag_kind: string | null;
  readonly system_flag_residual_micros: string | null;
  readonly system_flag_caused_by_sequence: number | null;
  readonly system_flag_caused_by_idempotency_key: string | null;
}

/** Columns of `inventory_items` as `pg` returns them. */
export interface InventoryItemRow {
  readonly id: string;
  readonly household_id: string;
  readonly unit: string;
  readonly product_ref: string | null;
  readonly ingredient_ref: string | null;
  readonly storage_location: string | null;
  readonly current_qty_micros: string;
  readonly next_sequence: number;
}

/** Columns of `inventory_lots` as `pg` returns them. */
export interface InventoryLotRow {
  readonly id: string;
  readonly item_id: string;
  readonly acquired_at: Date | null;
  readonly expires_at: Date | null;
  readonly expiry_tier: string | null;
  readonly label: string | null;
  readonly current_qty_micros: string;
}

const PROVENANCE_TIERS: readonly string[] = ["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION"];
const CORRELATION_KINDS: readonly string[] = ["receipt-line", "meal-log", "shopping-item"];
const STORAGE_LOCATIONS: readonly string[] = ["FRIDGE", "FREEZER", "PANTRY", "OTHER"];
const BIGINT_TEXT = /^-?\d+$/;

/**
 * Canonical ISO-8601 form of a stored instant.
 *
 * `timestamptz` has no notion of the offset it was written with, so every
 * instant reads back as UTC with millisecond precision. See
 * {@link canonicalizeInstant} for why that is lossless in practice.
 */
function toInstant(value: Date): Instant {
  return value.toISOString();
}

/**
 * Normalises a caller's instant to the exact form the database will return.
 *
 * Applied on the **write** path, before the domain records the transaction, so
 * that the recorded fact and the stored fact are byte-identical: a row written
 * as `2026-03-06T18:00:00+02:00` would otherwise read back as
 * `2026-03-06T16:00:00.000Z` and fail an idempotent replay's payload
 * comparison. Normalising once, before the fact exists, is the only way to
 * keep INV-LEDGER-2's "a recorded row is a fact" true across a reload.
 *
 * The cost is sub-millisecond precision, which `Date` cannot carry. That is
 * deliberate and is the timestamp-normalisation point ADR-010 already notes.
 * Unparseable input is passed through untouched so the domain rejects it with
 * a typed `INVALID_TIMESTAMP` rather than this function throwing.
 */
export function canonicalizeInstant(value: Instant): Instant {
  if (typeof value !== "string") return value;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? value : new Date(millis).toISOString();
}

function parseActor(row: InventoryTransactionRow): Outcome<Actor> {
  switch (row.actor_kind) {
    case "user":
      return row.actor_user_id === null
        ? err("CORRUPT_LEDGER", "stored user actor has no user id", row.idempotency_key)
        : ok({ kind: "user", userId: row.actor_user_id });
    case "system":
      return row.actor_component === null
        ? err("CORRUPT_LEDGER", "stored system actor has no component", row.idempotency_key)
        : ok({ kind: "system", component: row.actor_component });
    case "ai-confirmed":
      return row.actor_user_id === null || row.actor_model_ref === null
        ? err(
            "CORRUPT_LEDGER",
            "stored ai-confirmed actor is missing its user id or model ref",
            row.idempotency_key,
          )
        : ok({
            kind: "ai-confirmed",
            userId: row.actor_user_id,
            modelRef: row.actor_model_ref,
          });
    default:
      return err(
        "CORRUPT_LEDGER",
        `stored actor_kind "${row.actor_kind}" is not a known actor kind`,
        row.idempotency_key,
      );
  }
}

function parseProvenance(row: InventoryTransactionRow): Outcome<Provenance> {
  if (!PROVENANCE_TIERS.includes(row.provenance_tier)) {
    return err(
      "CORRUPT_LEDGER",
      `stored provenance_tier "${row.provenance_tier}" is not a known tier`,
      row.idempotency_key,
    );
  }
  const confidence =
    row.provenance_confidence === null ? undefined : Number(row.provenance_confidence);
  if (confidence !== undefined && !Number.isFinite(confidence)) {
    return err(
      "CORRUPT_LEDGER",
      "stored provenance_confidence is not a number",
      row.idempotency_key,
    );
  }
  return ok({
    tier: row.provenance_tier as ProvenanceTier,
    source: row.provenance_source,
    ...(confidence === undefined ? {} : { confidence }),
    ...(row.provenance_model_ref === null ? {} : { modelRef: row.provenance_model_ref }),
    ...(row.provenance_observed_at === null
      ? {}
      : { observedAt: toInstant(row.provenance_observed_at) }),
    ...(row.provenance_confirmed_by === null ? {} : { confirmedBy: row.provenance_confirmed_by }),
  });
}

function parseCorrelationRef(row: InventoryTransactionRow): Outcome<CorrelationRef | undefined> {
  if (row.correlation_kind === null && row.correlation_id === null) return ok(undefined);
  if (row.correlation_kind === null || row.correlation_id === null) {
    return err(
      "CORRUPT_LEDGER",
      "stored correlation reference is half-populated",
      row.idempotency_key,
    );
  }
  if (!CORRELATION_KINDS.includes(row.correlation_kind)) {
    return err(
      "CORRUPT_LEDGER",
      `stored correlation_kind "${row.correlation_kind}" is not a known kind`,
      row.idempotency_key,
    );
  }
  return ok({ kind: row.correlation_kind as CorrelationRef["kind"], id: row.correlation_id });
}

function parseSystemFlag(row: InventoryTransactionRow): Outcome<SystemFlag | undefined> {
  if (row.system_flag_kind === null) return ok(undefined);
  if (row.system_flag_kind !== "OVER_CONSUMPTION") {
    return err(
      "CORRUPT_LEDGER",
      `stored system_flag_kind "${row.system_flag_kind}" is not a known flag`,
      row.idempotency_key,
    );
  }
  const residual = row.system_flag_residual_micros;
  if (
    residual === null ||
    !BIGINT_TEXT.test(residual) ||
    row.system_flag_caused_by_sequence === null ||
    row.system_flag_caused_by_idempotency_key === null
  ) {
    return err("CORRUPT_LEDGER", "stored system flag is incomplete", row.idempotency_key);
  }
  const residualMicros = BigInt(residual);
  return ok({
    kind: "OVER_CONSUMPTION",
    residualMicros,
    // Derived exactly the way the ledger derives it, so a rehydrated clamp is
    // indistinguishable from the one `appendTransaction` returned.
    residual: microsToAmount(residualMicros),
    causedBySequence: row.system_flag_caused_by_sequence,
    causedByIdempotencyKey: row.system_flag_caused_by_idempotency_key,
  });
}

/**
 * Converts one stored row to a {@link RecordedTransaction}.
 *
 * Only structural/enum decoding happens here. Whether the row is one the ledger
 * could have produced — delta agreement, sign, the unforgeable system marker —
 * is `rehydrateInventoryItem`'s judgement, and it is left to make it.
 */
export function toRecordedTransaction(row: InventoryTransactionRow): Outcome<RecordedTransaction> {
  if (!(TRANSACTION_TYPES as readonly string[]).includes(row.type)) {
    return err(
      "CORRUPT_LEDGER",
      `stored type "${row.type}" is not a transaction type`,
      row.idempotency_key,
    );
  }
  if (!BIGINT_TEXT.test(row.qty_delta_micros)) {
    return err(
      "CORRUPT_LEDGER",
      `stored qty_delta_micros "${row.qty_delta_micros}" is not an integer`,
      row.idempotency_key,
    );
  }

  const actor = parseActor(row);
  if (!actor.ok) return actor;
  const provenance = parseProvenance(row);
  if (!provenance.ok) return provenance;
  const correlationRef = parseCorrelationRef(row);
  if (!correlationRef.ok) return correlationRef;
  const systemFlag = parseSystemFlag(row);
  if (!systemFlag.ok) return systemFlag;

  return ok({
    itemId: row.item_id,
    sequence: row.sequence,
    lotId: row.lot_id,
    type: row.type as TransactionType,
    qtyDelta: Number(row.qty_delta),
    qtyDeltaMicros: BigInt(row.qty_delta_micros),
    unit: row.unit,
    actor: actor.value,
    occurredAt: toInstant(row.occurred_at),
    recordedAt: toInstant(row.recorded_at),
    provenance: provenance.value,
    idempotencyKey: row.idempotency_key,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(correlationRef.value === undefined ? {} : { correlationRef: correlationRef.value }),
    ...(systemFlag.value === undefined ? {} : { systemFlag: systemFlag.value }),
  });
}

/** Decodes the `storage_location` column, rejecting values outside the enum. */
export function toStorageLocation(value: string | null): Outcome<StorageLocation | undefined> {
  if (value === null) return ok(undefined);
  return STORAGE_LOCATIONS.includes(value)
    ? ok(value as StorageLocation)
    : err("CORRUPT_LEDGER", `stored storage_location "${value}" is not a known location`, value);
}

/** Decodes the lot `expiry_tier` column, rejecting values outside the enum. */
export function toExpiryTier(value: string | null): Outcome<ProvenanceTier | undefined> {
  if (value === null) return ok(undefined);
  return PROVENANCE_TIERS.includes(value)
    ? ok(value as ProvenanceTier)
    : err("CORRUPT_LEDGER", `stored expiry_tier "${value}" is not a known tier`, value);
}
