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
- **Implementation addenda (M1-T1, 2026-09-08, reviewed):** negative-quantity semantics settled — never-negative committed state, full-magnitude recording + system-flagged residual `ADJUSTMENT`, per-lot clamping, flag unforgeable by callers. Idempotency: identical-payload replay = no-op; different payload on a reused key = rejected conflict. Quantities: exact scaled-integer (micro-unit) arithmetic, unrepresentable inputs rejected, no balance cap. Details: [docs/handoff/M1-T1.worker.md](docs/handoff/M1-T1.worker.md) + [review](docs/handoff/M1-T1.review.md).

## D-004 — Modular monolith backend; no microservices/K8s/event streaming/CQRS at MVP
- **Date:** 2026-09-03 · **Status:** PROPOSED · **Owner:** ENG
- **Decision:** Single deployable API with lint-enforced module boundaries ([ARCHITECTURE.md §1–2](ARCHITECTURE.md)). Alternatives (services-first) rejected for team size and absent scale requirements. Revisit triggers documented in ARCHITECTURE.md §9.

## D-005 — Client platform: Expo/React Native
- **Status:** PROPOSED · **Record:** [ADR-001](docs/adr/ADR-001-client-platform.md)

## D-006 — Backend runtime: Node/TypeScript + Fastify
- **Status:** DECIDED (2026-09-03) · **Owner:** ENG · **Record:** [ADR-002](docs/adr/ADR-002-backend-runtime.md)
- **Evidence:** PO approved M0-T1 (2026-09-03), which presupposes the Node/TS workspace; framework resolved by architect per ADR-002 rationale (boundaries from domain design + lint, not framework). Low reversal cost noted.

## D-007 — Database: PostgreSQL (+ RLS adopted)
- **Status:** DECIDED (2026-09-10) · **Owner:** ENG · **Record:** [ADR-003](docs/adr/ADR-003-database.md)
- **Evidence:** M1-T2's reviewed schema (6 migrations, 96 DB tests exercised as the real app role; adversarial review incl. two blocking findings fixed and re-verified). Three standing schema rules recorded in the ADR (household-scoped unique constraints; SECURITY DEFINER for RLS-reading triggers; security_invoker views). Managed-provider pick deferred to M2 hosting. Snapshot-maintenance question in ADR-008 also closed (DB trigger).

## D-008 — Authentication: managed provider (vendor open)
- **Status:** PROPOSED · **Record:** [ADR-004](docs/adr/ADR-004-authentication.md)

## D-009 — AI behind per-capability ports with fixture impls + eval gates; no vendor pick yet
- **Status:** PROPOSED (pattern) · **Record:** [ADR-005](docs/adr/ADR-005-ai-provider-abstraction.md)

## D-010 — Food data source cascade
- **Status:** PROPOSED (2026-09-09, R-1 evidence from M1-T5; FDC arm still unmeasured) · **Record:** [ADR-006](docs/adr/ADR-006-food-data-sources.md)
- **Settled sub-decision:** PLU/produce never enters the live barcode cascade (wrong-but-"found" ~60% of PLU "hits" measured) — curated PLU table instead. **New M4 requirement:** FDC-only-resolved products render allergen status unknown + warning (FDC has no allergen field).

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

## D-017 — Allergen screening policies (M1-T4, reviewer-endorsed, architect-ratified)
- **Date:** 2026-09-10 · **Status:** DECIDED (P1–P4) + one OPEN item · **Owner:** ENG (safety policies within brief §3/§18E mandate) — PO may overturn
- **P1 Cross-contact (`MAY_CONTAIN`):** `severe ⇒ BLOCKED`, `standard ⇒ ALLOWED_WITH_UNKNOWNS + high CROSS_CONTACT warning`. Frozen data in the engine, deliberately NOT a caller option (an option turning a block into a non-block is a forbidden override channel). Rationale: MAY_CONTAIN is a manufacturer statement of uncertainty — mapped to the uncertainty verdict, surfaced never hidden; blocking for standard-severity would remove much of packaged goods with no tolerance channel.
- **P2:** molluscs stay inside the `shellfish` term data (over-inclusion blocks; under-inclusion exposes). Distinct `mollusc` code arrives with the M4 taxonomy extension.
- **P3:** coconut stays in `tree_nut` for MVP (FDA labeling alignment); the separate-code split is **pulled forward to M4** (reviewer: highest-cost conservative call in the data).
- **P4:** severe + unknown data is NOT escalated to BLOCKED at the engine (INV-ALRG-2 prescribes unknown+warning; escalation would collapse "don't know" into "know it's there"); the critical `SEVERE_ALLERGY_UNKNOWN_DATA` warning is the hook for an M6 recommendation-layer filtering policy.
- **P5 (partial):** a declaration with an empty/missing `source` never licenses absence (implemented). **OPEN:** who may mint a `KNOWN_FACT` `AllergenDeclaration` — the trust root of the permissive verdict; must be decided before M4 wires adapter/catalog data in (same family as the M1-T1 "who may claim a system actor" question).
- **Accepted residual risk (recorded):** homoglyph (Cyrillic а) and genuine-hyphen (`pea-nut`) text evasion is not caught by matching; invisible-character evasion IS caught (stripped). Mitigation path: M6 suspicious-character detector that *warns and refuses to license absence* — adds warnings, never matches. Evidence: [docs/handoff/M1-T4.review.md](docs/handoff/M1-T4.review.md).

## D-018 — Foundation follow-ups approved for build; UI and cost-gated work still held
- **Date:** 2026-09-14 · **Status:** DECIDED · **Owner:** PO (directive: "keep building what we can build now with no cost and no PO decision from either I or Dean … then STOP")
- **Decision:** Five already-accepted follow-ups are ticketed and built under architect dispatch, in order: **M1-T6** allergen malformed-container fail-closed fix (pre-M4 gate a), **M1-T7** correction-rate telemetry view/query, **M1-T8** FEFO/FIFO lot-selection planner, **M1-T9** ledger write retry helper, **M1-T10** maintenance bundle (epic M1-E3 in [BACKLOG.md](BACKLOG.md)). Selection rule: zero spend, zero external resources, and no product decision consumed — every item is prerequisite work M2/M4/M8 would otherwise stall on.
- **Consequences:** Engineering stops after M1-T10 is accepted (PO review checkpoint). Still held: M3 build (double-gated on M3-E0 sign-off + D-002), M2 API (auth vendor + hosting cost gates need PO approval; a stubbed-auth M2 core remains possible on a further PO yes), D-017's declaration-minting policy (pre-M4 gate b), anything touching member profiles/allergy tables (Q3). PO answer recorded 2026-09-14 on cost: building UI before design/UX sign-off was assessed as expensive mainly through rework (20–40 % of screens), so it stays gated.
- **Alternatives:** stop entirely until D-002 (rejected by PO — idle time with prerequisite work available); start M2 core with stubbed auth (deferred — needs an explicit PO yes on the two deferrals).

## D-018a — Amendment (2026-09-15): M1-T11 and M3-E0-T1..T3 approved for build
- **Status:** DECIDED · **Owner:** PO (directive: "Go M1-T11, then M3-E0-T1 and T2 in parallel, then T3")
- **Decision:** the same selection rule as D-018 (zero spend, no PO/originator decision consumed) admits four more tickets: **M1-T11** (ledger write-path aborted-COMMIT fix, Opus/Opus) first; then **M3-E0-T1** (prototype completion) and **M3-E0-T2** (safety copy deck) in parallel; then **M3-E0-T3** (token sheet). All docs-only except M1-T11. Confirmed independent of the M2 auth/hosting decisions (design does not see them); D-002 remains the only design risk and the five missing screens are in every plausible cut.
- **Consequences:** engineering resumes; stops again after M3-E0-T3 is accepted (next PO checkpoint: Dean session per [docs/po/decision-brief-2026-09.md](docs/po/decision-brief-2026-09.md)). M3 build tickets are still gated on M3-E0 sign-off + D-002.

## D-019 — Visual design direction v2 adopted (PO revamp); OQ-D1/OQ-D2 resolved
- **Date:** 2026-09-15 · **Status:** DECIDED · **Owner:** PO (Andy) — visual direction is a PO call; architect reconciled it to the safety and scope rules
- **Decision:** The PO's revamped clickable prototype (v3, [docs/design/mockups/smart-kitchen-prototype.html](docs/design/mockups/smart-kitchen-prototype.html)) and its competitor-research plan ([docs/design/KitchenSmart UIUX Design Plan_09-14-2026.md](docs/design/KitchenSmart%20UIUX%20Design%20Plan_09-14-2026.md)) define the app's visual language: warm pantry-paper neutrals, dark espresso Home hero, **terracotta `#d9673b` brand accent (OQ-D1 → terracotta)**, **Fraunces display face over Inter (OQ-D2 → adopted)**, three-tier provenance chips, freshness ring. Authoritative token sheet: [design-direction.md §0](docs/design/design-direction.md).
- **Conditions attached by the architect (applied at adoption, see design-direction §7):** the two allergen-copy violations were corrected in the prototype (no "passed"/green-check clearance; ALLOWED renders as "no known allergen match" + standing caveat); ALLOWED_WITH_UNKNOWNS and BLOCKED card states added; Known Fact scoped to product identity on the scan sheet; phase labels added to the assistant entry and the confirmation tray. Four plan recommendations are **rejected** as conflicting with P2/P5/D-017/brief §14 (no-chip Known Fact, blocking-confirm dialog for allergen conflicts, two-state fallback, Expo stack picks as decided) — the stack picks are PROPOSED input to ADR-001 only.
- **Consequences:** design-direction.md v1 tokens superseded by §0; ux-plan §7 records prototype coverage vs the 12-screen inventory (six MVP screens and the non-happy states still to design in M3-E0). **Scope gates unchanged:** M3 build still requires M3-E0 sign-off + D-002. New open items OQ-D7 (tier of label-sourced nutrition/allergen data — with D-017 gate b) and OQ-D8 (photo licensing → R-4).
- **Alternatives:** keep v1 direction (rejected by PO as "looks like Claude web"); fresh-green accent (retired with OQ-D1).

---

## Open product-owner questions (not yet decisions)
Q1–Q8 in [PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed); Q9–Q10 in [MVP_PRD.md §14](docs/prd/MVP_PRD.md#14-open-questions). Answers get promoted to D-numbers here.

## Research required (evidence before decision)
- R-1 Barcode coverage: OFF/FDC hit-rate on a realistic US basket → feeds D-010 (ticket M1-T5).
- R-2 Receipt pipeline bake-off: accuracy × cost across OCR+LLM / multimodal / specialized APIs → feeds D-011 (M5).
- R-3 AI provider data-use terms review before real user data in prompts (pre-launch gate; threat model §7.8).
- R-4 ODbL / commercial food-data licensing implications for our merged catalog (legal; with R-1).
- R-5 GDPR special-category status of allergy data if non-US launch considered (legal; depends Q1).
