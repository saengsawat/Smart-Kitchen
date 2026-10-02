# Data Model (candidate relational sketch)

**Status:** PARTIALLY IMPLEMENTED — identity/household/inventory tables are REAL as of M1-T2 ([ADR-003](../adr/ADR-003-database.md) DECIDED: PostgreSQL + RLS); the authoritative schema is `apps/api/db/migrations/`. The rest of this file remains a design sketch for future milestones. Entities defined in [domain-model.md](domain-model.md).

## 0. Implementation notes (M1-T2, 2026-09-10) — where the real schema refined this sketch
- Ledger rows store BOTH `qty_delta` (numeric display) and `qty_delta_micros` (BIGINT, authoritative) with a DB CHECK enforcing agreement; reconciliation sums micros only. Kept the numeric columns deliberately (cheap corruption detector).
- Idempotency unique index is **`(household_id, idempotency_key)`** (architect ruling); sequence uniqueness is **`(household_id, item_id, sequence)`** — never unscoped (ADR-003 standing rule 1: unique-index oracles).
- Snapshots maintained by DB trigger; runtime role has NO UPDATE on snapshot columns (ADR-008). Non-negativity = deferred `SECURITY DEFINER` fail-closed constraint trigger.
- `text` + CHECK instead of Postgres `ENUM` (reversibility); enum values uppercase matching the TS unions; composite FKs carry `household_id` (and the item's unit), making cross-household references and mixed units referential-integrity failures.
- The sketch's `CHECK(product_id IS NOT NULL OR ingredient_id IS NOT NULL)` was **dropped** — the domain permits neither ref ("leftover soup" is a real item).
- `member_profiles` / `preferences` / `allergy_restrictions` deliberately **not created yet** — their access model is unresolved (Q3/OQ-3); creating them would have meant inventing one (rule 3).
- Views on tenant tables use `security_invoker = true`; app role is `sk_app` (INSERT+SELECT on ledger, no schema CREATE).

## 1. Conventions

- `id` = UUIDv7 (time-ordered, client-generatable — supports offline-created rows later and idempotency keys).
- Every household-scoped table carries `household_id NOT NULL` even where derivable via joins — enables blunt, auditable isolation checks and (optionally) Postgres RLS.
- Timestamps: `occurred_at` (domain time) vs `recorded_at` (system time) on ledger rows; `created_at/updated_at` elsewhere.
- Soft deletes only where product requires undo; ledger rows are never deleted.
- Provenance columns (see §4) on any fact that can be AI-derived or estimated.

## 2. Table sketch

### Identity & tenancy
```
users                (id, auth_provider_subject UNIQUE, email, display_name, created_at)
households           (id, name, created_at)
household_memberships(id, household_id FK, user_id FK, role ENUM(owner,member),
                      UNIQUE(household_id, user_id))
member_profiles      (id, user_id FK UNIQUE, age, sex, height_cm, weight_kg,
                      activity_level, calorie_goal, ...)          -- sensitive; see §5
preferences          (id, user_id FK, kind, value)
allergy_restrictions (id, user_id FK, allergen_code NULL, custom_name NULL,
                      severity ENUM(standard,severe), CHECK(allergen_code OR custom_name))
```

**Join codes and membership doors (M2-T3, migration 0008).** `household_join_codes` (`code_hash` PK, hex HMAC-SHA-256 of the normalised code under the server pepper `SK_JOIN_CODE_PEPPER`, plaintext never stored; `household_id`, `created_by`, `created_at`, `revoked_at`). At most one live code per household; `revoked_at` is set once and frozen by trigger; RLS like every household-scoped table, `sk_app` SELECT/INSERT/UPDATE(`revoked_at`) only. Codes are `XXXX-NNN` (letters without I and O, digits 2 to 9), returned in plaintext once, at issue. Memberships are created at runtime only through `app_create_household` (owner, new household) and `app_redeem_join_code` (member, live code, idempotent); `sk_app` holds no INSERT on `households` or `household_memberships`. `app_user_memberships` lists one user's memberships for the identity port. Membership changes are not a table: they are audit log lines (ARCHITECTURE §7.10). Join codes do not expire today (OQ-E3).

### Food knowledge (global, not household-scoped)
```
product_catalog_items(id, name, brand, category, package_qty, package_unit,
                      serving_qty, serving_unit, image_ref, storage_default,
                      shelf_life_days_pantry/fridge/freezer NULL, ...)
product_identifiers  (id, product_id FK, code_type ENUM(gtin,upc,ean,plu),
                      code, source, first_seen_at, UNIQUE(code_type, code, product_id))
canonical_ingredients(id, name, category, default_unit_kind ENUM(mass,volume,count),
                      default_shelf_life_days_by_location JSONB)
product_ingredient_map(product_id FK, ingredient_id FK, PRIMARY KEY(product_id, ingredient_id))
nutrition_profiles   (id, owner_type ENUM(product,ingredient), owner_id,
                      basis ENUM(per_serving,per_100g), calories, protein_g, carbs_g,
                      fat_g, fiber_g, sugar_g, sodium_mg, + provenance cols)
allergen_assertions  (id, owner_type, owner_id, allergen_code,
                      assertion ENUM(contains,may_contain), + provenance cols)
```
Per-field provenance on `product_catalog_items` is the awkward case; `PROPOSED`: a sidecar `product_field_provenance(product_id, field, tier, source, confidence, observed_at)` rather than doubling every column. Revisit in M1-T3.

### Inventory (household-scoped; the ledger)
```
inventory_items      (id, household_id, product_id NULL, ingredient_id NULL,
                      display_name, storage_location ENUM(fridge,freezer,pantry,other),
                      current_qty NUMERIC, unit,        -- derived snapshot, see §3
                      CHECK(product_id IS NOT NULL OR ingredient_id IS NOT NULL))
inventory_lots       (id, household_id, item_id FK, acquired_at,
                      expires_at NULL, expires_tier ENUM(known,estimated) NULL,
                      unit_size_qty NULL, unit_size_unit NULL)
inventory_transactions(id, household_id, lot_id FK, type ENUM(purchase,consume,
                      use_in_meal,discard,expire,donate,adjustment,initial_stock),
                      qty_delta NUMERIC NOT NULL, unit, reason NULL,
                      actor_type ENUM(user,system,ai_confirmed), actor_user_id NULL,
                      occurred_at, recorded_at DEFAULT now(),
                      provenance_tier, provenance_source,
                      correlation_type NULL, correlation_id NULL,   -- receipt_line / meal_log / shopping_item
                      idempotency_key UNIQUE NOT NULL)
```
`inventory_transactions` is **append-only**: no UPDATE/DELETE grants for the app role; enforced again by trigger in hardening milestone.

### Acquisition (fast-follow, schema reserved)
```
receipts             (id, household_id, image_ref, store_name NULL, purchased_at NULL,
                      status ENUM(uploaded,parsed,confirmed,rejected),
                      content_hash UNIQUE(household_id, content_hash))  -- duplicate-scan guard
receipt_lines        (id, receipt_id FK, household_id, raw_text, parsed JSONB,
                      candidates JSONB, confidence, disposition ENUM(pending,accepted,
                      corrected,ignored), resulting_transaction_id NULL)
```

### Cooking & shopping
```
recipes              (id, household_id NULL,  -- NULL = shareable/global later; MVP: household
                      title, instructions, prep_minutes, servings,
                      generation_model, generation_context_ref, created_at)
recipe_ingredients   (id, recipe_id FK, ingredient_id FK, qty, unit, optional BOOL)
recommendations      (id, household_id, recipe_id FK, shown_at, context JSONB,
                      response ENUM(none,accepted,rejected,cooked), responded_at NULL)
meal_logs            (id, household_id, recipe_id NULL, logged_by FK, eaten_at,
                      servings, notes)       -- ingredient decrements = ledger txns w/ correlation
shopping_rows        (id, household_id, name, group_label, origin_kind CHECK(member),
                      origin_member_id FK(household_id, membership), need_micros BIGINT > 0,
                      unit CHECK(contract units), item_id NULL FK(household_id, item),
                      default_location, status CHECK(open, done, skipped),
                      checked_off_by NULL, checked_off_at NULL, added_transaction_id NULL,
                      generation DEFAULT 1, removed_at NULL, removed_by NULL,
                      created_by FK users, created_at, updated_at)       -- REAL since M7-T1 (0009)
shopping_row_writes  (household_id, idempotency_key, row_id, kind CHECK(check, add), checked NULL,
                      generation, actor_member_id, transaction_id NULL, recorded_at,
                      PRIMARY KEY(household_id, idempotency_key))         -- insert-only
ai_observations      (id, household_id, kind ENUM(barcode_photo,receipt_line,vision_item),
                      payload JSONB, confidence, model_ref,
                      status ENUM(proposed,confirmed,rejected,expired), created_at)
```

**Shopping rows (M7-T1, 2026-09-30).** One list per household is implicit; `shopping_lists` waits for named lists. The amount to buy is never stored: every read computes it with the domain's `neededQuantity` over `need_micros` and the item's snapshot, counting the snapshot only when its unit is the row's unit (never a conversion), with the snapshot's own tier. Stored `skipped` means removed; "already have enough" is a read-time status. Add-to-inventory appends one PURCHASE per row and generation under the ledger key `shopping-row/<rowId>/generation/<n>`, in the transaction that sets the write-once `added_transaction_id`; unchecking never reverses it. Menu and AI origins arrive with later migrations (the `origin_kind` CHECK grows then).

**Confirmations (M2-T5, 2026-10-01, D-028).** `inventory_confirmations (id, household_id, item_id, transaction_id, confirmed_by, model_ref NULL, client_key, confirmed_at DEFAULT clock_timestamp(), UNIQUE (household_id, transaction_id))`, insert-only (no UPDATE, DELETE or TRUNCATE for any role), composite FK to the confirmed ledger row and to the confirmer's membership; REAL since migration 0010, which also gave `inventory_transactions` the `UNIQUE (household_id, item_id, id)` that composite FK references. A confirm inserts one row per not-yet-confirmed AI-interpreted transaction of the item (under the item's row lock, so concurrent confirms never race); reads join it to present the row as Known Fact with "{source} · confirmed by {initials}". The ledger's append-only trigger has existed since 0004 (the "enforced again by trigger in hardening milestone" note above is historical).

**Moves (M2-T6, 2026-10-02, D-024 row 1).** `inventory_item_moves (id, household_id, item_id, from_location NULL, to_location, moved_by, client_key, occurred_at DEFAULT clock_timestamp(), UNIQUE (household_id, item_id, client_key), CHECK (from_location IS DISTINCT FROM to_location))`, insert-only, composite FKs to the item and to the mover's membership; REAL since migration 0011. `inventory_items.storage_location` (stored as the upper-case text `FRIDGE`, `FREEZER`, `PANTRY`, `OTHER` with a CHECK) is the one mutable item attribute and changes only in the same transaction as a move row. The detail history merges move rows with ledger rows by time.

## 3. Snapshot maintenance & reconciliation

- `inventory_items.current_qty` updated in the **same DB transaction** as each ledger append (application-level, or trigger — decide in M1-T2).
- Invariant job/test: `current_qty == COALESCE(SUM(qty_delta),0)` over the item's lots' transactions. Drift ⇒ alert + auto-repair with an `ADJUSTMENT(system)` row, never silent overwrite.
- Unit mixing within an item is rejected at write time (single unit per item in MVP; conversions handled before the ledger).

## 4. Provenance columns

Standard column group wherever a fact can be non-authoritative (§14 of the brief):
```
provenance_tier   ENUM(known_fact, estimated, ai_interpretation)
provenance_source TEXT          -- 'gtin:0096619…', 'usda_fdc:12345', 'ocr:model@ver', 'user'
confidence        NUMERIC NULL  -- probabilistic sources only
observed_at       TIMESTAMPTZ
confirmed_by      UUID NULL     -- user who confirmed, where confirmation applies
```

`provenance_confirmed_by` on the ledger is write-once at insert (a row created already confirmed); a confirmation of an existing row lives in the sibling `inventory_confirmations` table (D-028), never as an update.

## 5. Tenancy isolation & sensitive data

- **App-layer:** every repository/query function takes a mandatory household context; no query path exists without it (enforced by module API design + tests).
- **DB-layer (ADOPTED in M1-T2, ADR-003 DECIDED; stale "PROPOSED" wording corrected 2026-09-22):** Postgres RLS keyed on `household_id` via the transaction-local `app.household_id` setting (migration 0006), as defense in depth; the app role `sk_app` has no BYPASSRLS and no UPDATE/DELETE on ledger tables. The HTTP layer (M2-T1) sets the context in `withHouseholdTransaction` with the role pinned on every request; a handler is handed a tenant-scoped runner, never the pool. The tenancy suite proves both layers independently: removing the tenant context returns nothing (RLS holds), and bypassing RLS still returns only the caller's household (the app predicate holds). Isolation survives application bugs, which is NFR-1's "cannot" rather than "should not."
- `member_profiles` + `allergy_restrictions` are the most sensitive tables (health-adjacent): access-scoped to the owning user (not whole household) by default pending Q3/OQ-3; encrypted at rest by platform; excluded from logs (see threat model).

## 6. Idempotency

| Write path | Key |
|---|---|
| Any inventory transaction | client-generated `idempotency_key` (UNIQUE) — retries no-op |
| Receipt upload | `content_hash` per household — duplicate scan returns existing receipt |
| Meal log → decrements | one key per (meal_log, ingredient) — retrying a meal log can't double-consume |
| Shopping check-off → purchase | the client key per tap in `shopping_row_writes` (household-scoped), plus one PURCHASE per row and generation under a derived ledger key (M7-T1) |
| External API calls | request-level dedupe/caching in adapters; never auto-retry non-idempotent provider ops |

**Idempotency rejections are savepoint-scoped (M1-T11, 2026-09-16).** The database's idempotency index is household-scoped, so a key already used elsewhere in the household is refused by the index rather than by the domain. `appendTransactionToDb` wraps its insert block in `SAVEPOINT ledger_append` and, on `23505` / `inventory_transactions_idempotency_key`, issues `ROLLBACK TO SAVEPOINT` before returning the typed `IDEMPOTENCY_KEY_CONFLICT` rejection. A rejected append therefore costs the caller exactly its own candidate rows and nothing else: sibling writes earlier in the same transaction stay valid and the transaction remains usable. Every other database error propagates with the transaction left aborted, for the session wrapper to roll back or the retry helper (M1-T9) to re-run.

**HTTP writes derive a key per row (M2-T2, 2026-09-22).** A client sends one `idempotencyKey` per request; the API never uses it as a ledger key directly. Every row a write appends is keyed `<clientKey>/lot/<n>`, the M1-T8 planner's namespace, so one request that splits across three lots writes three independently idempotent rows and the set of rows belonging to a request is exactly the set under its prefix. Client keys are restricted to `[A-Za-z0-9._-]{1,128}`, which keeps them out of both reserved namespaces (`::` for ledger-authored rows, `/lot/` for derived ones). A replay is not remembered: the request is planned again against the item as it stood immediately before the stored rows (rehydrated from the ledger prefix) and the resulting inputs are offered to the ledger, so the ledger's own payload comparison distinguishes an idempotent replay (200, nothing appended) from a reused key (409, `IDEMPOTENCY_KEY_CONFLICT`). This is what makes replaying a target-quantity correction work, since the target is relative to a balance the first attempt already moved. Undo rows carry their own client key and the same derivation; an undo whose compensation would overshoot a lot is refused (409, `UNDO_NOT_POSSIBLE`) rather than clamped, so a clamp row always means a real over-consumption. Relating an undo to the row it compensates uses `reason` `undo:<transactionId>` for now; a `compensates_transaction_id` column is the recorded shape for M8, not an `undo` value on `correlation_kind`, which names artefacts.

**`COMMIT` is not proof of commit.** Postgres answers `COMMIT` on an aborted transaction with the `ROLLBACK` command tag and no error. `withHouseholdTransaction` inspects `QueryResult.command` and throws `TransactionAbortedAtCommitError` when it is `ROLLBACK`, so for any `fn` that leaves transaction control to the wrapper, "returned normally" means "committed". The check reads the `ROLLBACK` tag specifically (fail-open on an unexpected tag — a fail-closed `!== "COMMIT"` variant is backlogged with the retry-helper test stubs it requires). Any code that catches a database error and then returns must therefore either use a savepoint, as the repository does, or let the error propagate. `TransactionAbortedAtCommitError` is deliberately **not** retryable: a swallowed `40001` becomes a loud failure, not a retry.
