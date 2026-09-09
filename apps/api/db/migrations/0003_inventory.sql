-- M1-T2 — inventory: items, lots and the append-only transaction ledger
-- (data-model.md §2 "Inventory", ADR-008/D-003, domain types from M1-T1).
--
-- This table set is the persistence image of `packages/domain/src/inventory`.
-- Where the data-model.md sketch and the implemented domain types disagree, the
-- domain wins and the difference is reported for the architect to fold back
-- into data-model.md (M1-T2 worker report §"proposed doc updates").
--
-- Three structural ideas carry most of the safety here:
--
-- 1. **Composite foreign keys carry `household_id`.** A transaction references
--    `(household_id, item_id, lot_id)`, not just `lot_id`. Linking a row to
--    another household's item or lot is therefore not merely denied by policy,
--    it fails referential integrity — a guarantee that survives RLS being
--    misconfigured, and that RI checks (which run as the table owner and
--    bypass RLS) still enforce.
--
-- 2. **The unit travels in the foreign key.** `(household_id, item_id, unit)`
--    references `inventory_items (household_id, id, unit)`, so a transaction in
--    a different unit from its item cannot be stored at all. domain-model.md §2
--    and data-model.md §3 require "one unit per item, never silently
--    converted"; this makes it a key constraint rather than a convention.
--
-- 3. **Both quantity forms are stored, and must agree.** `qty_delta_micros`
--    (BIGINT, exact micro-units) is authoritative and is the only column
--    arithmetic is ever done on; `qty_delta` (NUMERIC) is the display form the
--    sketch specifies. A CHECK pins them to each other, mirroring the
--    domain's `rehydrateInventoryItem` corruption check.

-- Up Migration

CREATE TABLE inventory_items (
  id                  uuid PRIMARY KEY,
  household_id        uuid NOT NULL REFERENCES households (id),
  -- The single unit every lot and transaction on this item must use.
  -- Opaque text at this layer, exactly as the domain's `Unit` is (M1-T3's
  -- conversion layer sits above the ledger, never inside it).
  unit                text NOT NULL CHECK (btrim(unit) <> ''),
  product_ref         text CHECK (product_ref IS NULL OR btrim(product_ref) <> ''),
  ingredient_ref      text CHECK (ingredient_ref IS NULL OR btrim(ingredient_ref) <> ''),
  display_name        text,
  storage_location    text CHECK (storage_location IN ('FRIDGE', 'FREEZER', 'PANTRY', 'OTHER')),
  -- Derived snapshot. Maintained ONLY by the ledger trigger in 0004; `sk_app`
  -- holds no UPDATE privilege on these columns (0006).
  current_qty_micros  bigint NOT NULL DEFAULT 0,
  current_qty         numeric(24, 6) NOT NULL DEFAULT 0,
  next_sequence       integer NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_items_qty_forms_agree
    CHECK (current_qty = current_qty_micros::numeric / 1000000),

  -- Referenced by the composite foreign keys below.
  CONSTRAINT inventory_items_household_id_key UNIQUE (household_id, id),
  CONSTRAINT inventory_items_household_id_unit_key UNIQUE (household_id, id, unit)
);

COMMENT ON COLUMN inventory_items.current_qty_micros IS
  'Derived snapshot in micro-units; always Σ of the item''s transaction deltas (INV-LEDGER-1). Written only by inventory_ledger_apply().';

CREATE INDEX inventory_items_household_idx ON inventory_items (household_id);

CREATE TABLE inventory_lots (
  id                  uuid PRIMARY KEY,
  household_id        uuid NOT NULL,
  item_id             uuid NOT NULL,
  acquired_at         timestamptz,
  expires_at          timestamptz,
  -- Full provenance tier, not the sketch's (known, estimated) pair: the domain
  -- models `expiryTier` as a `ProvenanceTier`, so an AI-derived expiry has a
  -- tier to land in rather than being rounded to "estimated".
  expiry_tier         text CHECK (expiry_tier IN ('KNOWN_FACT', 'ESTIMATED', 'AI_INTERPRETATION')),
  label               text,
  current_qty_micros  bigint NOT NULL DEFAULT 0,
  current_qty         numeric(24, 6) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_lots_qty_forms_agree
    CHECK (current_qty = current_qty_micros::numeric / 1000000),

  CONSTRAINT inventory_lots_item_fkey
    FOREIGN KEY (household_id, item_id)
    REFERENCES inventory_items (household_id, id),

  CONSTRAINT inventory_lots_household_item_id_key UNIQUE (household_id, item_id, id)
);

CREATE INDEX inventory_lots_item_idx ON inventory_lots (item_id);

CREATE TABLE inventory_transactions (
  id                                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id                       uuid NOT NULL,
  item_id                            uuid NOT NULL,
  lot_id                             uuid NOT NULL,
  -- 1-based, contiguous, per item; the ledger's authoritative order — never
  -- `occurred_at` (domain-model.md §2). Assignment is validated by the trigger
  -- in 0004 against `inventory_items.next_sequence`.
  sequence                           integer NOT NULL CHECK (sequence >= 1),
  type                               text NOT NULL CHECK (type IN (
                                       'INITIAL_STOCK', 'PURCHASE', 'CONSUME', 'USE_IN_MEAL',
                                       'DISCARD', 'EXPIRE', 'DONATE', 'ADJUSTMENT')),
  qty_delta                          numeric(24, 6) NOT NULL,
  qty_delta_micros                   bigint NOT NULL,
  unit                               text NOT NULL,
  reason                             text CHECK (reason IS NULL OR btrim(reason) <> ''),

  actor_kind                         text NOT NULL CHECK (actor_kind IN ('user', 'system', 'ai-confirmed')),
  actor_user_id                      uuid REFERENCES users (id),
  actor_component                    text CHECK (actor_component IS NULL OR btrim(actor_component) <> ''),
  actor_model_ref                    text CHECK (actor_model_ref IS NULL OR btrim(actor_model_ref) <> ''),

  occurred_at                        timestamptz NOT NULL,
  recorded_at                        timestamptz NOT NULL,

  provenance_tier                    text NOT NULL CHECK (provenance_tier IN ('KNOWN_FACT', 'ESTIMATED', 'AI_INTERPRETATION')),
  provenance_source                  text NOT NULL CHECK (btrim(provenance_source) <> ''),
  provenance_confidence              numeric CHECK (provenance_confidence IS NULL
                                       OR (provenance_confidence >= 0 AND provenance_confidence <= 1)),
  provenance_model_ref               text,
  provenance_observed_at             timestamptz,
  provenance_confirmed_by            uuid REFERENCES users (id),

  correlation_kind                   text CHECK (correlation_kind IN ('receipt-line', 'meal-log', 'shopping-item')),
  correlation_id                     text CHECK (correlation_id IS NULL OR btrim(correlation_id) <> ''),

  idempotency_key                    text NOT NULL CHECK (btrim(idempotency_key) <> ''),

  -- `SystemFlag` (currently the single `OVER_CONSUMPTION` variant) as typed
  -- columns rather than JSONB. Two reasons: `residual_micros` is a bigint whose
  -- exactness is the whole point and JSON numbers cannot carry it (it would
  -- have to be a stringly-typed field, unvalidated); and typed columns let the
  -- CHECK below enforce that a system flag is *well-formed and ledger-authored*
  -- — the unforgeability property M1-T1 established in memory — which is not
  -- expressible over an opaque JSONB blob.
  system_flag_kind                   text CHECK (system_flag_kind IN ('OVER_CONSUMPTION')),
  system_flag_residual_micros        bigint,
  system_flag_caused_by_sequence     integer,
  system_flag_caused_by_idempotency_key text,

  -- The two delta representations must agree exactly (mirrors validateStoredRow).
  CONSTRAINT inventory_transactions_qty_forms_agree
    CHECK (qty_delta = qty_delta_micros::numeric / 1000000),
  -- A transaction must change the quantity.
  CONSTRAINT inventory_transactions_qty_nonzero
    CHECK (qty_delta_micros <> 0),
  -- MAX_QUANTITY_MICROS (1e8 units) — the per-delta magnitude the domain
  -- guarantees round-trips exactly through a `number`.
  CONSTRAINT inventory_transactions_qty_range
    CHECK (qty_delta_micros BETWEEN -100000000000000 AND 100000000000000),
  -- Fixed sign per type (TRANSACTION_DIRECTIONS); ADJUSTMENT is the only
  -- signed instrument.
  CONSTRAINT inventory_transactions_sign_by_type
    CHECK (CASE type
             WHEN 'INITIAL_STOCK' THEN qty_delta_micros > 0
             WHEN 'PURCHASE'      THEN qty_delta_micros > 0
             WHEN 'ADJUSTMENT'    THEN true
             ELSE qty_delta_micros < 0
           END),
  CONSTRAINT inventory_transactions_time_order
    CHECK (recorded_at >= occurred_at),
  -- Exactly the fields the matching `Actor` variant carries, and no others.
  CONSTRAINT inventory_transactions_actor_shape
    CHECK (CASE actor_kind
             WHEN 'user' THEN
               actor_user_id IS NOT NULL AND actor_component IS NULL AND actor_model_ref IS NULL
             WHEN 'system' THEN
               actor_component IS NOT NULL AND actor_user_id IS NULL AND actor_model_ref IS NULL
             WHEN 'ai-confirmed' THEN
               actor_user_id IS NOT NULL AND actor_model_ref IS NOT NULL AND actor_component IS NULL
             ELSE false
           END),
  CONSTRAINT inventory_transactions_correlation_pair
    CHECK ((correlation_kind IS NULL) = (correlation_id IS NULL)),
  CONSTRAINT inventory_transactions_system_flag_complete
    CHECK (num_nulls(system_flag_kind, system_flag_residual_micros,
                     system_flag_caused_by_sequence, system_flag_caused_by_idempotency_key)
           IN (0, 4)),

  -- The unforgeable-marker rule, in SQL. `::` is the ledger's reserved key
  -- namespace (RESERVED_KEY_SEPARATOR) and a system flag may only appear on a
  -- row the ledger itself could have authored:
  --   * a key ending in the clamp suffix must be an ADJUSTMENT authored by the
  --     `inventory-ledger` component, carrying a residual equal to its own
  --     delta, keyed exactly `<cause key>::over-consumption-clamp`, and sitting
  --     immediately after the transaction it compensates;
  --   * no other row may use `::` at all;
  --   * no other row may carry a system flag.
  CONSTRAINT inventory_transactions_reserved_marker
    CHECK (CASE
             WHEN idempotency_key LIKE '%::over-consumption-clamp' THEN
               system_flag_kind = 'OVER_CONSUMPTION'
               AND type = 'ADJUSTMENT'
               AND actor_kind = 'system'
               AND actor_component = 'inventory-ledger'
               AND system_flag_residual_micros = qty_delta_micros
               AND idempotency_key = system_flag_caused_by_idempotency_key || '::over-consumption-clamp'
               AND system_flag_caused_by_sequence = sequence - 1
             WHEN position('::' IN idempotency_key) > 0 THEN false
             ELSE system_flag_kind IS NULL
           END),

  CONSTRAINT inventory_transactions_item_unit_fkey
    FOREIGN KEY (household_id, item_id, unit)
    REFERENCES inventory_items (household_id, id, unit),

  CONSTRAINT inventory_transactions_lot_fkey
    FOREIGN KEY (household_id, item_id, lot_id)
    REFERENCES inventory_lots (household_id, item_id, id),

  -- Architect ruling (M1-T1 §8.1): household-scoped, deliberately stronger than
  -- the domain's per-item uniqueness. Batch imports suffix per line.
  CONSTRAINT inventory_transactions_idempotency_key
    UNIQUE (household_id, idempotency_key),

  -- Per-item monotonicity: no two rows on an item share a sequence.
  --
  -- `household_id` leads the key even though it is functionally determined by
  -- `item_id` (an item belongs to exactly one household, and the composite
  -- foreign key above makes a transaction's household agree with its item's).
  -- It is here because unique indexes are checked at insert time, *before*
  -- foreign keys and AFTER-triggers — so without it, probing another
  -- household's item with ascending sequence numbers flipped from
  -- duplicate-key to foreign-key violation exactly at that ledger's length,
  -- which is an oracle for how much history a household has. Scoping the key
  -- makes a foreign item's rows uncollidable, so every probe fails the same
  -- way. Semantically the constraint is unchanged.
  CONSTRAINT inventory_transactions_item_sequence_key
    UNIQUE (household_id, item_id, sequence)
);

-- A clamp cannot exist without the transaction it compensates. Self-referential
-- on the household-scoped idempotency key, so a clamp can never point at a
-- different household's row either.
ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_clamp_cause_fkey
  FOREIGN KEY (household_id, system_flag_caused_by_idempotency_key)
  REFERENCES inventory_transactions (household_id, idempotency_key);

-- Read path: rehydration reads one item's ledger in sequence order.
CREATE INDEX inventory_transactions_item_sequence_idx
  ON inventory_transactions (household_id, item_id, sequence);

CREATE INDEX inventory_transactions_lot_idx
  ON inventory_transactions (household_id, lot_id);

-- Correlation lookups ("which rows did this receipt line produce?").
CREATE INDEX inventory_transactions_correlation_idx
  ON inventory_transactions (correlation_kind, correlation_id)
  WHERE correlation_kind IS NOT NULL;

-- Down Migration

DROP TABLE inventory_transactions;
DROP TABLE inventory_lots;
DROP TABLE inventory_items;
