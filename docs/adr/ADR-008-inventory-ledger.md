# ADR-008: Inventory ledger model

**Status:** PROPOSED (strong lean — foundational; approve before M1) · Owner: eng + product owner

## Context
Inventory is the product (brief §18C). §7 requires a historical record of consumption/waste with typed reasons; §14 requires explainable system beliefs; duplicate/retry safety is an MVP acceptance criterion. The core representational choice: mutate a quantity, or record events and derive quantity.

## Options considered

**A. Append-only `InventoryTransaction` ledger + maintained snapshot** ([domain-model.md §3](../architecture/domain-model.md#3-ledger-vs-mutable-quantity--tradeoff-analysis)) — *Pros:* every belief explainable ("purchase +2, meal −0.75, correction −0.10, expired −0.30 ⇒ 0.85"); corrections are data → the primary KPI (correction rate) is a query; idempotency keys natural; waste/budget analytics (§15B/C) and sync merges (appends commute) fall out later; snapshot keeps reads fast. *Cons:* snapshot must be kept consistent (same-DB-transaction update + reconciliation invariant test INV-LEDGER-1); marginally more write ceremony.

**B. Mutable quantity + side audit log** — *Pros:* simplest CRUD. *Cons:* audit log inevitably drifts from the write path; reconciliation unprovable; corrections invisible; retry safety bolted on.

**C. Full event sourcing (all aggregates, event store, projections)** — *Pros:* uniform model. *Cons:* infrastructure and cognitive cost across entities that don't need it (profiles, lists); explicitly the premature complexity we're avoiding. **Only inventory is ledgered.**

## Recommendation
**A.** This is the single most architecture-defining choice in the system and the one we ask the product owner to ratify first.

## Consequences
Ledger tables are append-only (no UPDATE/DELETE for app role); `packages/domain` owns transaction types and derivation; INV-LEDGER-1..4 become permanent property tests; storage grows linearly (cheap; archive strategy is a someday-problem).

## Open questions
- Snapshot maintenance: app-transaction vs DB trigger (M1-T2).
- Negative-quantity clamping policy (domain-model OQ… decided in M1 with UX input).
- Lot granularity for fungibles (domain-model OQ-1).
