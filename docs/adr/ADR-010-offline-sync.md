# ADR-010: Offline & synchronization strategy

**Status:** OPEN (online-first MVP is PROPOSED; full offline is the open part) · Target decision point: shopping-list cache at M3/M7; full offline only on user evidence

## Context
Brief requires multi-device household sync (§1, §12, §13) and specifically an **offline-available shopping list** (§6) — you're in a supermarket with bad reception. It does not require full offline editing of inventory. Full offline-first sync (conflict resolution, local DB, sync protocol) is one of the most expensive architectural commitments an app can make; adopting it "just in case" is a classic dead end. Conversely, retrofitting it later is hard — which is why this stays a tracked OPEN decision, not a silent default.

## Options considered

**A. Online-first + targeted offline (MVP proposal)** — server source of truth; client read-cache for browse; shopping list cached locally with queued check-off mutations (idempotency keys make replay safe); writes otherwise require connectivity. *Pros:* 10× simpler; meets every DOCUMENTED requirement; idempotent-command design already lays sync groundwork. *Cons:* no airplane-mode inventory edits; queued-mutation code is a small taste of sync complexity anyway.

**B. Full offline-first (CRDT or sync engine: PowerSync/ElectricSQL/Replicache-class, or Firestore)** — *Pros:* best UX under bad connectivity; kitchen/pantry use can be low-signal. *Cons:* large ongoing complexity tax or deep vendor lock-in; conflict semantics for a shared household ledger need careful design; premature before we know users need it.

**C. Hybrid evolution** — A now, with commutative-append ledger + client-generated UUIDv7 ids + idempotency keys deliberately chosen so that B remains reachable without rewriting the domain. This is the actual proposal: A's design choices are made *with B's door open*.

## Recommendation
**C** (= A now, B-compatible foundations). Trigger to revisit: telemetry/user feedback showing meaningful write attempts while offline, or expansion to markets with poor connectivity.

## Consequences
Ledger appends, idempotency keys, and client-generated IDs are mandatory now (already in data-model); no CRDT/sync-engine dependency in MVP; shopping-list offline cache is scoped as an M7 ticket.

## Open questions
- How much of inventory browse should be cached for offline read? (M3)
- Timestamp handling for offline/skewed clients (from M1-T1): the ledger rejects `recordedAt < occurredAt` and treats `occurredAt` string differences as payload conflicts on idempotent retry — the sync/API layer should normalise timestamps (parse-and-canonicalise) before append; decide skew tolerance here.
- If B triggers: sync engine vs hand-rolled vs DB-native — full evaluation then, not now.
