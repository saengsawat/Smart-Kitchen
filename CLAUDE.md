# CLAUDE.md — Standing instructions for AI coding sessions

This repo is the project's durable memory. These rules bind every session (human-paired or delegated).

## Read before you write

1. Before changing anything, read [STATUS.md](STATUS.md), the relevant ticket in [BACKLOG.md](BACKLOG.md), and the docs that ticket references. For architecture work, also the matching ADR in [docs/adr/](docs/adr/README.md).
2. Requirements live in [PRODUCT.md](PRODUCT.md) / [docs/prd/MVP_PRD.md](docs/prd/MVP_PRD.md). The original brief ([docs/source/](docs/source/product-brief.extracted.md)) is authoritative for *product intent only* — not architecture or MVP scope. Never alter files in `docs/source/`.

## Never guess, never invent

3. Unresolved product requirements are marked `UNKNOWN`/`OPEN` — never resolve one by assumption. Ask, or record the question in DECISIONS.md and stop that thread.
4. Do not manufacture decisions: DECIDED status requires recorded owner approval. Research questions (R-*) need evidence before becoming decisions.
5. Classify new findings as you write docs: DOCUMENTED / INFERRED / UNKNOWN (or SOURCE REQUIREMENT / ENGINEERING INFERENCE / PROPOSED DECISION / OPEN QUESTION / RESEARCH REQUIRED).

## Domain & safety rules

6. Domain rules take precedence over UI convenience. If a screen wants to bend an invariant (e.g. silently overwrite a quantity), the screen is wrong.
7. Safety-critical calculations — allergen screening, nutrition arithmetic, inventory math, shopping-gap math — are deterministic code with tests. Never route them through an LLM.
8. AI output is not authoritative data. It enters the system only as typed, schema-validated proposals with provenance `{tier, source, confidence, model, timestamp, confirmation state}` and crosses into domain state per [ai-architecture.md](docs/architecture/ai-architecture.md).
9. Allergen handling: LLM output may add warnings, never clear them; UI copy never claims a food is guaranteed safe (SR-1/SR-2 in the PRD).
10. Inventory is an append-only ledger. Never add a code path that mutates quantities outside a transaction append ([ADR-008](docs/adr/ADR-008-inventory-ledger.md)).

## Engineering discipline

11. Never silently introduce a dependency. New packages require stating why, alternatives considered, and a note in the PR; heavyweight or license-odd ones need explicit approval.
12. No secrets in code, config, fixtures, or docs — ever. `.env.example` carries names only. Never commit `.env*`.
13. Write tests with the implementation, not after. Invariant tests (INV-* in [testing-strategy.md](docs/architecture/testing-strategy.md)) are permanent and may not be deleted or weakened to make a change pass.
14. Keep work scoped to one ticket. Do not change files outside the ticket's file scope — if the ticket can't be done within scope, stop and escalate (update the ticket, don't improvise).
15. Update documentation in the same change that alters a decision or behavior it documents. Stale DECISIONS/STATUS/ADR content is a bug.
16. Explain migrations and irreversible operations (schema changes, data rewrites, deletions) and get approval before running them anywhere shared.
17. Stop for human approval before: creating/modifying paid or external resources (cloud, API signups, keys), sending data to a new external service, publishing anything, or any action that is hard to reverse.
18. Use fixtures ([tests/fixtures/](tests/fixtures/README.md)) for development; live provider calls are opt-in, metered, and never required for the test suite to pass.
19. Report honestly: failing tests are reported as failing, skipped steps as skipped. No "should work."

## Execution workflow — architect / worker / reviewer

### Roles
20. **Architect / planner** (one session; remains the planner). Responsible for: reviewing product requirements; maintaining architecture docs; proposing ADRs; creating narrowly scoped tickets; identifying dependencies and invariants; recommending implementation/review models per ticket; resolving architecture conflicts; accepting reviewed work and then updating project status. The architect does not implement product tickets unless explicitly requested.
21. **Implementation worker.** Works on exactly **one scoped ticket at a time**; follows existing ADRs and architecture; implements only the ticket's acceptance criteria; adds or updates the required tests; no unrelated refactors or drive-by fixes (rule 14's file scope applies). Problems discovered mid-ticket become new backlog entries, not scope creep. Never silently changes architecture or business invariants — see rule 25.
22. **Reviewer.** A separate reviewer (different session from the implementer) must review completed work **before the ticket is marked done** — no exceptions. The reviewer evaluates: acceptance criteria; architecture/ADR compliance; business invariants (INV-*); authorization boundaries; idempotency where applicable; test coverage; unintended scope changes; error handling and edge cases — not just style. Outcome is one of **PASS / PASS WITH FIXES / FAIL**, and the reviewer reviews before modifying any implementation.

### Model selection
23. **Default routine work to Sonnet** (UI, CRUD, API wiring, straightforward integration, tooling/config). **Use or escalate to Opus** — for implementation, review, or both — when a ticket carries substantial domain, data-integrity, security, concurrency, or synchronization risk, including: inventory ledger/reconciliation and inventory arithmetic; idempotency semantics (e.g. receipt processing, retried commands); household authorization/tenancy isolation; offline sync & conflict handling; allergen enforcement; schema migrations affecting inventory history; concurrency-sensitive inventory updates.
24. **Every ticket carries model recommendations.** Each ticket in [BACKLOG.md](BACKLOG.md) includes `Implementation model: Sonnet|Opus — reason` and `Review model: Sonnet|Opus — reason` (template there). The architect sets these; deviating requires architect sign-off recorded on the ticket. Review escalates to Opus whenever the ticket touches the rule-23 high-risk list or implementation was escalated to Opus.

### Architecture conflicts
25. **Workers never modify or bypass ADRs, DECISIONS.md, architectural invariants (INV-*), or this file to complete a ticket.** If the ticket as written conflicts with an ADR, architecture rule, or ticket invariant, stop — do not continue with the conflicting implementation — and report:

    ```
    ARCHITECTURE CONFLICT
    Ticket requirement: …
    Existing decision / invariant: …
    Conflict: …
    Recommended next action: …
    ```

    The architect (or product owner) resolves it through the decision log; rules 15–16 (documentation accompanying decisions) apply to the architect in that resolution.

### Ticket completion
26. **A ticket is not DONE merely because code was written.** Done requires: implementation complete; required tests passing; reviewer **PASS** (or PASS WITH FIXES with the fixes completed and re-checked); documentation updated where required; no unresolved architecture conflict; and STATUS.md updated per rule 27.
27. **STATUS.md updates only on acceptance.** [STATUS.md](STATUS.md) is updated only after reviewed work is accepted by the architect — never by workers mid-ticket, never for unreviewed work.

## Current phase note

No application code exists yet. Implementation is gated on product-owner approval of D-002/D-003 ([DECISIONS.md](DECISIONS.md)) and an explicit go-ahead for ticket M0-T1.
