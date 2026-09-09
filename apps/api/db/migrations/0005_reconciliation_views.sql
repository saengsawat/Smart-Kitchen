-- M1-T2 — reconciliation: the SQL mirror of the domain's `reconcile()`
-- (packages/domain/src/inventory/derive.ts), data-model.md §3.
--
-- These views re-derive every quantity from the ledger and compare it with the
-- maintained snapshot, exactly as `reconcile()` does in memory. They exist for
-- three jobs: the invariant test that proves the two agree on generated data
-- (INV-LEDGER-1 at the database boundary), the drift alarm data-model.md §3
-- calls for, and the correction-rate telemetry the KPI needs (a query over
-- `system_flag_kind = 'OVER_CONSUMPTION'` rows).
--
-- `security_invoker = true` is not optional. A view runs with its *owner's*
-- permissions by default, and its owner here is the migration role — so a
-- default view would hand `sk_app` a clean read straight past every row-level
-- security policy in 0006. With security_invoker the policies of the querying
-- role apply, and the views are as household-isolated as the tables beneath
-- them. (Tested: tenancy suite reads the views as `sk_app`.)

-- Up Migration

CREATE VIEW inventory_lot_reconciliation
WITH (security_invoker = true) AS
SELECT
  l.household_id,
  l.item_id,
  l.id                                        AS lot_id,
  l.current_qty_micros                        AS snapshot_micros,
  COALESCE(d.derived_micros, 0)               AS derived_micros,
  l.current_qty_micros - COALESCE(d.derived_micros, 0) AS drift_micros,
  (l.current_qty_micros < 0)                  AS negative,
  COALESCE(d.transaction_count, 0)            AS transaction_count,
  (l.current_qty_micros = COALESCE(d.derived_micros, 0) AND l.current_qty_micros >= 0) AS ok
FROM inventory_lots AS l
LEFT JOIN (
  SELECT lot_id,
         SUM(qty_delta_micros)::bigint AS derived_micros,
         COUNT(*)                      AS transaction_count
    FROM inventory_transactions
   GROUP BY lot_id
) AS d ON d.lot_id = l.id;

COMMENT ON VIEW inventory_lot_reconciliation IS
  'Per-lot snapshot vs Σ deltas (INV-LEDGER-1). Mirrors LotReconciliation in packages/domain.';

CREATE VIEW inventory_reconciliation
WITH (security_invoker = true) AS
SELECT
  i.household_id,
  i.id                                        AS item_id,
  i.current_qty_micros                        AS snapshot_micros,
  COALESCE(d.derived_micros, 0)               AS derived_micros,
  i.current_qty_micros - COALESCE(d.derived_micros, 0) AS drift_micros,
  (i.current_qty_micros < 0)                  AS negative,
  COALESCE(d.transaction_count, 0)            AS transaction_count,
  i.next_sequence,
  (
    -- snapshot == Σ deltas
    i.current_qty_micros = COALESCE(d.derived_micros, 0)
    -- never negative
    AND i.current_qty_micros >= 0
    -- sequences are a contiguous 1..n and next_sequence follows them, which is
    -- what rehydrateInventoryItem demands of stored history. UNIQUE(item_id,
    -- sequence) already forbids repeats, so "max == count" forbids gaps.
    AND COALESCE(d.max_sequence, 0) = COALESCE(d.transaction_count, 0)
    AND i.next_sequence = COALESCE(d.transaction_count, 0) + 1
    -- every lot of this item reconciles too
    AND NOT EXISTS (
      SELECT 1 FROM inventory_lot_reconciliation AS lr
       WHERE lr.item_id = i.id AND NOT lr.ok
    )
  ) AS ok
FROM inventory_items AS i
LEFT JOIN (
  SELECT item_id,
         SUM(qty_delta_micros)::bigint AS derived_micros,
         COUNT(*)                      AS transaction_count,
         MAX(sequence)                 AS max_sequence
    FROM inventory_transactions
   GROUP BY item_id
) AS d ON d.item_id = i.id;

COMMENT ON VIEW inventory_reconciliation IS
  'Per-item snapshot vs Σ deltas plus sequence contiguity (INV-LEDGER-1). Mirrors ReconciliationReport in packages/domain; `ok` false ⇒ drift ⇒ alert + repair with a flagged ADJUSTMENT, never a silent overwrite (data-model.md §3).';

-- Down Migration

DROP VIEW inventory_reconciliation;
DROP VIEW inventory_lot_reconciliation;
