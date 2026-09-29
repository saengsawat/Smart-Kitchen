# ADR-006: Food/product data sources

**Status:** PROPOSED (R-1 evidence from M1-T5, 2026-09-09; FDC arm still unmeasured — see findings) · Target decision point: M4 (barcode enrichment) · **Partial adoption 2026-09-29 (D-025):** the OFF arm goes live server-side in M2-T4a; FDC stays out; the OFF provenance-tier policy is recorded at M2-T4a acceptance

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

## Open Food Facts tier policy (M2-T4a, D-025, adopted at acceptance 2026-09-29)

OFF data enters as a proposal of label facts, never as fact. The barcode match is the only Known Fact and it is identity, not a field. Every OFF field (name, brand, category, package size, serving size, nutrition, ingredients text, image, allergen and trace tags) is `ESTIMATED` with source `open-food-facts` and `observedAt` from `last_modified_t`. OFF data never licenses the absence of an allergen: no completeness declaration is produced from it, so a product known only from OFF screens `BLOCKED` or `ALLOWED_WITH_UNKNOWNS`, never `ALLOWED` (D-017). A missing allergen field is absence of data. OFF allergen tags are mapped by one committed table in `packages/adapters/src/product-lookup/open-food-facts/allergen-tag-map.ts` (pinned exactly by a consistency test); everything else passes through raw and reads as unrecognized data. 429, 5xx, timeouts, network failures and unreadable answers are errors, never misses. PLUs are never sent. OFF's published read limit (15 per minute per IP, API page checked 2026-09-29) bounds the throttle: 12 per rolling minute per process, 60 s cooldown after a 429 or 503, over budget answers `error` rather than queueing.

**Open:** OFF's `_100g` nutriment values are per 100 ml for liquids; until a `PER_100ML` basis exists the adapter emits no per-100 profile when OFF's `nutrition_data_per` is not `100g` (M3-T4e), so no liquid is mislabelled. Non-English `ingredients_text` (common on OFF) needs a language gate before the engine matches text (M2-T4). UPC-E expansion and a GTIN-14 code type are backlog.

**R-4 note:** M2-T4a keeps OFF answers in a per-process in-memory cache (30 min hits, 5 min misses, 1000 codes), persists nothing, and does not forward product images to the client, so no derived database exists and the ODbL share-alike and image-licence questions (R-4, OQ-D8) stay untouched. Any product table, export or image display reopens them.
