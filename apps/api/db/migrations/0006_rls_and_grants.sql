-- M1-T2 — tenancy isolation: row-level security + the runtime role's grants
-- (data-model.md §5, NFR-1, INV-TENANT-1). This migration is the RLS spike
-- ADR-003 left open; the evidence for the decision is the tenancy test suite.
--
-- THE MODEL. Every household-scoped table carries `household_id` and is guarded
-- by a policy comparing it to a per-request setting, `app.household_id`, which
-- the API sets with `set_config(..., true)` (transaction-local) at the start of
-- each request transaction. Unset ⇒ the helper returns NULL ⇒ every comparison
-- is NULL ⇒ nothing is visible and nothing can be written. Isolation therefore
-- fails **closed**: a code path that forgets to establish household context
-- reads zero rows rather than everyone's rows.
--
-- WHY BOTH LAYERS. data-model.md §5 already requires the app-layer rule (every
-- repository function takes a mandatory household context). RLS is defence in
-- depth for the case that rule is broken by a bug — which is precisely the case
-- NFR-1's "cannot" is about, as opposed to "should not". The cost the ADR
-- worried about (ORM friction) does not apply: this schema is driven by raw
-- SQL with a thin mapper, and the only accommodation needed anywhere was
-- `security_invoker` on the reconciliation views (0005).
--
-- WHO IS EXEMPT. Policies bind every role except the table owner and
-- superusers. The migration role and the CI test harness therefore see
-- everything — deliberately, so fixtures can be seeded across households and
-- then read back as `sk_app` to prove the isolation. `FORCE ROW LEVEL
-- SECURITY` is not set: it would also subject the SECURITY DEFINER ledger
-- trigger to the policies, making a correct append depend on the caller's
-- session setting rather than on the row's own foreign keys.

-- Up Migration

CREATE FUNCTION app_current_household() RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.household_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app_current_household() IS
  'Household context for the current request transaction, set with set_config(''app.household_id'', <uuid>, true). NULL when unset — every policy then denies.';

-- --- Policies -------------------------------------------------------------

ALTER TABLE households ENABLE ROW LEVEL SECURITY;
CREATE POLICY households_current ON households
  USING (id = app_current_household())
  WITH CHECK (id = app_current_household());

ALTER TABLE household_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_memberships_current ON household_memberships
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

-- `users` is not household-scoped, so it gets the nearest equivalent: a user
-- row is visible only to a session whose household the user belongs to.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_shared_household ON users
  USING (EXISTS (
    SELECT 1 FROM household_memberships AS m
     WHERE m.user_id = users.id
       AND m.household_id = app_current_household()
  ));

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_items_current ON inventory_items
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_lots_current ON inventory_lots
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_transactions_current ON inventory_transactions
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

-- --- Runtime role privileges ----------------------------------------------
--
-- The append-only guarantee is expressed here first and as a trigger second:
-- `sk_app` is granted INSERT and SELECT on inventory_transactions and nothing
-- else, ever. UPDATE and DELETE are not withheld pending a hardening
-- milestone — they are simply never granted.
--
-- Snapshot columns are excluded from the UPDATE grants by listing the mutable
-- columns explicitly. `sk_app` literally cannot write current_qty_micros,
-- current_qty or next_sequence; only the SECURITY DEFINER ledger trigger can.

GRANT SELECT ON users, households, household_memberships TO sk_app;

GRANT SELECT, INSERT ON inventory_items, inventory_lots TO sk_app;
GRANT SELECT, INSERT ON inventory_transactions TO sk_app;

GRANT UPDATE (display_name, storage_location, product_ref, ingredient_ref)
  ON inventory_items TO sk_app;
GRANT UPDATE (label, acquired_at, expires_at, expiry_tier)
  ON inventory_lots TO sk_app;

GRANT SELECT ON inventory_reconciliation, inventory_lot_reconciliation TO sk_app;

GRANT EXECUTE ON FUNCTION app_current_household() TO sk_app;

-- Down Migration

REVOKE ALL ON inventory_reconciliation, inventory_lot_reconciliation FROM sk_app;
REVOKE ALL ON inventory_transactions FROM sk_app;
REVOKE ALL ON inventory_lots FROM sk_app;
REVOKE ALL ON inventory_items FROM sk_app;
REVOKE ALL ON users, households, household_memberships FROM sk_app;
REVOKE ALL ON FUNCTION app_current_household() FROM sk_app;

DROP POLICY inventory_transactions_current ON inventory_transactions;
ALTER TABLE inventory_transactions DISABLE ROW LEVEL SECURITY;
DROP POLICY inventory_lots_current ON inventory_lots;
ALTER TABLE inventory_lots DISABLE ROW LEVEL SECURITY;
DROP POLICY inventory_items_current ON inventory_items;
ALTER TABLE inventory_items DISABLE ROW LEVEL SECURITY;
DROP POLICY users_shared_household ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
DROP POLICY household_memberships_current ON household_memberships;
ALTER TABLE household_memberships DISABLE ROW LEVEL SECURITY;
DROP POLICY households_current ON households;
ALTER TABLE households DISABLE ROW LEVEL SECURITY;

DROP FUNCTION app_current_household();
