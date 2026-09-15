-- M1-T7 — correction-rate telemetry: the product's north-star KPI as a query.
-- (brief §18C; ARCHITECTURE.md §8 "Inventory correction rate"; M1-T1 review
-- "makes the correction-rate KPI a direct query"; M1-T2 worker §11 item 3.)
--
-- ONE ROW PER (household_id, item_id), over inventory_transactions:
--
--   statement_count         — rows that are NOT a system over-consumption
--                             clamp (system_flag_kind IS NULL). A "statement"
--                             is anything the household or an automated
--                             process asserted about the item's quantity.
--   user_adjustment_count   — type = 'ADJUSTMENT' AND actor_kind = 'user':
--                             a person manually correcting the system's belief.
--   clamp_count             — system_flag_kind = 'OVER_CONSUMPTION': the
--                             ledger's own residual-clamp row (0004), raised
--                             whenever a decrease overshot the balance on hand.
--   correction_event_count  — user_adjustment_count + clamp_count. A clamp row
--                             is always actor_kind = 'system' (the reserved-
--                             marker CHECK in 0003 pins that), so the two
--                             counts are disjoint and this sum never double
--                             counts a row.
--   correction_rate         — correction_event_count::numeric / statement_count,
--                             NULL when statement_count = 0 (no statements to
--                             divide by, not zero corrections).
--   first/last_recorded_at  — min/max recorded_at over ALL of the item's rows
--                             (statements and clamps alike), so the KPI can be
--                             read alongside "how long has this item existed".
--
-- This view carries no period argument — it is the all-time aggregate.
-- Bounded reads (since/until over recorded_at) are
-- apps/api/src/db/telemetry/correction-rate.ts's job, computed in SQL over
-- this same base table and definitions, never by filtering these rows in JS.
--
-- `security_invoker = true` is not optional, per ADR-003 standing rule 3 (see
-- 0005's header for the full argument): without it this view would read past
-- every row-level security policy in 0006 as its owner, handing `sk_app` every
-- household's correction data through a single unfiltered read. With it, the
-- querying role's own RLS context applies, so the view is exactly as
-- household-isolated as `inventory_transactions` itself.
--
-- Metric definition status: PROPOSED (architect records the ratified wording
-- in ARCHITECTURE.md §8 at ticket acceptance, per M1-T7's DoD). This worker
-- implements the ticket's definition verbatim and does not redefine it.

-- Up Migration

CREATE VIEW inventory_correction_telemetry
WITH (security_invoker = true) AS
SELECT
  household_id,
  item_id,
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
  min(recorded_at)                                                     AS first_recorded_at,
  max(recorded_at)                                                     AS last_recorded_at
FROM inventory_transactions
GROUP BY household_id, item_id;

COMMENT ON VIEW inventory_correction_telemetry IS
  'PROPOSED metric definition (M1-T7; architect to ratify in ARCHITECTURE.md §8): '
  'per (household_id, item_id) over inventory_transactions — statement_count = '
  'rows with system_flag_kind IS NULL; user_adjustment_count = type=ADJUSTMENT '
  'AND actor_kind=user; clamp_count = system_flag_kind=OVER_CONSUMPTION; '
  'correction_event_count = user_adjustment_count + clamp_count; correction_rate '
  '= correction_event_count / statement_count (NULL when statement_count = 0); '
  'first/last_recorded_at = min/max recorded_at over all of the item''s rows. '
  'This is the brief §18C north-star KPI (corrections ÷ statements). Read-only '
  'for sk_app (SELECT grant only) — see apps/api/src/db/telemetry for the '
  'period-bounded read function.';

GRANT SELECT ON inventory_correction_telemetry TO sk_app;

-- Down Migration

DROP VIEW inventory_correction_telemetry;
