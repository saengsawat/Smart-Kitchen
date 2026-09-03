# ADR-007: Receipt/OCR pipeline

**Status:** OPEN (fast-follow feature; fixtures-first) · Target decision point: M5

## Context
Receipt → inventory is the biggest automation differentiator (brief §2B, §17.1) and the messiest input (§18B: abbreviations, SKUs, weighted produce, coupons, multi-qty). Mandatory confirmation screen bounds the damage of errors. Pipeline: image → OCR/extraction → line parsing → product normalization → user confirmation → PURCHASE transactions.

## Options considered

**A. Cloud OCR (Google Vision / AWS Textract / Azure) + LLM parsing** — *Pros:* strong text extraction; parsing prompt controls normalization; per-stage confidence. *Cons:* two providers/two costs per receipt; latency.

**B. Multimodal LLM direct (image → structured lines)** — *Pros:* one call, simpler pipeline, rapidly improving. *Cons:* confidence signals weaker; cost per image higher today (verify — RESEARCH REQUIRED); harder to attribute failures to a stage.

**C. Specialized receipt-parsing APIs (Veryfi, Taggun, …)** — *Pros:* purpose-built, line-item aware. *Cons:* per-receipt pricing, vendor lock-in, still needs our normalization to canonical products.

**D. On-device OCR (ML Kit / Vision framework)** — *Pros:* free, private. *Cons:* receipt layout parsing still needed server-side; quality gap on crumpled/long receipts (verify).

## Recommendation
None yet. **Do first regardless of vendor:** build the fixture corpus (images + golden parses incl. §18B hard cases) and the pipeline stages behind `OcrPort`/`ReceiptParserPort` — then bake off A vs B vs C on the same fixtures with cost per receipt measured.

## Consequences
Fixtures-first means the confirmation UX and normalization logic (the durable parts) are built before any vendor commitment; content-hash dedupe (INV-RCPT-1) is pipeline-front, vendor-independent.

## Open questions
- Bake-off results: accuracy × cost per receipt across A/B/C (M5 spike).
- Receipt image retention policy (threat model §7.9 — product owner).
