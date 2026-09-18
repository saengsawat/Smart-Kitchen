# PO decision brief — Andy + Dean working session (target: week of 2026-09-15)

**New to the architecture?** Read [architecture-overview-decision-meeting-prep.md](architecture-overview-decision-meeting-prep.md) first (15 minutes, plain language).

**Purpose:** every decision that currently blocks the next build phase, with the architect's recommendation and the cost of each path. Prepared by the architect; nothing here is decided until it is recorded in [DECISIONS.md](../../DECISIONS.md). Guiding preference from the PO (2026-09-15): **open source first, small but scalable, pay only when we hit a wall.** The recommendations below follow that preference and say where the wall is.

**Cost figures are ESTIMATES from list prices known to the architect and must be verified on the vendor's pricing page before signup** (prices and free-tier limits change often). Any signup, key, or paid resource still needs explicit PO approval per CLAUDE.md rule 17.

---

## Part A — Decisions in the order they block work

| # | Decision | Where it lives | Blocks | Who | Architect recommendation |
|---|---|---|---|---|---|
| A1 | **D-002 MVP scope** — ratify the reduced vertical slice or restore parts of the brief's Phase 1 | [DECISIONS.md D-002](../../DECISIONS.md), detail in [docs/prd/MVP_PRD.md](../prd/MVP_PRD.md) §3 | M3 (UI) and M5+ sequencing; which screens exist | **Dean** | Ratify as proposed. Everything built so far is scope-invariant; the cut only decides what the *first* client shows. |
| A2 | **Q1 launch market** (US-only vs other) | [PRODUCT.md §8](../../PRODUCT.md) | Allergen taxonomy (US 9 vs EU 14), units default, R-5 GDPR question | Dean | US first (the engine and fixtures already assume FDA's nine allergens; EU codes are an M4 extension). |
| A3 | **Q3 household permissions** (owner vs member rights; who sees whose allergies) | PRODUCT.md §8, [domain-model.md](../architecture/domain-model.md) OQ-3 | Member-profile and allergy tables (not yet created on purpose), S2/S12 design | Andy + Dean | Owner enters allergies for all members at signup; members can edit their own; allergies visible to the whole household (they have to be, to cook safely); profiles private. |
| A4 | **Authentication approach** | [ADR-004](../adr/ADR-004-authentication.md) (status PROPOSED: managed provider, vendor OPEN); [ARCHITECTURE.md §3](../../ARCHITECTURE.md) row "Auth" | M2 first authenticated endpoint; S1 design | Andy | See Part B1. **Open-source-first pick: Better Auth (TypeScript library inside our Fastify monolith) — $0, no vendor, we own the users table.** Fallback if it proves immature: Supabase Auth (open source, hosted free tier). |
| A5 | **Hosting for the first shared environment** | ARCHITECTURE.md §3 row "Hosting" (decide at M2, no ADR yet); [ADR-003](../adr/ADR-003-database.md) notes the managed-Postgres choice rides with it | M2 deploy target; Dean testing on his own device against real data | Andy | See Part B2. **Phase it:** nothing until Dean needs a shared backend; then one small VPS running Docker Compose (API + Postgres) at ~$5/month; managed Postgres only when backups/uptime matter. |
| A6 | **ADR-001 client platform** (Expo / React Native assumed everywhere) | [ADR-001](../adr/ADR-001-client-platform.md) (PROPOSED) | First M3 ticket; the design plan's library picks | Andy | Decide Expo + React Native. Library picks from the design plan (NativeWind, Reanimated, copy-in components) go through rule 11 at M3 ticketing, one at a time. |
| A7 | **Stubbed-auth M2 core now?** — build household/inventory API against a fixture identity and local Postgres before A4/A5 are final | [BACKLOG.md](../../BACKLOG.md) M2 epic; [D-018](../../DECISIONS.md) consequences | Whether engineering has API work to do while design finishes | Andy | **Yes.** $0, no vendor, and the identity port is swapped in when A4 lands. This is the "build small" move. |
| A8 | **D-017 gate (b): who may mint a KNOWN_FACT allergen declaration** from label data (Open Food Facts) | [DECISIONS.md D-017](../../DECISIONS.md) P5; design OQ-D7 | M4 adapter wiring; scan-sheet copy | Andy + Dean | Manufacturer label data via OFF = **ESTIMATED** tier for allergens until a second source or user confirmation agrees; only a user-confirmed label photo or a verified manufacturer feed mints KNOWN_FACT. Conservative; costs nothing. |
| A9 | **Shortfall policy for meal-log decrements** (user says "used 2 lb", ledger has 1.25) | domain-model.md OQ-1 (M1-T8 note) | M8 consumption UX | Dean | Record the full statement and accept the ledger's clamp (the honest correction-rate signal), then prompt "we thought you had 1.25 lb, fix inventory?" |
| A10 | **UX opens:** OQ-D4 Home = dashboard (prototype), OQ-D5 allergy onboarding (owner-enters-all), OQ-D6 dark mode at launch vs fast-follow, **Q8 product name** (prototype says "KitchenSmart") | [docs/design/ux-plan.md §5](../design/ux-plan.md) | S1/S2/S12 design; app title, icon, store listings | Andy + Dean | Keep dashboard; owner-enters-all; light-first, dark fast-follow; **name needs a decision before any store or domain signup** (and a trademark search, see B7). |
| A11 | **Photo/imagery licensing** (prototype hotlinks Unsplash) | design OQ-D8; R-4 | M3 assets | Andy | Product images from the catalog source where licensed; illustrated category icons otherwise; no Unsplash hotlinks in the product. |
| A12 | **Token darkenings for contrast** (added 2026-09-16) — 16 text/background pairs in the adopted palette fail WCAG AA, incl. the Estimated badge, expiry text, the allergen bar and white-on-terracotta CTA text | [docs/design/tokens.md §2](../design/tokens.md) | M3 token module; every screen's text colours | Andy (visual call) | Adopt all seven PROPOSED values (`--ink-3` `#665c52`, `--amber` `#925b0a`, `--green` `#2c744b`, `--rose` `#9d4b51`, `--danger` `#882020`, brand-tint pairing `#a74925`, CTA text on `--brand-deep`). Each is a slightly deeper shade of the same hue; the direction is unchanged and every pair then passes. Review on the completed prototype during the on-device pass. |

---

## Part B — Cost map: the open-source path, and where each wall is

Totals first. **Foundation through M3 on the open-source path: ~$0/month in software, plus one-off store fees when Dean needs the app on his phone via a store channel.** The first recurring line item appears only when a shared backend is needed (A5).

| # | Cost centre | Open-source / free path (recommended) | The wall (when you would start paying) | Paid path and rough cost (ESTIMATE, verify) |
|---|---|---|---|---|
| B1 | **Auth** | **Better Auth** (MIT, TS, runs inside our API, users in our Postgres): $0. Alternative: **Supabase Auth** (Apache-2, hosted free tier, self-hostable later): $0 to start. Heavier self-host options (Keycloak, Ory Kratos) rejected for now: ops burden for a one-developer team. | Wall = *ops and security time*, not money: password reset email delivery, OTP/SMS, social login keys, breach response. Email sending needs a provider even on the OSS path (free tiers exist: Resend, Postmark trial, Brevo). | Managed: Clerk / Auth0 free tiers cover thousands of MAU; paid tiers roughly $25–35/month once past them. |
| B2 | **Backend + database hosting** | Phase A (now → Dean's first test): **$0** — API and Postgres on Andy's machine; Dean's phone reaches it over a tunnel (Expo dev tunnel, or Cloudflare Tunnel free). Phase B (shared env): **one VPS ~$4–6/month** (Hetzner CX-class or equivalent) running Docker Compose: API + Postgres 17 + nightly `pg_dump` to object storage. | Wall = backups, uptime, and someone paged at 2 a.m. Also our schema needs `CREATE ROLE` and `SECURITY DEFINER` ownership (M1-T2 follow-up); a VPS gives us superuser, some managed providers do not, so verify before choosing a managed one. | PaaS (Fly.io / Render / Railway) hobby tiers ~$0–7/month for the API; managed Postgres (Neon / Supabase free tiers, then ~$19–25/month). |
| B3 | **Mobile client build & distribution** | **Expo + React Native**: $0. Local builds and Expo Go for development: $0. **EAS Build** free tier (a small monthly build allowance) for the first device builds. | Wall 1 = getting the app on Dean's iPhone for more than 7 days: **Apple Developer Program $99/year** (required for TestFlight). Android: **Google Play developer account $25 one-time**. Wall 2 = build minutes: EAS paid plan from ~$19/month if the free allowance runs out (or build locally for free). | Store fees are unavoidable at beta; everything else stays $0 with local builds. |
| B4 | **Food/product data** | **Open Food Facts** (free, ODbL, attribution + share-alike obligations for our merged catalog: R-4 legal question) and **USDA FoodData Central** (free API key, signup needs PO approval under rule 17). Curated PLU table is ours. | Wall = coverage: R-1 measured ~85% branded match on OFF; produce is never a barcode. If coverage disappoints in M4 telemetry, a commercial UPC API becomes the question. | Commercial UPC/nutrition APIs are per-call or ~$50–200+/month tiers; cache aggressively; decide only on M4 evidence. |
| B5 | **LLM (recipes, M6) and OCR (receipts, M5)** | **$0 until those milestones start**: fixture-driven development, recorded outputs, eval suites built first. | Wall = the first live call. Both are metered. Plan daily per-household caps and a hard monthly dev budget (suggest $20/month dev cap to start). | Verify current per-token pricing at decision time; choose the smallest model that passes the eval suite (ADR-005 process). OCR: vendor bake-off (R-2) before any signup. |
| B6 | **Object storage (receipt images, M5)** | Not needed until M5. Then **Cloudflare R2 free tier (10 GB)** or self-hosted **MinIO** on the VPS: $0. | Wall = retention volume; a retention policy (PO decision, threat model §7.9) caps it. | S3-class storage: cents per GB-month. |
| B7 | **Name, domain, trademark, legal** | Placeholder "KitchenSmart" costs nothing until a store listing or domain. | Wall = public beta: domain (~$10–15/year), a trademark search before committing to the name, privacy policy and terms (R-3 AI data-use review, R-4 ODbL, R-5 GDPR if non-US). | Counsel time is the real cost here; templates cover an early beta, a lawyer before public launch. |
| B8 | **Observability** | Structured logs to stdout, **Sentry free tier** or self-hosted **GlitchTip** on the VPS: $0. | Wall = volume; sample traces. | Log/APM vendors bill per GB; avoid until needed (ARCHITECTURE §6). |
| B9 | **CI** | GitHub Actions on a public repo: free. Private repo: 2,000 free minutes/month, currently sufficient. | Wall = build minutes if the repo goes private and builds grow. | ~$4/user/month for GitHub Team if needed. |
| B10 | **Engineering time (agents)** | Not a cash line here, but the dominant cost. Sonnet for routine tickets, Opus only on the rule-23 high-risk list (already the policy). M3 UI is the largest ticket set; rework risk drops sharply once A1 and the design gate are settled. | Wall = building UI before A1: 20–40% rework (assessed 2026-09-14). | — |

**Bottom line for the meeting:** on the recommended path the only cash before beta is **$99/year Apple + $25 Google when Dean needs store-channel builds, and ~$5/month once a shared backend is needed.** Everything else is a decision, not a purchase.

---

## Part C — Suggested 60-minute agenda

1. **(15 min) A1 D-002 scope.** Walk the reduced slice in MVP_PRD §3 against the brief's Phase 1. Decide: ratify, or name the one or two additions Dean cannot live without (each adds screens and API).
2. **(10 min) A2, A3.** Market and household permissions. Both have conservative defaults ready.
3. **(10 min) Prototype v3 on Dean's phone.** Open `docs/design/mockups/smart-kitchen-prototype.html` on the device. Collect reactions; confirm OQ-D4/D5/D6 defaults; pick the product name direction (Q8).
4. **(10 min) A4, A5, A7.** Open-source-first auth and hosting, and a yes/no to the stubbed-auth M2 core so engineering has API work while design finishes.
5. **(10 min) A8, A9.** Two safety/accuracy policies: label-data trust tier, and the shortfall behaviour.
6. **(5 min) Record.** Andy sends the decisions; the architect promotes each to a D-number in DECISIONS.md and unblocks the matching tickets.

---

## Part D — What happens the moment each decision lands

- **A1 ratified →** M3-E0 completes the missing screens and copy deck against a fixed screen list; M3 build tickets get written (Sonnet UI, Opus for allergen surfaces).
- **A4 + A7 yes →** M2 tickets written: identity port + Better Auth adapter, household CRUD, inventory endpoints over the ledger, tenancy suite over HTTP, logging. Zero cash.
- **A5 phased →** no action until Dean's first shared test; then a one-ticket Docker Compose deployment on a VPS (~$5/month) with backups.
- **A6 decided →** ADR-001 DECIDED; first Expo scaffold ticket (M3-T1) can be written.
- **A8, A9 →** two DECISIONS entries; M4 and M8 tickets inherit them.
- **Q8 name →** domain and trademark check (B7) before any signup.
