# MVP PRD — Smart Kitchen App

**Status:** PROPOSED (awaiting product-owner approval — see [DECISIONS.md](../../DECISIONS.md) D-002)
**Sources:** product brief ([extracted](../source/product-brief.extracted.md)); requirement digest ([PRODUCT.md](../../PRODUCT.md)). § refs cite brief sections.

---

## 1. Problem statement

`DOCUMENTED` (§1, §16–18) Households don't know what food they own, so they buy duplicates, waste expiring food, and fall back to generic recipe apps that ignore their actual pantry. Existing apps fail because they make the *user* maintain the inventory — a spreadsheet with extra steps — and users quit (§18C, §18F).

## 2. Target user (MVP)

`INFERRED` One US household (1–4 adults), one shared inventory, driven by the member who plans meals and shops. Locale = US-only for MVP (**OPEN Q1**, [PRODUCT.md §8](../../PRODUCT.md#8-unanswered-questions-product-owner-input-needed)).

## 3. Product hypothesis (what MVP must prove)

> **The system can maintain a sufficiently accurate picture of household food inventory with low enough friction that users keep it alive — and that this inventory makes "what should I cook / what should I buy" decisions materially better than a generic recipe app.**

The differentiator is **not** recipe generation (commoditized, §16). It is trusted, low-effort inventory plus the closed loop built on top of it (§17.2, §17.3, §18C, §18F).

**Falsifiable success signals** (see §12 Telemetry):
- Inventory correction rate declines with usage and stays below a tolerance threshold.
- ≥ some target share of recommended recipes are accepted/cooked.
- Users return to the inventory weekly without prompting.

## 4. MVP scope decision — challenge to the brief's Phase 1

`PROPOSED DECISION` The brief's Phase 1 (§19) lists ~14 capabilities including receipt OCR **and** AI photo recognition **and** recommendations **and** nutrition tracking. That is 3–4 products' worth of probabilistic pipelines before the core hypothesis is tested. We cut to the smallest coherent vertical slice that exercises the full loop once:

### MUST exist in MVP
| Capability | Notes | Source |
|---|---|---|
| Account signup/login | Simplest robust option (managed auth candidate, [ADR-004](../adr/ADR-004-authentication.md)) | §19 |
| Household (single, shared) | Multi-member **data model** from day 1; polished invite UX deferred | §12 |
| Inventory w/ storage locations | Fridge/freezer/pantry/other; ledger-based, auditable ([ADR-008](../adr/ADR-008-inventory-ledger.md)) | §2A, §7 |
| Barcode scan → product | Lookup cascade behind adapter + manual-completion fallback | §2A |
| Manual add / adjust / deplete | With reasons (used/discarded/expired/…) — the correction path is core UX, not an afterthought | §7, §18C |
| Allergy profiles | Hard exclusions; deterministic filtering; safety language | §3, §18E |
| Dietary preferences (basic) | Soft ranking signals only | §3 |
| Inventory-aware recipe recommendations | AI-generated original recipes from on-hand items; ranked deterministically; allergen-filtered deterministically | §4, §18D, §18E |
| Shopping list gap computation | required − usable on-hand → BUY / ALREADY HAVE; editable; syncs | §6 |
| Purchase → inventory close-the-loop | Checking off shopping items offers to add them to inventory | §1 (closed loop) |
| Cloud sync (online-first) | Server is source of truth; client caches for read; full offline **deferred** ([ADR-010](../adr/ADR-010-offline-sync.md)) | §1, §13 |
| Provenance & confidence on facts | Known Fact / Estimated / AI Interpretation surfaced in UI | §14 |

### SHOULD follow immediately after MVP (fast-follow)
- Receipt scanning + confirmation screen (§2B) — the biggest automation win, but the heaviest probabilistic pipeline (OCR → parse → normalize → confirm, §18B). Built as fast-follow so its normalization layer can reuse a proven product model. If early users report barcode-only entry is too much friction, this is the first thing pulled forward.
- Expiration estimates + "use it soon" surfacing (§8) — MVP stores optional expiration dates; estimation/notification engine is fast-follow.
- Basic calorie display on recipes/products (§9) — display, not a tracking dashboard.
- Household invitations/sharing UX polish (§12).
- Meal logging → automatic inventory decrement (§7) — MVP ships manual "I used this"; recipe-driven decrement with per-ingredient quantities is fast-follow.

### Can be MOCKED / STUBBED during validation
- Product database: fixture-backed lookup adapter (≈100 curated products) so client/API development never blocks on live APIs.
- LLM recipe generation: recorded fixture responses for tests and demos.
- OCR: fixture receipt images + golden parsed outputs (pipeline built against fixtures before any vendor call).

### DEFER (post fast-follow)
- Visual pantry recognition (§2C — the brief itself calls it future), conversational assistant (§10), multi-day meal planning (§5), macro dashboard (§9), leftovers (§15E), portion scaling (§15F), recipe learning (§15D), waste/budget analytics (§15B/C), voice (§11).

### Do NOT build until product-market evidence exists
- Smart-home integrations (§11), store price comparison / shopping routes (§15A), grocery delivery, predictive purchasing, AI nutrition coach (§19 Phase 3).

**Explicitly not optimizing for demo appearance:** photo-the-fridge and chat demos are flashy but test nothing about sustained inventory accuracy, which is the hypothesis.

## 5. Goals / non-goals

**Goals:** prove the hypothesis in §3; establish the ledger + provenance foundation every later feature depends on; keep unit costs measurable from day 1.

**Non-goals (MVP):** offline-first sync; iPad/web clients; multiple households per user; i18n; social features; any Phase-2/3 brief feature not listed above.

## 6. Primary workflows (MVP)

1. **Onboard:** sign up → create household → add allergies (with safety copy) + dietary preferences → land on empty inventory with "scan your first item."
2. **Add via barcode:** scan → product found (Known Fact badge) → confirm qty ×N units + location → ledger `PURCHASE` transactions. Not found → prefill what any source returned → manual completion (fields marked by provenance).
3. **Manual add/adjust/deplete:** search-or-create item → qty/location/optional expiration; depletion requires a reason (§7 list); every change is a ledger transaction, nothing silently overwritten.
4. **Get recommendations:** "What can I make?" → 3–5 AI-generated recipes from on-hand inventory → each shows used-from-inventory vs missing ingredients, prep time, est. calories (marked Estimated), and passed-allergen-screen status → user accepts/rejects (telemetry).
5. **Shopping list:** from accepted recipe(s) or manual entry → gap computation vs inventory → BUY / ALREADY HAVE → editable → shared → checking off items prompts "add to inventory?"
6. **Correct the system:** every inventory row shows its history ("why does the app think I have 1.25 lb chicken?") and offers one-tap correction. Corrections are `ADJUSTMENT` transactions and feed the correction-rate metric.

## 7. Functional requirements

FR-1 to FR-30 style detail lives in tickets ([BACKLOG.md](../../BACKLOG.md)); the binding ones:

- **FR-INV-1** All inventory changes are append-only transactions (type, qty delta, unit, reason, actor, timestamp, provenance, idempotency key). Current quantity is derived/reconcilable from transactions. (§7, §14; [ADR-008](../adr/ADR-008-inventory-ledger.md))
- **FR-INV-2** Purchasing N units of a package creates N countable units (§2A "2 × 16 oz yogurt").
- **FR-INV-3** Manual correction is always available and never blocked by AI state (§7, §18C).
- **FR-BC-1** Barcode lookup resolves through an adapter cascade; result fields carry per-field provenance; unresolved codes degrade to manual entry with the code retained for later enrichment (§2A, §18A).
- **FR-ALG-1** Allergen exclusion is a deterministic filter over verified ingredient/allergen data applied to every recommendation *after* generation; LLM output never bypasses it (§3, §18E).
- **FR-ALG-2** UI never states a food is "safe"; when allergen data is missing, that absence is displayed as unknown, with a warning for serious allergies (§3).
- **FR-REC-1** Recipes are AI-original; no scraped content (§18D). Prompt context = inventory + preferences; ranking (inventory utilization, missing count, prep time) is computed deterministically server-side (§4).
- **FR-SL-1** shopping_qty = max(0, required − usable_on_hand), unit-aware; items below threshold appear in BUY; on-hand items listed under ALREADY HAVE (§6).
- **FR-SYNC-1** Server is source of truth; writes are idempotent (client-generated keys); clients converge after reconnect (§13).
- **FR-PROV-1** Every stored food fact carries provenance ∈ {KNOWN_FACT, ESTIMATED, AI_INTERPRETATION} + source + timestamp (+ confidence and confirmation state where AI-derived); UI surfaces the tier (§14).

## 8. Non-functional requirements

- **NFR-1 Isolation:** household A can never read/write household B data (enforced at API layer + tested; candidate DB-level enforcement in [data-model.md](../architecture/data-model.md)).
- **NFR-2 Latency:** interactive CRUD < 500 ms p95 server-side; recommendation generation may be async with progress UI (`INFERRED` targets — tune later).
- **NFR-3 Cost:** per-recommendation LLM cost tracked and capped; product lookups cached (see ARCHITECTURE.md cost section).
- **NFR-4 Privacy/security:** per threat model in [ARCHITECTURE.md](../../ARCHITECTURE.md#7-security--privacy-threat-model); allergy/health-adjacent data treated as sensitive.
- **NFR-5 Testability:** all external providers behind interfaces with fixture implementations; domain logic pure and unit-testable ([testing-strategy.md](../architecture/testing-strategy.md)).

## 9. Safety requirements

- **SR-1** Allergen decisions: deterministic data + rules; AI advisory only (§18E). Enforced by architecture (the filter lives in the deterministic core, [ai-architecture.md](../architecture/ai-architecture.md)).
- **SR-2** Never claim guaranteed safety; unknown allergen data ⇒ explicit unknown + warning (§3).
- **SR-3** Nutrition numbers shown to users come from verified sources or are labeled Estimated; arithmetic (totals, remaining budget) is deterministic (§9, §14).
- **SR-4** Low-confidence AI detections require user confirmation before entering inventory (§14).

## 10. Data requirements

- Normalized internal product catalog (own DB, multiple upstream sources, §18A) — see [data-model.md](../architecture/data-model.md).
- Allergen taxonomy: FDA major-allergen list + user-defined entries (§3).
- Units: mass/volume/count with per-product conversion where known; unknown conversions degrade gracefully (never invent densities — `INFERRED` from §14 honesty principle).
- Retention: receipts/images (fast-follow) get an explicit retention policy before launch (threat model).

## 11. AI behavior requirements

- All AI calls go through provider-agnostic adapters ([ADR-005](../adr/ADR-005-ai-provider-abstraction.md)).
- Every AI output stored = { output, model+version, prompt/context ref, confidence (where available), timestamp, user-confirmation state } (§14).
- AI never writes directly to the ledger; it proposes, deterministic code + (where required) user confirmation disposes (§2C pattern generalized).
- Prompt-injection stance: any text originating from OCR/receipts/product data/user free text is untrusted data, never instructions ([ai-architecture.md](../architecture/ai-architecture.md)).

## 12. Analytics / telemetry (MVP)

Product-health first (see [ARCHITECTURE.md observability](../../ARCHITECTURE.md#8-observability)):

1. **Inventory correction rate** — corrections ÷ total inventory transactions, per household per week. *The* primary metric (§18C).
2. Recommendation acceptance rate (accepted / shown).
3. Barcode resolution rate (resolved / scanned) and manual-completion rate.
4. Weekly active inventories (households with ≥1 non-correction transaction).
5. Shopping-list close-the-loop rate (checked-off items added to inventory).
6. Cost per household per week (LLM + lookups).

## 13. Acceptance criteria (MVP release gate)

- A new user can: sign up → create household → add 10 items via barcode/manual → get ≥3 allergen-safe recipe recommendations using ≥2 on-hand items each → generate a shopping list with correct BUY/ALREADY HAVE math → check off purchases into inventory — on two devices sharing one household, seeing consistent state.
- Ledger invariants hold under property tests (reconciliation, no silent disappearance — [testing-strategy.md](../architecture/testing-strategy.md)).
- Allergen filter blocks a seeded "peanut in ingredients + peanut allergy" case in E2E, regardless of LLM output.
- Duplicate submission of any write (double-tap, retry) produces no duplicate transactions.
- All telemetry in §12 emitting.

## 14. Open questions

Q1–Q8 in [PRODUCT.md §8](../../PRODUCT.md#8-unanswered-questions-product-owner-input-needed) plus:
- **Q9** Minimum viable product-catalog size/quality for barcode UX to feel "magic" vs frustrating? (RESEARCH REQUIRED — coverage spike, ticket M1-T5.)
- **Q10** Should MVP recommendations require zero missing ingredients, or allow ≤N with shopping-list handoff? (`PROPOSED`: allow ≤3 missing, ranked down — matches §4 ranking factor.)

## 15. Future scope

Everything in §4's DEFER/NOT-YET lists, sequenced in [BACKLOG.md](../../BACKLOG.md) M5+ and brief Phases 2–3 (§19).
