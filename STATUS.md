# STATUS.md

_Last updated: 2026-09-15_

## Current phase
**Milestones 0 and 1 COMPLETE; foundation follow-ups (epic M1-E3) UNDERWAY per D-018 (2026-09-14).** The deterministic foundation exists, reviewed and merged: inventory ledger, units engine, allergen rule engine, product-lookup ports + fixtures + R-1 research, and the Postgres schema with RLS/append-only enforcement — 475 tests (with DB), CI green. UI/UX planning package delivered 2026-09-10 (docs only). PO directive 2026-09-14: build only what needs **no spend and no PO/originator decision** — tickets M1-T6 → T7 → T8 → T9 → T10 — then **stop for PO review**. M2 (API) and M3 (client) remain gated (see D-018).

## In progress (M1-E3, architect-dispatched, one ticket at a time)
| Ticket | Title | Models (impl/review) | State |
|---|---|---|---|
| M1-T6 | Allergen malformed-container fail-closed fix (pre-M4 gate a) | Opus / Opus | ✅ **DONE 2026-09-14** — review PASS (no fixes), squash `1fa171c`, +136 tests (525 w/o DB); pre-M4 gate (a) closed |
| M1-T7 | Correction-rate telemetry view + read function | Sonnet / Opus | ✅ **DONE 2026-09-14** — review PASS (no fixes), squash `cf301c6`; 625 tests with DB / 527 without; KPI definition recorded in ARCHITECTURE §8 |
| M1-T8 | FEFO/FIFO lot-selection planner | Opus / Opus | ✅ **DONE 2026-09-15** — review PASS WITH FIXES (3 hand-built-input hardenings) → re-review PASS, squash `244e97b`; 562 tests without DB; FEFO = PROPOSED default (OQ-1) |
| M1-T9 | Ledger write retry helper (`40001` + sequence-key `23505`) | Sonnet / Opus | ✅ **DONE 2026-09-15** — review PASS WITH FIXES (pin `assumeRole` across retries) → re-review PASS, squash `12641b4`; 697 tests with DB / 594 without |
| M1-T10 | Maintenance bundle (13 accepted follow-ups, a–m) | Sonnet / Sonnet | **not started — next to dispatch** |
| M1-T11 | *(new, found by M1-T9 review)* aborted-transaction COMMIT silently discards ledger work | Opus / Opus | **ticketed, NOT dispatched — outside the D-018 five; awaits PO go** |

## What exists
- Original product brief preserved in [docs/source/](docs/source/) (DOCX + extracted text).
- Full documentation foundation: [PRODUCT.md](PRODUCT.md), [MVP PRD](docs/prd/MVP_PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md) (+ domain/data/AI/system-context/testing docs), [DECISIONS.md](DECISIONS.md), ADR-001…010, [BACKLOG.md](BACKLOG.md) (M0–M1 ticketed, M2–M9 epics), [CLAUDE.md](CLAUDE.md).
- **M0-T1 DONE (2026-09-03):** pnpm workspace (`apps/api` Fastify skeleton + `packages/domain|contracts|adapters` placeholders), TypeScript strict, ESLint/Prettier/Vitest, domain dependency-boundary lint. Sonnet impl, Sonnet review (PASS WITH FIXES, applied & re-verified), merged.
- **M0-T2 DONE (2026-09-08) — Milestone 0 complete:** GitHub Actions CI (`quality` + `secret-scan` jobs: frozen-lockfile install, lint, typecheck, test, format check, `pnpm audit`, gitleaks), CONTRIBUTING.md (conventions, setup, Windows long-path caveat, branch-protection checklist), README badge. Sonnet impl, Sonnet review (PASS, no fixes; all five verification runs re-confirmed via live Actions API), merged. Reviewer→architect handoff ran via direct cross-session message — no human relay.

## Milestone 1 record (complete)
- M1 queue ran under architect dispatch (CLAUDE.md rules 28–30), PO-approved order T1 → T3 → T5 → T4 → T2.
- ✅ **M1-T1 DONE (2026-09-08):** inventory ledger core merged (squash) — exact bigint micro-unit arithmetic, per-lot clamp with unforgeable system flag, idempotent replay + conflict rejection, rehydration as corruption detector; 75 tests incl. INV-LEDGER-1..4. Opus/Opus, PASS after one fix round. Handoff: docs/handoff/M1-T1.{worker,review}.md.
- ✅ **M1-T3 DONE (2026-09-09):** units & quantity model merged (squash) — exact rational conversions (US customary + metric), ground-truth-pinned factors, bridges-only cross-kind, INV-SHOP-1 gap math; 150 tests. Sonnet/Opus, PASS after one fix round. Handoff: docs/handoff/M1-T3.{worker,review}.md.
- ✅ **M1-T5 DONE (2026-09-09):** product lookup ports + 101-item synthetic fixture corpus + R-1 coverage research merged (squash); 216 tests. ADR-006 promoted OPEN → PROPOSED on measured evidence (OFF ~85% genuine branded match; PLU-as-barcode dangerous → curated table settled; FDC unvalidated 0/27 rate-limited, honestly reported; FDC has no allergen field → M4 unknown+warning rule). Sonnet/Sonnet, PASS after doc-only fixes. Handoff: docs/handoff/M1-T5.{worker,review}.md.
- ✅ **M1-T4 DONE (2026-09-10):** deterministic allergen rule engine merged (squash) — 3-state verdict with no "safe" state, absence licensed only by sourced KNOWN_FACT completeness declarations, worst-wins aggregation; 163 allergen tests (379 total), mutation-pinned. Adversarial Opus review found and closed three fail-open paths (prototype-key lookup, name-satisfied licence, zero-width obfuscation). Policies ratified as **D-017**; one mandatory pre-M4 gate + accepted residual risk recorded. Handoff: docs/handoff/M1-T4.{worker,review}.md.
- ✅ **M1-T2 DONE (2026-09-10) — MILESTONE 1 COMPLETE:** Postgres schema merged (squash) — 6 migrations, snapshot-by-trigger with no runtime UPDATE privilege on quantities, RLS fail-closed, append-only both layers, household-scoped idempotency/sequence keys; 96 DB tests incl. fast-check round-trip through `rehydrateInventoryItem`. Opus/Opus; review closed an INV-LEDGER-4 fail-open and a tenant-inference oracle; worker self-found a CREATE ROLE CI race. ADR-003 → DECIDED; ADR-008 fully closed. Handoff: docs/handoff/M1-T2.{worker,review}.md.
- **UI/UX planning package delivered (PO directive, docs only):** [design-principles.md](docs/design/design-principles.md) (10 binding behavior principles) + [ux-plan.md](docs/design/ux-plan.md) (IA, 12-screen inventory, three make-or-break flows, design→build pipeline) + **M3-E0 gate epic** in BACKLOG.md. Nothing built; M3 build double-gated on M3-E0 sign-off + D-002.

## Awaiting owner action
- **Apply branch protection on `main`** per the checklist in [CONTRIBUTING.md](CONTRIBUTING.md) (require PR; required checks exactly `quality` and `secret-scan`; block force pushes). Architect verifies the branch's `protected` flag afterwards.

## Blocked decisions (need product owner)
1. **D-002** MVP scope (reduced vertical slice vs brief §19 Phase 1) — per **D-016** (foundation-first, 2026-09-08) this no longer blocks M1; it must be ratified (Dean) before **M3 (UI)** and M5+ sequencing.
2. Q1–Q10 open questions ([PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed), [MVP_PRD §14](docs/prd/MVP_PRD.md#14-open-questions)) — Q1 (launch market) and Q3 (household permissions) matter earliest.

*(D-003 ledger model: DECIDED 2026-09-08 — M1 is unblocked.)*

## Operational note — repo location
**Remote decided (2026-09-03):** `https://github.com/saengsawat/Smart-Kitchen` (branch `main`) is the repo's home and sharing mechanism — this unblocks M0-T2 (CI). The working clone still lives inside a OneDrive-synced folder; recommendation stands to move it out (or exclude from sync) now that GitHub is the sync mechanism — especially since `node_modules/` exists and OneDrive syncs it.

## Next 3 actions
1. **Engineering (architect):** run M1-E3 to acceptance, one ticket at a time; update this file only at each acceptance (rule 27); stop after M1-T10.
2. **Dean ratifies D-002** (MVP scope) and answers Q1/Q3 — gates M3; M2 (API) awaits a PO go-ahead (cost gates: auth vendor, hosting — or a PO yes to a stubbed-auth M2 core).
3. **Owner:** apply the **branch-protection checklist** (CONTRIBUTING.md); answer the UX plan's open items (OQ-D1, Q8, OQ-D4/D5/D6); housekeeping — move the clone out of OneDrive; keep-or-delete ruling on the untracked user files `docs/architecture/workflow-diagrams.{md,html}` and `docs/design/mockups/smart-kitchen-prototype-v2.html` (appeared 2026-09-14; not architect-authored, untouched); optionally install Docker for local DB tests.

## Major risks (top 3 now)
1. Inventory-accuracy hypothesis fails (users won't maintain even low-friction inventory) — mitigated by correction-rate telemetry from M3 and receipt fast-follow.
2. Barcode/product data coverage disappoints (R-1 research, M1-T5) — could force paid data sources earlier than hoped.
3. Scope regrowth toward the brief's full Phase 1 before the hypothesis is tested — guarded by D-002 gate and backlog discipline.

Full risk list: [PRODUCT.md §7](PRODUCT.md#7-assumptions-constraints-risks).
