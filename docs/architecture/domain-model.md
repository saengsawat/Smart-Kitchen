# Domain Model

**Status:** PROPOSED. Names/boundaries refined from the checklist in the founding task; expected to evolve during M1. Source refs (§) cite [the product brief](../source/product-brief.extracted.md).

## 1. Design principles

1. **Inventory is a ledger, not a number** (§7, §14, §18C). Quantities are derived from append-only transactions; every belief the system holds is explainable ("purchase +2 on 3/4, consumed −0.75 on 3/6 …").
2. **Product ≠ Ingredient.** A *ProductCatalogItem* is a purchasable branded thing (Kirkland Greek Yogurt 32 oz, GTIN 0096619…); a *CanonicalIngredient* is a cooking-level concept (greek yogurt). Recipes reference ingredients; inventory holds products (or generic items) mapped to ingredients. This mapping is where barcode data, receipt lines, and recipes meet (§18A, §18B).
3. **Provenance everywhere facts can be wrong** (§14). Any AI- or estimate-derived value carries `{tier: KNOWN_FACT | ESTIMATED | AI_INTERPRETATION, source, confidence?, modelRef?, observedAt, confirmedBy?}`.
4. **AI proposes, the domain disposes.** Probabilistic subsystems emit *Observations*; only deterministic code (plus user confirmation where required) turns observations into ledger transactions (§2C, §14).

## 2. Entities

### Identity & tenancy
| Entity | Purpose | Notes |
|---|---|---|
| **User** | Authenticated person | Auth identity external ([ADR-004](../adr/ADR-004-authentication.md)); minimal PII here |
| **Household** | Tenancy + sharing boundary (§12) | Every food-domain row is household-scoped |
| **HouseholdMembership** | User↔Household + role | Roles: `owner`, `member` for MVP; richer permissions UNKNOWN (Q3) |
| **MemberProfile** | Per-member personal info, goals (§3) | Age/sex/height/weight/activity/calorie goal — sensitive; optional in MVP |
| **Preference** | Dietary preference (soft) (§3) | Ranking signal only |
| **AllergyRestriction** | Hard safety restriction (§3) | Per member; taxonomy code or user-defined; severity flag. **Never** modeled as a Preference |

### Food knowledge (household-independent, shared/cached)
| Entity | Purpose | Notes |
|---|---|---|
| **ProductCatalogItem** | Normalized branded product (§18A) | Our own DB, merged from sources; fields carry per-field provenance |
| **ProductIdentifier** | GTIN/UPC/EAN/PLU → catalog item | One product may have several codes; codes get reassigned (keep source + seen-at) |
| **CanonicalIngredient** | Cooking-level food concept | Small curated taxonomy to start; category, default unit kind, default shelf-life by storage location (drives §8 estimates) |
| **NutritionProfile** | Per-serving/per-100g nutrients (§2A, §9) | Attached to catalog item (branded) or ingredient (generic, e.g. USDA FDC); source + tier required |
| **AllergenAssertion** | Product/ingredient contains/may-contain allergen (§3) | Kinds are `CONTAINS | MAY_CONTAIN` **only** — there is deliberately no negative/"free-from" kind; invented negative kinds are rejected and degrade to unknown (M1-T4). Absence-of-data ≠ absence-of-allergen (SR-2) |
| **AllergenDeclaration** | A positive, sourced completeness claim (M1-T4) | The **sole licence** for a screening verdict to conclude absence: two independent claims (`majorAllergens` completeness licenses major-code restrictions; `ingredientStatement` completeness licenses user-defined terms — no cross-licensing). Counts only at exact tier `KNOWN_FACT` with a non-empty `source`. Who may mint one = OPEN decision, must be settled before M4 wires adapter data (D-017) |

### Inventory (household-scoped) — the core
| Entity | Purpose | Notes |
|---|---|---|
| **InventoryItem** | "This household has greek yogurt (this product) in the fridge" | Links product and/or ingredient + StorageLocation; holds *derived* quantity snapshot. M1: an item declares a single unit; every lot/transaction on it must use that unit (mixed units rejected, never converted — conversion is M1-T3's layer) |
| **InventoryLot** | A distinguishable acquisition (batch) | Carries acquisition date, expiration (with tier: printed=KNOWN, shelf-life-derived=ESTIMATED §14), unit size. "2 × 16 oz yogurt" = qty 2 on one lot, or two lots (§2A) |
| **InventoryTransaction** | Append-only ledger entry | `{lot, type, qtyDelta, unit, reason?, actor (user|system|ai-confirmed), occurredAt, recordedAt, provenance, idempotencyKey, correlationRef, sequence}`. `sequence` (1-based per item, assigned at append) is the authoritative order — not `occurredAt`. Deltas held as **exact scaled integers** (micro-units, 1e-6) alongside decimal `qtyDelta`; ledger arithmetic uses only the exact form; the decimal view is canonicalised from it (M1-T1). Fixed sign per type (`PURCHASE`/`INITIAL_STOCK` +, consumption/waste types −, `ADJUSTMENT` signed); zero deltas rejected |
| **StorageLocation** | Fridge/Freezer/Pantry/Other (§2A) | Implemented enum `FRIDGE | FREEZER | PANTRY | OTHER` (M1-T1); optional user labels later |

**Transaction types** (superset of §7): `PURCHASE`, `CONSUME`, `USE_IN_MEAL`, `DISCARD`, `EXPIRE`, `DONATE`, `ADJUSTMENT` (manual correction, signed), `INITIAL_STOCK`. Reasons map 1:1 to §7's list so waste analytics (§15C) fall out of the ledger later for free.

### Acquisition
| Entity | Purpose | Notes |
|---|---|---|
| **Receipt** | Stored scan + parse state (§2B) | Image ref, store, date, status (uploaded→parsed→confirmed), content hash for dedupe (idempotency) |
| **ReceiptLine** | One parsed line | Raw text + normalized candidate(s) + confidence + user disposition; confirmed lines emit PURCHASE transactions with correlationRef |
| *(Purchase)* | Not a separate entity in MVP | A purchase **is** a `PURCHASE` transaction (+ optional receipt correlation). Revisit if order-level metadata (store, totals) needs a home beyond Receipt |

### Cooking & consumption
| Entity | Purpose | Notes |
|---|---|---|
| **Recipe** | AI-generated original recipe (§4, §18D) | Stored with generation metadata (model, prompt ref) |
| **RecipeIngredient** | Ingredient + qty + unit | References CanonicalIngredient; optionality flag |
| **MealLog** | "We cooked/ate this" (§7, §9) | Emits `USE_IN_MEAL` transactions per ingredient (fast-follow); nutrition totals derive from it |
| *(Meal/MealPlan)* | Deferred | Multi-day planning (§5) is post-MVP; MealLog suffices until then |
| **ConsumptionEvent / WasteEvent** | Not separate entities | They are ledger transactions (`CONSUME`/`DISCARD`/`EXPIRE`/`DONATE`); analytics are queries over the ledger |

### Shopping
| Entity | Purpose | Notes |
|---|---|---|
| **ShoppingList** | Household-shared list (§6) | MVP: one active list per household |
| **ShoppingListItem** | Ingredient/product + required qty + status | `neededQty = max(0, required − usableOnHand)` computed at generation, editable after; check-off can emit PURCHASE flow |

### AI & decisions
| Entity | Purpose | Notes |
|---|---|---|
| **AIObservation** | Any probabilistic output awaiting/holding disposition | Barcode-photo detection, receipt line parse, vision detection (§2C, §14). `{kind, payload, confidence, modelRef, status: proposed|confirmed|rejected|expired}` |
| **Recommendation** | A recipe suggestion event + user response (§4) | Accept/reject/cooked feeds ranking + telemetry (§15D later) |
| **Provenance** (value object) | See §1 principle 3 | Embedded, not a table of its own necessarily — see [data-model.md](data-model.md) |

## 3. Ledger vs. mutable quantity — tradeoff analysis

**DECIDED** ([ADR-008](../adr/ADR-008-inventory-ledger.md), 2026-09-08; implemented in M1-T1): append-only `InventoryTransaction` ledger + maintained snapshot on `InventoryItem`/`InventoryLot`.

**For the ledger:**
- §7 demands a "historical record of food consumption and waste" and §14 demands explainability — a mutated float provides neither.
- Corrections become first-class data: the correction-rate KPI (§18C, our primary metric) is a query, not new instrumentation.
- Idempotency is natural (transaction keys) — duplicate receipt processing / retried commands can't double-count (MVP acceptance criterion).
- Waste/budget analytics (§15B/C), leftover reasoning (§15E), and sync conflict handling (ADR-010) all become ledger queries/merges later.

**Costs / risks:**
- Reads need a snapshot (or view) — we maintain derived `currentQty` transactionally with each append; a reconciliation job/test asserts `snapshot == Σ transactions` (invariant test, [testing-strategy.md](testing-strategy.md)).
- Slightly more ceremony for the simplest "set qty to 3" UX — modeled as one `ADJUSTMENT` with delta, so still one write.
- Not event sourcing of the whole system: **only inventory** is ledgered. Profiles, lists, recipes remain plain CRUD rows. No event store, no CQRS infrastructure (§ constraint: no premature complexity).

**Rejected alternative:** mutable `quantity` column + audit log on the side. Audit logs drift from truth precisely because they're not the write path; reconciliation becomes impossible to guarantee.

## 4. Invariants (enforced + tested)

1. `InventoryItem.currentQty == Σ qtyDelta` of its lots' transactions (reconciliation).
2. Inventory quantity is never negative in any committed state, at lot or item level. A decrease exceeding the recorded balance is recorded **at its full stated magnitude** and, in the same operation, compensated by a system-authored `ADJUSTMENT` flagged `OVER_CONSUMPTION` carrying the exact residual, leaving the balance at zero. Clamping is per lot (no cross-lot borrowing); all decreasing instruments clamp, `ADJUSTMENT` included. The flag is unforgeable by callers. *(Settled and property-tested in M1-T1.)*
3. Transactions are immutable; corrections are new transactions.
4. Every transaction has an idempotency key; replaying an identical payload is a no-op returning the original row. A key reused with a **materially different payload is rejected** as a conflict, never treated as a replay. Keys are unique within an item's ledger; system rows use the reserved `::` namespace, forbidden in caller keys. *(M1-T1; DB index scope: household-level, see M1-T2.)*
5. Every household-scoped row is reachable only through membership (NFR-1).
6. An `AIObservation` below its kind's confidence threshold cannot transition to `confirmed` without a user action (§14, SR-4).
7. No recommendation may surface a recipe whose known ingredients intersect a member's `AllergyRestriction` set (SR-1) — deterministic check, post-generation.
8. Allergen screening returns a 3-state verdict (`BLOCKED | ALLOWED_WITH_UNKNOWNS | ALLOWED`) with **worst-wins aggregation**: per-restriction outcome → worst across loci → worst across a member's restrictions → household verdict = worst member. `ALLOWED` means *no known match under a valid sourced completeness declaration* — never "safe" — and is unreachable from silence, unsourced declarations, or sub-`KNOWN_FACT` tiers. *(Implemented and adversarially reviewed in M1-T4; policies in D-017.)*

## 5. Open modeling questions

- **OQ-1** Lot granularity for fungibles (rice, oil): per-purchase lots vs single pooled lot per item? `PROPOSED`: lots always, pooled display. Decide with real UX. *M1-T1 note: quantities derive and clamp per lot, so a pooled-lot choice changes UX, not ledger semantics. Still open: which lot a consumption draws from (FEFO/FIFO) — backlogged.*
- **OQ-2** Unit conversion ownership — **RESOLVED (M1-T3).** Conversion lives in `packages/domain/src/units/**`, a standalone module beside the inventory ledger, not inside it. The ledger is unchanged: an `InventoryItem` declares one `Unit` and every lot/transaction must match it exactly (`MIXED_UNITS` rejected, never converted). Same-kind conversion (MASS g/kg/oz/lb; VOLUME ml/l/tsp/tbsp/cup/pt/qt/gal; COUNT) uses exact rational registry factors, ground-truth-pinned in tests. Cross-kind conversion requires an explicit caller-supplied `ConversionBridge` (density, per-item weight) — no built-in or default density anywhere; absent a bridge it is a typed `INCOMPATIBLE_UNITS` error, never a guess. *Still open, deferred to M2:* where bridge data lives and which service resolves it before calling `convertWithBridge` (data-modeling/service-wiring, not a units question).
- **OQ-3** Are member profiles (weight, goals) per-user-private or household-visible? (Q3/Q5 to product owner; privacy default: private to the member.)
