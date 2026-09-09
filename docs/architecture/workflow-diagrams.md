# Workflow & flow diagrams (visual companion)

**Status:** Explanatory reference only — no new decisions live here. Every fact below is restated from [ARCHITECTURE.md](../../ARCHITECTURE.md), [system-context.md](system-context.md), the ADRs in [docs/adr/](../adr/README.md), and [CLAUDE.md](../../CLAUDE.md). If this file and one of those ever disagree, the other doc wins — update this one to match.

Four diagrams: how the system is shaped, what happens on one real request, how code goes from written to running, and how a ticket moves from idea to done.

## 1. System shape — the three tiers

```mermaid
flowchart TB
    subgraph Tier1["Tier 1 — Presentation (runs on the phone)"]
        APP["Mobile app
Expo / React Native
(ADR-001, PROPOSED)"]
    end

    subgraph Tier2["Tier 2 — Application logic (runs on the server)"]
        API["Backend API
Node.js + TypeScript + Fastify
(ADR-002, DECIDED)"]
        CORE["Deterministic core
ledger, allergen rules, gap math, ranking"]
        EDGE["Probabilistic edge
AI parsing, recipe generation"]
    end

    subgraph Tier3["Tier 3 — Data"]
        DB[("PostgreSQL
(ADR-003, PROPOSED — strong lean)")]
    end

    subgraph External["External providers — all behind ports, never imported by domain code"]
        AUTH["Auth provider
(ADR-004)"]
        FOOD["Food data APIs
(ADR-006)"]
        LLM["LLM provider
(ADR-005)"]
    end

    APP -- "HTTPS / JSON" --> API
    API --> CORE
    CORE <--> DB
    CORE -. "proposals only, never final say" .-> EDGE
    API --> AUTH
    EDGE --> FOOD
    EDGE --> LLM
```

**Reading it:** the phone app never touches the database or an external API directly — everything routes through the backend. Inside the backend, the "deterministic core" (safety math, ledger, allergen rules) only ever *receives proposals* from the AI edge — it never lets AI make the final call. See [ai-architecture.md §1](ai-architecture.md#1-the-boundary-rule).

## 2. One request, start to finish — scanning a barcode

```mermaid
sequenceDiagram
    actor U as Household member
    participant App as Mobile app
    participant API as Backend API (Fastify)
    participant Core as Deterministic core
    participant DB as PostgreSQL
    participant Food as Food data API (external)

    U->>App: Point camera at barcode
    App->>API: POST /inventory/scan { upc }
    API->>API: Check auth token + household membership
    API->>Core: resolve(upc)
    alt Product already known
        Core->>DB: SELECT product by upc
    else Product unknown
        Core->>Food: lookup(upc)
        Food-->>Core: product data (untrusted — validated + provenance-tagged)
        Core->>DB: INSERT product
    end
    Core->>DB: INSERT ledger transaction (append-only, never UPDATE)
    DB-->>Core: ok
    Core-->>API: result
    API-->>App: 200 { item added }
    App-->>U: "Milk added to inventory"
```

**Reading it:** the inventory change is always an *append* to a transaction log, never an in-place edit — see [ADR-008](../adr/ADR-008-inventory-ledger.md). This diagram is illustrative of the intended shape; the actual routes/modules land ticket by ticket, not all at once.

## 3. Local build/test/run cycle — what happens to the code you write

```mermaid
flowchart LR
    A["Write TypeScript
apps/api/src/*.ts"] --> B["Compile
tsc -b"]
    B --> C["dist/*.js
plain JavaScript"]
    A --> D["Test
vitest run"]
    D -->|fail| A
    D -->|pass| F["Run
node dist/server.js"]
    F --> G["Server listens
on a port"]
    G --> H["Call it
curl, or the mobile app, over HTTP"]
    H --> G
    G --> I["Stop the process"]
```

**Reading it:** this is the exact loop demonstrated live in-session against the real [apps/api/](../../apps/api/) skeleton from ticket M0-T1 — write, compile, test, run, call, stop.

## 4. Ticket workflow — how a change is allowed to become "done"

```mermaid
flowchart TD
    A["Architect writes a scoped ticket
BACKLOG.md + Sonnet/Opus recommendation"] --> B["Implementation worker
one ticket only, tests written alongside code"]
    B --> C{"Conflicts with an
ADR or invariant?"}
    C -- yes --> X["STOP — report
ARCHITECTURE CONFLICT
escalate to architect"]
    C -- no --> D["Reviewer
separate session from the worker"]
    D --> E{"Verdict"}
    E -- FAIL --> B
    E -- "PASS WITH FIXES" --> Fx["Worker applies fixes"]
    Fx --> D
    E -- PASS --> G["Architect accepts"]
    G --> H["STATUS.md updated
ticket marked DONE"]
```

**Reading it:** rule 26 in [CLAUDE.md](../../CLAUDE.md) — code being written is not the finish line. A ticket is DONE only after tests pass, an independent reviewer signs off, docs are updated, and the architect records acceptance in [STATUS.md](../../STATUS.md).
