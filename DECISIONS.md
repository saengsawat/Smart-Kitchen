# DECISIONS.md — Decision Log

Single index of architecture/product/process decisions. Long-form technical records live in [docs/adr/](docs/adr/README.md). Statuses: **OPEN → PROPOSED → DECIDED → SUPERSEDED**. A decision becomes DECIDED only with recorded owner approval and evidence — never manufacture one.

Owners: `PO` = product owner (Dean), `ENG` = engineering.

---

## D-001 — Repository as durable project memory; docs-first foundation
- **Date:** 2026-09-03 · **Status:** DECIDED · **Owner:** PO (mandated in founding task)
- **Decision:** Requirements, decisions, backlog, and status live in version-controlled files (this repo), not chat history. Foundation docs precede any product code.
- **Rationale/source:** Founding engineering task; enables AI-assisted development with persistent context.
- **Consequences:** CLAUDE.md governs agent sessions; docs updated when decisions change (stale docs = bug).

## D-002 — MVP scope: reduced vertical slice (challenges brief §19 Phase 1)
- **Date:** 2026-09-03 · **Status:** PROPOSED — **needs PO approval before coding**
- **Decision:** MVP = auth + household + ledger inventory + barcode + manual entry/correction + allergen-safe inventory-aware recommendations + shopping-list gap + online-first sync. Receipt OCR, expiration engine, calorie display = fast-follow. Vision, chat, meal planning, nutrition dashboard deferred. Detail: [MVP_PRD.md §4](docs/prd/MVP_PRD.md#4-mvp-scope-decision--challenge-to-the-briefs-phase-1).
- **Rationale:** Brief's Phase 1 bundles 3–4 probabilistic pipelines before the core hypothesis (trusted low-effort inventory) is tested. Alternatives: full Phase 1 as written (rejected: slow, diffuse learning); recipe-app-first (rejected: commoditized per §16).
- **Consequences:** Receipt scanning — the brief's flagship automation — is deliberately *not* in the first cut; pulled forward if barcode-only friction proves too high.

## D-003 — Inventory as append-only ledger
- **Date:** 2026-09-03 · **Status:** DECIDED (2026-09-08) · **Owner:** ENG+PO
- **Decision/record:** [ADR-008](docs/adr/ADR-008-inventory-ledger.md). Alternatives and consequences there.
- **Evidence:** product owner's foundation-first directive (2026-09-08) approving non-UI foundation build, of which the ledger is the keystone; no objection raised to the ADR-008 recommendation since 2026-09-03.

## D-004 — Modular monolith backend; no microservices/K8s/event streaming/CQRS at MVP
- **Date:** 2026-09-03 · **Status:** PROPOSED · **Owner:** ENG
- **Decision:** Single deployable API with lint-enforced module boundaries ([ARCHITECTURE.md §1–2](ARCHITECTURE.md)). Alternatives (services-first) rejected for team size and absent scale requirements. Revisit triggers documented in ARCHITECTURE.md §9.

## D-005 — Client platform: Expo/React Native
- **Status:** PROPOSED · **Record:** [ADR-001](docs/adr/ADR-001-client-platform.md)

## D-006 — Backend runtime: Node/TypeScript + Fastify
- **Status:** DECIDED (2026-09-03) · **Owner:** ENG · **Record:** [ADR-002](docs/adr/ADR-002-backend-runtime.md)
- **Evidence:** PO approved M0-T1 (2026-09-03), which presupposes the Node/TS workspace; framework resolved by architect per ADR-002 rationale (boundaries from domain design + lint, not framework). Low reversal cost noted.

## D-007 — Database: PostgreSQL
- **Status:** PROPOSED · **Record:** [ADR-003](docs/adr/ADR-003-database.md)

## D-008 — Authentication: managed provider (vendor open)
- **Status:** PROPOSED · **Record:** [ADR-004](docs/adr/ADR-004-authentication.md)

## D-009 — AI behind per-capability ports with fixture impls + eval gates; no vendor pick yet
- **Status:** PROPOSED (pattern) · **Record:** [ADR-005](docs/adr/ADR-005-ai-provider-abstraction.md)

## D-010 — Food data source cascade
- **Status:** OPEN — RESEARCH REQUIRED (coverage spike M1-T5) · **Record:** [ADR-006](docs/adr/ADR-006-food-data-sources.md)

## D-011 — Receipt/OCR pipeline vendor & shape
- **Status:** OPEN (fixtures-first regardless) · **Record:** [ADR-007](docs/adr/ADR-007-receipt-ocr-pipeline.md)

## D-012 — Object storage
- **Status:** OPEN (deferred to M5) · **Record:** [ADR-009](docs/adr/ADR-009-image-object-storage.md)

## D-013 — Offline/sync: online-first with B-compatible foundations
- **Status:** OPEN (online-first MVP proposed) · **Record:** [ADR-010](docs/adr/ADR-010-offline-sync.md)

## D-014 — Allergen safety is deterministic; AI advisory only
- **Date:** 2026-09-03 · **Status:** PROPOSED (source-mandated — expect fast ratification) · **Owner:** PO+ENG
- **Decision:** Allergen exclusion implemented as deterministic rules over verified data; LLM output can add warnings, never clear them; UI never claims guaranteed safety.
- **Source:** Brief §3, §18E (DOCUMENTED). **Consequences:** INV-ALRG-1/2 permanent tests; allergen data quality becomes a launch gate.

## D-015 — No scraped recipe content; AI-original recipes for MVP
- **Date:** 2026-09-03 · **Status:** PROPOSED · **Owner:** PO
- **Source:** Brief §18D (DOCUMENTED constraint); licensing a recipe DB remains an open product option (Q6).

## D-016 — Foundation-first build order: M1 unblocked ahead of full D-002 ratification
- **Date:** 2026-09-08 · **Status:** DECIDED · **Owner:** PO (directive: "build foundation first — any tickets that don't relate to UI")
- **Decision:** Non-UI foundation work proceeds now: remainder of M0, and all of M1 (ledger core, Postgres schema, units model, allergen rule engine, product-lookup ports + R-1 coverage research). These are scope-invariant — required under any plausible MVP cut, including the brief's full Phase 1 — so building them does not pre-empt D-002.
- **Consequences:** D-002 (the exact MVP feature cut) remains PROPOSED and must be ratified before **M3 (client/UI)** and before committing M5+ sequencing. M2 (household + inventory API) is also non-UI but carries its own cost gates (auth vendor, hosting) — dispatch decision at M1 exit.
- **Alternatives:** wait for full D-002 ratification (rejected: stalls scope-invariant work on a decision it doesn't depend on).

---

## Open product-owner questions (not yet decisions)
Q1–Q8 in [PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed); Q9–Q10 in [MVP_PRD.md §14](docs/prd/MVP_PRD.md#14-open-questions). Answers get promoted to D-numbers here.

## Research required (evidence before decision)
- R-1 Barcode coverage: OFF/FDC hit-rate on a realistic US basket → feeds D-010 (ticket M1-T5).
- R-2 Receipt pipeline bake-off: accuracy × cost across OCR+LLM / multimodal / specialized APIs → feeds D-011 (M5).
- R-3 AI provider data-use terms review before real user data in prompts (pre-launch gate; threat model §7.8).
- R-4 ODbL / commercial food-data licensing implications for our merged catalog (legal; with R-1).
- R-5 GDPR special-category status of allergy data if non-US launch considered (legal; depends Q1).
