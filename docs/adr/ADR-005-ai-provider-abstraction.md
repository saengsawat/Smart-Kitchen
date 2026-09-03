# ADR-005: AI provider abstraction

**Status:** PROPOSED (abstraction pattern); provider selection deliberately deferred · Target decision point: pattern at M1; first provider pick at M6 (recommendations)

## Context
Multiple probabilistic capabilities (recipe generation, receipt parsing, normalization assist, later vision/chat) with different quality/cost profiles. Brief §18A/§18E warn against single-source trust; models improve monthly — the pick that's right at M6 may be wrong at M9. Domain must not import vendor SDKs.

## Options considered

**A. Per-capability ports + fixture impls + eval gates** (see [ai-architecture.md §3](../architecture/ai-architecture.md#3-provider-adapters)) — *Pros:* provider swap = pass the eval suite; dev/test needs no keys; cost metering centralized; per-capability model tiering. *Cons:* upfront interface discipline; risk of over-abstracting (mitigate: ports mirror our needs, not vendor feature sets).

**B. Direct SDK usage per feature** — *Pros:* fastest first line of code. *Cons:* vendor coupling spreads through domain; untestable without keys; per-call cost invisible.

**C. LLM gateway/proxy product (LiteLLM-style)** — *Pros:* uniform API over many vendors. *Cons:* another dependency; doesn't remove the need for our typed ports and evals; can sit *behind* a port later if useful.

## Recommendation
**A.** Vendor choices are separate, later, per-capability decisions recorded in DECISIONS.md when made, each justified by eval results + cost.

## Consequences
Every AI output carries model+version provenance (§14); eval suites ([testing-strategy.md](../architecture/testing-strategy.md)) are the swap gate; no AI code path is authoritative for safety data (SR-1).

## Open questions
- First recipe-generation model shortlist + eval budget (M6).
- Whether receipt parsing uses OCR+LLM or multimodal-LLM-direct (ADR-007).
