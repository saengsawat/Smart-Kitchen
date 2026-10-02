-- M2-T6 (D-024 row 1): moving an item between storage locations, as its own
-- append-only record.
--
-- Approved by the architect for throwaway and CI databases only (CLAUDE.md
-- rule 16, BACKLOG.md M2-T6). Nothing here rewrites or deletes existing data.
--
-- WHY A TABLE. Location is an attribute of an item, not a quantity (ADR-008:
-- the ledger carries quantities only, and a move is not a transaction). The
-- attribute is `inventory_items.storage_location`, which `sk_app` may already
-- UPDATE (0006). Updating it in place would lose the fact that the item was
-- ever somewhere else, so every move also inserts one row here, in the same
-- database transaction as the column update: who moved it, from where, to
-- where, when. The detail read merges these rows into the item's history by
-- time. No quantity is stored here, and a move writes no ledger row at all.
--
-- WHAT UP DOES
--
-- 1. Creates `inventory_item_moves`:
--      * `item_id` with its household as a composite foreign key to
--        `inventory_items (household_id, id)`, so a move can never name
--        another household's item.
--      * `from_location` and `to_location`: the same four-value enum as
--        `inventory_items.storage_location`, with a CHECK that they differ
--        (a move that goes nowhere is not recorded). `from_location` is
--        nullable because an item may have been stored with no location
--        (the column is nullable in 0003); a first move out of "Unassigned"
--        records NULL as the source.
--      * `moved_by`: the acting user, as a composite foreign key to
--        `household_memberships (household_id, user_id)`, so only a member of
--        the item's own household can be recorded as having moved it.
--      * `client_key`: the request's idempotency key (the M2-T2 key shape),
--        `UNIQUE (household_id, item_id, client_key)`: a retry of the same
--        request finds its own row and inserts nothing.
--      * `occurred_at` defaults to `clock_timestamp()`, not `now()`, so a
--        stamp taken after waiting on the item lock is the time it was
--        actually taken (the M2-T3a lesson).
-- 2. Append-only, both layers, like the ledger and 0010: `sk_app` gets SELECT
--    and INSERT and nothing else, and a trigger refuses UPDATE, DELETE and
--    TRUNCATE for every role, the owner included.
-- 3. Row-level security with the 0006 shape.
--
-- WHAT DOWN DOES
--
-- Revokes the grants, drops the policy and the table (its triggers go with
-- it) and both trigger functions. Every recorded move is lost with the table;
-- the items keep whatever `storage_location` they hold now, and the ledger is
-- untouched in both directions.

-- Up Migration

CREATE TABLE inventory_item_moves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL,
  item_id        uuid NOT NULL,
  from_location  text CHECK (from_location IN ('FRIDGE', 'FREEZER', 'PANTRY', 'OTHER')),
  to_location    text NOT NULL CHECK (to_location IN ('FRIDGE', 'FREEZER', 'PANTRY', 'OTHER')),
  moved_by       uuid NOT NULL,
  -- The client key shape every M2-T2 write uses.
  client_key     text NOT NULL CHECK (client_key ~ '^[A-Za-z0-9._-]{1,128}$'),
  occurred_at    timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT inventory_item_moves_item_fkey
    FOREIGN KEY (household_id, item_id)
    REFERENCES inventory_items (household_id, id),
  CONSTRAINT inventory_item_moves_moved_by_fkey
    FOREIGN KEY (household_id, moved_by)
    REFERENCES household_memberships (household_id, user_id),
  CONSTRAINT inventory_item_moves_goes_somewhere
    CHECK (from_location IS DISTINCT FROM to_location),
  -- Household-scoped, like every key in this schema: a probe with another
  -- household's item id and key can never collide with a row here.
  CONSTRAINT inventory_item_moves_client_key_key
    UNIQUE (household_id, item_id, client_key)
);

COMMENT ON TABLE inventory_item_moves IS
  'One row per move of an item between storage locations (M2-T6, D-024 row 1). Append-only; written in the same transaction as the inventory_items.storage_location update. Never carries a quantity, and a move writes no ledger row.';

-- Read path: an item's moves, for the detail history.
CREATE INDEX inventory_item_moves_item_idx
  ON inventory_item_moves (household_id, item_id, occurred_at);

-- --- Append-only ----------------------------------------------------------------

CREATE FUNCTION inventory_item_moves_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'inventory_item_moves is append-only (D-024, ADR-008): % is not permitted',
    TG_OP
    USING ERRCODE = '0A000';
END
$$;

CREATE TRIGGER inventory_item_moves_no_mutation
  BEFORE UPDATE OR DELETE ON inventory_item_moves
  FOR EACH ROW EXECUTE FUNCTION inventory_item_moves_append_only();

CREATE TRIGGER inventory_item_moves_no_truncate
  BEFORE TRUNCATE ON inventory_item_moves
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_item_moves_append_only();

-- --- Tenancy --------------------------------------------------------------------

ALTER TABLE inventory_item_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_item_moves_current ON inventory_item_moves
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

GRANT SELECT, INSERT ON inventory_item_moves TO sk_app;

-- Down Migration

REVOKE ALL ON inventory_item_moves FROM sk_app;
DROP POLICY inventory_item_moves_current ON inventory_item_moves;
DROP TABLE inventory_item_moves;
DROP FUNCTION inventory_item_moves_append_only();
