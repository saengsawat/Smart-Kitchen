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
- **Status:** DECIDED 2026-09-21 (PO Andy, brief item A6) · **Record:** [ADR-001](docs/adr/ADR-001-client-platform.md). Managed workflow first; barcode library and any UI library go through rule 11 at ticket time, one at a time.

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
- **Outcome (2026-09-16):** all four accepted and merged (M1-T11 `13a631b`, M3-E0-T2 `b4e4c4f`, M3-E0-T1 `05181fb`, M3-E0-T3 `804881e`); engineering stopped as directed. New PO item surfaced by M3-E0-T3: adopt or reject seven PROPOSED token darkenings (tokens.md §2) — added to the decision brief agenda.

## D-019 — Visual design direction v2 adopted (PO revamp); OQ-D1/OQ-D2 resolved
- **Date:** 2026-09-15 · **Status:** DECIDED · **Owner:** PO (Andy) — visual direction is a PO call; architect reconciled it to the safety and scope rules
- **Decision:** The PO's revamped clickable prototype (v3, [docs/design/mockups/smart-kitchen-prototype.html](docs/design/mockups/smart-kitchen-prototype.html)) and its competitor-research plan ([docs/design/KitchenSmart UIUX Design Plan_09-14-2026.md](docs/design/KitchenSmart%20UIUX%20Design%20Plan_09-14-2026.md)) define the app's visual language: warm pantry-paper neutrals, dark espresso Home hero, **terracotta `#d9673b` brand accent (OQ-D1 → terracotta)**, **Fraunces display face over Inter (OQ-D2 → adopted)**, three-tier provenance chips, freshness ring. Authoritative token sheet: [design-direction.md §0](docs/design/design-direction.md).
- **Conditions attached by the architect (applied at adoption, see design-direction §7):** the two allergen-copy violations were corrected in the prototype (no "passed"/green-check clearance; ALLOWED renders as "no known allergen match" + standing caveat); ALLOWED_WITH_UNKNOWNS and BLOCKED card states added; Known Fact scoped to product identity on the scan sheet; phase labels added to the assistant entry and the confirmation tray. Four plan recommendations are **rejected** as conflicting with P2/P5/D-017/brief §14 (no-chip Known Fact, blocking-confirm dialog for allergen conflicts, two-state fallback, Expo stack picks as decided) — the stack picks are PROPOSED input to ADR-001 only.
- **Consequences:** design-direction.md v1 tokens superseded by §0; ux-plan §7 records prototype coverage vs the 12-screen inventory (six MVP screens and the non-happy states still to design in M3-E0). **Scope gates unchanged:** M3 build still requires M3-E0 sign-off + D-002. New open items OQ-D7 (tier of label-sourced nutrition/allergen data — with D-017 gate b) and OQ-D8 (photo licensing → R-4).
- **Alternatives:** keep v1 direction (rejected by PO as "looks like Claude web"); fresh-green accent (retired with OQ-D1).

## D-020 — Navigation locked at four tabs; "Recipes" becomes a Menu page (recipes as a subset)
- **Date:** 2026-09-21 · **Status:** PROPOSED (agreed verbally by Andy and Dean; ratified when Dean's additional-function list is triaged and Andy confirms the tab name) · **Owner:** Dean (product), Andy (PO)
- **Decision:** Home, Inventory, Add food (centre scan) and Shopping are locked. The fifth tab becomes a Menu page: instant or planned menus (day, weekend, next N days), recommended menus from current inventory, recipes opened from a menu, and missing ingredients pushed to Shopping by the user or by the AI. Recipes are a subset of the Menu page.
- **Architect recommendation:** ship in two layers, "Tonight" (today's Recipes screen) in MVP and "Plan ahead" as a fast-follow in the same tab; carry MealPlan in the data model from M2. Gap math and allergen verdicts stay deterministic (rule 7, P5); the AI proposes, the gap function adds. Detail in [docs/po/meeting-notes-2026-09-21.md](docs/po/meeting-notes-2026-09-21.md).
- **Consequences:** D-002 gains a scope add (multi-day planning was deferred; layer 2 brings it forward). MealPlan/MealSlot leave "Deferred" in domain-model.md when ratified. ux-plan §1 and §6, MVP_PRD §3 and the prototype's Recipes tab update at ratification. Product name and the other brief items are unchanged.
- **Alternatives:** keep Recipes as the tab and add planning inside Shopping (rejected: planning is the organising idea, recipes are the leaf); separate Menu and Recipes tabs (rejected: six tabs).
- **New open question OQ-D9 (home page by user state):** the dashboard cannot be the first screen for a new user. Architect proposal: minimum required onboarding = household + allergies (safety gate, already designed as S1/S2); everything else progressive (home states: empty, sparse, ready; preferences asked when first used, skippable). To be written as an M3-E0 design ticket before the Home build ticket. Owner: Andy + Dean.

## D-021 — Token darkenings for contrast adopted (A12)
- **Date:** 2026-09-21 · **Status:** DECIDED · **Owner:** PO (Andy), visual call
- **Decision:** the seven PROPOSED changes in [tokens.md §2](docs/design/tokens.md) are the palette: `--ink-3` `#665c52`, `--amber` `#925b0a`, `--green` `#2c744b`, `--rose` `#9d4b51`, `--danger` `#882020`, text on `--brand-tint` pairs with `#a74925` (new token `--brand-on-tint`), primary CTA fill is `--brand-deep` `#b64f28` with a darker pressed stop `#9c4322`. Prototype v4 renders them; the PO reviewed them there.
- **Consequences:** every measured pair passes its threshold; design-direction §0 carries the new values; the M3 token module ships these numbers and nothing else. `--brand` `#d9673b` stays for non-text uses (orb, active nav stroke, camera chrome).
- **Alternatives:** keep v2 values (rejected: 16 failing pairs, several on safety text).

## D-022 — Build against a stubbed identity first; auth vendor stays open (A7)
- **Date:** 2026-09-21 · **Status:** DECIDED · **Owner:** PO (Andy)
- **Decision:** M2 (API) and M3 (client) are built against an identity port with a fixture implementation (fixed test users in one household, plus a second household for isolation tests). No vendor, no signup, no cost. ADR-004 stays PROPOSED on vendor; the architect's recommendation is Better Auth (open source, in-process), fallback Supabase Auth. The swap is one adapter behind the port.
- **Consequences:** every authorization test runs against the port, so it stays valid when the real provider lands; no endpoint may read identity from anywhere but the port; the fixture adapter is never *selected* in production: it loads only when `SK_IDENTITY=fixture` and `NODE_ENV` is on the allowlist (`development`, `test`, unset), and the process refuses to start otherwise. **Wording corrected 2026-09-22 at M2-T1 acceptance:** an earlier draft said "compiled out of production builds"; the module does ship in `dist/`, what is guarded is its selection, checked at startup and by a spawn test against the compiled server.
- **Alternatives:** wait for the vendor decision (rejected: idle time, and the decision has no bearing on the domain or screens).

## D-023 — M3 build starts on the locked screens; design gate signed off with the hallway test deferred to pre-release
- **Date:** 2026-09-21 · **Status:** DECIDED · **Owner:** PO (Andy), with Dean's verbal agreement of 2026-09-21 on the prototype shape
- **Decision:** the M3-E0 design gate is signed off for the screens the 21 Sep session locked: onboarding (S1, S2), Inventory (S4, S5), Add food (S6 to S9), Shopping (S11), Profile (S12), the four-tab shell plus the Menu slot. The one household hallway test in ux-plan §4 step 4 is **deferred**, to run on the real app before any release, not before build. **Held** until Dean's additional-function list is triaged and D-002 is formally ratified: the Menu page internals (D-020, both views) and the Home dashboard states (OQ-D9). The Menu tab exists in the shell from day one as a placeholder so the nav never changes.
- **Consequences:** M3 build tickets are written from prototype v4 and the copy deck; Menu and Home tickets are written when Dean's list lands. Rework risk is confined to the two held screens. D-002 remains PROPOSED in this log until Dean's list is in; the PO accepts that the locked screens are in every plausible cut (the same reasoning as D-016).
- **Alternatives:** wait for D-002 and the hallway test (rejected by PO: nothing the test finds changes architecture, only copy and layout).

## D-024 — Dean's additional functionality (2026-09-22): triage toward D-002 ratification
- **Date:** 2026-09-22 · **Status:** PROPOSED (architect triage; Andy decides per row, with Dean on rows 10 and 11) · **Owner:** Andy (PO), Dean (product)
- **Input:** [docs/source/additional-functionality.extracted.md](docs/source/additional-functionality.extracted.md) (15 items). **Triage:** [docs/po/dean-additions-2026-09-22.md](docs/po/dean-additions-2026-09-22.md).
- **Proposed:** MVP adds: move item Fridge ⇄ Freezer as a recorded location event; "Remove from inventory" wording and hide rule; favourite meals; safety stock (par level) feeding the deterministic gap math; allergen warnings on shopping rows (never "safe"; unknown for free-text rows); household unit-of-measure preference (display only, exact conversions). Folded into existing epics: executed-in-full shopping with category default locations (M7), menu-driven gaps (D-020, deterministic), defrost reminder as an in-app card first (Menu layer 2), shopping-row origin display (chips and tags first; any colour band from the palette, not literal green and blue, because green means Known Fact and colour is never the sole signal). Kept out of the first release: pantry photo recognition (already future), coupon notifications, AI healthier alternatives (after M6).
- **Consequences if accepted:** D-002 becomes DECIDED as the current build plus the MVP adds; the held Menu and Home tickets (D-020, OQ-D9, D-023) are written; M7 and M3-T5 tickets inherit rows 5, 10, 11, 13. Nothing here adds cash cost.
- **Alternatives:** take the whole list into MVP (rejected: rows 4, 12, 14 need vision or LLM vendors and metered spend); take none (rejected: rows 1, 8, 15 are cheap and clearly wanted).
- **Partial ratification (2026-10-01):** row 1 (move an item between locations) approved by Andy in chat during the second device test ("I accidentally put it into the fridge bucket. There is no way to correct or move to pantry"), generalized from Fridge ⇄ Freezer to any location in the enum. Built as M2-T6 (`ada4455`, 2026-10-02): a move is a recorded location event in its own append-only table (`inventory_item_moves`, migration 0011), never a ledger row (ADR-008); `inventory_items.storage_location` is the one mutable item attribute and changes only together with a move row; any member may move any household item. **OPEN (PO):** Dean's row 1 also said "freezing changes the expiry estimate; MVP records the move and marks the expiry tier Estimated"; M2-T6 leaves the expiry date and tier untouched on a move. Andy decides whether a Fridge to Freezer move re-estimates expiry (M8's expiry engine is the natural home). The other rows stay PROPOSED.

## D-025 — Live product lookup over Open Food Facts, unbundled from A3
- **Date:** 2026-09-29 · **Status:** DECIDED (PO Andy, in chat, after the first on-device test showed every real barcode missing) · **Owner:** Andy (PO), architect
- **Context:** the scan screen knew only the four fixture barcodes, so a real product always fell to the typed fallback and manual add, and over HTTP manual add was also refused (client wiring pending). The product lookup endpoint had been bundled into M2-T4 with restrictions storage and server-side screening, which chained product data to the A3 household-permissions decision.
- **Decision:** (1) the API calls **Open Food Facts** live for barcode lookups (rule 17 approval): server-side only, the phone never calls OFF; production host for development traffic within OFF's published limits and with a descriptive User-Agent; OFF's staging host for manual developer testing; the automated test suite never calls OFF (recorded fixtures only, rule 18). (2) **USDA FoodData Central stays out** for now: it needs an API key signup, R-1 could not validate it (rate-limited on every attempt), and it carries no allergen field. (3) **No persisted product catalog**: an in-memory per-process TTL cache only, so the ODbL share-alike question (R-4) stays untouched. (4) The lookup endpoint is **unbundled from A3** as ticket M2-T4a; until M2-T4 stores restrictions, the lookup response carries an explicit `NOT_RUN` screening state that the scan sheet renders as "not checked", never as a verdict.
- **Consequences:** ADR-006 gains a PROPOSED provenance-tier policy for OFF data (identity match KNOWN_FACT; every OFF label field ESTIMATED with source `open-food-facts`; OFF can never license the absence of an allergen, so `ALLOWED` cannot come from OFF data alone, consistent with D-017); copy-deck §3.3 gains the `NOT_RUN` row; M3-T4d wires the client to the M2-T3 endpoints in parallel; M3-T4e wires lookup once M2-T4a lands.
- **Alternatives:** wait for A3 (rejected: blocks the one flow a fridge test exercises); call OFF from the phone (rejected: no rate control, no provenance stamping, the API is the data boundary); FDC alongside OFF (rejected for now, see above).

## D-026 — Open Food Facts `en:gluten` tag maps to `wheat` (over-blocking direction)
- **Date:** 2026-09-29, amended 2026-10-01 · **Status:** PROPOSED, built as amended in M2-T4b (dual emission pinned by the celiac, coconut and mollusc tests); PO ratifies the amended text · **Owner:** architect, Andy (PO)
- **Context:** M2-T4a maps ten OFF allergen tags into the engine's codes and passes everything else through raw, where it reads as unrecognized data (an unknown plus a warning, never a block). OFF tags gluten-containing cereals as `en:gluten`, not `en:wheat`, so a product tagged gluten reaches a wheat-allergic member as an unknown rather than a block once M2-T4 runs the engine.
- **Decision (proposed, amended 2026-10-01 after the M2-T4b review):** map `en:gluten` to `wheat` for both CONTAINS and MAY_CONTAIN **and keep the raw `en:gluten` assertion alongside it** (dual emission). The review proved that mapping alone narrows screening: the engine matches a user-defined term such as "gluten" against the raw tag, and a celiac member can only express gluten that way under D-017, so a product tagged gluten went from BLOCKED on main to ALLOWED_WITH_UNKNOWNS with the mapped tag only. With both assertions the outcome is a strict superset of main's: the wheat block for wheat-allergic members plus the user-defined match, at the cost of the UNRECOGNIZED_ALLERGEN_DATA warning every gluten-tagged product already carried. The same dual-emission rule applies to every non-identity mapping in the table (`en:coconut` to `tree_nut`, `en:molluscs` to `shellfish`), so a user-defined "coconut" or "mollusc" term keeps matching. The EU-only tags (`en:mustard`, `en:celery`, `en:lupin`, `en:sulphur-dioxide-and-sulphites`) stay raw. Over-blocking barley, rye and oat products for wheat-allergic members remains the accepted D-017 safe direction.
- **Alternatives:** leave gluten raw (rejected: a real wheat signal downgraded to an unknown); add a `gluten` code to the taxonomy (rejected for now: the taxonomy is the FDA nine plus user-defined, D-017).

## D-027 — Browser origins may call the API only through an explicit allowlist (BUG-002)
- **Date:** 2026-09-30 · **Status:** PROPOSED, built as proposed in the BUG-002 fix (2026-10-01, `2051473`; a malformed entry, `*`, `null` or credentials in an entry refuses to start without echoing the entry; `Vary: Origin` on every response once an allowlist exists; a deployment with `NODE_ENV` unset also implies the two localhost origins, so the deploy checklist sets production and `SK_CORS_ORIGINS` to the deployed web origin); PO ratifies · **Owner:** architect, Andy (PO)
- **Context:** the web build in real mode could not reach the API: the API sent no CORS headers and answered the browser's preflight with 404, so every request carrying the Authorization header was blocked (docs/bugs/BUG-002-api-no-cors.md). Phones are not subject to CORS, so real mode worked there only. Allowing browser origins is a security boundary, not a convenience patch.
- **Decision (proposed):** `SK_CORS_ORIGINS`, a comma-separated list of exact origins, unset by default. Unset: no CORS headers at all (today's behaviour, production-safe). Set: an exactly matching Origin is echoed back (never `*`), with `Vary: Origin`, and a preflight to a `/v1/` route answers 204 with the allowed methods and headers; a non-matching origin gets nothing. No credentials flag (bearer header, not cookies). In development only (`NODE_ENV` unset or `development`) and only when the variable is unset, the two local Expo web origins are implied and logged at startup. Hand-rolled, no package (rule 11).
- **Alternatives:** `@fastify/cors` (rejected: a dozen inspectable lines are enough and the default-deny guard must see the preflight route); allow `*` in development (rejected: a wildcard is a habit that leaks into production); leave web demo-only (rejected: the PO tests in the browser and the README promises real mode there).
- **Consequences:** ARCHITECTURE §7.11 gains the rule; `.env.example` gains the name; the mobile README states which origins work in real mode on web.

---

## D-028 — Confirming an AI proposal is its own append-only record, never an edit of a ledger row (M2-T5)
- **Date:** 2026-10-01 · **Status:** PROPOSED, built as proposed in M2-T5 (`dab68f1`, migration 0010; the request body field is `idempotencyKey` like every other write); PO ratifies · **Owner:** architect, Andy (PO)
- **Context:** the M2-T5 ticket as first written asked the worker to set `provenance_confirmed_by` on the existing AI-interpreted ledger rows. The worker stopped (rule 25): `inventory_transactions` is append-only by grant (0006: SELECT and INSERT only), by trigger (0004 `inventory_transactions_no_mutation`, every role) and by the permanent tests behind INV-LEDGER-2 and ADR-008; a zero-delta row is refused by `qty_nonzero`; no item or lot column the app role may update carries quantity provenance. The architect's ticket was wrong, not the worker.
- **Decision (proposed):** a new append-only table `inventory_confirmations` (migration 0010): one row per confirmed ledger transaction, with a composite household foreign key to the transaction, `confirmed_by` (the user), a nullable `model_ref`, `client_key` and `confirmed_at` from `clock_timestamp()`; RLS, SELECT and INSERT only for the app role, a no-mutation trigger, `UNIQUE (household_id, transaction_id)`. Confirming an item inserts one row for every not-yet-confirmed `AI_INTERPRETATION` transaction of that item in one database transaction. Reads join it: a confirmed transaction presents as `KNOWN_FACT` with source "{original source} · confirmed by {initials}", so the summary tier the list derives from the latest row flips without touching the row. The `ai-confirmed` actor kind stays reserved for rows inserted by a future AI flow after confirmation; the seeded receipt rows and their system actor are untouched. An item already fully confirmed answers the same idempotent 200; 409 `NOT_A_PROPOSAL` only when the item has no AI-interpreted transaction at all.
- **Alternatives:** relax append-only for one column (rejected: weakens INV-LEDGER-2 for every future case); a zero-delta confirmation transaction type (rejected: changes the ledger's core shape and the `qty_nonzero` invariant for a non-quantity fact); confirm only the latest row (rejected: an older unconfirmed AI row would keep the item in the tray after the user said it was right).
- **Consequences:** ADR-008 gains the note that provenance-level facts about a transaction live in sibling append-only tables; M2-T6's migration moves to 0011; ai-architecture §5 points at the table as the confirmation record that feeds evaluation data.

## D-029 — Count units take whole numbers only
- **Date:** 2026-10-07 · **Status:** DECIDED (Andy, PO, in chat 2026-10-07) · **Owner:** architect, Andy (PO)
- **Context:** M3-T7 let S5's typed amount and S8's typed size take decimals for every unit. On the phone Andy found 12.5 eggs and 1.5 boxes of tea (2026-10-06). Half an egg isn't real, and a fraction of a box is a guess nobody keeps up to date.
- **Decision:** amounts in count units (`count`, `each`, and any other COUNT-kind unit in the registry) are whole numbers. The client steps them by 1 and refuses a typed fraction with a hint. The server refuses a fractional count on every write (create, correction, removal), so the screen is never the only guard (rule 6). Mass and volume units keep decimals.
- **Existing data:** history stays as written (ADR-008, append-only). An item that already holds a fraction can be corrected to a whole number. The architect decides in the ticket whether a removal from a fractional balance is allowed down to zero.
- **Consequences:** a ticket (Opus implementation and review, rule 23 inventory arithmetic) across contracts, the domain or API validation, S5 and S8; copy for the hint proposed in the ticket.

## D-030 — A passed best-by date reads "expired", not "use today"
- **Date:** 2026-10-07 · **Status:** DECIDED (Andy, PO, in chat 2026-10-07) · **Owner:** architect, Andy (PO)
- **Context:** S4 and S5 show "use today" for an item whose date has already passed (copy-deck S5 "Expired: not yet designed"). On the phone every seeded fridge item read "use today" once its September date had passed.
- **Decision:** "use today" is for a date that is today. A date in the past reads "expired". The architect proposes the exact strings in the ticket and keeps provenance honest: a passed Estimated date must not read as certain as a Known Fact date (P-rules, copy-deck §4), so its wording is proposed in the ticket and added to the copy deck at acceptance.
- **Consequences:** a Sonnet ticket on S4 and S5 display (no data change); copy-deck S5 "Expired" line updated at acceptance.

---

## Open product-owner questions (not yet decisions)
Q1–Q8 in [PRODUCT.md §8](PRODUCT.md#8-unanswered-questions-product-owner-input-needed); Q9–Q10 in [MVP_PRD.md §14](docs/prd/MVP_PRD.md#14-open-questions). Answers get promoted to D-numbers here.

**Open engineering questions (architect-owned, recorded 2026-09-22 from the M2-T1 review):**
- **OQ-E1 Multi-household sessions.** `Session` carries one `householdId`; the schema allows a user to belong to several households. Safe today (the fixture map enforces one membership per user). Rule for M2-T3 and the auth-vendor adapter: the *set* of permitted households comes only from the identity port, and any client-side selection is validated against `household_memberships` inside the tenant session, never trusted from a header or body.
- **OQ-E2 Lot expiry provenance.** `inventory_lots.expiry_tier` stores a tier with no source, confidence or timestamp (migration 0003), so `FieldProvenanceDto` carries honest nulls there. Decide with OQ-D7 whether lots get a full provenance block (schema change, M4 or M8). *M2-T3 note (2026-09-29):* item creation accepts `bestByProvenance` and keeps only its tier; an `AI_INTERPRETATION` best-by lands on the lot unconfirmed and labelled as such. Decide before the first AI-tier best-by source (receipts, M5) whether the lot needs a confirmation state per ai-architecture.md.
- **OQ-E3 Join code expiry (M2-T3, 2026-09-29).** The ticket said "expired codes"; no expiry policy or column exists, so codes live until the owner rotates them (one live code per household). PO call: expire or not, and after how long. Architect recommendation: no expiry for MVP, rotation is enough for a household-sized audience; revisit with real signups.
- **OQ-E4 Creating a household while already a member (M2-T3 review N1).** `POST /v1/households` has no idempotency key and a member who creates a second household is moved to it with no way back until switching exists. Only reachable through the API today (onboarding offers create to new users only). Proposed rule for the client-wiring ticket: refuse create for a caller who already has a membership until switching exists, and add a client key to the create body.

## Research required (evidence before decision)
- R-1 Barcode coverage: OFF/FDC hit-rate on a realistic US basket → feeds D-010 (ticket M1-T5).
- R-2 Receipt pipeline bake-off: accuracy × cost across OCR+LLM / multimodal / specialized APIs → feeds D-011 (M5).
- R-3 AI provider data-use terms review before real user data in prompts (pre-launch gate; threat model §7.8).
- R-4 ODbL / commercial food-data licensing implications for our merged catalog (legal; with R-1).
- R-5 GDPR special-category status of allergy data if non-US launch considered (legal; depends Q1).
