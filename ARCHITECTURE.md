# ARCHITECTURE.md

**Status:** PROPOSED overall; individual choices tracked in [docs/adr/](docs/adr/README.md) and [DECISIONS.md](DECISIONS.md). Nothing here is DECIDED until its ADR says so.

Companion detail docs:
[system-context.md](docs/architecture/system-context.md) ·
[domain-model.md](docs/architecture/domain-model.md) ·
[data-model.md](docs/architecture/data-model.md) ·
[ai-architecture.md](docs/architecture/ai-architecture.md) ·
[testing-strategy.md](docs/architecture/testing-strategy.md)

---

## 1. Architecture principles

1. **Modular monolith first.** One deployable backend with enforced internal module boundaries. No microservices, Kubernetes, event streaming, or CQRS — none of the actual requirements (small team, single product, modest early scale) justify them. Boundaries are designed so a module *could* be extracted later if evidence demands it.
2. **Deterministic core, probabilistic edge.** Safety- and money-relevant logic (allergens, nutrition math, ledger, gap computation, ranking) is deterministic and unit-tested; AI subsystems propose, never dispose ([ai-architecture.md](docs/architecture/ai-architecture.md)).
3. **Ledger over mutation.** Inventory is an append-only transaction log with derived snapshots — auditable, idempotent, reconcilable ([ADR-008](docs/adr/ADR-008-inventory-ledger.md)).
4. **Provenance is a first-class field.** Known Fact / Estimated / AI Interpretation on every fallible fact (brief §14).
5. **Replaceable edges.** Every external provider (food data, LLM, OCR, auth, storage) sits behind a port with a fixture implementation. No domain import of any vendor SDK.
6. **Inventory accuracy is the product.** The correction-rate metric shapes design priorities more than feature count (brief §18C).
7. **Cost-aware from day 1.** Every AI/OCR/lookup call is metered and attributable.

## 2. Proposed shape

```
apps/
  mobile/        client app (ADR-001: Expo/React Native proposed vs PWA)
  api/           modular monolith backend (ADR-002: Node/TypeScript proposed)
packages/
  domain/        pure domain logic: ledger, allergen rules, gap math, ranking,
                 units. Zero I/O, zero vendor imports. The most-tested code.
  contracts/     shared API/schema types (client ↔ server)
  adapters/      provider ports + implementations (fixture + real)
```

Backend internal modules (folders with lint-enforced import rules, not services):
`identity` · `household` · `catalog` (product knowledge) · `inventory` (ledger) · `cooking` (recipes/recommendations/meal logs) · `shopping` · `ingestion` (receipts/observations, fast-follow) · `platform` (auth, telemetry, storage).

Module rule: modules talk through exported interfaces; `inventory` never imports `cooking` internals, etc. Enforced by dependency-lint in CI (M0).

## 3. Technology evaluation (facts / recommendation / open)

| Area | Options weighed | Recommendation (PROPOSED) | Why / lock-in notes | ADR |
|---|---|---|---|---|
| Client | Expo/React Native · PWA · native ×2 | **Expo/RN** | Camera+barcode need native APIs (PWA camera/barcode support is uneven, esp. iOS); one TS codebase; small team. Native ×2 doubles cost; PWA is the cheap fallback if camera constraints relax. Lock-in: moderate, mitigated by thin client / server-owned logic | [ADR-001](docs/adr/ADR-001-client-platform.md) |
| Backend | Node/TS (Fastify or Nest) · Python (FastAPI) · Go | **Node/TypeScript** | One language across client/server/contracts; typed domain package shared; team-size leverage. Python remains an option later for ML-heavy workers behind the same ports — not now. Framework choice inside ADR-002 | [ADR-002](docs/adr/ADR-002-backend-runtime.md) |
| Database | PostgreSQL · MySQL · Firestore/Dynamo · SQLite/Turso | **PostgreSQL** (strong lean) | Relational fits ledger + catalog joins; RLS option for tenancy; JSONB for observations; boring, portable, cheap at MVP scale. Document stores make ledger invariants and cross-entity queries harder | [ADR-003](docs/adr/ADR-003-database.md) |
| Auth | Managed (Clerk/Auth0/Supabase/Cognito) · self-hosted (Keycloak) · roll-own | **Managed provider** | Auth bugs are existential; small team shouldn't own password/OTP infra. Lock-in real but bounded: only `platform/identity` touches it; users exportable. Vendor pick inside ADR-004 | [ADR-004](docs/adr/ADR-004-authentication.md) |
| LLM | Anthropic · OpenAI · Google · open-weights | No vendor pick now | Port + eval suite make the choice swappable and testable; pick per-capability by eval + cost when M6 nears | [ADR-005](docs/adr/ADR-005-ai-provider-abstraction.md) |
| Food data | Open Food Facts · USDA FDC · commercial UPC APIs | Cascade: OFF + FDC first, commercial only if coverage demands | RESEARCH REQUIRED: measured coverage on a real shopping basket (ticket M1-T5) | [ADR-006](docs/adr/ADR-006-food-data-sources.md) |
| OCR | Cloud OCR (Google/AWS/Azure) · multimodal LLM direct · on-device | Open; fixtures first | Fast-follow feature; pipeline shape decided before vendor | [ADR-007](docs/adr/ADR-007-receipt-ocr-pipeline.md) |
| Object storage | S3-compatible anything | S3-compatible API assumed; vendor open | Needed with receipts; trivial to defer | [ADR-009](docs/adr/ADR-009-image-object-storage.md) |
| Offline/sync | Online-first + cache · full offline w/ CRDT/sync engine | **Online-first for MVP**; shopping list gets read cache + queued check-offs | Brief requires offline *shopping list* only (§6). Full offline sync is a project-sized commitment — defer until evidence | [ADR-010](docs/adr/ADR-010-offline-sync.md) |
| Hosting | Render/Fly/Railway-class PaaS · AWS/GCP direct | PaaS-class for MVP (no resources created yet) | Optimize for zero ops burden; migration path to IaaS preserved by containerized monolith + Postgres | (decide at M2, no ADR yet) |

**No cloud resources are created during the foundation phase.** Deployment decisions are documented, not executed.

## 4. Synchronization model (MVP)

Server is the source of truth. Clients read-through-cache household state; writes are online, idempotent (client-generated keys), and safe to retry. Two-device consistency = last-write-wins per row for CRUD entities + append-only merge for ledger (appends commute). Full offline editing and conflict resolution: [ADR-010](docs/adr/ADR-010-offline-sync.md), OPEN.

## 5. Idempotency (summary)

Client-generated UUIDv7 keys on every mutating command; content-hash dedupe on receipt uploads; correlation refs from transactions back to their cause. Detail: [data-model.md §6](docs/architecture/data-model.md#6-idempotency).

## 6. Cost awareness

| Cost center | Control |
|---|---|
| LLM inference | Metered per call → per-household/week rollup; model tiering; caching by context hash; daily per-household caps with graceful degradation |
| OCR | Fast-follow; fixture-driven dev keeps spend at 0 until launch; per-receipt unit cost tracked from first live call |
| Image storage | Receipts downscaled/compressed at upload; retention policy (threat model §7.9) caps growth |
| Database/storage | Single Postgres at MVP scale is small; ledger growth is linear and cheap; partitioning is a someday-problem |
| Food data | OFF/FDC are free; commercial UPC APIs only after coverage research proves need (they are per-call — cache aggressively) |
| Notifications | Fast-follow; platform push is ~free at MVP scale |
| Observability | Sampled traces, free-tier error tracking initially; structured logs to stdout — avoid per-GB log vendors until needed |

## 7. Security & privacy threat model (initial)

Data held: identity, age/sex/height/weight, health-adjacent goals and **allergies**, household composition, purchase history and spending, photos (receipts, later shelves), food consumption history. Treat the aggregate as sensitive personal data.

1. **Authentication:** managed provider (ADR-004); MFA available; tokens short-lived; refresh rotation.
2. **Authorization:** every request resolved to (user, household, role); default-deny; the authz matrix is a permanent test suite (INV-TENANT-1).
3. **Household isolation:** app-layer mandatory household context + candidate Postgres RLS as defense in depth ([data-model.md §5](docs/architecture/data-model.md#5-tenancy-isolation--sensitive-data)).
4. **Least privilege:** app DB role has no UPDATE/DELETE on ledger tables; no superuser in app path; provider API keys scoped per capability.
5. **Encryption:** TLS everywhere in transit; at-rest via platform (DB + object storage); no custom crypto.
6. **Secrets:** never in repo (gitignore + secret scanning in CI baseline); injected via environment/platform secret store; `.env.example` documents names only.
7. **PII & health-adjacent data:** profiles/allergies minimized, member-private by default (OQ-3); not sent to LLM providers except where a feature requires it (allergen *codes*, not identity, go into generation context); excluded from logs.
8. **AI provider exposure:** contracts must be reviewed for training-use terms before any real user data flows (RESEARCH REQUIRED, pre-launch gate); until then only synthetic/fixture data in prompts during development.
9. **Image/receipt retention:** explicit policy required before receipt launch (`PROPOSED`: originals deleted after confirmed parse + N days; parsed data retained). OPEN — product owner input.
10. **Audit logging:** authz denials, profile/allergy changes, data exports/deletions logged with actor; ledger is itself the inventory audit trail.
11. **API abuse:** rate limiting per user/IP; upload size/type limits; AI endpoints get stricter quotas (cost DoS).
12. **Prompt injection / malicious uploads:** [ai-architecture.md §4](docs/architecture/ai-architecture.md#4-prompt-injection--untrusted-content); uploaded images validated/re-encoded; no user content becomes instructions.
13. **Deletion/export:** design for account+household data deletion and export from the start (schema keeps household-scoped data enumerable); required for GDPR/CCPA-class obligations.
14. **Dependency security:** lockfiles committed; automated dependency + secret scanning in CI (baseline, M0).
15. **Logging redaction:** structured logger with denylist (names, emails, tokens, profile fields, allergy details); log payload review is part of code review.

**Legal/compliance questions — flagged, not answered here:**
- HIPAA: on current facts (consumer wellness app, no covered entity/plan involvement) HIPAA **likely does not apply** — but this is a legal determination, not an engineering one. Get counsel before any marketing claim or B2B health partnership.
- GDPR/UK/CCPA applicability depends on launch markets (Q1). Allergy data may qualify as special-category health data under GDPR — if EU launch is considered, this needs legal review *before* collection.
- COPPA-class issues if minors get profiles (Q7).

## 8. Observability

From first deploy (M2), not retrofitted:

- **Structured JSON logs** with request/correlation IDs propagated client → API → adapters; correlation ref stored on resulting transactions.
- **Error tracking** (client + server) with release tagging.
- **Metrics:** API latency p50/p95/p99 per route; external-provider error/latency/timeout rates per port; OCR + parse confidence distributions; AI token usage and cost per call/capability/household.
- **Product-health metrics** (the ones that matter — MVP_PRD §12):
  - **Inventory correction rate** — corrections ÷ transactions per household-week. *Primary metric*: it measures whether the system's beliefs track reality, which is the hypothesis (brief §18C). A falling correction rate with steady usage = product working; session counts can look great while inventory rots.
  - Recommendation acceptance/rejection; barcode resolution rate; receipt-line correction rate (fast-follow); close-the-loop rate; weekly active inventories.
- **Alerting:** provider failure spikes, reconciliation drift (INV-LEDGER-1 violations in prod = page), cost-cap breaches.

## 9. What we are explicitly not building yet

Microservices; message brokers/event streaming; CQRS/event-store frameworks; multi-region; Kubernetes; GraphQL federation; feature-flag platforms; a data warehouse. Each has a trigger condition (scale, team size, or feature evidence) noted in the relevant ADR before adoption would be considered.
