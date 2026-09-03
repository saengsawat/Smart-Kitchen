# ADR-009: Image/object storage

**Status:** OPEN (deferred — first needed with receipt ingestion, M5) · Target decision point: M5

## Context
Receipt photos (fast-follow), later shelf photos and product images. Requirements: private-by-default buckets, per-household prefixing, lifecycle/retention rules (threat model §7.9), signed-URL upload/download, low cost.

## Options considered
**A. S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, or PaaS-bundled)** — *Pros:* commodity API, lifecycle policies built in, near-zero lock-in if we code to the S3 API. *Cons:* egress pricing varies (R2 favorable). **B. Database bytea/blob storage** — Rejected: bloats DB, no lifecycle tooling. **C. Provider-proprietary APIs (Firebase Storage etc.)** — Only if the rest of the stack lands there; otherwise avoid the coupling.

## Recommendation (tentative)
Assume the **S3 API as the interface** now (adapter in `platform/storage`); pick the vendor with hosting at M5 on price. No resources created until then.

## Consequences
Nothing in MVP blocks on this; retention policy must be decided (product owner) before first real receipt is stored.

## Open questions
- Vendor + region (with hosting decision).
- Retention: delete originals N days after confirmed parse? (product owner)
- Client-side downscale/compress targets for receipts (M5 spike).
