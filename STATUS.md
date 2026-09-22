# STATUS.md

_Last updated: 2026-09-22_

## Current phase
**Milestones 0 and 1 COMPLETE; D-018 batch (M1-T6 → T10) and D-018a queue (M1-T11, M3-E0-T1/T2/T3) ALL COMPLETE as of 2026-09-16 — engineering is STOPPED for the PO/Dean decision session** ([decision brief](docs/po/decision-brief-2026-09.md)). 1113 tests with DB / 961 without (2026-09-22); CI green on main. Design gate M3-E0: engineering deliverables done (14-screen prototype, binding copy deck, token sheet); PO-run steps remain (Dean on-device review, hallway test, token-darkening call, sign-off + D-002). The deterministic foundation exists, reviewed and merged: inventory ledger, units engine, allergen rule engine, product-lookup ports + fixtures + R-1 research, and the Postgres schema with RLS/append-only enforcement — 475 tests (with DB), CI green. UI/UX planning package delivered 2026-09-10 (docs only). PO directive 2026-09-14: build only what needs **no spend and no PO/originator decision** — tickets M1-T6 → T7 → T8 → T9 → T10 — then **stop for PO review**. M2 (API) and M3 (client) remain gated (see D-018).

## In progress (M1-E3, architect-dispatched, one ticket at a time)
| Ticket | Title | Models (impl/review) | State |
|---|---|---|---|
| M1-T6 | Allergen malformed-container fail-closed fix (pre-M4 gate a) | Opus / Opus | ✅ **DONE 2026-09-14** — review PASS (no fixes), squash `1fa171c`, +136 tests (525 w/o DB); pre-M4 gate (a) closed |
| M1-T7 | Correction-rate telemetry view + read function | Sonnet / Opus | ✅ **DONE 2026-09-14** — review PASS (no fixes), squash `cf301c6`; 625 tests with DB / 527 without; KPI definition recorded in ARCHITECTURE §8 |
| M1-T8 | FEFO/FIFO lot-selection planner | Opus / Opus | ✅ **DONE 2026-09-15** — review PASS WITH FIXES (3 hand-built-input hardenings) → re-review PASS, squash `244e97b`; 562 tests without DB; FEFO = PROPOSED default (OQ-1) |
| M1-T9 | Ledger write retry helper (`40001` + sequence-key `23505`) | Sonnet / Opus | ✅ **DONE 2026-09-15** — review PASS WITH FIXES (pin `assumeRole` across retries) → re-review PASS, squash `12641b4`; 697 tests with DB / 594 without |
| M1-T10 | Maintenance bundle (13 accepted follow-ups, a–m) | Sonnet / Sonnet | ✅ **DONE 2026-09-15** — review PASS (no fixes), squash `605aae2`; all 13 items landed; 769 tests with DB / 665 without |
| M1-T11 | *(found by M1-T9 review)* aborted-transaction COMMIT silently discards ledger work | Opus / Opus | ✅ **DONE 2026-09-16** — review PASS WITH FIXES (pin the fn-thrown-error rollback path) → re-review PASS, squash `13a631b`; 786 tests with DB / 668 without |
| M3-E0-T2 | Safety and provenance copy deck (docs only) | Sonnet / Opus | ✅ **DONE 2026-09-16** — review PASS WITH FIXES (5 safety-wording defects + 9 smaller) → re-review PASS, squash `b4e4c4f`; 63/63 codes covered; binding for M3 |
| M3-E0-T1 | Prototype completion: missing screens + non-happy states (docs only) | Sonnet / Opus | ✅ **DONE 2026-09-16** — review PASS WITH FIXES (9 findings, all fixed) → re-review PASS, squash `05181fb`; 14 screens, three flows complete |
| M3-E0-T3 | Token sheet: contrast + scarcity audit (docs only) | Sonnet / Sonnet | ✅ **DONE 2026-09-16** — review PASS WITH FIXES (5 uncovered pairs) → re-review PASS, squash `804881e`; 40 pairs, 16 FAILs with PROPOSED fixes (PO call) |

**Queue complete. Nothing is dispatched. Next engineering move requires a PO word (see decision brief Part A/D).**

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
- **Visual direction v2 adopted 2026-09-15 (D-019):** the PO's revamped prototype v3 + competitor-research plan are the visual language (terracotta, Fraunces/Inter, pantry-paper neutrals, provenance chips, freshness ring). Architect fixed two allergen-copy violations and added the BLOCKED / unknown card states at adoption; token sheet in design-direction §0; screen coverage vs the 12-screen inventory in ux-plan §7 (S1/S2/S5/S9/S12 + non-happy states still to design). M3 build gates unchanged.
- **UI/UX planning package delivered (PO directive, docs only):** [design-principles.md](docs/design/design-principles.md) (10 binding behavior principles) + [ux-plan.md](docs/design/ux-plan.md) (IA, 12-screen inventory, three make-or-break flows, design→build pipeline) + **M3-E0 gate epic** in BACKLOG.md. Nothing built; M3 build double-gated on M3-E0 sign-off + D-002.

## Build resumed 2026-09-22 (D-021, D-022, D-023, D-005)
- **Decided 2026-09-21/22 by Andy:** Expo (D-005, ADR-001 DECIDED), the seven token darkenings (D-021), build against a stubbed identity port (D-022), M3 build opens on the locked screens with the hallway test deferred to pre-release (D-023). Prototype **v4** is the build reference (Menu tab, Home states, D-021 palette); v3 archived.
- ✅ **M3-T1 DONE 2026-09-22:** Expo app scaffold merged (squash `11e79fb`): SDK 57, D-021 tokens pinned with live contrast recomputation, five-slot shell with Menu placeholder, fixture ApiClient, mobile boundary lint, CI export smoke check. Sonnet/Sonnet, PASS after one fix (relative-path boundary bypass). 731 tests without a DB. Handoff: docs/handoff/M3-T1.{worker,review}.md. **Dean can now run the shell in Expo Go over the LAN** (apps/mobile/README.md); no real screens yet.
- ✅ **M2-T1 DONE 2026-09-22:** identity port + fixture adapter, default-deny authorization (boot-time and request-time guards), tenant-scoped sessions with the role pinned, `GET /v1/inventory/items` with per-field tiers, structured redacted logging; workspace packages now build to `dist` with a `source` export condition for dev tools. Opus/Opus adversarial review PASS WITH FIXES (compiled API could not start; 500 logging; production guard denylist; four minor) → architect F8 (clean-state lint) → re-review PASS; squash `079bfc1`. **1113 tests with DB / 961 without / 956 with no build.** Handoff: docs/handoff/M2-T1.{worker,review}.md. OQ-E1/OQ-E2 recorded; D-022 wording corrected; ARCHITECTURE §7 and data-model §5 updated.
- **Next:** M3-T2 onboarding (S1 + S2) to be written and dispatched; M2-T2 (write endpoints over the ledger) after it. Held: Menu internals (D-020), Home states (OQ-D9) pending Dean's list.
- **Held:** Menu page internals (D-020) and Home dashboard states (OQ-D9) until Dean's additional-function list is triaged and D-002 is ratified. Session notes: [docs/po/meeting-notes-2026-09-21.md](docs/po/meeting-notes-2026-09-21.md).

## Awaiting owner action
- Dean's additional-function list (unblocks D-002 ratification, D-020, OQ-D9 tickets); (model question settled 2026-09-22: default Opus plus a detailed architect pass; Fable only when super important).
- **Andy + Dean decision session (this week):** agenda, recommendations and cost map in [docs/po/decision-brief-2026-09.md](docs/po/decision-brief-2026-09.md) — D-002, Q1/Q3, auth (open-source-first), hosting (phased), ADR-001, stubbed-auth M2 go/no-go, D-017 gate b, shortfall policy, UX opens incl. product name.
- **Apply branch protection on `main`** per the checklist in [CONTRIBUTING.md](CONTRIBUTING.md) (require PR; required checks exactly `quality` and `secret-scan`; block force pushes). Architect verifies the branch's `protected` flag afterwards.

## Blocked decisions (need product owner)
1. **D-002** MVP scope (reduced vertical slice vs brief §19 Phase 1) — per **D-016** (foundation-first, 2026-09-08) this no longer blocks M1; it must be ratified (Dean) before **M3 (UI)** and M5+ sequencing.
2. Q1–Q10 open questions ([PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed), [MVP_PRD §14](docs/prd/MVP_PRD.md#14-open-questions)) — Q1 (launch market) and Q3 (household permissions) matter earliest.

*(D-003 ledger model: DECIDED 2026-09-08 — M1 is unblocked.)*

## Operational note — repo location
**Remote decided (2026-09-03):** `https://github.com/saengsawat/Smart-Kitchen` (branch `main`) is the repo's home and sharing mechanism — this unblocks M0-T2 (CI). The working clone still lives inside a OneDrive-synced folder; recommendation stands to move it out (or exclude from sync) now that GitHub is the sync mechanism — especially since `node_modules/` exists and OneDrive syncs it.

## Next 3 actions
1. **Andy + Dean session** (agenda in the [decision brief](docs/po/decision-brief-2026-09.md)): D-002, Q1/Q3, open-source-first auth + phased hosting, stubbed-auth M2 go/no-go, ADR-001, D-017 gate b, shortfall policy, UX opens incl. product name; plus the new **token-darkening call** (tokens.md §2) and Dean's on-device review of the completed prototype.
2. **Dean ratifies D-002** (MVP scope) and answers Q1/Q3 — gates M3; M2 (API) awaits a PO go-ahead (cost gates: auth vendor, hosting — or a PO yes to a stubbed-auth M2 core).
3. **Owner:** apply the **branch-protection checklist** (CONTRIBUTING.md); answer the UX plan's open items (OQ-D1, Q8, OQ-D4/D5/D6); housekeeping — move the clone out of OneDrive; keep-or-delete ruling on the untracked user files `docs/architecture/workflow-diagrams.{md,html}` and `docs/design/mockups/smart-kitchen-prototype-v2.html` (appeared 2026-09-14; not architect-authored, untouched); optionally install Docker for local DB tests.

## Major risks (top 3 now)
1. Inventory-accuracy hypothesis fails (users won't maintain even low-friction inventory) — mitigated by correction-rate telemetry from M3 and receipt fast-follow.
2. Barcode/product data coverage disappoints (R-1 research, M1-T5) — could force paid data sources earlier than hoped.
3. Scope regrowth toward the brief's full Phase 1 before the hypothesis is tested — guarded by D-002 gate and backlog discipline.

Full risk list: [PRODUCT.md §7](PRODUCT.md#7-assumptions-constraints-risks).
