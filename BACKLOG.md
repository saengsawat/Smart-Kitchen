# BACKLOG.md — Implementation Backlog

Authoritative work plan. Structure: **Milestone → Epic → Ticket**. Only M0 and M1 are fully ticketed (per plan discipline — no speculative ticket dumps); M2–M9 stay at epic level until their predecessor is underway. Sequencing is dependency-driven, not demo-driven.

> **Tracking view:** a spreadsheet mirror of this backlog (tickets, model recommendations, status column) lives in `BACKLOG_TRACKER.xlsx` / `BACKLOG_TRACKER.csv` for status tracking. **This file remains authoritative** for ticket content; when tickets change here, regenerate/update the tracker (status values live in the tracker only).

**Gate:** No implementation starts until the product owner approves D-002 (MVP scope) and D-003 (ledger) in [DECISIONS.md](DECISIONS.md). Ticket 1 additionally requires explicit go-ahead from the product owner (per founding task).

**Ticket template** — every ticket includes, in order:

1. **Implementation model:** Sonnet | Opus — reason
2. **Review model:** Sonnet | Opus — reason
3. **Objective**
4. **Context**
5. **Dependencies**
6. **Invariants**
7. **Acceptance criteria**
8. **Tests required**
9. **File scope**
10. **Out of scope**
11. **Definition of done (DoD)**

Model routing rules (default Sonnet; Opus for the high-risk domain list; separate reviewer always required before done) are defined in [CLAUDE.md rules 20–27](CLAUDE.md). The architect sets the model lines; deviating requires architect sign-off recorded on the ticket. Work outside a ticket's file scope requires escalation, not improvisation.

---

## Milestone 0 — Engineering foundation
*Goal: a repo where `git clone → install → test` works, CI enforces quality, and module boundaries exist before code fills them.*

### Epic M0-E1: Workspace & quality gates

#### M0-T1 — Repo & workspace scaffolding ✅ DONE 2026-09-03
*Sonnet impl → independent Sonnet review (PASS WITH FIXES: `.gitattributes`, release-age comment — applied & re-verified) → accepted & merged. ADR-002 framework question closed (Fastify) before dispatch.*
- **Implementation model:** Sonnet — routine tooling/config on well-trodden patterns; no domain logic, no data-integrity risk.
- **Review model:** Sonnet — low blast radius; review focuses on boundary-lint correctness and script reproducibility.
- **Objective:** pnpm monorepo with `apps/api`, `packages/domain`, `packages/contracts`, `packages/adapters` (placeholder packages, no product logic); TypeScript strict everywhere; ESLint + Prettier; Vitest wired; dependency-boundary lint rule proving `domain` imports nothing but stdlib.
- **Context:** ARCHITECTURE.md §2; ADR-002 (resolve Fastify-vs-Nest spike inside this ticket and record in ADR-002/DECISIONS).
- **Dependencies:** D-002/D-003 approval; Node LTS + pnpm locally.
- **Invariants:** `packages/domain` has zero runtime deps and zero I/O; lockfile committed; no secrets anywhere (`.env.example` names only).
- **Acceptance criteria:** fresh clone → `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passes; a deliberate `domain → adapters` import fails lint.
- **Tests:** one placeholder unit test per package proving the harness runs.
- **File scope:** repo root configs, `apps/api/*`, `packages/*` skeletons, `.gitignore`, `.editorconfig`, `.env.example`.
- **Out of scope:** CI (M0-T2), any domain logic, DB, client app.
- **DoD:** CI-ready scripts documented in README dev section; ADR-002 framework question closed; STATUS.md updated.

#### M0-T2 — CI pipeline & quality gates ✅ DONE 2026-09-08
*Sonnet impl → independent Sonnet review (PASS, no fixes — all runs re-verified via live Actions API) → accepted & merged. Worker deviation (dropping `version:` input from pnpm/action-setup in favor of exact `packageManager` pinning) architect-approved: forced by action incompatibility, disclosed with run evidence, strictly tighter pinning. Branch protection = owner checklist in CONTRIBUTING.md; architect verifies the `protected` flag after the owner applies it.*
- **Implementation model:** Sonnet — standard CI configuration; security-adjacent (secret/dependency scanning) but assembled from stock actions, verified by deliberate-failure PRs.
- **Review model:** Sonnet — acceptance criteria are self-demonstrating (the three failing test PRs); reviewer checks gate coverage and branch protection.
- **Objective:** CI (GitHub Actions assumed once hosting of repo is settled — confirm) running lint, typecheck, unit tests, **format check** (now that `.gitattributes` normalizes line endings), dependency-boundary check, secret scan (gitleaks-class), dependency audit on every PR; trunk-based flow with short-lived branches; conventional commits with ticket refs documented; short CONTRIBUTING notes incl. Windows long-path caveat (`git config core.longpaths true` / Win32 long paths — M0-T1 follow-up) and pnpm/corepack setup.
- **Context:** ARCHITECTURE.md quality baseline; CLAUDE.md rules. Remote decided 2026-09-03: `github.com/saengsawat/Smart-Kitchen` (main) → GitHub Actions confirmed as CI host.
- **Dependencies:** M0-T1 (done); GitHub remote (done).
- **Invariants:** no merges to main with red CI; lockfile drift fails CI (`--frozen-lockfile`).
- **Acceptance criteria:** a branch/PR with a lint error, a leaked fake secret, or a domain-boundary violation each fail CI visibly (workflow triggers on both `push` and `pull_request`, so pushed demo branches prove the gates without PR tooling).
- **Tests:** CI exercised by three deliberate-failure demo branches, run conclusions verified via the repo's public Actions API, then demo branches deleted.
- **File scope:** `.github/workflows/*`, `CONTRIBUTING.md` (or README CONTRIBUTING section), README badge/link lines.
- **Out of scope:** deployment, E2E infra, coverage gates, installing new local tooling (incl. `gh` CLI — not installed; do not install without approval).
- **DoD:** CI green on main; badges/links in README; **branch-protection checklist delivered for the owner to apply in repo Settings** (no admin API access from this machine — architect verifies application at acceptance); STATUS.md updated (architect, on acceptance).
- *Architect amendment 2026-09-08:* verification method and branch-protection delivery adjusted for missing `gh` CLI; substance of gates unchanged.

---

## Milestone 1 — Domain core + inventory ledger
*Goal: the product's heart — ledger, units, allergen rules, gap math — as pure, property-tested TypeScript with no server, no DB dependency for logic, plus the first real schema. Proves ADR-008 in code.*

### Epic M1-E1: Deterministic domain package

#### M1-T1 — Inventory ledger core ✅ DONE 2026-09-08
*Opus worker → independent Opus review (PASS WITH FIXES: forged-systemFlag spread + rehydration input-trust — fixed by worker, re-reviewed, final PASS; fixes mutation-proven) → squash-merged (keeps a gitleaks false-positive fixture commit out of main history). 75 tests incl. INV-LEDGER-1..4 property suites. Handoff: [worker](docs/handoff/M1-T1.worker.md) · [review](docs/handoff/M1-T1.review.md). Clamp/idempotency semantics recorded under D-003.*
- **Implementation model:** **Opus** — the highest-risk domain work in the system: ledger/reconciliation math, idempotency semantics, immutability guarantees (CLAUDE.md rule-23 list, multiple hits).
- **Review model:** **Opus** — invariants INV-LEDGER-1..4 are permanent product guarantees; review must adversarially probe derivation, replay, and negative-quantity edge cases.
- **Objective:** `packages/domain/inventory`: transaction types (`PURCHASE|CONSUME|USE_IN_MEAL|DISCARD|EXPIRE|DONATE|ADJUSTMENT|INITIAL_STOCK`), lot/item aggregates, quantity derivation, idempotency-key semantics, negative-quantity policy (implement the clamp+flagged-adjustment proposal; record outcome in domain-model OQ).
- **Context:** [domain-model.md](docs/architecture/domain-model.md), [ADR-008](docs/adr/ADR-008-inventory-ledger.md), brief §7.
- **Dependencies:** M0-T1.
- **Invariants:** INV-LEDGER-1..4 ([testing-strategy.md §2](docs/architecture/testing-strategy.md#2-named-invariant--property-tests)).
- **Acceptance criteria:** derivation over any generated transaction sequence reconciles; replay with same key is a no-op; immutability enforced by types + runtime guard.
- **Tests:** property tests (fast-check) for INV-LEDGER-1..4; example-based tests for each transaction type incl. the brief's worked example (2.0 − 0.75 = 1.25 lb chicken, §7).
- **File scope:** `packages/domain/src/inventory/**`, its tests.
- **Out of scope:** persistence, API, units beyond pass-through (M1-T3).
- **DoD:** invariant tests named with their IDs; domain-model.md updated where implementation refined the model.

#### M1-T2 — Postgres schema & migrations: identity, household, inventory ✅ DONE 2026-09-10 — **MILESTONE 1 COMPLETE**
*Opus worker → adversarial Opus review (PASS WITH FIXES: INV-LEDGER-4 failed OPEN via RLS-filtered non-definer trigger; ledger-length oracle via unscoped unique index — both closed against the reviewer's original repros; worker also self-found a CREATE ROLE CI race) → final PASS → squash-merged. 96 DB tests (475 total w/ DB). ADR-003 → DECIDED (Postgres + RLS, three standing schema rules); ADR-008 snapshot question closed (DB trigger). Handoff: [worker](docs/handoff/M1-T2.worker.md) · [review](docs/handoff/M1-T2.review.md).*
- **Implementation model:** **Opus** — sensitive schema for inventory history, append-only enforcement, tenancy isolation/RLS spike, snapshot-consistency decision (rule-23 list: authorization + schema migrations affecting inventory history).
- **Review model:** **Opus** — isolation and append-only guarantees must survive adversarial review; migration reversibility affects everything downstream.
- **Objective:** first migrations for users/households/memberships + inventory items/lots/transactions per [data-model.md](docs/architecture/data-model.md); migration tooling chosen (with ORM/query-layer decision from ADR-002 open question); append-only enforcement; snapshot-maintenance approach decided (app-tx vs trigger) and recorded; RLS spike → decision recorded in ADR-003/DECISIONS.
- **Context:** data-model.md §2–5; runs against real Postgres in CI — **no cloud resources**.
- *Architect amendment 2026-09-10 (Docker not installed on the dev machine):* DB tests key off `DATABASE_URL` and **skip loudly** when it is absent locally; `.github/workflows/ci.yml` gains a Postgres **service container** for the `quality` job so the tests always run and gate in CI (ci.yml is therefore IN scope for this ticket, narrowly). Local containerized Postgres becomes possible once Docker is installed (owner's call, CONTRIBUTING note).
- **Dependencies:** M1-T1 (types inform columns); D-007 ratified enough to proceed (PROPOSED→DECIDED expected here).
- **Invariants:** INV-TENANT-1 test harness exists (even with only fixture users); ledger tables reject UPDATE/DELETE from app role.
- **Acceptance criteria:** migrate up/down clean on empty + seeded DB; reconciliation query matches domain derivation on generated data.
- **Acceptance additions from M1-T1 (architect, 2026-09-08):** unique idempotency index scoped `(household_id, idempotency_key)` (ruling on M1-T1 §8.1 — batch imports suffix per line); snapshots updated in the same DB transaction as the append; reconciliation query must agree with domain `reconcile()` on generated data; `rehydrateInventoryItem` is the reference corruption detector for rows read back; store both `qty_delta` and exact `qty_delta_micros`.
- **Tests:** database tests per testing-strategy §1 (constraints, append-only, isolation), migration reversibility.
- **File scope:** `apps/api/db/**` (migrations), `packages/domain` untouched except type exports.
- **Out of scope:** HTTP endpoints (M2), auth integration (M2), receipt/shopping tables (later migrations).
- **DoD:** ADR-003 marked DECIDED (with evidence) or blockers recorded; RLS decision logged.

#### M1-T3 — Units & quantity model ✅ DONE 2026-09-09
*Sonnet worker → independent Opus review (PASS WITH FIXES: unpinned volume anchor — imperial-gallon swap passed the whole suite; makeBridge throw on exponential ratios; alias leak; non-antisymmetric comparator — fixed, re-reviewed, final PASS with mutations re-run) → squash-merged. 150 tests; factor table ground-truth-pinned. Handoff: [worker](docs/handoff/M1-T3.worker.md) · [review](docs/handoff/M1-T3.review.md). OQ-2 resolved in domain-model.md.*
- **Implementation model:** Sonnet — pure, well-specified conversion functions with strong property tests; errors are loud (typed `IncompatibleUnits`), not silent.
- **Review model:** **Opus** — escalated despite routine implementation: INV-SHOP-1 and future nutrition math sit on top of this; silent conversion errors would corrupt inventory arithmetic (rule-23 adjacency).
- **Objective:** `packages/domain/units`: mass/volume/count kinds, conversion within kind, product-specific cross-kind conversion only where data exists, graceful `IncompatibleUnits` failures (never guessed densities).
- **Context:** brief §6 examples mix lbs/cups/tbsp; INV-SHOP-1 depends on this; domain-model OQ-2.
- **Dependencies:** M0-T1.
- **Invariants:** conversions round-trip within tolerance; incompatible conversions are typed errors, not numbers.
- **Acceptance criteria:** brief §6 worked example computes exactly (chicken 2−1=1 lb; rice covered; broccoli 2−0=2 lb).
- **Tests:** property tests (round-trip, associativity of scaling), exhaustive kind-pair matrix.
- **File scope:** `packages/domain/src/units/**` + tests.
- **Out of scope:** localization of display units.
- **DoD:** OQ-2 resolved or narrowed in domain-model.md.

#### M1-T4 — Allergen rule engine (deterministic) ✅ DONE 2026-09-10
*Opus worker (restarted post-reboot) → adversarial Opus review (PASS WITH FIXES: three fail-open paths to ALLOWED — prototype-key code lookup, name-satisfied completeness gate, zero-width obfuscation — plus totality and alias-coverage gaps; fixed, re-reviewed against original repros, final PASS) → squash-merged. 163 allergen tests (379 total), mutation-pinned. Policies ratified as **D-017**; UI copy requirements recorded on M3/M6 epics. Handoff: [worker](docs/handoff/M1-T4.worker.md) · [review](docs/handoff/M1-T4.review.md).*
- **Implementation model:** **Opus** — allergen enforcement is explicitly on the rule-23 high-risk list; safety-critical semantics (`allowed-with-unknowns`, never "safe") must be exactly right.
- **Review model:** **Opus** — adversarial review required (INV-ALRG-1/2); a reviewer must actively try to construct inputs that slip past the screen.
- **Objective:** `packages/domain/allergens`: allergen taxonomy (FDA major allergens + user-defined), `AllergenAssertion` evaluation, recipe-vs-restrictions screening returning `{blocked | allowed-with-unknowns | allowed}` — *never* a plain "safe".
- **Context:** brief §3, §18E; SR-1/SR-2; [ai-architecture.md §2](docs/architecture/ai-architecture.md#2-capability-by-capability-boundaries).
- **Dependencies:** M0-T1; fixture products with allergen data (M1-T5 fixtures usable early).
- **Invariants:** INV-ALRG-1, INV-ALRG-2.
- **Acceptance criteria:** adversarial fixture (recipe containing peanut against peanut allergy) blocked regardless of any other field; missing data yields `allowed-with-unknowns` + warning payload.
- **Tests:** unit + adversarial fixtures from `tests/fixtures/recommendations/`.
- **File scope:** `packages/domain/src/allergens/**` + tests + `tests/fixtures/products|recommendations` additions.
- **Out of scope:** LLM integration, UI copy (copy requirements noted for M3/M6).
- **DoD:** screening API documented; safety language requirements captured for client tickets.

### Epic M1-E2: Product knowledge foundations

#### M1-T5 — Product lookup port + fixture adapter + coverage research spike ✅ DONE 2026-09-09
*Sonnet worker → independent Sonnet review (PASS WITH FIXES: three report-accounting corrections, doc-only; research numbers recomputed exact from raw JSON, live OFF spot-checks reproduced, synthetic codes live-verified non-colliding) → squash-merged. 216 tests. R-1 delivered → ADR-006 OPEN → PROPOSED (PLU sub-decision settled; FDC arm honestly unmeasured). Handoff: [worker](docs/handoff/M1-T5.worker.md) · [review](docs/handoff/M1-T5.review.md) · [research](docs/research/food-data-coverage.md).*
- **Implementation model:** Sonnet — adapter interfaces, fixture plumbing, and a read-only research script; no domain invariants at stake.
- **Review model:** Sonnet — review checks port-boundary hygiene (no vendor types leaking, provenance present) and that the research method/numbers in the spike doc hold up.
- **Objective:** `ProductLookupPort`/`NutritionSourcePort` interfaces in `packages/adapters`; fixture-backed implementations over `tests/fixtures/products|barcodes` (~100 curated synthetic products per testing-strategy §3); **research spike:** measure Open Food Facts + USDA FDC hit-rate on a realistic ~100-item US grocery basket (read-only API calls, free tiers, no keys committed) and write results to `docs/research/food-data-coverage.md`.
- **Context:** [ADR-006](docs/adr/ADR-006-food-data-sources.md) is OPEN pending exactly this evidence (R-1); brief §18A.
- **Dependencies:** M0-T1.
- **Invariants:** no vendor SDK types leak through the port; per-field provenance on every returned record.
- **Acceptance criteria:** fixture adapter serves hit/miss/conflict cases; spike doc reports hit-rates + data-quality notes + ODbL/licensing questions for counsel (R-4).
- **Tests:** contract tests over fixtures; adapter schema-validation tests.
- **File scope:** `packages/adapters/src/product-lookup/**`, `tests/fixtures/products|barcodes/**`, `docs/research/food-data-coverage.md`.
- **Out of scope:** live-source caching layer, our-catalog merge logic (M4), any paid API signup (requires approval per CLAUDE.md).
- **DoD:** ADR-006 updated from OPEN → PROPOSED with evidence, or gap documented.

### Epic M1-E3: Foundation follow-ups (PO-approved 2026-09-14 — D-018)
*Scope rule for this epic: only work that needs **no spend and no PO/originator decision** (D-018). Everything here was already accepted as a follow-up at an M1 acceptance; these tickets make them buildable. Order: T6 → T7 → T8 → T9 → T10, one at a time, architect-dispatched (rules 28–30). PO has asked for a **stop after T10 is accepted**.*

#### M1-T6 — Allergen screening: malformed allergen containers fail closed (mandatory pre-M4 gate a)
- **Implementation model:** **Opus** — allergen enforcement (rule-23 list); the change is small but it closes a fail-open path to `ALLOWED`, and three such paths were found in M1-T4 review.
- **Review model:** **Opus** — adversarial: the reviewer must try to construct a malformed input that still reaches `ALLOWED` under a valid declaration (INV-ALRG-2).
- **Objective:** `parseAssertions`/`asAssertionList` in `packages/domain/src/allergens/screen.ts` currently coerce a structurally malformed `allergens` field (`"peanut"`, `5`, `{}`, `["peanut"]`, `[null]`) to "no assertions", so under a valid sourced `KNOWN_FACT` declaration the locus reaches `ALLOWED`. Malformed containers and malformed elements must instead be recorded as **uninterpreted** data (new `UnknownReason` `MALFORMED_ALLERGEN_DATA`), which already refuses the absence licence (`licensesAbsence` returns false on any uninterpreted entry) and raises `UNRECOGNIZED_ALLERGEN_DATA`.
- **Context:** [M1-T4 review §"Mandatory pre-M4 follow-up"](docs/handoff/M1-T4.review.md); D-017; SR-2; rule 9 (data may add unknowns, never clear them).
- **Dependencies:** M1-T4 (done).
- **Invariants:** INV-ALRG-1, INV-ALRG-2. **Distinguish absent from malformed:** `allergens` missing/`undefined` and `allergens: []` remain "no assertions" (they are honest); only a present-but-wrongly-shaped container or element is malformed. `BLOCKED` results must be unchanged everywhere (this fix can only move `ALLOWED` → `ALLOWED_WITH_UNKNOWNS`).
- **Acceptance criteria:** (1) for every malformed shape above, on both `PRODUCT` and `RECIPE_INGREDIENT` loci, with a valid sourced `KNOWN_FACT` complete declaration, the verdict is `ALLOWED_WITH_UNKNOWNS` with a `ScreeningUnknown` whose `reason` is `MALFORMED_ALLERGEN_DATA` and whose `detail` names the offending shape, plus the `UNRECOGNIZED_ALLERGEN_DATA` warning; (2) a well-formed array element alongside a malformed one is still parsed (a `CONTAINS peanut` next to a `null` still blocks a peanut allergy); (3) `screenSubject` stays total — zero throws across the malformed matrix; (4) a property test: for any generated subject carrying a malformed container, verdict ≠ `ALLOWED` for every member with ≥1 restriction; (5) mutation check reported: reverting the fix fails ≥1 test per malformed shape.
- **Tests required:** unit matrix (shapes × locus kinds × restriction kinds), the property test, the mutation table in the worker report; one new recommendations fixture `screening-016-malformed-allergens-not-allowed.json` in `tests/fixtures/recommendations/` **and** its inline mirror in the domain corpus test (domain has no I/O).
- **File scope:** `packages/domain/src/allergens/{screen,types}.ts`, `packages/domain/src/allergens/*.test.ts`, `tests/fixtures/recommendations/**` (+ its README index line), `docs/handoff/M1-T6.worker.md`.
- **Out of scope:** declaration minting policy (D-017 open item — PO decision, pre-M4 gate b); taxonomy changes; adapters.
- **DoD:** rule 26; worker report lists the mutation results and proposes the `UnknownReason` doc line for `domain-model.md` §2 (architect applies at acceptance).

#### M1-T7 — Correction-rate telemetry: SQL view + read function (north-star KPI)
- **Implementation model:** Sonnet — a read-only view and a repository read; the metric definition is fixed below, so no domain judgement is needed.
- **Review model:** **Opus** — the view sits on tenant tables (ADR-003 standing rule 3: `security_invoker` or it leaks across households — tenancy is on the rule-23 list) and the KPI must count exactly the rows the definition says.
- **Objective:** migration `0007_correction_telemetry.sql` creating view `inventory_correction_telemetry` (`WITH (security_invoker = true)`) over `inventory_transactions`, one row per `(household_id, item_id)`, with columns: `statement_count` (rows that are **not** system clamp rows), `user_adjustment_count` (`type = 'ADJUSTMENT' AND actor_kind = 'user'`), `clamp_count` (`system_flag_kind = 'OVER_CONSUMPTION'`), `correction_event_count` (= user adjustments + clamps), `correction_rate` (`correction_event_count::numeric / statement_count`, `NULL` when `statement_count = 0`), `first_recorded_at`, `last_recorded_at`. Plus `apps/api/src/db/telemetry/correction-rate.ts` exporting `readCorrectionTelemetry(client, householdId, {since?, until?})` — household-level aggregate and per-item rows, computed in SQL over `recorded_at` bounds (`since` inclusive, `until` exclusive), returning exact strings/bigint counts (no float arithmetic on counts; rate as Postgres `numeric` text).
- **Context:** brief §18C (correction rate is the product's north-star metric); [M1-T1 review](docs/handoff/M1-T1.review.md) ("makes the correction-rate KPI a direct query"); [M1-T2 worker §11 item 3](docs/handoff/M1-T2.worker.md); ARCHITECTURE.md §8 observability; migration 0005 header (telemetry named as a job of the reconciliation views).
- **Dependencies:** M1-T2 (done).
- **Invariants:** view is `security_invoker = true` and reads as `sk_app` return **only** the session household's rows (INV-TENANT-1 pattern from `tenancy.test.ts`); no household context ⇒ zero rows, never all rows; the view is read-only for `sk_app` (SELECT grant only); metric definition **PROPOSED** as above — the worker implements it verbatim and does not redefine it; the architect records it in ARCHITECTURE §8 at acceptance.
- **Acceptance criteria:** on a seeded ledger with known composition (e.g. 6 statements: 1 `INITIAL_STOCK`, 2 `CONSUME`, 1 user `ADJUSTMENT`, 1 over-consuming `CONSUME` that produced 1 clamp) the view returns `statement_count=5`, `user_adjustment_count=1`, `clamp_count=1`, `correction_event_count=2`, `correction_rate=0.4` exactly; clamp rows are excluded from `statement_count` and counted once; a `system` `ADJUSTMENT` that is not a clamp counts as a statement, not a correction; `since`/`until` boundaries behave inclusive/exclusive; migrate down drops the view cleanly; `pnpm test` with `DATABASE_URL` green, without it the new suite skips loudly with the CI guard (harness pattern).
- **Tests required:** DB tests (DATABASE_URL-gated via `test-support/harness.ts`): composition test above; tenancy test as `sk_app` (household A sees only A; B only B; `null` context sees none); grants test (`sk_app` cannot `INSERT`/`UPDATE` the view); period-bound tests; migration reversibility.
- **File scope:** `apps/api/db/migrations/0007_correction_telemetry.sql`, `apps/api/src/db/telemetry/**` (new), `apps/api/src/db/migrations.test.ts` (if it enumerates migrations), `docs/handoff/M1-T7.worker.md`.
- **Out of scope:** dashboards, alerting jobs (M9), HTTP endpoints (M2), any change to ledger tables or the trigger.
- **DoD:** rule 26; worker report proposes the ARCHITECTURE §8 metric-definition paragraph.

#### M1-T8 — Lot-selection policy for consumption (FEFO/FIFO planner)
- **Implementation model:** **Opus** — inventory arithmetic that decides how a decrease is split across lots (rule-23 list); a wrong plan produces clamps or drains the wrong stock.
- **Review model:** **Opus** — must adversarially probe ordering ties, expired/undated lots, exhaustion and idempotency-key derivation against the reserved `::` namespace.
- **Objective:** pure domain helper in `packages/domain/src/inventory/lot-selection.ts`: `planLotConsumption(item, { qtyMicros | amount, policy })` → `Outcome<ConsumptionPlan>` where `policy ∈ {"FEFO","FIFO"}`; `ConsumptionPlan = { allocations: [{ lotId, qtyDeltaMicros (<0), lotBalanceBeforeMicros, expiresAt?, expiryTier? }], requestedMicros, allocatedMicros, shortfallMicros }`. FEFO orders lots by `expiresAt` ascending (undated last), ties by `acquiredAt` ascending (undated last), then by lot order on the item; FIFO by `acquiredAt` ascending (undated last), then lot order. Lots at zero balance are skipped. Each allocation ≤ that lot's derived balance, so **a plan never causes an `OVER_CONSUMPTION` clamp**; a request exceeding total on hand returns allocations covering the whole balance plus a non-zero `shortfallMicros` (the caller decides — the planner never invents stock or a negative). Second helper `consumptionInputsFromPlan(plan, base)` produces one `TransactionInput` per allocation from a base input (type/actor/provenance/times/reason/correlation copied by explicit field list), deriving idempotency keys deterministically from `base.idempotencyKey` **without** using the reserved `::` separator (e.g. `<key>/lot/<n>`), so a replay of the whole planned consumption is idempotent and a partial replay conflicts loudly.
- **Context:** [M1-T1 worker §9 item 1](docs/handoff/M1-T1.worker.md); domain-model.md OQ-1 note; brief §7 (meal-log decrements) — the M8 consumer.
- **Dependencies:** M1-T1 (done).
- **Invariants:** INV-LEDGER-4 preserved by construction (applying a plan through `appendTransactions` yields zero clamps — a property test); Σ allocations = min(requested, on hand); determinism (same aggregate + request ⇒ identical plan); no mutation of the input aggregate (deep-frozen inputs untouched); no clock — `asOf`, if offered at all, is a caller-supplied `Instant`.
- **Acceptance criteria:** worked example: lots A (exp 2026-09-20, 1.0 lb), B (exp 2026-09-15, 0.5 lb), C (undated, 2.0 lb); FEFO for 1.2 lb ⇒ B 0.5, A 0.7, C untouched; FIFO with A acquired first ⇒ A 1.0, B 0.2; request 4.0 lb ⇒ all three drained, `shortfallMicros = 500000`; applying plans via `appendTransactions` reconciles with `clampAdjustment` absent on every result; keys never contain `::` and replaying the derived inputs returns `duplicate` for each.
- **Tests required:** example tests above; property tests (fast-check): allocation bounds, Σ rule, ordering monotonicity per policy, zero-clamp-on-apply, determinism, key uniqueness/replay; ties and undated lots explicitly.
- **File scope:** `packages/domain/src/inventory/lot-selection.ts` (+ `.test.ts`), `packages/domain/src/inventory/index.ts` (exports only), `docs/handoff/M1-T8.worker.md`.
- **Out of scope:** which policy the UX defaults to (OQ — architect records **FEFO as PROPOSED default** in domain-model.md at acceptance; PO may overrule); expiry estimation; persistence/API wiring (M2/M8); changing `appendTransaction`.
- **DoD:** rule 26; worker report proposes the domain-model.md OQ-1 wording.

#### M1-T9 — Ledger write retry helper (`40001` + `23505` on the sequence key)
- **Implementation model:** Sonnet — a bounded retry wrapper with a precisely specified error classifier; the hard part (which errors mean "retry") is already pinned by the constraints suite and stated below.
- **Review model:** **Opus** — concurrency-sensitive inventory updates (rule-23 list); the reviewer must verify that a business conflict is never retried and that a retry cannot double-apply.
- **Objective:** `apps/api/src/db/retry.ts`: `isRetryableLedgerError(error)` — true for SQLSTATE `40001` (any), and for `23505` **only when** `constraint === "inventory_transactions_item_sequence_key"`; false for every other `23505` (notably `inventory_transactions_idempotency_key`, a terminal business conflict already mapped by the repository) and every other error. `withRetriedHouseholdTransaction(pool, householdId, fn, options)` wraps `withHouseholdTransaction`, re-running the **whole** transaction on a retryable error up to `maxAttempts` (default 3) with an injectable `delay(attempt)` and injectable `sleep` (tests never wait on real time and never use `Math.random`); on exhaustion throws `LedgerRetryExhaustedError` carrying `attempts` and `cause`; non-retryable errors propagate unchanged after attempt 1.
- **Context:** [M1-T2 worker §11 item 4 and §12 F6](docs/handoff/M1-T2.worker.md) (both codes are the same concurrency loser); repository header comment (the `40001` trigger backstop); migration 0004.
- **Dependencies:** M1-T2 (done).
- **Invariants:** retries re-execute `fn` from scratch inside a fresh transaction — no partial state survives (rollback proven); idempotency conflicts are **never** retried; a retried append is idempotent by the ledger's own key semantics, so a retry can never double-count (test: the successful retry leaves exactly one row for the key).
- **Acceptance criteria:** classifier unit tests over a table of `{code, constraint}` pairs (pure, no DB); DB tests (gated): (a) two concurrent appends to one item through the locked repository path — the loser hits `40001` or blocks-and-succeeds, and with the helper both succeed with the ledger showing both rows and contiguous sequences; (b) a forced stale-sequence insert path that raises `23505` on the sequence key is retried and succeeds; (c) an idempotency-key conflict is **not** retried (`attempts === 1`) and surfaces as the repository's typed `IDEMPOTENCY_KEY_CONFLICT`; (d) a permanently failing `fn` exhausts after `maxAttempts` with the original cause attached; (e) a non-retryable error propagates after one attempt.
- **Tests required:** as above; the fake `sleep` records the delays requested.
- **File scope:** `apps/api/src/db/retry.ts` (+ `.test.ts`), `apps/api/src/db/session.ts` (only if a small hook is needed — document why), `docs/handoff/M1-T9.worker.md`.
- **Out of scope:** HTTP-layer retry semantics, backoff tuning under load (M9), changing the trigger or constraints.
- **DoD:** rule 26.

#### M1-T10 — Maintenance bundle (accepted follow-ups, no behaviour change to product logic)
- **Implementation model:** Sonnet — tooling, pins, fixtures and test-coverage items; each is small and mechanical.
- **Review model:** Sonnet — review checks each item against its acceptance line and that no product behaviour changed; item (e) touches the ledger write path and gets a line-by-line look.
- **Objective:** land these accepted follow-ups in one branch, one commit per item, in this order:
  - **(a)** `packageManager` pnpm `12.3.1 → 12.3.4` and add `workflow_dispatch:` to `ci.yml` (M0-T2). Must install with `--frozen-lockfile` locally and in CI; if the local corepack cannot fetch 12.3.4, **revert (a) and report** rather than work around.
  - **(b)** pin the CI `postgres:17-alpine` image by digest (`image: postgres:17-alpine@sha256:…`), digest obtained read-only from the registry (no Docker locally); comment how to bump.
  - **(c)** tighten the domain boundary lint: `import-x/no-extraneous-dependencies` for `packages/domain/src/**` production files must reject devDependencies (`devDependencies: false`), so a `fast-check` import into production domain source fails lint; prove it with a temporary violation (shown in the report, then removed) and correct the overclaiming comment.
  - **(d)** `scripts/**/*.mjs` lint block: modern `ecmaVersion`/`sourceType: module` + Node globals (M1-T5 follow-up); `pnpm lint` stays green.
  - **(e)** canonicalise lot instants on write: `insertInventoryLot` passes `acquiredAt`/`expiresAt` through `canonicalizeInstant`; the round-trip property generator produces non-canonical offsets/precisions and the read-back equals the canonical form (M1-T2 F9).
  - **(f)** move pure helpers (`microsToDecimalText`, `canonicalizeInstant`, mapping validators) under unit tests that run **without** `DATABASE_URL` (M1-T2 F10) — no behaviour change.
  - **(g)** `next_sequence`-drift read-path test: tamper `inventory_items.next_sequence` inside a rolled-back transaction (existing F5 pattern) and assert `loadInventoryItem` refuses with `CORRUPT_LEDGER`.
  - **(h)** UUIDv7 helper `apps/api/src/ids/uuidv7.ts` (RFC 9562 layout from `node:crypto`; version/variant bits, millisecond timestamp, monotonic within a millisecond) with tests — **not wired anywhere**: where ids are minted stays an M2 decision.
  - **(i)** corpus-mirror consistency test: outside `packages/domain` (which stays I/O-free), assert the inline recommendations-corpus mirror equals the JSON fixtures on disk, so the two cannot drift silently (M1-T4 follow-up). Include the M1-T6 fixture.
  - **(j)** one sesame-bearing product fixture in `tests/fixtures/products/**` following the corpus's synthetic-code scheme (valid GS1 check digit; non-collision spot-checked read-only against Open Food Facts as M1-T5 did, or reported as unchecked if offline), and update the domain corpus test's "sesame absent" note/assertion so all nine codes are exercised.
  - **(k)** CONTRIBUTING.md note on running the database suites locally (`DATABASE_URL`, loud skip, Docker or any throwaway Postgres incl. the native `initdb` pattern).
- **Context:** "Accepted follow-ups" section below (M0-T2, M1-T2, M1-T3, M1-T4, M1-T5 lines).
- **Dependencies:** M1-T6 (fixture for (i)), M1-T9 (avoid touching the same files concurrently — this ticket runs last).
- **Invariants:** no product-logic behaviour change; `packages/domain` still zero deps / zero I/O; all existing 475 tests still pass (with DB) — nothing weakened or deleted; no new runtime dependency (rule 11 — `uuidv7` is hand-written on `node:crypto`, no package).
- **Acceptance criteria:** one commit per item, each item's line above satisfied; `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` green locally (DB suites skip loudly) and CI green with the DB suites running; report has a table item → commit → evidence.
- **Tests required:** per item as stated; (f) and (h) add non-DB unit tests; (e), (g), (i), (j) add or extend tests.
- **File scope:** `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, `eslint.config.js`, `apps/api/src/db/**` (items e–g only), `apps/api/src/ids/**`, `packages/adapters/src/**` or `tests/**` (item i), `tests/fixtures/products/**` (+ manifest/README lines), `packages/domain/src/allergens/corpus.test.ts` (item j note only), `CONTRIBUTING.md`, `docs/handoff/M1-T10.worker.md`.
- **Out of scope:** SHA-pinning the GitHub actions themselves (M9); the `SECURITY DEFINER` owner role (needs the hosting decision); `fl-oz` guard (conditional, not needed); anything in `docs/**` other than the handoff report.
- **DoD:** rule 26; worker report's item table complete; any item reverted is listed with the reason.

---

## Milestones 2–9 (epic level only — ticketed when reached)

### M2 — Household + inventory API
Auth integration (managed provider — ADR-004 vendor decision here; cost approval gate), household CRUD + membership, inventory endpoints over the ledger (all writes idempotent), authz matrix + INV-TENANT-1 suite, structured logging/correlation IDs, first deploy target decision (PaaS — cost approval gate). *Exit:* two fixture users in one household mutate shared inventory via HTTP with full isolation tests green.

### Epic M3-E0 — UX design (GATES the M3 build; PO directive 2026-09-10: plan only, no build)
Deliverables, per [docs/design/ux-plan.md](docs/design/ux-plan.md) §4: wireframes for the 12 MVP screens incl. non-happy states → hi-fi mockups in the design-direction tokens (extending the existing clickable prototype) → safety-copy deck (M1-T4's nine rules applied verbatim, reviewed like code) → PO + Dean on-device review + one real-household hallway test of the three make-or-break flows → iterate once. **Exit gate: PO sign-off recorded in DECISIONS *and* D-002 ratified — only then are M3 build tickets written.** Design work is Sonnet-class with PO review; no code, no dependencies. Open inputs: OQ-D1 accent, Q8 brand, OQ-D4/D5/D6 ([ux-plan §5](docs/design/ux-plan.md)).

### M3 — Basic client inventory experience
Expo app (ADR-001 finalize): auth, household join, inventory list by location, manual add/adjust/deplete with reasons, item history view ("why does the app think…"), barcode scan → lookup → confirm flow with provenance badges (Known Fact / Estimated / AI Interpretation), correction-rate telemetry live. **Binding UI copy requirements for allergen surfaces:** the nine rules in [M1-T4's worker report §6](docs/handoff/M1-T4.worker.md) (never "safe"; the standing NO_SAFETY_GUARANTEE caveat always shown; unknowns never collapsed into allowed; critical warnings prominent; copy keyed off codes not messages; blocked evidence displayed; per-member attribution). *Exit:* MVP acceptance journey steps 1–3 pass on two devices.

### M4 — Barcode/product enrichment
Live lookup cascade per ADR-006 outcome + caching + our-catalog merge (normalization v1), manual completion UX for misses, barcode-resolution telemetry. *Exit:* measured resolution rate on real scans; catalog rows carry per-field provenance.

### M5 — Receipt ingestion + confirmation (fast-follow flagship)
Fixture corpus incl. §18B hard cases → pipeline stages behind ports → vendor bake-off (R-2, ADR-007 decision; cost approval gate) → upload (content-hash dedupe, INV-RCPT-1) → confirmation screen → PURCHASE transactions with correlation refs; object storage (ADR-009 decision); retention policy implemented (PO decision required first).

### M6 — Recipe generation + recommendations
`RecipeGeneratorPort` + first LLM vendor pick via eval suite (ADR-005 process; cost approval gate), schema-validated generation, deterministic ranking (§4 factors) + allergen screening integration via `partitionByVerdict` (M1-T4 — BLOCKED never displayed as a choice; a severe+unknown filtering policy decided here per D-017 P4), accept/reject telemetry, prompt-injection adversarial evals, **suspicious-character detector** (mixed-script/unexpected-codepoint ingredient text ⇒ warning + refuse to license absence — D-017 accepted-residual-risk mitigation), M1-T4's UI copy rules bind here too. *Exit:* INV-ALRG-1 E2E green; acceptance-rate metric live.

### M7 — Shopping-list closed loop
Gap computation (INV-SHOP-1) from accepted recipes + manual items, BUY/ALREADY HAVE, household sharing, offline cache + queued check-offs (ADR-010 scope), check-off → inventory prompt (close the loop). *Exit:* full MVP acceptance journey passes.

### M8 — Consumption + reconciliation
Meal logging → per-ingredient `USE_IN_MEAL` decrements (INV-MEAL-1), expiration estimates from shelf-life data + "use it soon" surfacing, reconciliation prompts ("still have this?"), calorie display (deterministic, INV-NUTR-1). *(Pulled from fast-follow list as evidence dictates.)*

### M9 — Hardening & observability completion
Alerting, cost caps enforcement, load/perf pass, security deep-set (isolation fuzzing, abuse limits), deletion/export flows, pre-launch legal gates (R-3/R-4/R-5), beta readiness review.

---

## Accepted follow-ups from completed tickets
- From M0-T1 (worker report, triaged at acceptance): Windows long-path CONTRIBUTING note → folded into M0-T2 (✅ done); `apps/api` dev/watch script (`tsx`-style) → add with first real API ticket (M2); OneDrive-sync concern → tracked in STATUS.md.
- From M1-T1 (worker §9 + review, triaged at acceptance 2026-09-08): **lot-selection policy (FEFO/FIFO) for consumption** — domain helper + UX input, needed before meal-log decrements (M2/M8, Opus); correction-rate telemetry query over `OVER_CONSUMPTION` clamps + user adjustments (after M1-T2); wiring units conversion into inventory/shopping services — incl. where `ConversionBridge` data (densities, per-item weights) lives and a possible `wasClamped` field on gap results — is **M2's job** (retargeted from an earlier note; M1-T3 deliberately left the ledger's pass-through `Unit` untouched); boundary schema validation belt-and-braces + who may claim a `system` actor + mustUse-style handling of discarded `AppendResult`s (M2); observation-boundary invariant test for unconfirmed AI-tier rows (M6); timestamp normalisation note added to ADR-010.
- From M1-T3 (review, triaged at acceptance 2026-09-09): tighten the domain boundary lint or its comment — `import-x/no-extraneous-dependencies` permits devDependencies by default, so a `fast-check` import into domain *production* source currently lints clean (small M0-maintenance ticket, fold into next config-touching work); `fl-oz` disambiguation guard if fluid ounces ever needed (never overload `oz`).
- From M1-T2 (worker §11 + both review rounds, triaged at acceptance 2026-09-10): **M2-blocking:** dedicated non-superuser owner role for SECURITY DEFINER functions (deployment-roles decision); retry helper must handle `23505` AND `40001`; managed-provider migration behavior (CREATE ROLE/definer ownership without superuser) verified against the chosen host. **Maintenance:** pin `postgres:17-alpine` by digest; lot-instant canonicalisation on write (+ property-generator instants); move pure helpers out from behind the DATABASE_URL gate; add a `next_sequence`-drift read-path test; reconciliation alerting job (INV-LEDGER-1 in prod = page, per ARCHITECTURE §8); UUIDv7 generation helper; CONTRIBUTING note on local DB options (native throwaway cluster pattern / Docker when installed). **Unblocked now:** correction-rate telemetry query (D-003 + schema both landed).
- From M1-T4 (worker §12 + both review rounds, triaged at acceptance 2026-09-10): **MANDATORY pre-M4 gates:** (a) malformed-`allergens`-container inputs must record as uninterpreted rather than silently dropping (blocks a declaration-assisted ALLOWED; ~3 lines + tests — must land before any adapter can mint an AllergenDeclaration), (b) decide who may mint a `KNOWN_FACT` AllergenDeclaration (D-017 open item). **M4:** non-FDA allergen codes (mustard/celery/lupin/sulphites/mollusc); coconut split out of tree_nut (pulled forward per review); adapter→domain completeness mapping (with the FDC-allergen-gap rule). **Maintenance:** corpus-mirror consistency check from packages/adapters; sesame product fixture; broader lookalike/negative-matching test corpus; extract shared deepFreeze when a third module needs it. **M9 gate:** clinical/domain-expert review of the curated allergen term lists before launch.
- From M1-T5 (worker §10 + review, triaged at acceptance 2026-09-09): **follow-up R-1 FDC measurement pass** (slower pacing or a free signup key — key acquisition needs PO approval per rule 17 — before ADR-006 finalizes FDC's slot); **M4: curated PLU → CanonicalIngredient table** (never the live cascade — settled sub-decision, D-010); **M4: FDC-allergen-gap rule** (FDC-only-resolved products render allergen status unknown + warning) — explicit implementation requirement; **M4: guard name-search against free-text collisions** (the "baby carrots → infant formula" class — category-scoped search); scripts/** eslint modernization (ecmaVersion/globals) maintenance ticket.
- From M0-T2 (worker report + review, triaged at acceptance 2026-09-08): bump `packageManager` pnpm 12.3.1 → 12.3.4 (one-line maintenance, next ticket that touches package.json); add `workflow_dispatch:` trigger to ci.yml (optional convenience, with that same change); SHA-pin the remaining actions (checkout/setup-node/pnpm-setup — hardening, fold into M9); after the owner applies branch protection, verify a real PR shows both required checks (architect acceptance step, next PR).

## Non-milestone track (continuous)
- Fixture corpus growth (every prod bug → fixture first).
- Docs hygiene: DECISIONS/STATUS updated with every merged decision-affecting PR.
- Cost telemetry review at each milestone exit.
