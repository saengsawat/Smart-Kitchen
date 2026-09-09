# Architecture Decision Records

ADRs capture decisions that are expensive to reverse or that future contributors will ask "why?" about. The log of *all* decisions (including product/process ones) is [DECISIONS.md](../../DECISIONS.md); ADRs are the long-form records it links to.

## Rules

- Statuses: **OPEN** (not yet evaluated enough to propose) → **PROPOSED** (recommendation exists, awaiting approval/evidence) → **DECIDED** → **SUPERSEDED**.
- An ADR is only marked DECIDED with evidence and owner sign-off recorded in DECISIONS.md. Do not manufacture decisions.
- Template sections: Context · Status · Options considered (with pros/cons) · Recommendation (if PROPOSED) · Consequences · Open questions.
- New ADR = next number, kebab-case slug, linked from this index and DECISIONS.md.

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-client-platform.md) | Client platform | PROPOSED (Expo/React Native) |
| [ADR-002](ADR-002-backend-runtime.md) | Backend runtime & framework | PROPOSED (Node/TypeScript; framework open) |
| [ADR-003](ADR-003-database.md) | Primary database | PROPOSED (PostgreSQL) |
| [ADR-004](ADR-004-authentication.md) | Authentication | PROPOSED (managed provider; vendor open) |
| [ADR-005](ADR-005-ai-provider-abstraction.md) | AI provider abstraction | PROPOSED (ports + evals; no vendor pick) |
| [ADR-006](ADR-006-food-data-sources.md) | Food/product data sources | OPEN (research required) |
| [ADR-007](ADR-007-receipt-ocr-pipeline.md) | Receipt/OCR pipeline | OPEN (fast-follow feature) |
| [ADR-008](ADR-008-inventory-ledger.md) | Inventory ledger model | DECIDED (2026-09-08) |
| [ADR-009](ADR-009-image-object-storage.md) | Image/object storage | OPEN (deferred until receipts) |
| [ADR-010](ADR-010-offline-sync.md) | Offline & synchronization strategy | OPEN (online-first MVP proposed) |
