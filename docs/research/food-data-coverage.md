# Food data coverage — R-1 research spike (M1-T5)

**Status of evidence:** OFF (Open Food Facts) — complete, live-measured. FDC (USDA FoodData
Central) — **blocked this session** by the public `DEMO_KEY`'s rate limit (see §5); no FDC
field-completeness data was obtainable. This doc reports what was actually measured, flags what
wasn't, and does not extrapolate past what the evidence supports (CLAUDE.md rule 19).

Raw per-item results: [`food-data-coverage.raw.json`](food-data-coverage.raw.json) (written by
[`scripts/food-data-coverage-research.mjs`](../../scripts/food-data-coverage-research.mjs)).

## 1. Method

### 1.1 Basket construction

The basket (110 items — "~100" per the ticket) was assembled from general knowledge of common
US grocery categories named in the brief (§18A: dairy, produce/PLU, meat, pantry staples,
frozen, snacks, beverages), plus condiments and baking to round out the category spread. It was
**not** constructed by browsing Open Food Facts or FDC first — doing so would bias the sample
toward whatever those catalogs already contain, defeating the point of measuring coverage
against an independent basket.

Two lookup methods are used, tagged per item in the raw JSON and never conflated below:

- **`plu`** (23 items) — a real, standardized IFPS PLU code (e.g. banana = `4011`, hass avocado
  = `4225`) sent to OFF's barcode-lookup endpoint (`GET /api/v2/product/{code}.json`). A PLU is
  **not** a GS1 barcode, so this arm's purpose is to test what actually happens when one is
  queried as if it were one — see §4.1, the result is more interesting (and more concerning)
  than a clean miss.
- **`name`** (87 items) — a brand + product name text search. Used for every branded item
  because **this script's author (an LLM, constructing the basket from training-data knowledge,
  with no physical shopping basket, barcode scanner, or live catalog access at basket-design
  time) cannot attest a real 12/13-digit UPC/GTIN from memory with confidence.** Fabricating a
  structurally-valid-but-invented barcode would have produced a near-universal, meaningless miss
  (a check-digit-valid but nonexistent code essentially never resolves against any real
  database) — that would have corrupted this research rather than informed it. Name search
  instead measures "does this source know this product at all," a real and useful question, but
  **narrower than true barcode-scan hit-rate** — a limitation carried through the rest of this
  doc, not hidden.

### 1.2 Known bias/limitations (stated up front, not just at the end)

1. **Brand selection bias.** The branded portion of the basket deliberately names well-known,
   long-standing national brands (Kraft, Heinz, Tyson, Barilla, Coca-Cola, ...) because those are
   the products this LLM can name confidently and hold in mind while constructing a basket
   without external lookup. A real household's cart also contains store brands, regional
   products, and less common items, which this basket structurally under-represents. **The
   name-search hit-rate below should be read as an upper bound for well-known-brand coverage,
   not a general-population estimate.**
2. **Name-search is not barcode-scan.** The MVP's real flow is "camera decodes a barcode → look
   up that exact code." This spike's branded arm instead does "search by name → take the top
   result → fetch that result's own real barcode's full record." That is a legitimate proxy for
   "does OFF have *a* full record for this common product" but is **not** the same measurement
   as "does OFF resolve *this specific household's purchased SKU's actual barcode*" — a
   store-brand repack, a different size, or a regional variant could easily have a barcode OFF
   has never seen, even though the *brand* clearly exists in OFF's catalog. Real, unbiased
   barcode-hit-rate can only be measured from actual scanned codes — recommended as **live
   telemetry once M3/M4 ships** (BACKLOG.md already names this: "measured resolution rate on
   real scans").
3. **Top-1 relevance ≠ correct product.** A name search returning *some* result is not the same
   as it returning the *right* result. §4.2 below reports a manual review of every one of the 87
   name-search "hits" and finds a real, non-trivial mismatch rate — this is the single most
   important finding of this spike and is why the raw 87/87 number is **not** this doc's
   headline.
4. **FDC evidence is incomplete this session** (§5) — the DEMO_KEY subset could not be measured
   due to rate limiting. This is reported as a gap, not papered over with an assumed number.

## 2. Basket composition

| Category | Items | Method split |
|---|---|---|
| produce | 28 | 23 `plu`, 5 `name` (berries/bagged/leaf items without a practical PLU) |
| pantry | 24 | 24 `name` |
| dairy | 12 | 12 `name` |
| snacks | 12 | 12 `name` |
| meat | 10 | 10 `name` |
| frozen | 10 | 10 `name` |
| beverages | 6 | 6 `name` |
| condiments | 5 | 5 `name` |
| baking | 3 | 3 `name` |
| **Total** | **110** | **23 `plu` / 87 `name`** |

An FDC subset of 27 items (documented via the `fdc: true` flag in the script, spanning every
category above) was selected for the USDA FoodData Central `DEMO_KEY` arm — see §5 for why no
results came back.

## 3. Open Food Facts — measured results

### 3.1 Raw hit-rate

| Arm | Hit | Total | Rate |
|---|---|---|---|
| Overall | 102 | 110 | 92.7% |
| `name` (branded, text search) | 87 | 87 | 100% |
| `plu` (produce, sent as if a barcode) | 15 | 23 | 65.2% |

Taken at face value, these numbers look excellent — and that is precisely why §4 (manual
quality review) matters: neither of these headline rates survives a look at *what* was actually
matched.

### 3.2 Field completeness among hits

Measured on the **full product record** (name-search hits follow up their search match with a
real `GET /api/v2/product/{code}.json` call, matching how a real lookup would work once a
candidate code is known):

| Field | `name` arm (n=87) | `plu` arm (n=15) |
|---|---|---|
| name | 87 (100%) | 13 (87%) |
| brand | 62 (71%) | 8 (53%) |
| nutrition (calories present) | 64 (74%) | 5 (33%) |
| ingredients text | 41 (47%) | 9 (60%) |
| allergen tags | 36 (41%) | 0 (0%) |
| image | 53 (61%) | 14 (93%) |

Observations:
- **Allergens are the weakest field even on branded hits (41%)** — over half of matched branded
  products carry no `allergens_tags` at all on OFF. Per SR-2 (never treat absence as "safe"),
  this is exactly the case the architecture already accounts for (`allowed-with-unknowns`, never
  a plain "safe") — this data confirms that path will be exercised often, not rarely.
- **Brand field completeness (71%) is lower than name completeness (100%)** on branded hits —
  some products are identifiable by name/photo but the crowd-sourced `brands` field wasn't
  filled in. Relevant to per-field provenance design: a resolved product can legitimately have
  `name` at `KNOWN_FACT` while `brand` is simply absent, not wrong.
- **PLU-arm field completeness is poor across the board** except image (93%) and name (87%) —
  consistent with §4.1's finding that most PLU "hits" are unrelated products that merely have
  *some* image and *some* name, not a real produce record.

## 4. Quality review (manual) — the actual finding

Every one of the 102 recorded OFF hits (87 name-search + 15 PLU) was read against its query by
hand. This is a **single-reviewer heuristic pass**, not a blinded or statistically powered study
— treat the classification below as directional, not exact.

### 4.1 PLU arm: "hit" mostly does not mean "correct"

Of the 15 nominal PLU-arm hits, manual review finds:

| PLU query | Matched (OFF) | Verdict |
|---|---|---|
| Lemon (4053) | *Miel du Queyras* (a French honey brand) | **wrong** |
| Russet potato (4072) | *Zaatar Salmon with Israeli Couscous* | **wrong** |
| Cauliflower (4064) | *Tomat stykk* (Norwegian, "tomato piece") | **wrong** |
| Iceberg lettuce (4061) | *Produto* (literally "product" in Portuguese) | **wrong / junk record** |
| Cucumber (4062) | *Organic Raw Pumpkin Seeds* | **wrong** |
| Celery (4070) | *Tartelette Banane* (banana tart) | **wrong** |
| Yellow onion (4082) | *Red Onion* | **wrong item, right category** |
| Gala apple (4134) | *(hit, but empty product name)* | **junk record** |
| Navel orange (4012) | *(hit, but empty product name)* | **junk record** |
| Banana (4011) | *Bananer Bama* (a real Norwegian banana product) | plausible |
| Lime (4048) | *Lime* | correct |
| Roma tomato (4087) | *Italian Roma Tomato* | correct |
| Red bell pepper (4688) | *Hothouse Red Bell Pepper* | correct |
| Green bell pepper (4065) | *Green Bell Pepper* | correct |
| Broccoli crown (4060) | *Broccoli* | correct |

**6 of 15 (40%) are genuinely correct (one, banana, only plausibly so); 9 of 15 (60%) are
unrelated products or empty junk records.** A PLU number is a short 4-5 digit string, and OFF's barcode field apparently contains
enough short/malformed entries (crowd-sourced data quality) that a PLU digit string collides
with *something* most of the time — but that something is usually wrong.

**This is a more important and more actionable finding than a clean miss would have been.** A
clean 404 is safe (falls through to manual entry, per FR-BC-1). A **wrong but "found" record**
is not safe by default — it would silently attach the wrong nutrition/allergen data to a
produce item unless something downstream refuses to trust it. This is strong evidence for
ADR-006's already-suspected conclusion: **PLU/produce must never be sent through a live
barcode-lookup cascade at all** — it needs its own small, manually curated PLU → ingredient
table, decoupled entirely from OFF/FDC barcode resolution. Recommend this become a settled
sub-decision, not just an open question, in the ADR-006 update (§6 below).

### 4.2 Name-search arm: real mismatch rate ≈ 15%

Reading all 87 matched names against their queries:

**Clear mismatches (13 of 87, ~15%):**

| Query | Matched (OFF) | Problem |
|---|---|---|
| Kirkland Signature whole milk | *Artichoke Hearts* | unrelated product |
| Land O'Lakes salted butter | *Petits sablés Ossau-Iraty* (French shortbread) | unrelated product |
| Sargento shredded mozzarella | *Mexican 4 cheese blend...* | wrong cheese type |
| Butterball ground turkey | *Traditional Turkey Wieners* | wrong product (hot dogs) |
| Breyers vanilla ice cream | *Lino lada duo* | unrelated product |
| Ben & Jerry's Cookie Dough ice cream | *Lino lada duo* | unrelated product (same junk record as above) |
| LaCroix sparkling water, lime | *Naturally Essenced Coconut Sparkling Water* | wrong flavor/brand |
| Rao's marinara sauce | *Rao's Homemade Alfredo* | right brand, wrong sauce |
| Strawberries, clamshell | *Clamshell* | matched the packaging word, not the fruit |
| Baby carrots | *Bledidej Croissance Choco Saveur Banane* | wrong domain entirely (infant formula) |
| Baby spinach | *Aptamil 3 800g* | wrong domain entirely (infant formula) |
| Half & half | *Iced tea lemonade* | unrelated product |
| Smucker's strawberry preserves | *Smucker's strawberry Uncrustables* | right brand/flavor, wrong product form |

Two of these (`baby carrots`, `baby spinach`) show a specific, fixable failure mode: the word
"baby" in the query pulled in infant-formula products — a text search over a mixed
general/baby-food catalog needs query scoping a real implementation would want to add (e.g.
category filters), not just "send the raw name."

**Remaining 74 of 87 (~85%)** are the same product, a same-brand flavor/size variant (judged
close enough — e.g. "DiGiorno rising crust pepperoni" matching a spicy-pepperoni-and-poblano
variant), or a generic-but-correct match. A handful of these are only "plausible" rather than
confirmed (brand not independently visible in the matched name), noted as a limitation of
reading `product_name` alone without also re-fetching and eyeballing the `brands` field for
every item.

**Conclusion:** a name-search-based resolution path, even against well-known national brands,
has a real double-digit wrong-product rate on the very first search result. This is exactly why
ai-architecture.md's confirmation-gate principle ("AI proposes, deterministic code + user
confirmation disposes") must apply to *any* non-exact-barcode resolution — a fuzzy name match is
squarely a `AI_INTERPRETATION`-tier result requiring confirmation before it can affect inventory,
never an auto-accepted `KNOWN_FACT`.

## 5. USDA FoodData Central — blocked by rate limiting

The FDC subset (27 items, per the `fdc: true` flags in the basket) was attempted using the
public `DEMO_KEY` literal from api.data.gov, paced at 1.5s between requests (well under the
documented "~30 requests/hour" cap by request *count*). **Every one of the 27 attempts returned
HTTP 429** (`OVER_RATE_LIMIT`), confirmed by a follow-up isolated retest after the main run:

```json
{"error":{"code":"OVER_RATE_LIMIT","message":"You have exceeded your rate limit. Try again later or contact us for assistance: https://api.nal.usda.gov:443"}}
```

A single exploratory FDC call made ~15 minutes before this run (to confirm the endpoint shape;
`query=cheerios` — see script development notes) succeeded and returned real results (250 total
hits, top match "Cereals ready-to-eat, GENERAL MILLS, CHEERIOS"), so the endpoint and query
shape are known-good. **The most likely explanation is that `DEMO_KEY`'s real enforcement is a
short-window burst limiter, not an evenly-spread hourly count** — 27 requests inside ~40 seconds
is a much higher instantaneous rate than "30 spread across an hour" even though the raw count
is under 30, and/or `DEMO_KEY` is a globally shared credential across every api.data.gov demo
user, which can already be near its cap from unrelated traffic before this session's first call.

**No FDC field-completeness or hit-rate data exists from this session.** Retried 6 times at
90-second intervals after the main run (still 429 every time, spanning ~9 more minutes) — this
doc does not fabricate or estimate FDC numbers to fill the gap. **Recommendation:** re-run
`scripts/food-data-coverage-research.mjs`'s FDC arm later (a different hour, or the next day)
with a much longer inter-request gap (e.g. one request every 2 minutes, ~1 hour for 27 items),
or — if this evidence is needed sooner — request a free individual FDC API key (a real signup,
requiring the CLAUDE.md rule-17 approval gate for external-resource creation, which this ticket
was explicitly told not to do: "any paid API signup (requires approval per CLAUDE.md)" is
out of scope, and while FDC's real key is free, the signup step itself still crosses that gate).
This is a genuine, disclosed gap in R-1's evidence, not a silent omission.

## 6. Licensing (R-4 flag for counsel)

- **Open Food Facts is ODbL-licensed** (Open Database License). Its *database structure* carries
  share-alike obligations on redistribution of the database itself; individual facts (a specific
  product's calorie count) are less clearly "creative" content subject to copyleft, but the
  **database as a whole** (our normalized catalog, if built by merging OFF data in) likely
  triggers ODbL's share-alike clause if we redistribute a derivative database — this needs real
  legal review before any merged/cached catalog ships (already flagged as R-4 in
  [DECISIONS.md](../../DECISIONS.md)). Practical note from this spike: OFF's content itself
  (`content_attribution_license`) requires attribution ("Data source: Open Food Facts") at
  minimum wherever OFF-derived facts are displayed — this is a low-cost, easy compliance item
  worth doing regardless of the harder share-alike question.
- **USDA FoodData Central is public domain** (US government work) — no licensing constraint,
  confirmed by FDC's own terms. This makes FDC's *nutrition* data the cleaner long-term anchor
  for anything we want to freely redistribute/cache without restriction, once real coverage
  numbers exist for it (§5's gap).
- **FDC's schema has no allergen field at all** (not rate-limited, not a data-quality gap —
  structurally absent from the API). Any allergen data in our catalog must come from OFF (or
  manufacturer-label ingestion, or user input), never FDC. This is a hard requirement for
  ADR-006's cascade design: **allergen tags cannot flow from an "OFF miss → FDC fallback"
  cascade** the way nutrition data can — a barcode that misses OFF but hits FDC would have
  nutrition but zero allergen information, which must render as "unknown, not safe" (SR-2), not
  silently look like "no allergens asserted, therefore safe."

## 7. Recommendation for ADR-006

Given what was actually measured (OFF only; FDC evidence pending — §5):

1. **Open Food Facts remains a strong candidate for the branded-product arm of the cascade.**
   Name/text-search identification is high (~85% genuine match after manual review) *for
   well-known national brands specifically* — likely an upper bound, not a general-population
   estimate (§1.2). Real, unbiased barcode-hit-rate needs **live scan telemetry once M3/M4
   ships** (already on the BACKLOG) before this number can be trusted as a launch metric.
2. **PLU/produce must be pulled out of any live barcode-lookup cascade entirely** and served
   from a small, manually curated PLU → `CanonicalIngredient` table instead (~50-150 common
   produce codes covers the vast majority of a US grocery basket). This spike found sending a
   PLU digit string to OFF's barcode endpoint returns a *wrong* record roughly twice as often as
   a *right* one (§4.1) — worse than a clean miss, because it looks like success. Recommend
   promoting ADR-006's "likely manual/curated list" open question to a **settled decision**, not
   left open.
3. **USDA FoodData Central's role in the cascade is unvalidated this session** — the DEMO_KEY
   rate limit blocked all 27 attempts (§5). FDC remains attractive in principle (public domain,
   authoritative nutrition, no licensing gate) but ADR-006 should not claim a measured hit-rate
   for it yet. Recommend: either a follow-up spike with slower pacing/a real key before ADR-006
   moves past PROPOSED, or explicitly scope FDC's MVP role to "nutrition-only fallback, coverage
   TBD" and revisit with real numbers before M4.
4. **A commercial source (option C) is not yet justified by this evidence** — OFF's
   branded-name identification looks strong enough, on this (biased) basket, that reaching for a
   paid API before measuring real scan telemetry (M4) would be premature. Revisit if M4's live
   resolution-rate telemetry shows OFF underperforming in practice, especially on store-brand/
   regional products this spike's basket didn't test.
5. **Allergen data has a structural gap FDC cannot fill** (§6) — any product resolved via an
   FDC-only path must render allergen status as unknown/warn, never omit the warning silently.
   This should be an explicit rule in the eventual cascade implementation (M4), not just an
   inference from this doc.
6. **ODbL review (R-4) is a precondition for shipping any merged/cached OFF-derived catalog**,
   independent of the hit-rate findings above — flag to counsel before M4, not after.

Overall: **cascade shape A → B → manual (per ADR-006's tentative recommendation) still looks
directionally right**, but this spike sharpens it — PLU is not part of the live cascade at all,
FDC's slot in the cascade needs its own evidence before being relied on, and every cascade output
needs the confirmation-gate discipline the architecture already specifies, because even OFF's
best-case (well-known-brand) name matching is wrong often enough to matter (§4.2).

## 8. Commands run

```bash
node scripts/food-data-coverage-research.mjs
```

Run live on 2026-09-09. Two runs were needed: the first draft's OFF name-search calls used a
decommissioned endpoint (`cgi/search.pl`, returns an HTML "temporarily unavailable" page instead
of JSON) that was silently scoring every name-search item as a miss — caught mid-run by manually
spot-checking a "miss" against the live endpoint, fixed to use OFF's current
`search.openfoodfacts.org` API, and re-run in full. This is disclosed here because it's exactly
the kind of methodology bug this doc's own §4 argues you must actively look for, not assume away.
