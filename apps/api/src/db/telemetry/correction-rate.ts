/**
 * Correction-rate telemetry read path (M1-T7).
 *
 * `inventory_correction_telemetry` (migration 0007) is the all-time aggregate,
 * with no period argument. This module answers the period-bounded question a
 * dashboard actually asks ("this household's rate over the last week") by
 * re-running the *same* aggregate definitions as SQL over the base table,
 * `inventory_transactions`, filtered by `recorded_at` bounds — never by
 * loading rows and filtering or summing them in JavaScript. Counts come back
 * as exact integer text (parsed with `BigInt`, never `Number`) and the rate as
 * the Postgres `numeric` text Postgres computed, so nothing here re-derives or
 * rounds the KPI a second time.
 *
 * Like every other read in this package, this function takes an already-open
 * `client` and does no session setup of its own: the caller is expected to be
 * inside `withHouseholdTransaction` (session.ts), which is what makes the
 * row-level security policies from migration 0006 apply. There is no query
 * path here that can run without that context (data-model.md §5).
 */

import type { ClientBase } from "pg";

/** Inclusive/exclusive bounds applied to `inventory_transactions.recorded_at`. */
export interface CorrectionTelemetryPeriod {
  /** `recorded_at >= since` (inclusive). Omit for no lower bound. */
  readonly since?: string;
  /** `recorded_at < until` (exclusive). Omit for no upper bound. */
  readonly until?: string;
}

/**
 * One aggregate over the correction-telemetry definitions in migration 0007:
 * `statement_count`, `user_adjustment_count`, `clamp_count`,
 * `correction_event_count`, `correction_rate`, `first_recorded_at` and
 * `last_recorded_at` — see the migration header for exactly what each counts.
 */
export interface CorrectionTelemetryTotals {
  readonly statementCount: bigint;
  readonly userAdjustmentCount: bigint;
  readonly clampCount: bigint;
  readonly correctionEventCount: bigint;
  /** The Postgres `numeric` text Postgres computed, or `null` when there were no statements to divide by. */
  readonly correctionRate: string | null;
  /** ISO-8601, or `null` when there are no rows in scope. */
  readonly firstRecordedAt: string | null;
  /** ISO-8601, or `null` when there are no rows in scope. */
  readonly lastRecordedAt: string | null;
}

/** A {@link CorrectionTelemetryTotals} for one item within the household. */
export interface CorrectionTelemetryItemRow extends CorrectionTelemetryTotals {
  readonly itemId: string;
}

/** The result of {@link readCorrectionTelemetry}. */
export interface CorrectionTelemetryResult {
  /** Aggregate over every item of the household, within the requested period. */
  readonly household: CorrectionTelemetryTotals;
  /** Per-item breakdown, within the same period. Never includes another household's items — see the tenancy tests. */
  readonly items: readonly CorrectionTelemetryItemRow[];
}

/** Row shape shared by the household-level and per-item aggregate queries. */
interface AggregateRow {
  readonly statement_count: string;
  readonly user_adjustment_count: string;
  readonly clamp_count: string;
  readonly correction_event_count: string;
  readonly correction_rate: string | null;
  readonly first_recorded_at: Date | null;
  readonly last_recorded_at: Date | null;
}

interface ItemAggregateRow extends AggregateRow {
  readonly item_id: string;
}

/**
 * The same column definitions as `inventory_correction_telemetry` (migration
 * 0007), restated here rather than selected from the view because the view
 * carries no period argument — see this module's header.
 */
const AGGREGATE_COLUMNS = `
    count(*) FILTER (WHERE system_flag_kind IS NULL)                     AS statement_count,
    count(*) FILTER (WHERE type = 'ADJUSTMENT' AND actor_kind = 'user')  AS user_adjustment_count,
    count(*) FILTER (WHERE system_flag_kind = 'OVER_CONSUMPTION')        AS clamp_count,
    (
      count(*) FILTER (WHERE type = 'ADJUSTMENT' AND actor_kind = 'user')
      + count(*) FILTER (WHERE system_flag_kind = 'OVER_CONSUMPTION')
    )                                                                    AS correction_event_count,
    CASE
      WHEN count(*) FILTER (WHERE system_flag_kind IS NULL) = 0 THEN NULL
      ELSE (
        count(*) FILTER (WHERE type = 'ADJUSTMENT' AND actor_kind = 'user')
        + count(*) FILTER (WHERE system_flag_kind = 'OVER_CONSUMPTION')
      )::numeric / count(*) FILTER (WHERE system_flag_kind IS NULL)
    END                                                                  AS correction_rate,
    min(recorded_at)                                                    AS first_recorded_at,
    max(recorded_at)                                                    AS last_recorded_at`;

/** `since`/`until` filter, NULL-safe so an omitted bound imposes no constraint. */
const PERIOD_FILTER = `
    AND ($2::timestamptz IS NULL OR recorded_at >= $2::timestamptz)
    AND ($3::timestamptz IS NULL OR recorded_at < $3::timestamptz)`;

function toTotals(row: AggregateRow): CorrectionTelemetryTotals {
  return {
    statementCount: BigInt(row.statement_count),
    userAdjustmentCount: BigInt(row.user_adjustment_count),
    clampCount: BigInt(row.clamp_count),
    correctionEventCount: BigInt(row.correction_event_count),
    correctionRate: row.correction_rate,
    firstRecordedAt: row.first_recorded_at === null ? null : row.first_recorded_at.toISOString(),
    lastRecordedAt: row.last_recorded_at === null ? null : row.last_recorded_at.toISOString(),
  };
}

/**
 * Reads correction-rate telemetry for one household, optionally bounded to a
 * period over `recorded_at` (`since` inclusive, `until` exclusive).
 *
 * Two queries, not one: the household total must be present even when the
 * household has no matching rows at all (an aggregate with no GROUP BY always
 * returns exactly one row — its counts are simply zero), whereas the per-item
 * breakdown must correctly return zero rows in that case. A single
 * `GROUP BY household_id, item_id` cannot produce both shapes at once without
 * either fabricating an item-shaped household row or losing the always-present
 * household total when there is nothing to group.
 */
export async function readCorrectionTelemetry(
  client: ClientBase,
  householdId: string,
  period: CorrectionTelemetryPeriod = {},
): Promise<CorrectionTelemetryResult> {
  const since = period.since ?? null;
  const until = period.until ?? null;

  const householdResult = await client.query<AggregateRow>(
    `SELECT${AGGREGATE_COLUMNS}
       FROM inventory_transactions
      WHERE household_id = $1${PERIOD_FILTER}`,
    [householdId, since, until],
  );
  const householdRow = householdResult.rows[0];
  /* c8 ignore next 3 -- an aggregate with no GROUP BY always returns one row */
  if (householdRow === undefined) {
    throw new Error("correction-telemetry household aggregate returned no row");
  }

  const itemsResult = await client.query<ItemAggregateRow>(
    `SELECT item_id,${AGGREGATE_COLUMNS}
       FROM inventory_transactions
      WHERE household_id = $1${PERIOD_FILTER}
      GROUP BY item_id
      ORDER BY item_id`,
    [householdId, since, until],
  );

  return {
    household: toTotals(householdRow),
    items: itemsResult.rows.map((row) => ({ itemId: row.item_id, ...toTotals(row) })),
  };
}
