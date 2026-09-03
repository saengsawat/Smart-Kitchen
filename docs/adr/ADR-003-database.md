# ADR-003: Primary database

**Status:** PROPOSED (strong lean: PostgreSQL) · Target decision point: M1-T2 (first migration)

## Context
Needs: transactional ledger appends + snapshot updates (atomicity), relational product catalog with joins (product↔identifier↔ingredient↔nutrition), household tenancy isolation, JSON payloads for observations, boring operations for a small team.

## Options considered

**A. PostgreSQL** — *Pros:* ACID transactions for ledger+snapshot; RLS for tenancy defense-in-depth; JSONB where schemaless helps; UUIDv7-friendly; runs anywhere (managed or container) → low lock-in; the default boring choice. *Cons:* requires migrations discipline; offline-sync (ADR-010) not built-in.

**B. Firestore / DynamoDB** — *Pros:* managed sync/offline stories (Firestore), zero-ops. *Cons:* ledger invariants and multi-entity transactions harder; catalog joins painful; strong vendor lock-in; RLS-equivalent tenancy weaker for our shape.

**C. MySQL** — Comparable to A but weaker RLS/JSON story; no advantage for us.

**D. SQLite-per-tenant (Turso-style)** — Interesting for offline-first future; immature operational story for shared catalog + cross-household product data; revisit only if ADR-010 goes offline-first.

## Recommendation
**A: PostgreSQL.** The ledger is the heart of the system and it wants ACID + SQL.

## Consequences
Migration tooling + reversibility tests from M1-T2; RLS evaluation happens there too; managed-Postgres vendor chosen with hosting (M2) — schema is vendor-portable.

## Open questions
- Adopt RLS or app-layer-only isolation? (M1-T2 spike; leaning yes.)
- Managed provider (Neon/Supabase/RDS/…) — with hosting decision, cost-driven.
