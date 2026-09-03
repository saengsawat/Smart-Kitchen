# System Context

**Status:** PROPOSED. High-level context for the MVP system. Details: [ARCHITECTURE.md](../../ARCHITECTURE.md), [ai-architecture.md](ai-architecture.md).

```mermaid
flowchart TB
    subgraph Users["Household members (§12)"]
        M1[Member phone A]
        M2[Member phone B]
    end

    subgraph Client["Mobile app (ADR-001 open)"]
        UI[Inventory · Recommendations · Shopping list · Profile]
        CAM[Camera: barcode scan<br/>receipt capture fast-follow]
        CACHE[(Local read cache<br/>full offline: ADR-010 open)]
    end

    subgraph Backend["Modular monolith API (ADR-002 open)"]
        APIL[HTTP API + authz<br/>household isolation]
        CORE[Deterministic core:<br/>ledger · allergen rules ·<br/>gap math · ranking]
        EDGE[Probabilistic edge:<br/>normalization · parsing ·<br/>recipe generation]
        ADP[Adapter layer / ports]
    end

    DB[(PostgreSQL — ADR-003 lean<br/>household data + product catalog)]
    OBJ[(Object storage — ADR-009<br/>receipt images, fast-follow)]

    subgraph External["External providers (all behind ports)"]
        AUTH[Auth provider<br/>ADR-004]
        FOOD[Food/product data:<br/>Open Food Facts · USDA FDC · commercial UPC<br/>ADR-006]
        LLMP[LLM provider(s)<br/>ADR-005]
        OCRP[OCR provider<br/>ADR-007, fast-follow]
        PUSH[Push notifications<br/>fast-follow]
    end

    M1 --> Client
    M2 --> Client
    UI --> APIL
    CAM --> APIL
    APIL --> CORE
    CORE <--> DB
    CORE <-- proposals --> EDGE
    EDGE --> ADP
    CORE --> ADP
    ADP --> FOOD & LLMP & OCRP
    APIL --> AUTH
    APIL --> OBJ
    Backend --> PUSH
```

## External dependencies & their ports

| Dependency | Port | Status | Notes |
|---|---|---|---|
| Auth provider | (platform-level, not domain port) | OPEN [ADR-004](../adr/ADR-004-authentication.md) | Managed service candidate vs self-hosted |
| Open Food Facts | `ProductLookupPort` | OPEN [ADR-006](../adr/ADR-006-food-data-sources.md) | Free/open barcode→product; coverage/quality varies — RESEARCH REQUIRED |
| USDA FoodData Central | `NutritionSourcePort` (+ branded lookup) | OPEN ADR-006 | Named in brief §13; nutrition foundation, **not** a full UPC solution (§18A) |
| Commercial UPC DBs | `ProductLookupPort` fallback | OPEN ADR-006 | Cost/licensing — evaluate only if coverage gap demands |
| LLM provider | `RecipeGeneratorPort`, parsing assists | OPEN [ADR-005](../adr/ADR-005-ai-provider-abstraction.md) | Provider-agnostic adapter; fixture impl for dev |
| OCR provider | `OcrPort` | OPEN [ADR-007](../adr/ADR-007-receipt-ocr-pipeline.md) | Fast-follow; fixtures first |
| Object storage | infra | OPEN [ADR-009](../adr/ADR-009-image-object-storage.md) | Needed with receipts |
| Push notifications | infra | OPEN (no ADR yet) | Needed with expiration alerts (fast-follow) |
| Smart-home platforms | future extensible API layer (§11) | Not designed yet — deliberately | Constraint honored: nothing in the core assumes any ecosystem |

## Trust boundaries

1. **Client ↔ API** — authenticated, TLS; client input never trusted (all invariants re-checked server-side).
2. **API ↔ external providers** — provider responses are untrusted data (schema-validated, provenance-tagged).
3. **Probabilistic edge ↔ deterministic core** — the load-bearing internal boundary: proposals only, see [ai-architecture.md §1](ai-architecture.md#1-the-boundary-rule).
4. **Household ↔ household** — tenancy isolation (NFR-1), enforced at API + candidate RLS ([data-model.md §5](data-model.md#5-tenancy-isolation--sensitive-data)).
