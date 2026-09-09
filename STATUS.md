# STATUS.md

_Last updated: 2026-09-10_

## Current phase
**Milestones 0 and 1 COMPLETE.** The deterministic foundation exists, reviewed and merged: inventory ledger, units engine, allergen rule engine, product-lookup ports + fixtures + R-1 research, and the Postgres schema with RLS/append-only enforcement — 475 tests (with DB), CI green. Per PO directive (2026-09-10): next is **UI/UX planning only** (delivered — see below); **no further building** until the PO green-lights M2 (API) and/or M3-E0 → M3 (client).

## What exists
- Original product brief preserved in [docs/source/](docs/source/) (DOCX + extracted text).
- Full documentation foundation: [PRODUCT.md](PRODUCT.md), [MVP PRD](docs/prd/MVP_PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md) (+ domain/data/AI/system-context/testing docs), [DECISIONS.md](DECISIONS.md), ADR-001…010, [BACKLOG.md](BACKLOG.md) (M0–M1 ticketed, M2–M9 epics), [CLAUDE.md](CLAUDE.md).
- **M0-T1 DONE (2026-09-03):** pnpm workspace (`apps/api` Fastify skeleton + `packages/domain|contracts|adapters` placeholders), TypeScript strict, ESLint/Prettier/Vitest, domain dependency-boundary lint. Sonnet impl, Sonnet review (PASS WITH FIXES, applied & re-verified), merged.
- **M0-T2 DONE (2026-09-08) — Milestone 0 complete:** GitHub Actions CI (`quality` + `secret-scan` jobs: frozen-lockfile install, lint, typecheck, test, format check, `pnpm audit`, gitleaks), CONTRIBUTING.md (conventions, setup, Windows long-path caveat, branch-protection checklist), README badge. Sonnet impl, Sonnet review (PASS, no fixes; all five verification runs re-confirmed via live Actions API), merged. Reviewer→architect handoff ran via direct cross-session message — no human relay.

## In progress
- **M1 queue running under architect dispatch (CLAUDE.md rules 28–30), PO-approved order: T1 → T3 → T5 → T4 → T2, one at a time. PO has asked for a stop after the queue completes.**
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

## Next 3 actions (all with the product owner — engineering is paused by directive)
1. **Dean ratifies D-002** (MVP scope) and answers Q1/Q3 — gates M3; M2 (API) also awaits a PO go-ahead (its own cost gates: auth vendor, hosting).
2. Owner applies the **branch-protection checklist** (CONTRIBUTING.md); review the UX plan's open items (OQ-D1 accent, Q8 name, OQ-D4/D5/D6).
3. Housekeeping when convenient: move this clone out of OneDrive; decide keep-vs-delete for the untracked `docs/architecture/workflow-diagrams.md`; optionally install Docker for local DB tests.

## Major risks (top 3 now)
1. Inventory-accuracy hypothesis fails (users won't maintain even low-friction inventory) — mitigated by correction-rate telemetry from M3 and receipt fast-follow.
2. Barcode/product data coverage disappoints (R-1 research, M1-T5) — could force paid data sources earlier than hoped.
3. Scope regrowth toward the brief's full Phase 1 before the hypothesis is tested — guarded by D-002 gate and backlog discipline.

Full risk list: [PRODUCT.md §7](PRODUCT.md#7-assumptions-constraints-risks).
