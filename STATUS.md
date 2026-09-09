# STATUS.md

_Last updated: 2026-09-03_

## Current phase
**Phase 0 — engineering foundation (docs only).** No application code exists. Implementation is gated on product-owner approvals below.

## What exists
- Original product brief preserved in [docs/source/](docs/source/) (DOCX + extracted text).
- Full documentation foundation: [PRODUCT.md](PRODUCT.md), [MVP PRD](docs/prd/MVP_PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md) (+ domain/data/AI/system-context/testing docs), [DECISIONS.md](DECISIONS.md), ADR-001…010, [BACKLOG.md](BACKLOG.md) (M0–M1 ticketed, M2–M9 epics), [CLAUDE.md](CLAUDE.md).
- **M0-T1 DONE (2026-09-03):** pnpm workspace (`apps/api` Fastify skeleton + `packages/domain|contracts|adapters` placeholders), TypeScript strict, ESLint/Prettier/Vitest, domain dependency-boundary lint. Implemented by Sonnet worker, independently Sonnet-reviewed (PASS WITH FIXES — `.gitattributes` LF normalization + supply-chain-exclusion comment, applied and re-verified at acceptance), merged to master. First AI worker/reviewer cycle of the project completed cleanly.

## In progress
- **M0-T2 — CI pipeline & quality gates**: dispatched 2026-09-08 to a Sonnet worker (independent Sonnet review to follow). Ticket amended for missing `gh` CLI (demo branches + public Actions API instead of PR tooling; branch protection = owner checklist).

## Blocked decisions (need product owner)
1. **D-002** MVP scope (reduced vertical slice vs brief §19 Phase 1) — per **D-016** (foundation-first, 2026-09-08) this no longer blocks M1; it must be ratified (Dean) before **M3 (UI)** and M5+ sequencing.
2. Q1–Q10 open questions ([PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed), [MVP_PRD §14](docs/prd/MVP_PRD.md#14-open-questions)) — Q1 (launch market) and Q3 (household permissions) matter earliest.

*(D-003 ledger model: DECIDED 2026-09-08 — M1 is unblocked.)*

## Operational note — repo location
**Remote decided (2026-09-03):** `https://github.com/saengsawat/Smart-Kitchen` (branch `main`) is the repo's home and sharing mechanism — this unblocks M0-T2 (CI). The working clone still lives inside a OneDrive-synced folder; recommendation stands to move it out (or exclude from sync) now that GitHub is the sync mechanism — especially since `node_modules/` exists and OneDrive syncs it.

## Next 3 actions
1. Complete the M0-T2 cycle (worker → review → acceptance; owner applies the branch-protection checklist).
2. Dispatch M1 foundation tickets — order: **M1-T1** (ledger core, Opus/Opus) → then **M1-T3** (units) and **M1-T5** (lookup ports + R-1 research) → **M1-T4** (allergens) → **M1-T2** (schema, needs M1-T1). One worker session at a time in this clone (shared working tree).
3. Dean ratifies D-002 (MVP scope) — now needed before **M3 (UI)**, not M1; the repo + prototype are his review package. (Also: move this clone out of OneDrive.)

## Major risks (top 3 now)
1. Inventory-accuracy hypothesis fails (users won't maintain even low-friction inventory) — mitigated by correction-rate telemetry from M3 and receipt fast-follow.
2. Barcode/product data coverage disappoints (R-1 research, M1-T5) — could force paid data sources earlier than hoped.
3. Scope regrowth toward the brief's full Phase 1 before the hypothesis is tested — guarded by D-002 gate and backlog discipline.

Full risk list: [PRODUCT.md §7](PRODUCT.md#7-assumptions-constraints-risks).
