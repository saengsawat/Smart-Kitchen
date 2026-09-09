# ADR-003: Primary database

**Status:** DECIDED — PostgreSQL, **with Row-Level Security adopted** (2026-09-10, M1-T2 evidence; managed-provider choice remains open for M2 hosting)

## Decision evidence (M1-T2)
Six migrations + 96 database tests, adversarially reviewed ([record](../handoff/M1-T2.review.md)): RLS policies on every household-scoped table, fail-closed on missing context, exercised as the real non-superuser app role with positive controls; append-only enforced by grants AND trigger; snapshot columns writable only by the ledger trigger (see ADR-008); household-scoped idempotency index; reconciliation views summing exact micros. Anticipated ORM friction did not materialise (raw-SQL migrations + thin mapping). RLS **complements** the app-layer household check — INV-TENANT-1 requires both halves; M2's authz matrix is still mandatory.

**Standing rules (demonstrated by review findings, binding on all future schema work):**
1. Household-scope **every unique constraint** on tenant tables — RLS does not protect against unique-index oracles (a cross-tenant probe can otherwise read information out of error-type boundaries).
2. Any trigger that reads household-scoped tables must be `SECURITY DEFINER` with a pinned `search_path`, or it **fails open** under RLS (its verification query gets filtered as the caller).
3. Views on tenant tables require `security_invoker = true` or they read past every policy.
- Pre-production gate (M2): dedicated non-superuser owner role for `SECURITY DEFINER` functions.

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
