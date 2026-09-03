# ADR-006: Food/product data sources

**Status:** OPEN — RESEARCH REQUIRED (ticket M1-T5) · Target decision point: M4 (barcode enrichment)

## Context
Barcode → product → nutrition → allergen mapping is a named barrier to entry (brief §18A): millions of products, changing data, no single complete source. Brief names USDA FoodData Central as *one* nutrition source, explicitly not a full UPC solution. We will maintain our own normalized catalog fed by multiple upstreams.

## Options considered (as cascade members, not either/or)

**A. Open Food Facts** — *Pros:* free, open (ODbL), global barcode coverage, allergen tags, images. *Cons:* crowd-sourced quality varies; US coverage weaker than EU (extent = research question); ODbL share-alike obligations on derived *database* need review for our normalized catalog.

**B. USDA FoodData Central** — *Pros:* authoritative US nutrition incl. branded foods; free; public domain. *Cons:* not designed for live UPC lookup UX; branded data lags market; identification (vs nutrition) is weak.

**C. Commercial UPC/product APIs (Nutritionix, Edamam, Spoonacular, GS1-fed services)** — *Pros:* better coverage/freshness SLAs. *Cons:* per-call cost, licensing limits on caching/retention (some forbid storing results — directly conflicts with our own-catalog strategy; must be checked per vendor), lock-in.

**D. Our own catalog (always)** — the cache/merge layer on top of any cascade; grows into the moat (§18A).

## Recommendation (tentative shape, pending research)
Cascade **A → B → manual completion**, all merging into D, with C added only if measured coverage is unacceptable.

## Consequences
Per-field provenance required from day 1 (sources disagree); license review (ODbL, commercial caching terms) becomes a pre-launch legal gate.

## Open questions / research (M1-T5 spike)
- Measured hit-rate of A/B on a realistic 100-item US grocery basket (RESEARCH REQUIRED — this number decides whether C is needed).
- ODbL implications for a merged catalog (legal question, flag to counsel).
- PLU handling for produce (no barcode) — likely manual/curated list.
