-- M7-T1: the household's shopping list, and the record of every check-off
-- and add-to-inventory written against it.
--
-- Approved by the architect for local and CI databases only (CLAUDE.md rule
-- 16, BACKLOG.md M7-T1 (a)). Nothing here rewrites or deletes existing data.
--
-- WHAT UP DOES
--
-- 1. Adds `UNIQUE (household_id, id)` to `household_memberships`, so the new
--    tables can point at a member with a composite foreign key that carries
--    the household, the same trick 0003 uses for items. `id` is already the
--    primary key, so the pair is unique by construction; the constraint only
--    exists to be referenced. A shopping row can therefore never name a
--    member of another household as its origin, its checker or its remover.
-- 2. Creates `shopping_rows`: one row per thing to buy. One list per
--    household is implicit (the sketch's `shopping_lists` table waits for
--    named lists). Quantities are exact micros (`need_micros`, bigint), never
--    numeric or float; the gap to buy is not stored at all, because it is
--    computed on every read from the item's current snapshot by the domain's
--    `neededQuantity` (INV-SHOP-1), so it cannot go stale.
--      * `origin_kind` is text with a CHECK that admits only 'member' today;
--        menu and AI rows arrive in later migrations by widening the CHECK.
--      * `unit` is one of the contract units (`UNITS_BY_KIND_DTO`), checked
--        here so no writer can store a unit the client cannot draw.
--      * `item_id` is an optional composite foreign key to an item of the
--        same household. The row's unit is deliberately NOT tied to the
--        item's: a mismatch is allowed and the read answers it with nothing
--        on hand, never with a conversion.
--      * `status` is open, done or skipped. `skipped` is written only by a
--        removal, together with `removed_at` and `removed_by`; there is no
--        DELETE. "Already have enough" is a read-time status, not stored.
--      * `added_transaction_id` is the PURCHASE this row's add-to-inventory
--        appended. A trigger makes it write-once and checks that it names a
--        PURCHASE on the row's own item, correlated to this row. With
--        `generation` it is what makes the add land once per row: the ledger
--        key of that PURCHASE is derived from the row id and generation, and
--        the household-scoped idempotency index on the ledger is the backstop
--        behind the row lock the service takes.
--      * `created_at` and `updated_at` default to `clock_timestamp()`, not
--        `now()`, so rows inserted in one transaction keep their order and a
--        stamp taken after waiting on a lock is the time it was actually
--        taken (the M2-T3a lesson).
-- 3. Creates `shopping_row_writes`: one row per idempotency key the two
--    keyed writes (check and add) have seen, household-scoped exactly like
--    the ledger's key index (M2-T2 convention, same key shape). It is what
--    tells a replay (same key, same row, same payload, same caller: 200)
--    from a reused key (anything else: 409), and it doubles as the audit
--    trail of who checked what off and when. Insert-only for `sk_app`.
-- 4. A trigger on `shopping_rows` that freezes every column except the
--    status, check-off, purchase and removal columns, keeps a removed row
--    removed, makes `added_transaction_id` write-once and validates it, and
--    refuses an insert that claims a purchase already.
-- 5. Row-level security on both tables with the 0006 shape, and grants:
--    `sk_app` gets SELECT and INSERT on both, UPDATE of the mutable columns of
--    `shopping_rows` only, and no DELETE on either.
--
-- WHAT DOWN DOES
--
-- Drops the trigger and its function, the policies, the grants and both
-- tables (writes first, then rows), then the membership constraint. Every
-- shopping row and every recorded check-off is lost with the tables. PURCHASE
-- rows an add appended stay in the ledger, which is append-only and not this
-- migration's to touch; their `correlation_id` then names a row that no
-- longer exists, which is harmless (it is text, not a foreign key) and is
-- exactly what an audit of a rolled-back schema should still show. Re-running
-- up recreates empty tables; the dev seed writes the Chen rows again.

-- Up Migration

ALTER TABLE household_memberships
  ADD CONSTRAINT household_memberships_household_id_key UNIQUE (household_id, id);

CREATE TABLE shopping_rows (
  id                    uuid PRIMARY KEY,
  household_id          uuid NOT NULL REFERENCES households (id),
  name                  text NOT NULL
                        CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  group_label           text NOT NULL
                        CHECK (btrim(group_label) <> '' AND char_length(group_label) <= 60),
  origin_kind           text NOT NULL CHECK (origin_kind IN ('member')),
  origin_member_id      uuid,
  need_micros           bigint NOT NULL CHECK (need_micros > 0),
  unit                  text NOT NULL
                        CHECK (unit IN ('g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'each')),
  item_id               uuid,
  default_location      text NOT NULL
                        CHECK (default_location IN ('FRIDGE', 'FREEZER', 'PANTRY', 'OTHER')),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  checked_off_by        uuid,
  checked_off_at        timestamptz,
  added_transaction_id  uuid,
  generation            integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  removed_at            timestamptz,
  removed_by            uuid,
  created_by            uuid NOT NULL REFERENCES users (id),
  created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT shopping_rows_household_id_key UNIQUE (household_id, id),
  CONSTRAINT shopping_rows_item_fkey
    FOREIGN KEY (household_id, item_id) REFERENCES inventory_items (household_id, id),
  CONSTRAINT shopping_rows_origin_member_fkey
    FOREIGN KEY (household_id, origin_member_id)
    REFERENCES household_memberships (household_id, id),
  CONSTRAINT shopping_rows_checked_off_by_fkey
    FOREIGN KEY (household_id, checked_off_by)
    REFERENCES household_memberships (household_id, id),
  CONSTRAINT shopping_rows_removed_by_fkey
    FOREIGN KEY (household_id, removed_by)
    REFERENCES household_memberships (household_id, id),

  -- A member row names its member; nothing else exists yet.
  CONSTRAINT shopping_rows_member_origin
    CHECK ((origin_kind = 'member') = (origin_member_id IS NOT NULL)),
  -- Who and when travel together.
  CONSTRAINT shopping_rows_checked_pair
    CHECK ((checked_off_by IS NULL) = (checked_off_at IS NULL)),
  -- A done row says who checked it; an open row says nobody has.
  CONSTRAINT shopping_rows_done_is_checked
    CHECK (status <> 'done' OR checked_off_at IS NOT NULL),
  CONSTRAINT shopping_rows_open_is_unchecked
    CHECK (status <> 'open' OR checked_off_at IS NULL),
  CONSTRAINT shopping_rows_removed_pair
    CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  -- Stored `skipped` means removed, and only that.
  CONSTRAINT shopping_rows_skipped_is_removed
    CHECK ((status = 'skipped') = (removed_at IS NOT NULL)),
  CONSTRAINT shopping_rows_added_needs_item
    CHECK (added_transaction_id IS NULL OR item_id IS NOT NULL),
  CONSTRAINT shopping_rows_updated_after_created
    CHECK (updated_at >= created_at)
);

COMMENT ON TABLE shopping_rows IS
  'The household shopping list (M7-T1). The amount to buy is never stored: it is the domain''s neededQuantity over need_micros and the item''s snapshot, computed on read.';

COMMENT ON COLUMN shopping_rows.added_transaction_id IS
  'The PURCHASE this row''s add-to-inventory appended. Write-once (trigger); unchecking the row never clears it.';

-- Read path: the list, in insertion order.
CREATE INDEX shopping_rows_household_created_idx
  ON shopping_rows (household_id, created_at, id);

CREATE TABLE shopping_row_writes (
  household_id     uuid NOT NULL,
  -- The client key shape every M2-T2 write uses.
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{1,128}$'),
  row_id           uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('check', 'add')),
  checked          boolean,
  generation       integer NOT NULL CHECK (generation >= 1),
  actor_member_id  uuid NOT NULL,
  transaction_id   uuid,
  recorded_at      timestamptz NOT NULL DEFAULT clock_timestamp(),

  -- Household-scoped, like the ledger's key index: a key used in another
  -- household can never collide with one used here, so a probe learns nothing.
  CONSTRAINT shopping_row_writes_pkey PRIMARY KEY (household_id, idempotency_key),
  CONSTRAINT shopping_row_writes_row_fkey
    FOREIGN KEY (household_id, row_id) REFERENCES shopping_rows (household_id, id),
  CONSTRAINT shopping_row_writes_actor_fkey
    FOREIGN KEY (household_id, actor_member_id)
    REFERENCES household_memberships (household_id, id),
  CONSTRAINT shopping_row_writes_check_payload
    CHECK ((kind = 'check') = (checked IS NOT NULL)),
  CONSTRAINT shopping_row_writes_add_payload
    CHECK ((kind = 'add') = (transaction_id IS NOT NULL))
);

COMMENT ON TABLE shopping_row_writes IS
  'One row per idempotency key the shopping check and add endpoints have accepted (M7-T1). Insert-only for sk_app; replay and conflict are decided against it.';

CREATE INDEX shopping_row_writes_row_idx ON shopping_row_writes (household_id, row_id);

-- --- The row guard ------------------------------------------------------------

CREATE FUNCTION shopping_rows_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.added_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'a shopping row starts with no purchase recorded'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.group_label IS DISTINCT FROM OLD.group_label
     OR NEW.origin_kind IS DISTINCT FROM OLD.origin_kind
     OR NEW.origin_member_id IS DISTINCT FROM OLD.origin_member_id
     OR NEW.need_micros IS DISTINCT FROM OLD.need_micros
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.default_location IS DISTINCT FROM OLD.default_location
     OR NEW.generation IS DISTINCT FROM OLD.generation
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the status, check-off, purchase and removal columns of a shopping row change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a removed shopping row stays removed'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.added_transaction_id IS NOT NULL
     AND NEW.added_transaction_id IS DISTINCT FROM OLD.added_transaction_id THEN
    RAISE EXCEPTION 'a shopping row''s purchase is recorded once and never cleared'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.added_transaction_id IS NULL AND NEW.added_transaction_id IS NOT NULL THEN
    -- Invoker rights: under `sk_app` the policies also apply, so only the
    -- session's own household is visible here, on top of the explicit filter.
    IF NOT EXISTS (
      SELECT 1 FROM inventory_transactions AS t
       WHERE t.household_id = NEW.household_id
         AND t.item_id = NEW.item_id
         AND t.id = NEW.added_transaction_id
         AND t.type = 'PURCHASE'
         AND t.correlation_kind = 'shopping-item'
         AND t.correlation_id = NEW.id::text
    ) THEN
      RAISE EXCEPTION 'added_transaction_id must name this row''s PURCHASE on its own item'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER shopping_rows_guard
  BEFORE INSERT OR UPDATE ON shopping_rows
  FOR EACH ROW EXECUTE FUNCTION shopping_rows_guard();

-- --- Tenancy ------------------------------------------------------------------

ALTER TABLE shopping_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopping_rows_current ON shopping_rows
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

ALTER TABLE shopping_row_writes ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopping_row_writes_current ON shopping_row_writes
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

GRANT SELECT, INSERT ON shopping_rows TO sk_app;
GRANT UPDATE (status, checked_off_by, checked_off_at, added_transaction_id,
              removed_at, removed_by, updated_at)
  ON shopping_rows TO sk_app;
GRANT SELECT, INSERT ON shopping_row_writes TO sk_app;

-- Down Migration

REVOKE ALL ON shopping_row_writes FROM sk_app;
REVOKE ALL ON shopping_rows FROM sk_app;
DROP POLICY shopping_row_writes_current ON shopping_row_writes;
DROP POLICY shopping_rows_current ON shopping_rows;
DROP TRIGGER shopping_rows_guard ON shopping_rows;
DROP FUNCTION shopping_rows_guard();
DROP TABLE shopping_row_writes;
DROP TABLE shopping_rows;
ALTER TABLE household_memberships DROP CONSTRAINT household_memberships_household_id_key;
