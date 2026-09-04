# STATUS.md

_Last updated: 2026-09-03_

## Current phase
**Phase 0 — engineering foundation (docs only).** No application code exists. Implementation is gated on product-owner approvals below.

## What exists
- Original product brief preserved in [docs/source/](docs/source/) (DOCX + extracted text).
- Full documentation foundation: [PRODUCT.md](PRODUCT.md), [MVP PRD](docs/prd/MVP_PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md) (+ domain/data/AI/system-context/testing docs), [DECISIONS.md](DECISIONS.md), ADR-001…010, [BACKLOG.md](BACKLOG.md) (M0–M1 ticketed, M2–M9 epics), [CLAUDE.md](CLAUDE.md).
- **M0-T1 DONE (2026-09-03):** pnpm workspace (`apps/api` Fastify skeleton + `packages/domain|contracts|adapters` placeholders), TypeScript strict, ESLint/Prettier/Vitest, domain dependency-boundary lint. Implemented by Sonnet worker, independently Sonnet-reviewed (PASS WITH FIXES — `.gitattributes` LF normalization + supply-chain-exclusion comment, applied and re-verified at acceptance), merged to master. First AI worker/reviewer cycle of the project completed cleanly.

## In progress
- Nothing. Next ticket **M0-T2 (CI)** is blocked on the repo remote/OneDrive decision below.

## Blocked decisions (need product owner)
1. **D-002** MVP scope (reduced vertical slice vs brief §19 Phase 1) — formal ratification still pending; M0-T1 is scope-neutral, but this blocks **M1** onward.
2. **D-003 / ADR-008** inventory ledger model — ratification pending; blocks M1.
3. Q1–Q10 open questions ([PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed), [MVP_PRD §14](docs/prd/MVP_PRD.md#14-open-questions)) — Q1 (launch market) and Q3 (household permissions) matter earliest.

## Operational note — repo location
The repo currently lives inside a OneDrive-synced folder. OneDrive + `.git` is a known source of lock/corruption issues (the source DOCX was already file-locked during extraction). **Recommendation:** move the working clone outside OneDrive (or exclude the folder from sync) and use a proper git remote (GitHub/etc.) as the sync mechanism. Needs user decision before M0-T2 (CI needs a remote anyway).

## Next 3 actions
1. Decide repo hosting/remote + resolve the OneDrive question above (blocks M0-T2; now more urgent — `node_modules/` exists and OneDrive syncs it unless excluded).
2. Product owner ratifies D-002 (MVP scope) and D-003 (ledger) — required before M1 starts.
3. Dispatch M0-T2 (CI + quality gates) once the remote exists; M1-T1/M1-T3 can be dispatched in parallel once D-002/D-003 are ratified.

## Major risks (top 3 now)
1. Inventory-accuracy hypothesis fails (users won't maintain even low-friction inventory) — mitigated by correction-rate telemetry from M3 and receipt fast-follow.
2. Barcode/product data coverage disappoints (R-1 research, M1-T5) — could force paid data sources earlier than hoped.
3. Scope regrowth toward the brief's full Phase 1 before the hypothesis is tested — guarded by D-002 gate and backlog discipline.

Full risk list: [PRODUCT.md §7](PRODUCT.md#7-assumptions-constraints-risks).
