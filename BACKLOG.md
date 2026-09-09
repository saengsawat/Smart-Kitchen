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

#### M1-T2 — Postgres schema & migrations: identity, household, inventory
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

---

## Milestones 2–9 (epic level only — ticketed when reached)

### M2 — Household + inventory API
Auth integration (managed provider — ADR-004 vendor decision here; cost approval gate), household CRUD + membership, inventory endpoints over the ledger (all writes idempotent), authz matrix + INV-TENANT-1 suite, structured logging/correlation IDs, first deploy target decision (PaaS — cost approval gate). *Exit:* two fixture users in one household mutate shared inventory via HTTP with full isolation tests green.

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
- From M1-T4 (worker §12 + both review rounds, triaged at acceptance 2026-09-10): **MANDATORY pre-M4 gates:** (a) malformed-`allergens`-container inputs must record as uninterpreted rather than silently dropping (blocks a declaration-assisted ALLOWED; ~3 lines + tests — must land before any adapter can mint an AllergenDeclaration), (b) decide who may mint a `KNOWN_FACT` AllergenDeclaration (D-017 open item). **M4:** non-FDA allergen codes (mustard/celery/lupin/sulphites/mollusc); coconut split out of tree_nut (pulled forward per review); adapter→domain completeness mapping (with the FDC-allergen-gap rule). **Maintenance:** corpus-mirror consistency check from packages/adapters; sesame product fixture; broader lookalike/negative-matching test corpus; extract shared deepFreeze when a third module needs it. **M9 gate:** clinical/domain-expert review of the curated allergen term lists before launch.
- From M1-T5 (worker §10 + review, triaged at acceptance 2026-09-09): **follow-up R-1 FDC measurement pass** (slower pacing or a free signup key — key acquisition needs PO approval per rule 17 — before ADR-006 finalizes FDC's slot); **M4: curated PLU → CanonicalIngredient table** (never the live cascade — settled sub-decision, D-010); **M4: FDC-allergen-gap rule** (FDC-only-resolved products render allergen status unknown + warning) — explicit implementation requirement; **M4: guard name-search against free-text collisions** (the "baby carrots → infant formula" class — category-scoped search); scripts/** eslint modernization (ecmaVersion/globals) maintenance ticket.
- From M0-T2 (worker report + review, triaged at acceptance 2026-09-08): bump `packageManager` pnpm 12.3.1 → 12.3.4 (one-line maintenance, next ticket that touches package.json); add `workflow_dispatch:` trigger to ci.yml (optional convenience, with that same change); SHA-pin the remaining actions (checkout/setup-node/pnpm-setup — hardening, fold into M9); after the owner applies branch protection, verify a real PR shows both required checks (architect acceptance step, next PR).

## Non-milestone track (continuous)
- Fixture corpus growth (every prod bug → fixture first).
- Docs hygiene: DECISIONS/STATUS updated with every merged decision-affecting PR.
- Cost telemetry review at each milestone exit.
