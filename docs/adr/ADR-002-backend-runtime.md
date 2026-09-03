# ADR-002: Backend runtime & framework

**Status:** DECIDED — Node.js + TypeScript with **Fastify** (2026-09-03). Runtime ratified via product-owner go-ahead for M0-T1 (which presupposes this stack); framework selected by architect (ENG-owned per D-006): the module boundaries in this architecture come from the domain design and dependency-lint, not a framework — Fastify's lean surface fits that, NestJS's DI/decorator layer would duplicate it. Reversal cost while the API is skeletal: low.

## Context
Modular monolith API (ARCHITECTURE.md §1): CRUD + ledger + adapter orchestration. No heavy in-process ML. Small team; type-safety valued (domain invariants); shared types with client desirable.

## Options considered

**A. Node.js + TypeScript** — *Pros:* one language across client (if ADR-001 = RN), server, contracts; strong typing for domain code; huge ecosystem; async-I/O fits an adapter-heavy API. *Cons:* CPU-bound work (none planned in-process) is weak; ecosystem churn requires discipline.

**B. Python (FastAPI)** — *Pros:* best AI/data-tooling ecosystem. *Cons:* splits stack from TS client; typing weaker for a domain-invariant-heavy core. Remains the likely choice **if** we later add ML-heavy workers — those would live behind the same ports, so this door stays open.

**C. Go** — *Pros:* performance, deploy simplicity. *Cons:* more ceremony for domain modeling; no stack sharing; team leverage lower.

Framework (within A): **Fastify + explicit modules** (lean, fast, minimal magic) vs **NestJS** (structure out of the box, DI, heavier). Lean: Fastify — our module boundaries come from the domain design and dependency-lint, not a framework. OPEN until M0-T1.

## Recommendation
**A: Node.js + TypeScript**, strict mode, single deployable. Framework decided in M0-T1 after a short spike.

## Consequences
`packages/domain` is pure TS with zero I/O; adapters isolate all vendor SDKs; a future Python worker is an ops addition, not a rewrite.

## Open questions
- ~~Fastify vs NestJS~~ — resolved 2026-09-03 (Fastify, see Status).
- ORM/query layer (Drizzle vs Kysely vs Prisma) — interacts with RLS decision in [data-model.md §5](../architecture/data-model.md#5-tenancy-isolation--sensitive-data); decide M1-T2.
