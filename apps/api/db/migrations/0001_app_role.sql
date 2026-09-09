-- M1-T2 — the two-role story.
--
-- Two roles exist by design (data-model.md §5, CLAUDE.md rule 10):
--
--   * the *migration/owner* role — whatever identity runs these migrations. It
--     owns every object created here, so it bypasses RLS and can DDL. Nothing
--     in the running application ever connects as this role.
--   * `sk_app` — the *runtime* role the API connects as. It gets the narrowest
--     privileges that let it do its job: INSERT + SELECT on the ledger and
--     column-scoped UPDATE on mutable metadata. It is never granted UPDATE or
--     DELETE on `inventory_transactions`, and never granted UPDATE on any
--     snapshot column (see 0006).
--
-- `sk_app` is created NOLOGIN. Tests (and any future in-process job) assume it
-- with `SET ROLE sk_app`, which is what makes RLS apply: policies are evaluated
-- against the *current* role, and a non-superuser current role does not bypass
-- them. Giving the role a password would mean putting a credential in the repo
-- (CLAUDE.md rule 12); provisioning a LOGIN role with a real secret belongs to
-- deployment (M2).
--
-- Roles are cluster-scoped, not database-scoped, so the down migration
-- deliberately does NOT drop the role — a concurrent database in the same
-- cluster (as in the per-file test databases) may still be relying on it. Only
-- the privileges granted *inside this database* are revoked.

-- Up Migration

-- Create-and-tolerate rather than check-then-create. Roles live in a
-- cluster-wide catalog, so two databases in the same cluster migrating at the
-- same moment (which is exactly what the per-file test databases do) can both
-- pass an `IF NOT EXISTS` check and then collide on `pg_authid`. An advisory
-- lock cannot serialise it — advisory locks are per-database — so the race is
-- caught instead of prevented. Postgres reports the collision as either
-- `duplicate_object` or a raw unique violation depending on where the two
-- sessions cross, hence both.
DO $$
BEGIN
  CREATE ROLE sk_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN
    NULL;
END
$$;

GRANT USAGE ON SCHEMA public TO sk_app;

-- Down Migration

REVOKE USAGE ON SCHEMA public FROM sk_app;
