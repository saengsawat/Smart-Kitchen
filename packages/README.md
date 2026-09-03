# packages/

Shared workspace packages. Populated starting ticket M0-T1 ([BACKLOG.md](../BACKLOG.md)):

- `domain/` — pure domain logic (ledger, units, allergen rules, gap math). Zero I/O, zero vendor imports — enforced by lint.
- `contracts/` — shared API/schema types (client ↔ server seam).
- `adapters/` — provider ports + implementations (fixture + real): product lookup, nutrition, LLM, OCR ([ai-architecture.md §3](../docs/architecture/ai-architecture.md#3-provider-adapters)).
