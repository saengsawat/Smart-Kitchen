/**
 * Fixture builders for the inventory database suites (M1-T2).
 *
 * These write rows with **raw SQL**, deliberately bypassing the repository and
 * the domain. The constraint suites exist to prove what the database refuses
 * on its own — a test that could only insert rows the domain already approved
 * would be testing the domain a second time, not the schema.
 */

import { randomUUID } from "node:crypto";
import type { ClientBase, Pool } from "pg";

export interface SeededItem {
  readonly itemId: string;
  readonly lotId: string;
  readonly unit: string;
}

/** Creates an item with one open lot, as the owner role. */
export async function seedItem(
  pool: Pool,
  householdId: string,
  unit = "lb",
  storageLocation: string | null = "FRIDGE",
): Promise<SeededItem> {
  const itemId = randomUUID();
  const lotId = randomUUID();
  await pool.query(
    `INSERT INTO inventory_items (id, household_id, unit, storage_location)
     VALUES ($1, $2, $3, $4)`,
    [itemId, householdId, unit, storageLocation],
  );
  await pool.query(`INSERT INTO inventory_lots (id, household_id, item_id) VALUES ($1, $2, $3)`, [
    lotId,
    householdId,
    itemId,
  ]);
  return { itemId, lotId, unit };
}

/** Opens an extra lot on an existing item. */
export async function seedLot(pool: Pool, householdId: string, itemId: string): Promise<string> {
  const lotId = randomUUID();
  await pool.query(`INSERT INTO inventory_lots (id, household_id, item_id) VALUES ($1, $2, $3)`, [
    lotId,
    householdId,
    itemId,
  ]);
  return lotId;
}

export interface RawTransactionContext {
  readonly householdId: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly userId: string;
  readonly unit?: string;
}

/** Every column of `inventory_transactions`, with a valid PURCHASE as the default. */
export function rawTransactionRow(
  context: RawTransactionContext,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    household_id: context.householdId,
    item_id: context.itemId,
    lot_id: context.lotId,
    sequence: 1,
    type: "PURCHASE",
    qty_delta: "2",
    qty_delta_micros: "2000000",
    unit: context.unit ?? "lb",
    reason: null,
    actor_kind: "user",
    actor_user_id: context.userId,
    actor_component: null,
    actor_model_ref: null,
    occurred_at: "2026-03-06T18:00:00.000Z",
    recorded_at: "2026-03-06T18:00:01.000Z",
    provenance_tier: "KNOWN_FACT",
    provenance_source: "manual-entry",
    provenance_confidence: null,
    provenance_model_ref: null,
    provenance_observed_at: null,
    provenance_confirmed_by: null,
    correlation_kind: null,
    correlation_id: null,
    idempotency_key: `raw-${randomUUID()}`,
    system_flag_kind: null,
    system_flag_residual_micros: null,
    system_flag_caused_by_sequence: null,
    system_flag_caused_by_idempotency_key: null,
    ...overrides,
  };
}

/**
 * Inserts a raw transaction row. Column names come from
 * {@link rawTransactionRow}'s fixed key set, never from test input, so building
 * the statement by interpolation is safe.
 */
export async function insertRawTransaction(
  executor: Pool | ClientBase,
  context: RawTransactionContext,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const row = rawTransactionRow(context, overrides);
  const columns = Object.keys(row);
  const placeholders = columns.map((_column, index) => `$${String(index + 1)}`);
  await executor.query(
    `INSERT INTO inventory_transactions (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    Object.values(row),
  );
}

/** Runs `work` and returns the error it threw, failing if it did not throw. */
export async function captureError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to be rejected by the database, but it succeeded");
}

/** Postgres error fields, for asserting *which* rule rejected a statement. */
export interface PgFailure {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
  readonly message: string;
}

export function pgFailure(error: unknown): PgFailure {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined,
    message: typeof candidate.message === "string" ? candidate.message : String(error),
  };
}
