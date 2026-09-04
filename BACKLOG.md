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

#### M0-T2 — CI pipeline & quality gates
- **Implementation model:** Sonnet — standard CI configuration; security-adjacent (secret/dependency scanning) but assembled from stock actions, verified by deliberate-failure PRs.
- **Review model:** Sonnet — acceptance criteria are self-demonstrating (the three failing test PRs); reviewer checks gate coverage and branch protection.
- **Objective:** CI (GitHub Actions assumed once hosting of repo is settled — confirm) running lint, typecheck, unit tests, **format check** (now that `.gitattributes` normalizes line endings), dependency-boundary check, secret scan (gitleaks-class), dependency audit on every PR; trunk-based flow with short-lived branches; conventional commits with ticket refs documented; short CONTRIBUTING notes incl. Windows long-path caveat (`git config core.longpaths true` / Win32 long paths — M0-T1 follow-up) and pnpm/corepack setup.
- **Context:** ARCHITECTURE.md quality baseline; CLAUDE.md rules.
- **Dependencies:** M0-T1; repo pushed to a remote (see OneDrive note in STATUS.md — **decide remote/host with user first**).
- **Invariants:** no merges to main with red CI; lockfile drift fails CI.
- **Acceptance criteria:** a PR with a lint error, a leaked fake secret, or a domain-boundary violation each fail visibly.
- **Tests:** CI config exercised by three deliberate-failure test PRs (then closed).
- **File scope:** `.github/workflows/*` (or host equivalent), `CONTRIBUTING` section in README.
- **Out of scope:** deployment, E2E infra, coverage gates.
- **DoD:** branch protection on main; badges/links in README; STATUS.md updated.

---

## Milestone 1 — Domain core + inventory ledger
*Goal: the product's heart — ledger, units, allergen rules, gap math — as pure, property-tested TypeScript with no server, no DB dependency for logic, plus the first real schema. Proves ADR-008 in code.*

### Epic M1-E1: Deterministic domain package

#### M1-T1 — Inventory ledger core
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

#### M1-T2 — Postgres schema & migrations: identity, household, inventory
- **Implementation model:** **Opus** — sensitive schema for inventory history, append-only enforcement, tenancy isolation/RLS spike, snapshot-consistency decision (rule-23 list: authorization + schema migrations affecting inventory history).
- **Review model:** **Opus** — isolation and append-only guarantees must survive adversarial review; migration reversibility affects everything downstream.
- **Objective:** first migrations for users/households/memberships + inventory items/lots/transactions per [data-model.md](docs/architecture/data-model.md); migration tooling chosen (with ORM/query-layer decision from ADR-002 open question); append-only enforcement; snapshot-maintenance approach decided (app-tx vs trigger) and recorded; RLS spike → decision recorded in ADR-003/DECISIONS.
- **Context:** data-model.md §2–5; runs against containerized Postgres locally/CI — **no cloud resources**.
- **Dependencies:** M1-T1 (types inform columns); D-007 ratified enough to proceed (PROPOSED→DECIDED expected here).
- **Invariants:** INV-TENANT-1 test harness exists (even with only fixture users); ledger tables reject UPDATE/DELETE from app role.
- **Acceptance criteria:** migrate up/down clean on empty + seeded DB; reconciliation query matches domain derivation on generated data.
- **Tests:** database tests per testing-strategy §1 (constraints, append-only, isolation), migration reversibility.
- **File scope:** `apps/api/db/**` (migrations), `packages/domain` untouched except type exports.
- **Out of scope:** HTTP endpoints (M2), auth integration (M2), receipt/shopping tables (later migrations).
- **DoD:** ADR-003 marked DECIDED (with evidence) or blockers recorded; RLS decision logged.

#### M1-T3 — Units & quantity model
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

#### M1-T4 — Allergen rule engine (deterministic)
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

#### M1-T5 — Product lookup port + fixture adapter + coverage research spike
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

---

## Milestones 2–9 (epic level only — ticketed when reached)

### M2 — Household + inventory API
Auth integration (managed provider — ADR-004 vendor decision here; cost approval gate), household CRUD + membership, inventory endpoints over the ledger (all writes idempotent), authz matrix + INV-TENANT-1 suite, structured logging/correlation IDs, first deploy target decision (PaaS — cost approval gate). *Exit:* two fixture users in one household mutate shared inventory via HTTP with full isolation tests green.

### M3 — Basic client inventory experience
Expo app (ADR-001 finalize): auth, household join, inventory list by location, manual add/adjust/deplete with reasons, item history view ("why does the app think…"), barcode scan → lookup → confirm flow with provenance badges (Known Fact / Estimated / AI Interpretation), correction-rate telemetry live. *Exit:* MVP acceptance journey steps 1–3 pass on two devices.

### M4 — Barcode/product enrichment
Live lookup cascade per ADR-006 outcome + caching + our-catalog merge (normalization v1), manual completion UX for misses, barcode-resolution telemetry. *Exit:* measured resolution rate on real scans; catalog rows carry per-field provenance.

### M5 — Receipt ingestion + confirmation (fast-follow flagship)
Fixture corpus incl. §18B hard cases → pipeline stages behind ports → vendor bake-off (R-2, ADR-007 decision; cost approval gate) → upload (content-hash dedupe, INV-RCPT-1) → confirmation screen → PURCHASE transactions with correlation refs; object storage (ADR-009 decision); retention policy implemented (PO decision required first).

### M6 — Recipe generation + recommendations
`RecipeGeneratorPort` + first LLM vendor pick via eval suite (ADR-005 process; cost approval gate), schema-validated generation, deterministic ranking (§4 factors) + allergen screening integration (M1-T4), accept/reject telemetry, prompt-injection adversarial evals. *Exit:* INV-ALRG-1 E2E green; acceptance-rate metric live.

### M7 — Shopping-list closed loop
Gap computation (INV-SHOP-1) from accepted recipes + manual items, BUY/ALREADY HAVE, household sharing, offline cache + queued check-offs (ADR-010 scope), check-off → inventory prompt (close the loop). *Exit:* full MVP acceptance journey passes.

### M8 — Consumption + reconciliation
Meal logging → per-ingredient `USE_IN_MEAL` decrements (INV-MEAL-1), expiration estimates from shelf-life data + "use it soon" surfacing, reconciliation prompts ("still have this?"), calorie display (deterministic, INV-NUTR-1). *(Pulled from fast-follow list as evidence dictates.)*

### M9 — Hardening & observability completion
Alerting, cost caps enforcement, load/perf pass, security deep-set (isolation fuzzing, abuse limits), deletion/export flows, pre-launch legal gates (R-3/R-4/R-5), beta readiness review.

---

## Accepted follow-ups from completed tickets
- From M0-T1 (worker report, triaged at acceptance): Windows long-path CONTRIBUTING note → folded into M0-T2; `apps/api` dev/watch script (`tsx`-style) → add with first real API ticket (M2); OneDrive-sync concern → tracked in STATUS.md, decide before M0-T2.

## Non-milestone track (continuous)
- Fixture corpus growth (every prod bug → fixture first).
- Docs hygiene: DECISIONS/STATUS updated with every merged decision-affecting PR.
- Cost telemetry review at each milestone exit.
