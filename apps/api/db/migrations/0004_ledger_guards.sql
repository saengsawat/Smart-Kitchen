-- M1-T2 — ledger guards: sequence assignment, snapshot maintenance,
-- append-only enforcement, and the never-negative invariant.
--
-- SNAPSHOT MAINTENANCE DECISION (ADR-008's open question, M1-T1 §8.4).
-- data-model.md §3 left "application-level, or trigger" open. This schema
-- chooses **database trigger**, with the application transaction still doing
-- the domain computation:
--
--   * CLAUDE.md rule 10 says no code path may mutate quantities outside a
--     transaction append. As an application convention that is one forgotten
--     `UPDATE` away from being false — for the API, a future receipt importer,
--     a backfill script, or a person at a psql prompt. As a trigger it is
--     structurally true: inserting a ledger row is the *only* way a snapshot
--     can change, because `sk_app` holds no UPDATE privilege on the snapshot
--     columns at all (0006) and the trigger function is SECURITY DEFINER.
--   * It makes the update atomic with the append by construction, which is
--     what "same DB transaction" in the acceptance criteria actually asks for.
--   * It serialises concurrent appends to one item for free: the trigger's
--     `SELECT … FOR UPDATE` takes the item row lock, so a second concurrent
--     append blocks, then finds its sequence stale and is rejected with
--     `40001` (serialization_failure) for the caller to retry. An
--     application-level snapshot update would need that lock anyway, and
--     would silently corrupt the snapshot the day someone omitted it.
--
-- The application transaction still owns the *domain* decisions (whether a
-- decrease overshoots, what the clamp row contains) because those are
-- safety-critical arithmetic and belong in tested domain code, never in SQL
-- (CLAUDE.md rule 7). The trigger only maintains the derived totals and
-- enforces ordering — it never invents a row.

-- Up Migration

-- ---------------------------------------------------------------------------
-- Snapshot column guards.
--
-- Belt-and-braces behind the column-level grants in 0006: even a role that DOES
-- hold UPDATE on these tables (the owner, a migration, a future maintenance
-- job) cannot move a snapshot by hand. The transaction-local `sk.ledger_apply`
-- flag is set only by inventory_ledger_apply() below. It is not a security
-- boundary — privileges are — it is a mistake boundary.
-- ---------------------------------------------------------------------------

CREATE FUNCTION inventory_items_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('sk.ledger_apply', true) IS DISTINCT FROM 'on' THEN
    IF NEW.current_qty_micros IS DISTINCT FROM OLD.current_qty_micros
       OR NEW.current_qty IS DISTINCT FROM OLD.current_qty
       OR NEW.next_sequence IS DISTINCT FROM OLD.next_sequence
    THEN
      RAISE EXCEPTION
        'inventory_items snapshot columns are maintained by the ledger (ADR-008, CLAUDE.md rule 10); append a transaction instead'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Identity of an item never changes: its household and its unit are part of
  -- every transaction's foreign key, and re-pointing them would silently
  -- reinterpret recorded history.
  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR NEW.unit IS DISTINCT FROM OLD.unit THEN
    RAISE EXCEPTION 'inventory_items.household_id and .unit are immutable once the item exists'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER inventory_items_guard
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION inventory_items_guard();

CREATE FUNCTION inventory_lots_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('sk.ledger_apply', true) IS DISTINCT FROM 'on' THEN
    IF NEW.current_qty_micros IS DISTINCT FROM OLD.current_qty_micros
       OR NEW.current_qty IS DISTINCT FROM OLD.current_qty
    THEN
      RAISE EXCEPTION
        'inventory_lots snapshot columns are maintained by the ledger (ADR-008, CLAUDE.md rule 10); append a transaction instead'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.household_id IS DISTINCT FROM OLD.household_id OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'inventory_lots.household_id and .item_id are immutable once the lot exists'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER inventory_lots_guard
  BEFORE UPDATE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION inventory_lots_guard();

-- ---------------------------------------------------------------------------
-- The append: sequence validation + snapshot maintenance, in the same
-- statement as the insert.
--
-- SECURITY DEFINER so that `sk_app` — which has no UPDATE privilege on the
-- snapshot columns — can still cause them to move by appending. search_path is
-- pinned so the definer's privileges cannot be redirected at a shadowed object.
--
-- AFTER INSERT, deliberately, not BEFORE. A BEFORE trigger runs ahead of
-- row-level security's WITH CHECK, and this one is SECURITY DEFINER — so as a
-- BEFORE trigger it answered questions about rows the caller was not allowed to
-- touch: aiming an insert at another household's item id returned "sequence 1
-- is not item X's next sequence (7)", disclosing both the item's existence and
-- its ledger length before the policy ever rejected the write. Running AFTER
-- puts every policy and foreign key ahead of this code, so nothing here can
-- speak about a row the caller cannot see.
-- ---------------------------------------------------------------------------

CREATE FUNCTION inventory_ledger_apply() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_household_id  uuid;
  v_next_sequence integer;
BEGIN
  SELECT household_id, next_sequence
    INTO v_household_id, v_next_sequence
    FROM inventory_items
   WHERE id = NEW.item_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_transactions references unknown item %', NEW.item_id
      USING ERRCODE = '23503';
  END IF;

  -- The message names only values the caller already supplied. Echoing the
  -- item's real household would hand one tenant another tenant's identifier,
  -- read through a SECURITY DEFINER function that is not subject to the
  -- policies — currently unreachable (the composite foreign key rejects this
  -- row first) but one schema change away from being a disclosure.
  IF v_household_id <> NEW.household_id THEN
    RAISE EXCEPTION 'inventory_transactions for item % does not belong to the household it claims (%)',
      NEW.item_id, NEW.household_id
      USING ERRCODE = '23514';
  END IF;

  -- 1..n contiguity, per item. The unique index on (item_id, sequence) makes a
  -- collision impossible; this makes a *gap* impossible too, which is what
  -- rehydrateInventoryItem requires of stored history.
  IF NEW.sequence <> v_next_sequence THEN
    RAISE EXCEPTION 'inventory_transactions.sequence % is not item %''s next sequence (%)',
      NEW.sequence, NEW.item_id, v_next_sequence
      USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('sk.ledger_apply', 'on', true);

  UPDATE inventory_items
     SET current_qty_micros = current_qty_micros + NEW.qty_delta_micros,
         current_qty        = (current_qty_micros + NEW.qty_delta_micros)::numeric / 1000000,
         next_sequence      = next_sequence + 1
   WHERE id = NEW.item_id;

  UPDATE inventory_lots
     SET current_qty_micros = current_qty_micros + NEW.qty_delta_micros,
         current_qty        = (current_qty_micros + NEW.qty_delta_micros)::numeric / 1000000
   WHERE id = NEW.lot_id
     AND item_id = NEW.item_id;

  IF NOT FOUND THEN
    PERFORM set_config('sk.ledger_apply', 'off', true);
    RAISE EXCEPTION 'inventory_transactions references unknown lot % on item %', NEW.lot_id, NEW.item_id
      USING ERRCODE = '23503';
  END IF;

  PERFORM set_config('sk.ledger_apply', 'off', true);

  RETURN NEW;
END
$$;

CREATE TRIGGER inventory_transactions_apply
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION inventory_ledger_apply();

-- ---------------------------------------------------------------------------
-- Append-only (INV-LEDGER-2).
--
-- `sk_app` is never granted UPDATE or DELETE on this table, so for the runtime
-- role this is already impossible. The triggers make it impossible for the
-- owner and any future role as well: a recorded transaction is a fact, and
-- facts are corrected by appending an ADJUSTMENT, never by editing history.
-- ---------------------------------------------------------------------------

CREATE FUNCTION inventory_transactions_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'inventory_transactions is append-only (INV-LEDGER-2, ADR-008): % is not permitted; record a compensating ADJUSTMENT instead',
    TG_OP
    USING ERRCODE = '0A000';
END
$$;

CREATE TRIGGER inventory_transactions_no_mutation
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION inventory_transactions_append_only();

CREATE TRIGGER inventory_transactions_no_truncate
  BEFORE TRUNCATE ON inventory_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_transactions_append_only();

-- ---------------------------------------------------------------------------
-- INV-LEDGER-4: no committed state is ever negative, at lot or item level.
--
-- These are DEFERRABLE INITIALLY DEFERRED constraint triggers, and that is
-- load-bearing. An over-consuming decrease is recorded at its full stated
-- magnitude and compensated by a clamp ADJUSTMENT *in the same transaction*
-- (M1-T1); between those two inserts the snapshot is legitimately negative. A
-- plain CHECK would fire on the first insert and make the domain's settled
-- policy unimplementable. Deferring to COMMIT tests exactly what the invariant
-- says: no *committed* state is negative.
--
-- Each trigger re-reads the row rather than trusting NEW: a deferred trigger
-- carries the row image from the moment it was queued, not from commit time.
--
-- SECURITY DEFINER is load-bearing, not hygiene. As SECURITY INVOKER the
-- verification SELECT was itself filtered by the caller's row-level security
-- context, so a caller could clear or switch `app.household_id` before COMMIT,
-- make its own row invisible to the check, and have `NOT FOUND` wave a negative
-- balance through — INV-LEDGER-4 failing *open*, which is the worst way for a
-- safety invariant to fail. The check must see the row the way the database
-- sees it, not the way the caller is permitted to.
--
-- For the same reason `NOT FOUND` now raises instead of passing. With the
-- definer's view of the table there is no legitimate way for the row to be
-- missing except deletion inside the same transaction that moved it, which no
-- application path does and which we would want to hear about anyway. The
-- invariant fails closed.
-- ---------------------------------------------------------------------------

CREATE FUNCTION inventory_items_nonnegative() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_micros bigint;
BEGIN
  SELECT current_qty_micros INTO v_micros FROM inventory_items WHERE id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-LEDGER-4: item % disappeared before its non-negativity check could run',
      NEW.id
      USING ERRCODE = '23514';
  END IF;
  IF v_micros < 0 THEN
    RAISE EXCEPTION 'INV-LEDGER-4: item % would commit a negative quantity (% micro-units)',
      NEW.id, v_micros
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER inventory_items_nonnegative
  AFTER INSERT OR UPDATE ON inventory_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION inventory_items_nonnegative();

CREATE FUNCTION inventory_lots_nonnegative() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_micros bigint;
BEGIN
  SELECT current_qty_micros INTO v_micros FROM inventory_lots WHERE id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-LEDGER-4: lot % disappeared before its non-negativity check could run',
      NEW.id
      USING ERRCODE = '23514';
  END IF;
  IF v_micros < 0 THEN
    RAISE EXCEPTION 'INV-LEDGER-4: lot % would commit a negative quantity (% micro-units)',
      NEW.id, v_micros
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER inventory_lots_nonnegative
  AFTER INSERT OR UPDATE ON inventory_lots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION inventory_lots_nonnegative();

-- ---------------------------------------------------------------------------
-- Functions are EXECUTE-able by PUBLIC in Postgres by default. Trigger
-- functions cannot usefully be called directly, and privilege checks happen
-- when the trigger is created rather than when it fires, so revoking costs
-- nothing and removes a SECURITY DEFINER function from every role's reach.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION inventory_ledger_apply() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory_transactions_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory_items_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory_lots_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory_items_nonnegative() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory_lots_nonnegative() FROM PUBLIC;

-- Down Migration

DROP TRIGGER inventory_lots_nonnegative ON inventory_lots;
DROP FUNCTION inventory_lots_nonnegative();
DROP TRIGGER inventory_items_nonnegative ON inventory_items;
DROP FUNCTION inventory_items_nonnegative();
DROP TRIGGER inventory_transactions_no_truncate ON inventory_transactions;
DROP TRIGGER inventory_transactions_no_mutation ON inventory_transactions;
DROP FUNCTION inventory_transactions_append_only();
DROP TRIGGER inventory_transactions_apply ON inventory_transactions;
DROP FUNCTION inventory_ledger_apply();
DROP TRIGGER inventory_lots_guard ON inventory_lots;
DROP FUNCTION inventory_lots_guard();
DROP TRIGGER inventory_items_guard ON inventory_items;
DROP FUNCTION inventory_items_guard();
