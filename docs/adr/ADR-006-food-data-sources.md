# ADR-006: Food/product data sources

**Status:** PROPOSED (R-1 evidence from M1-T5, 2026-09-09; FDC arm still unmeasured — see findings) · Target decision point: M4 (barcode enrichment)

## R-1 findings (measured 2026-09-09 — [docs/research/food-data-coverage.md](../research/food-data-coverage.md))

- **Open Food Facts** gives strong branded-product identification via name/text search (~85% genuine match rate after manual review, on a basket biased toward well-known national brands — not a general-population estimate; unbiased rates need live scan telemetry, M4). Even at its best there is a real ~15% wrong-match rate — reinforcing the confirmation gate the architecture already mandates. Allergen tags present on only ~41% of branded hits.
- **USDA FDC's cascade role is UNVALIDATED, not disproven:** the public DEMO_KEY rate-limited all 27 attempts (0 completed). A follow-up measurement (slower pacing or a free signup key) is required before this ADR relies on any FDC number. Structural finding regardless: **FDC has no allergen field at all.**
- **Settled sub-decision:** PLU/produce items must **never** be sent through a live barcode-lookup cascade — empirically, a PLU queried as a barcode returns a wrong-but-"found" product ~60% of the time it "hits" (worse than a clean miss). Produce gets its own small curated PLU → CanonicalIngredient table, decoupled from the cascade (M4).
- **New M4 cascade requirement:** a product resolved via an FDC-only path must render allergen status as *unknown + warning* (SR-2), never omit the warning because no allergen data came back.
- Commercial source (option C) not yet justified by this evidence; revisit after M4 live telemetry. ODbL review (R-4) remains a precondition for any merged catalog.

## Context
Barcode → product → nutrition → allergen mapping is a named barrier to entry (brief §18A): millions of products, changing data, no single complete source. Brief names USDA FoodData Central as *one* nutrition source, explicitly not a full UPC solution. We will maintain our own normalized catalog fed by multiple upstreams.

## Options considered (as cascade members, not either/or)

**A. Open Food Facts** — *Pros:* free, open (ODbL), global barcode coverage, allergen tags, images. *Cons:* crowd-sourced quality varies; US coverage weaker than EU (extent = research question); ODbL share-alike obligations on derived *database* need review for our normalized catalog.

**B. USDA FoodData Central** — *Pros:* authoritative US nutrition incl. branded foods; free; public domain. *Cons:* not designed for live UPC lookup UX; branded data lags market; identification (vs nutrition) is weak.

**C. Commercial UPC/product APIs (Nutritionix, Edamam, Spoonacular, GS1-fed services)** — *Pros:* better coverage/freshness SLAs. *Cons:* per-call cost, licensing limits on caching/retention (some forbid storing results — directly conflicts with our own-catalog strategy; must be checked per vendor), lock-in.

**D. Our own catalog (always)** — the cache/merge layer on top of any cascade; grows into the moat (§18A).

## Recommendation (PROPOSED, sharpened by R-1)
Cascade **A → B → manual completion**, all merging into D, with C added only if measured coverage proves unacceptable — with produce/PLU carved out of the live cascade entirely (curated table) and the FDC-allergen-gap rule above binding on M4.

## Consequences
Per-field provenance required from day 1 (sources disagree); license review (ODbL, commercial caching terms) becomes a pre-launch legal gate.

## Open questions (post-R-1)
- FDC hit-rate/field-completeness — needs the follow-up measurement pass (backlogged) before finalizing FDC's cascade slot.
- ODbL implications for a merged catalog (legal, R-4 — unresolved regardless of hit rates).
- Unbiased real-scan hit rates — only obtainable from M4 live telemetry.
- ~~Measured hit-rate of A/B~~ (done, M1-T5); ~~PLU handling~~ (settled: curated table, never the live cascade).
