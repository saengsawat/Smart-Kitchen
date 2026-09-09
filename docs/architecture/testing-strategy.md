# Testing Strategy

**Status:** PROPOSED. Priority: business invariants over UI snapshots. Tooling choices finalize with ADR-001/002; the strategy below is toolchain-agnostic.

## 1. Test layers

| Layer | Scope | Runs | Notes |
|---|---|---|---|
| Domain unit tests | Pure domain logic (ledger math, gap computation, allergen rules, ranking, unit conversion) | Every commit, fast | Domain package has zero I/O — fully unit-testable by construction |
| Property/invariant tests | Randomized sequences against domain invariants (see §2) | Every commit | fast-check-style generators over transaction sequences |
| API integration tests | HTTP → service → real (containerized) DB | Every PR | Includes authz/isolation suites |
| Database tests | Migrations up/down, constraints, RLS policies, append-only enforcement | Every PR | Migration reversibility tested before merge |
| Contract tests | Each provider adapter vs recorded fixtures; live smoke tests on demand | Fixtures in CI; live nightly/manual | Detects provider drift without CI cost/flakiness |
| AI evaluation tests | Golden sets per probabilistic capability ([ai-architecture.md §6](ai-architecture.md#6-evaluation--fixtures)) | Fixture-mode in CI; live on demand | Gate for model/provider swaps |
| OCR/vision fixture tests | Fixture images → expected structured output | CI (fixtures) | Includes §18B hard cases |
| E2E tests | Critical journeys on real client against test backend | Pre-release + nightly | Small, stable set — journeys from MVP acceptance criteria |
| Security tests | Isolation fuzzing, authz matrix, injection attempts (incl. prompt injection cases) | Every PR (fast set) + scheduled deep set | |
| Data migration tests | Prod-shaped seed → migrate → invariants still hold | Per migration | |

## 2. Named invariant / property tests

These encode the product's non-negotiables; each becomes a permanent test with this ID:

| ID | Invariant |
|---|---|
| INV-LEDGER-1 | Inventory cannot silently disappear: for any transaction sequence, `current_qty` == Σ deltas, and every change is attributable to a transaction |
| INV-LEDGER-2 | Ledger rows are immutable; correction = new `ADJUSTMENT` row |
| INV-LEDGER-3 | Replaying any write with the same idempotency key is a no-op (retried inventory command ⇒ no duplicate consumption) |
| INV-LEDGER-4 | No committed inventory state is ever negative, at lot or item level; an overshooting decrease is recorded at full magnitude and compensated in the same operation by a system-authored, caller-unforgeable flagged adjustment carrying the exact residual *(wording settled in M1-T1)* |
| INV-TENANT-1 | Household A can never read/write household B data — exhaustive authz matrix over every endpoint + (if RLS adopted) DB-level test with app-role credentials |
| INV-SHOP-1 | `needed_qty == max(0, required − usable_on_hand)` for all unit-compatible cases; incompatible units force explicit resolution, never silent guesses |
| INV-RCPT-1 | Processing the same receipt twice (same content hash) adds inventory at most once |
| INV-MEAL-1 | Retrying a meal log produces exactly one set of decrements |
| INV-NUTR-1 | Nutrition totals are exact arithmetic over stored source values; no path lets generated text supply numbers |
| INV-ALRG-1 | No recommendation containing a known member allergen is ever returned, regardless of LLM output (adversarial fixture: LLM emits allergen-laden recipe ⇒ filtered) |
| INV-ALRG-2 | Missing allergen data surfaces as *unknown + warning*, never as safe |
| INV-CONF-1 | An observation below its confidence threshold cannot reach `confirmed` without a user action |

## 3. Fixtures strategy (`tests/fixtures/`)

Development must never depend on live APIs (cost, flakiness, keys). Layout:

```
tests/fixtures/
  products/        ~100 curated ProductCatalogItem JSONs spanning: complete branded items,
                   missing-nutrition items, allergen-bearing items, multi-code products,
                   generic/PLU produce
  barcodes/        code → expected resolution (hit, miss, multi-source-conflict cases)
  receipts/        image + ground-truth parse pairs; must include §18B hard cases:
                   abbreviations, store SKUs, weighted produce, coupons/discounts,
                   multi-qty lines, duplicates of the same receipt
  inventories/     household inventory snapshots + transaction histories for
                   recommendation/gap-math scenarios (incl. near-expiry sets)
  recommendations/ generation contexts + recorded LLM outputs (valid, malformed,
                   adversarial/allergen-violating, prompt-injection attempts)
  nutrition/       source profiles + expected computed totals
```

Rules:
- Fixtures are synthetic or rights-cleared — no real user data, no scraped content, real receipt images only if scrubbed of PII.
- Every provider port ships a fixture-backed implementation reading from these directories; the same fixtures drive unit, contract, and eval tests (single source of truth).
- Adding a discovered production bug ⇒ first reproduce it as a fixture.

## 4. What we deliberately do less of

- UI snapshot tests: minimal — they churn without protecting invariants.
- Mock-heavy unit tests of glue code: prefer integration tests through real module boundaries.
- 100%-coverage targets: coverage is a diagnostic, the invariant list above is the contract.
