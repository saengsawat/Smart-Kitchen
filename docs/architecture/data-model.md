# Data Model (candidate relational sketch)

**Status:** PROPOSED — Postgres-shaped ([ADR-003](../adr/ADR-003-database.md) leans Postgres, not yet DECIDED). This is a design sketch, **not** migration code. Entities defined in [domain-model.md](domain-model.md).

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
shopping_lists       (id, household_id, status ENUM(active,archived), created_at)
shopping_list_items  (id, list_id FK, household_id, ingredient_id NULL, product_id NULL,
                      free_text NULL, required_qty NULL, on_hand_qty_at_gen NULL,
                      needed_qty NULL, unit NULL, department NULL,
                      status ENUM(to_buy,already_have,checked_off,removed),
                      idempotency_key UNIQUE NULL)
ai_observations      (id, household_id, kind ENUM(barcode_photo,receipt_line,vision_item),
                      payload JSONB, confidence, model_ref,
                      status ENUM(proposed,confirmed,rejected,expired), created_at)
```

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

## 5. Tenancy isolation & sensitive data

- **App-layer:** every repository/query function takes a mandatory household context; no query path exists without it (enforced by module API design + tests).
- **DB-layer (PROPOSED, evaluate in M1-T2):** Postgres RLS keyed on `household_id` via a per-request setting, as defense in depth. Cost: some ORM friction; Benefit: isolation survives application bugs. Leaning **yes** — matches NFR-1's "cannot" rather than "should not."
- `member_profiles` + `allergy_restrictions` are the most sensitive tables (health-adjacent): access-scoped to the owning user (not whole household) by default pending Q3/OQ-3; encrypted at rest by platform; excluded from logs (see threat model).

## 6. Idempotency

| Write path | Key |
|---|---|
| Any inventory transaction | client-generated `idempotency_key` (UNIQUE) — retries no-op |
| Receipt upload | `content_hash` per household — duplicate scan returns existing receipt |
| Meal log → decrements | one key per (meal_log, ingredient) — retrying a meal log can't double-consume |
| Shopping check-off → purchase | key per shopping_list_item transition |
| External API calls | request-level dedupe/caching in adapters; never auto-retry non-idempotent provider ops |
