-- M2-T5 (D-028): a user's confirmation of an AI-interpreted ledger row, as its
-- own append-only record.
--
-- Approved by the architect for throwaway and CI databases only (CLAUDE.md
-- rule 16, BACKLOG.md M2-T5). Nothing here rewrites or deletes existing data.
--
-- WHY A TABLE. A confirmation is a fact about a ledger row that arrives after
-- the row was written. `inventory_transactions` is append-only for every role
-- (0004 trigger, 0006 grants, INV-LEDGER-2), so the row itself can never learn
-- that it was confirmed, and a zero-delta "confirmation" transaction is refused
-- by `qty_nonzero`. So the confirmation lives here, one row per confirmed ledger
-- row, and the read paths join it: a confirmed AI_INTERPRETATION row presents
-- as KNOWN_FACT with "{original source} · confirmed by {initials}" without the
-- ledger row changing by a single byte. No quantity is stored here at all.
--
-- WHAT UP DOES
--
-- 1. Adds `UNIQUE (household_id, item_id, id)` to `inventory_transactions`, so
--    a confirmation can point at a ledger row with a composite foreign key
--    that carries the household and the item (the 0003 trick). `id` is
--    already the primary key, so the triple is unique by construction; the
--    constraint only exists to be referenced. No row is read or written.
-- 2. Creates `inventory_confirmations`:
--      * `transaction_id` with its household and item: the composite foreign
--        key means a confirmation can never name another household's row, or
--        a row of a different item than the one it says it confirms.
--      * `confirmed_by`: the confirming user, as a composite foreign key to
--        `household_memberships (household_id, user_id)`, so only a member of
--        the row's own household can be recorded as having confirmed it.
--      * `model_ref`: copied from the confirmed row's `provenance_model_ref`,
--        nullable because a row may carry none (the seeded receipt rows do not).
--      * `client_key`: the request's client key, the M2-T2 key shape. Recorded
--        for the audit trail; idempotency comes from the next point, not from
--        the key.
--      * `UNIQUE (household_id, transaction_id)`: a ledger row is confirmed at
--        most once, whoever confirms it and under whatever key. A second
--        confirm finds nothing left to insert.
--      * `confirmed_at` defaults to `clock_timestamp()`, not `now()`, so a stamp
--        taken after waiting on the item lock is the time it was actually taken
--        (the M2-T3a lesson).
-- 3. A trigger that refuses a confirmation of any row whose tier is not
--    AI_INTERPRETATION: a confirmation never promotes an ESTIMATED or an
--    already-known row. Invoker rights, so under `sk_app` it sees only the
--    session's household, which is the only household the policy lets it
--    insert into anyway.
-- 4. Append-only, both layers, like the ledger: `sk_app` gets SELECT and
--    INSERT and nothing else, and a trigger refuses UPDATE, DELETE and
--    TRUNCATE for every role, the owner included.
-- 5. Row-level security with the 0006 shape.
--
-- WHAT DOWN DOES
--
-- Revokes the grants, drops the policy, the table (its triggers go with it),
-- both trigger functions and the ledger constraint added in step 1. Every
-- recorded confirmation is lost with the table: the confirmed items read as
-- AI_INTERPRETATION again, which is what their ledger rows always said. The
-- ledger itself is untouched in both directions.

-- Up Migration

ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_household_item_id_key UNIQUE (household_id, item_id, id);

CREATE TABLE inventory_confirmations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL,
  item_id         uuid NOT NULL,
  transaction_id  uuid NOT NULL,
  confirmed_by    uuid NOT NULL,
  model_ref       text CHECK (model_ref IS NULL OR btrim(model_ref) <> ''),
  -- The client key shape every M2-T2 write uses.
  client_key      text NOT NULL CHECK (client_key ~ '^[A-Za-z0-9._-]{1,128}$'),
  confirmed_at    timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT inventory_confirmations_transaction_fkey
    FOREIGN KEY (household_id, item_id, transaction_id)
    REFERENCES inventory_transactions (household_id, item_id, id),
  CONSTRAINT inventory_confirmations_confirmed_by_fkey
    FOREIGN KEY (household_id, confirmed_by)
    REFERENCES household_memberships (household_id, user_id),
  -- Household-scoped, like every key in this schema: a probe with another
  -- household's transaction id can never collide with a row here.
  CONSTRAINT inventory_confirmations_transaction_key
    UNIQUE (household_id, transaction_id)
);

COMMENT ON TABLE inventory_confirmations IS
  'One row per AI_INTERPRETATION ledger row a member confirmed (M2-T5, D-028). Append-only; the read paths present a confirmed row as KNOWN_FACT. Never carries a quantity.';

-- Read path: an item's confirmations, for the detail history.
CREATE INDEX inventory_confirmations_item_idx
  ON inventory_confirmations (household_id, item_id);

-- --- Only an AI_INTERPRETATION row can be confirmed -----------------------------

CREATE FUNCTION inventory_confirmations_ai_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Invoker rights: under `sk_app` the policies also apply, so only the
  -- session's own household is visible here, on top of the explicit filter.
  -- A row that does not exist in this household and item is refused here or
  -- by the composite foreign key, whichever fires first; either way nothing
  -- is inserted.
  IF NOT EXISTS (
    SELECT 1 FROM inventory_transactions AS t
     WHERE t.household_id = NEW.household_id
       AND t.item_id = NEW.item_id
       AND t.id = NEW.transaction_id
       AND t.provenance_tier = 'AI_INTERPRETATION'
  ) THEN
    RAISE EXCEPTION 'only an AI_INTERPRETATION ledger row can be confirmed (D-028)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER inventory_confirmations_ai_only
  AFTER INSERT ON inventory_confirmations
  FOR EACH ROW EXECUTE FUNCTION inventory_confirmations_ai_only();

-- --- Append-only ----------------------------------------------------------------

CREATE FUNCTION inventory_confirmations_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'inventory_confirmations is append-only (D-028, ADR-008): % is not permitted',
    TG_OP
    USING ERRCODE = '0A000';
END
$$;

CREATE TRIGGER inventory_confirmations_no_mutation
  BEFORE UPDATE OR DELETE ON inventory_confirmations
  FOR EACH ROW EXECUTE FUNCTION inventory_confirmations_append_only();

CREATE TRIGGER inventory_confirmations_no_truncate
  BEFORE TRUNCATE ON inventory_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_confirmations_append_only();

-- --- Tenancy --------------------------------------------------------------------

ALTER TABLE inventory_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_confirmations_current ON inventory_confirmations
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

GRANT SELECT, INSERT ON inventory_confirmations TO sk_app;

-- Down Migration

REVOKE ALL ON inventory_confirmations FROM sk_app;
DROP POLICY inventory_confirmations_current ON inventory_confirmations;
DROP TABLE inventory_confirmations;
DROP FUNCTION inventory_confirmations_append_only();
DROP FUNCTION inventory_confirmations_ai_only();
ALTER TABLE inventory_transactions DROP CONSTRAINT inventory_transactions_household_item_id_key;
