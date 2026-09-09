# Smart Kitchen App

[![CI](https://github.com/saengsawat/Smart-Kitchen/actions/workflows/ci.yml/badge.svg)](https://github.com/saengsawat/Smart-Kitchen/actions/workflows/ci.yml)

**An AI kitchen manager, not another recipe app.** The system maintains a continuously updated, trustworthy inventory of a household's fridge/freezer/pantry with minimal manual entry (barcode, receipts, later camera), and uses it to close the loop: *what should we cook → what should we buy → what did we use → what's about to expire*.

**Problem:** households don't know what food they own — so they buy duplicates, waste expiring food, and get recipe suggestions disconnected from their actual pantry. Existing apps fail because the user ends up maintaining the inventory by hand and quits.

## Current phase

**Phase 0 — engineering foundation.** This repo contains the complete planning/architecture foundation plus workspace scaffolding (ticket M0-T1); no product/domain logic exists yet. Live state: [STATUS.md](STATUS.md).

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io/) (install via `corepack enable`, or `npm install -g pnpm` if corepack is unavailable in your environment).

```bash
pnpm install     # install workspace dependencies
pnpm lint        # ESLint, incl. the packages/domain dependency-boundary rule
pnpm typecheck   # tsc -b across all workspace packages (TypeScript strict)
pnpm test        # Vitest, one placeholder test per package
pnpm format      # Prettier --write (docs/**, *.md, BACKLOG_TRACKER.csv excluded)
```

Workspace shape (ARCHITECTURE.md §2): `apps/api` (Fastify — [ADR-002](docs/adr/ADR-002-backend-runtime.md)), `packages/domain` (pure, zero-dependency, zero-I/O core), `packages/contracts`, `packages/adapters`. `packages/domain` may import nothing but itself; an import from `packages/adapters` or `packages/contracts`, or any external package, fails `pnpm lint` (`eslint.config.js`).

## MVP hypothesis

> The system can keep household inventory accurate with low enough friction that users keep it alive — and that inventory makes cook/buy decisions materially better than a generic recipe app.

The primary product-health metric is the **inventory correction rate** (how often users must fix the system's beliefs), not session counts. Scope details and what was deliberately cut from the original Phase 1: [docs/prd/MVP_PRD.md](docs/prd/MVP_PRD.md).

## Key architecture principles

1. **Modular monolith** — one deployable backend, enforced module boundaries, no microservices/K8s/CQRS at this scale.
2. **Deterministic core, probabilistic edge** — allergen rules, nutrition math, ledger, and shopping-gap math are deterministic and tested; AI (OCR, parsing, recipe generation) only *proposes*, with confidence + provenance, behind replaceable adapters.
3. **Inventory is an append-only ledger** — every quantity is derivable from auditable transactions; corrections are data, not overwrites.
4. **Provenance everywhere** — every fallible fact is tagged Known Fact / Estimated / AI Interpretation.
5. **Safety first** — allergen decisions never rest on LLM claims alone; the UI never promises a food is "safe."

Full proposal: [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository map

| Path | What it is |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Requirements digest (DOCUMENTED / INFERRED / UNKNOWN classified) |
| [docs/prd/MVP_PRD.md](docs/prd/MVP_PRD.md) | Engineering-ready MVP spec + scope challenge |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture, threat model, observability, cost |
| [docs/architecture/](docs/architecture/) | Domain model, data model, AI architecture, system context, testing strategy |
| [docs/adr/](docs/adr/README.md) | Architecture Decision Records (ADR-001…010) |
| [DECISIONS.md](DECISIONS.md) | Decision log — OPEN/PROPOSED/DECIDED/SUPERSEDED index |
| [BACKLOG.md](BACKLOG.md) | Milestones → epics → tickets (M0–M1 fully specified) |
| [STATUS.md](STATUS.md) | Current state, blockers, next actions |
| [CLAUDE.md](CLAUDE.md) | Standing rules for AI-assisted development |
| [docs/source/](docs/source/) | Original product brief (unaltered DOCX + extracted text) |
| [docs/research/](docs/research/) | Research spike outputs (e.g. food-data coverage) |
| `apps/` `packages/` | Workspace scaffolding (M0-T1); no product/domain logic yet |
| `tests/fixtures/` `scripts/` | Skeletons; filled as later tickets need them |

## How work is managed

- All work flows through [BACKLOG.md](BACKLOG.md) tickets; one ticket at a time, file scope enforced ([CLAUDE.md](CLAUDE.md)).
- Decisions are made in [DECISIONS.md](DECISIONS.md)/ADRs — a decision without a log entry didn't happen.
- Baseline: trunk-based development, short-lived branches, conventional commits with ticket refs, PR review, TypeScript strict + ESLint + Prettier + Vitest (installed, M0-T1), CI with secret/dependency scanning (M0-T2, not yet installed), committed lockfiles, `.env.example` templates.
- Contributor workflow, commit conventions, local setup, and the branch-protection checklist: [CONTRIBUTING.md](CONTRIBUTING.md).

## Current next step

M0-T1 (scaffolding) is done. Next: decide the repo remote/hosting (and the OneDrive question in [STATUS.md](STATUS.md)) to unblock **M0-T2 (CI)**, and ratify **D-002 (MVP scope)** / **D-003 (inventory ledger)** in [DECISIONS.md](DECISIONS.md) to unblock **M1**.
