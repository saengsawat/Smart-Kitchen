# Shelf-life data research — R-6 (docs only)

**Status of evidence:** the source is located and its licence is verified (public domain,
CC0 1.0, no account/key/payment gate). **The raw dataset itself could not be downloaded
this session** — a network-level block on the source host, detailed in
[`tests/fixtures/shelf-life/README.md`](../../tests/fixtures/shelf-life/README.md), stopped
every retrieval attempt. This means objectives (b) (coverage measurement) and (c) (data
shape) are **not measured** and this document does not estimate numbers to fill that gap
(CLAUDE.md rule 19 — report honestly). What follows reports exactly what was verified,
what is local-corpus fact (measured, real), and what is proposed reasoning that does not
depend on the blocked file (objective d), each labeled per CLAUDE.md rule 5.

Raw output: [`shelf-life.raw.json`](shelf-life.raw.json) (written by
[`scripts/shelf-life-coverage-research.mjs`](../../scripts/shelf-life-coverage-research.mjs),
which runs today and reports the local-corpus half honestly; its FoodKeeper-matching half
is written but has never executed against real data — see the script's own header comment).

## 1. Source and licence — SOURCE REQUIREMENT (verified)

- **Dataset:** "FSIS - FoodKeeper Data", published by the Food Safety and Inspection
  Service (FSIS), U.S. Department of Agriculture.
- **Catalog record:** <https://catalog.data.gov/dataset/fsis-foodkeeper-data> (read
  successfully 2026-09-30).
- **Declared resource URL (English, JSON):**
  `http://www.fsis.usda.gov/shared/data/EN/foodkeeper.json` (an XLS twin and Spanish/
  Portuguese copies also exist; not needed for this ticket).
- **Dataset First Published:** November 10, 2020. **Last Updated (catalog `modified`
  field):** 2025-01-22. **Access Level:** public.
- **Licence, verbatim from the catalog record's own metadata:**

  > license: https://creativecommons.org/publicdomain/zero/1.0/

  This is the Creative Commons **CC0 1.0 Universal (Public Domain Dedication)**. No
  account, API key, additional terms acceptance, or payment is asked for anywhere on the
  catalog record — CLAUDE.md rule 17's stop condition for this ticket ("if it requires an
  account, an API key, acceptance of terms beyond a public-domain or open statement, or
  any payment, STOP") is **not triggered**. Full detail, including a cross-check against
  a second open-data mirror that also only links back to the same source, is in
  `tests/fixtures/shelf-life/README.md`.

## 2. Retrieval attempt — BLOCKED, not a licence or account gate

Every declared resource URL, the bare `fsis.usda.gov` domain root, and a second USDA-family
property (`foodsafety.gov`, which hosts the same FoodKeeper data as a web app) returned
`HTTP 403 Forbidden` with `Server: AkamaiGHost` and an "Access Denied" edge-block page, from
three different HTTP clients (curl with a descriptive research User-Agent, curl with a
generic browser User-Agent, and Node's `fetch`). The block fired on the very first request
to the bare domain root, with no query string at all, so it is not rate-limiting and not a
challenge asking for credentials — it reads as a categorical block of this session's egress
address by USDA's CDN. `catalog.data.gov` (a different host) answered `200 OK` to the
identical client throughout the same session, so this is host-specific, not a general loss
of network access. Full request/response detail is in
`tests/fixtures/shelf-life/README.md`, which this document does not repeat.

**No raw file is committed.** `tests/fixtures/shelf-life/raw/` holds only a
`NOT_RETRIEVED.md` marker explaining the gap. No checksum exists because nothing was
retrieved to hash.

This is treated the same way R-1 treated USDA FDC's `DEMO_KEY` rate-limit block
(`food-data-coverage.md` §5): a genuine, disclosed evidence gap, reported as a gap, not
papered over with an invented or estimated number.

## 3. What WAS measured: the local corpus — DOCUMENTED (script output)

`scripts/shelf-life-coverage-research.mjs` reads the real, committed local fixtures — the
part of this ticket that does not depend on the blocked download — and reports real,
reproducible counts (run `node scripts/shelf-life-coverage-research.mjs`; the same numbers
are in `shelf-life.raw.json`'s `localCorpus` object):

**`tests/fixtures/products/**`: 102 files, not 101.** The ticket text (and the R-6 backlog
entry) says "101 fixture products"; the directory as of this branch's base commit
(`91c496b`) contains 102 `*.json` files. This is reported as measured fact, not corrected
silently — the ticket's number may simply predate a fixture added by a later ticket (the
`multicode-*` and `conflict-*` fixtures look like later additions for M2-T4-family
lookup-hardening tests). Category breakdown (by each fixture's own `category.value` field,
not by filename prefix, since `conflict-*`/`multicode-*` filenames don't carry a category):

| Category | Count |
|---|---|
| pantry | 24 |
| produce | 15 |
| dairy | 13 |
| meat | 11 |
| frozen | 10 |
| snacks | 10 |
| condiments | 9 |
| baking | 5 |
| beverages | 5 |
| **Total** | **102** |

**The nine Chen seed items** (`apps/api/src/seed/fixture-inventory.ts`, `CHEN_SEED_ITEMS`):
strawberries, chicken breast, spinach, mushrooms, Greek yogurt, eggs, salmon fillets,
Basmati rice, olive oil — storage locations FRIDGE (six), FREEZER (one, salmon), PANTRY
(two, rice and olive oil). No FoodKeeper category bucket assignment for these nine is
verified data; the script assigns each a bucket from our own fixture taxonomy purely so the
same category-keyword table could apply to both corpora once real data exists — two of
those nine assignments (eggs and salmon) are the script's own judgment call, not sourced
from either file, and are marked as such in the script's comments.

## 4. Data shape — UNKNOWN (not measured)

Objective (c) asks for per-category ranges (min/max/metric), storage types, opened/
unopened splits, and where the data is missing or contradictory. **None of this is known
this session.** No FoodKeeper record of any kind was read. Any description of FoodKeeper's
field names or category taxonomy from general knowledge would be exactly the kind of
invented data CLAUDE.md rule 4 forbids in a research finding — so none is given here. This
is an open RESEARCH REQUIRED item, unblocked only by resolving §2's retrieval failure.

## 5. Coverage — UNKNOWN (not measured)

Objective (b) — hit / ambiguous / miss counts for the 102 fixture products and the nine
Chen items against FoodKeeper — cannot be computed without the file. §3 above is the
honest substitute: real counts of the corpus this ticket would have matched, with nothing
on the FoodKeeper side of the comparison. `shelf-life.raw.json`'s `foodKeeper` object
records `"status": "blocked"` rather than a fabricated zero-hit result, so it cannot be
misread later as "measured, and everything missed."

## 6. Mapping approach — PROPOSED, unverified

The intended method (once the file exists): match by category first, the same way R-1
warned against name-only matching (`food-data-coverage.md` §4.1 — a name match without a
plausible category match produced FDC's most dangerous false "hits"). Two category
vocabularies exist in this codebase already and both would need mapping to FoodKeeper's own
category field once its real values are visible:

- **Our fixture corpus's `category.value`** (`tests/fixtures/products/**`): nine plain
  English words — pantry, produce, dairy, meat, frozen, snacks, condiments, baking,
  beverages (§3 table above; DOCUMENTED, read directly from the fixture files).
- **Open Food Facts' `categories_tags`**, as the OFF adapter already reads it
  (`packages/adapters/src/product-lookup/open-food-facts/mapping.ts`,
  `mostSpecificCategory()`): the **last well-formed `en:` tag** of OFF's
  `categories_tags` array (OFF orders categories general → specific), kept as the raw tag
  itself (e.g. an OFF tag shaped like `en:yogurts`), never cleaned up or translated. This
  is the value that would actually arrive on a live-scanned product's `category` field
  under ADR-006's OFF tier policy (D-025): `ESTIMATED`, source `open-food-facts`, and (per
  that policy) never licenses an allergen absence.

`scripts/shelf-life-coverage-research.mjs` proposes a third table, `CATEGORY_KEYWORD_MAP`,
mapping each of our nine fixture-category words to a short list of English keywords a
FoodKeeper category/subcategory field might plausibly contain (e.g. `meat` →
`["meat", "poultry", "seafood", "fish", "beef", "pork", "chicken"]`). **This keyword list is
PROPOSED from general knowledge of how food-storage guidance is usually grouped, not
verified against this session's download, since none was obtained** — every entry in it
should be treated as a first guess to correct once real FoodKeeper category strings are
visible, not a settled mapping. The script does not hardcode FoodKeeper's exact field
names either: it introspects whatever JSON shape the file turns out to have (looking for
an array of records, then guessing which of that record's own keys look "name-like" or
"category-like" by regex on the key name) and prints its guess before using it, specifically
so a reviewer catches a wrong guess rather than trusting it silently. **None of this
matching code has ever run against real data. It is written, not verified — the script's
own header comment says so again, deliberately, so this claim survives being read out of
context.**

OFF-tag mapping and fixture-category mapping are two *different* open questions that both
resolve the same way once real FoodKeeper category values exist: extend
`CATEGORY_KEYWORD_MAP` (or replace it with a real fixed table once the shape is known), and
separately decide how an OFF `en:` tag (free-form, thousands of possible values, no fixed
enum) reduces to one of FoodKeeper's category buckets — likely the same kind of small,
hand-curated, allowlist-only table the D-025 allergen tag map already uses for OFF
allergen tags (`packages/adapters/src/product-lookup/open-food-facts/allergen-tag-map.ts`),
pinned by a consistency test the same way, so an unmapped OFF tag reads as "unrecognized",
never guessed.

## 7. Storage options — PROPOSED, compared

The ticket asks to compare a `shelf_life_rules` table against a static JSON module in
`packages/adapters`, without deciding.

**Option A — `shelf_life_rules` table** (a new Postgres table, e.g.
`shelf_life_rules(id, category, storage_location, opened BOOL, min_days, max_days, source,
source_rule_id)`, alongside `docs/architecture/data-model.md` §2's existing
`product_catalog_items.shelf_life_days_pantry/fridge/freezer` and
`canonical_ingredients.default_shelf_life_days_by_location` columns, which are already
reserved for exactly this).
- *Pros:* queryable and joinable with `inventory_items`/`product_catalog_items` in the same
  transaction that reads inventory (no second data source to keep in sync with a running
  process); a future correction/override workflow (per-household or per-item shelf-life
  adjustments) is a normal row update, matching the append-only-ledger discipline's spirit
  of "state lives in the database, not in code"; a schema migration is the natural place
  to record `source_rule_id` provenance per §8 below.
- *Cons:* a full ETL/seed step is needed to load FoodKeeper's rows into the table (a
  migration or a seed script, whichever M8-T1 chooses); every FoodKeeper update becomes a
  data migration, not a deploy of new code; RLS and household-scoping are irrelevant here
  (this table is global, like `product_catalog_items`), so it needs the same "not
  household-scoped" carve-out those tables already have (§5 of data-model.md).

**Option B — static JSON in `packages/adapters`** (checked into the repo, imported like the
allergen corpus already is per `packages/domain`'s `recommendations-corpus` subpath export
convention, M1-T10 follow-up).
- *Pros:* no migration, no seed step, no database round-trip to look up a shelf-life rule;
  versioned in git exactly like `tests/fixtures/shelf-life/raw/foodkeeper.json` itself would
  be, so a diff shows exactly what changed when FoodKeeper's data updates; matches this
  ticket's own R-1-pattern precedent of committing curated data as a file, not a table.
- *Cons:* every FoodKeeper update requires a code deploy, not a data operation; no per-item
  or per-household override path without also adding a database table anyway for the
  override rows (in which case the base rule set and the override set live in two different
  places, which is its own complexity); larger than the allergen corpus (FoodKeeper is
  reported to cover several hundred items across many categories, per its own public
  description — ENGINEERING INFERENCE, not verified this session), so bundle size for
  `packages/adapters` consumers is a real if probably small concern.

**PROPOSED pick: Option A, the `shelf_life_rules` table.** The reasoning that does not
depend on the blocked data: `data-model.md` §2 already reserved shelf-life columns on
`product_catalog_items` and `canonical_ingredients` rather than a static export, suggesting
the original schema sketch expected this to be data, not code; a correction/override
workflow (S5's existing "tap to correct" mechanism, `copy-deck.md` §5) reads far more
naturally as an UPDATE to a row than as a per-household patch over a static JSON shipped in
every client bundle; and the M8 epic line explicitly pairs "expiration estimates from
shelf-life data" with "reconciliation prompts," both database-shaped concerns. This is
PROPOSED, not decided — CLAUDE.md rule 4 reserves DECIDED status for recorded PO/architect
approval, and this pick has evidence but no such approval yet.

## 8. Estimation rule — PROPOSED, exactly as the ticket frames it

Quoted from the ticket (BACKLOG.md, R-6 objective d), not reworded, since CLAUDE.md rule 4
says a research spike does not get to soften or restate a PO-approved framing on its own
authority:

> best-by = the anchoring date plus the range minimum for the item's storage location;
> anchoring date = purchase or open date, never invented; tier ESTIMATED with source
> `usda-foodkeeper` and the rule id; a printed label date always wins and is never
> overwritten; the estimate is confirmable and correctable through the existing S5 flow

Restated against this codebase's actual types, still PROPOSED:

- **Anchoring date:** `inventory_lots.acquired_at` (purchase) if no separate "opened" date
  is ever captured, or a new `opened_at` column if M8-T1 adds one (see §9's first open
  question — S5 does not capture an opened date today). Never a system-invented date: if
  neither a purchase date nor an open date is on record, no estimate is produced (the item
  keeps whatever expiry state it already has, which per `data-model.md` §2's
  `inventory_lots.expires_tier` may simply be absent).
- **Range minimum:** whichever of FoodKeeper's pantry/fridge/freezer ranges matches the
  lot's `inventory_items.storage_location` (fridge/freezer/pantry/other), taking the
  *minimum* of that range specifically because CLAUDE.md rule 9's allergen-safety framing
  ("never claims a food is guaranteed safe") generalizes here too: an expiry estimate that
  runs long is the unsafe direction, so the rule takes the conservative (earliest) bound of
  whatever range FoodKeeper reports, once that range is known.
- **Tier and provenance:** `provenance_tier = ESTIMATED`, `provenance_source =
  "usda-foodkeeper"` plus a `rule id` distinguishing this specific derivation (e.g. category
  + storage location + FoodKeeper's row id) from any other `ESTIMATED` source already in the
  system (receipt OCR, OFF). This matches `data-model.md` §4's existing provenance column
  group (`provenance_tier`, `provenance_source`, `confidence`, `observed_at`,
  `confirmed_by`) and `copy-deck.md` §4's `ESTIMATED` chip ("A reasonable estimate, not a
  confirmed fact. Tap to correct it.") without needing a new tier or a new chip.
- **Label date always wins:** a `KNOWN_FACT`-tier expiry (a printed date the user entered or
  confirmed) is never overwritten by this rule. This mirrors CLAUDE.md rule 9's "LLM output
  may add warnings, never clear them" pattern one level over: an estimate may fill an
  absence, never demote a fact.
- **Confirmable/correctable through S5:** the existing "Fix this" one-tap-correct entry
  point (`copy-deck.md` §5) already generalizes to any `ESTIMATED` fact; this rule proposes
  no new UI surface, only a new value flowing into an existing one.

This whole section is a restatement and a fitting of the ticket's own words to real types,
not new evidence — it does not require the blocked FoodKeeper file to write down, and it
is marked PROPOSED throughout because CLAUDE.md rule 4 reserves DECIDED for recorded PO
approval, which this ticket does not carry.

## 9. Open questions for the PO — OPEN QUESTION

1. **Opened-date capture on S5.** No screen captures an "opened" date today (checked
   `copy-deck.md` §5 and §11's S1/S2 onboarding strings — neither mentions one). The
   estimation rule above needs an anchoring date; without an opened-date field, every
   opened-vs-unopened FoodKeeper range collapses to "unopened" by default, which may
   overstate shelf life for anything a household has already opened (an opened jar of
   olive oil, a cracked carton of eggs). Does S5 (or a new small addition to it) get an
   "I opened this" action, and if so, what happens to lots that were already opened
   before this ships?
2. **Freezer moves.** `inventory_items.storage_location` is one value per item (per
   `data-model.md` §2's single-unit-per-item MVP simplification), and CLAUDE.md rule 10
   forbids mutating a lot's history outside a transaction append. If a household moves an
   item from fridge to freezer partway through its life (a common real behavior — freezing
   bread, freezing meat before its fridge date), does that move: (a) require a new
   transaction type or correlation, (b) simply overwrite `storage_location` going forward
   with no historical record of the move, or (c) stay out of MVP scope entirely (freezer
   moves treated as "removed, then a fresh `INITIAL_STOCK` in the new location")? This
   affects whether the `shelf_life_rules` table (§7) needs a "recompute on location change"
   trigger or hook.
3. **What the freshness ring shows for an estimate.** `M3-T3`'s follow-up already flagged
   "the 7-day amber-to-green ring boundary as an ENGINEERING INFERENCE" and "an expired
   state... documented in deck §7 S5 as owed." Once `ESTIMATED`-tier expiries exist
   alongside `KNOWN_FACT` ones on the same ring, does the ring visually distinguish an
   estimate from a confirmed date (an outline vs. a filled ring, an icon, the existing
   compact "≈ Est." chip alongside it), or does it read identically and rely on the item
   detail screen alone to disclose the tier? `copy-deck.md` §4's chip rule ("every fallible
   fact wears one of these three; there is no 'no chip' state") suggests the chip must
   appear somewhere on the row regardless, but the ring itself is a separate design
   surface not yet specified for this case.

## 10. Proposed M8-T1 outline (PROPOSED, not a ticket yet)

Not written into BACKLOG.md (workers do not edit `docs/**`/BACKLOG.md per CLAUDE.md rule 25
and rule 30 — this is a proposal for the architect to write up once §2's blocker is
resolved and §9's PO questions are answered):

- **Title (draft):** M8-T1 — Shelf-life estimation: FoodKeeper-backed `shelf_life_rules`
  table and the ESTIMATED-tier expiry rule.
- **Depends on:** this ticket's blocker resolved (a real `foodkeeper.json` committed and
  §4/§5 actually measured — the coverage numbers this ticket was supposed to produce are
  this future ticket's real inputs, not this one's); PO answers to §9's three questions;
  the M8 epic's other prerequisites (meal logging, per the BACKLOG.md M8 epic line).
- **Objective (draft):** load FoodKeeper's category/storage/opened-unopened ranges into
  the `shelf_life_rules` table (§7's pick, pending PO ratification); implement the
  estimation rule from §8 as deterministic code (CLAUDE.md rule 7 — this is exactly the
  kind of safety-adjacent arithmetic that must never route through an LLM); wire it to
  produce `ESTIMATED`-tier `expires_at`/`expires_tier` on `inventory_lots` only where no
  `KNOWN_FACT` expiry already exists; extend S5's existing correction flow rather than add
  a new one.
- **Invariants (draft, pending review):** a `KNOWN_FACT` expiry is never overwritten by an
  estimate (§8); the rule never invents an anchoring date; every produced estimate carries
  `source = "usda-foodkeeper"` plus a rule id; the range minimum is always taken, never the
  maximum or a midpoint (§7's safety-direction reasoning).
- **Model routing (draft):** Implementation Sonnet (deterministic arithmetic and a
  migration, no domain-safety judgment call left open once §9 answers land); Review
  **Opus-class** if §9.2 (freezer moves) resolves in a way that touches ledger/transaction
  semantics (CLAUDE.md rule 23's inventory-arithmetic/ledger criterion), otherwise Sonnet.

## 11. Commands run

```bash
node scripts/shelf-life-coverage-research.mjs
```

Run on 2026-09-30. Output: local corpus counts (§3 above, identical to `shelf-life.raw.json`).
The FoodKeeper-matching half of the script exists (see the script's own docstring) but has
never executed against real data this session, because the retrieval attempts documented in
`tests/fixtures/shelf-life/README.md` all failed before any content came back.

Retrieval attempts (all failed, all recorded verbatim in
`tests/fixtures/shelf-life/README.md`, not repeated here): `curl` against
`https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json`,
`https://www.fsis.usda.gov/shared/data/EN/FoodKeeper-Data.xls`,
`https://www.fsis.usda.gov/wps/wcm/connect/.../Data-Documentation-FoodKeeper-Application.pdf`,
and the bare `https://www.fsis.usda.gov/` and
`https://www.foodsafety.gov/keep-food-safe/foodkeeper-app` roots, each with two different
User-Agents; a Node `fetch()` retry of the JSON URL; a check of
`https://catalog.data.gov/dataset/fsis-foodkeeper-data` (succeeded, used for §1's licence
text) and `https://data.amerigeoss.org/dataset/fsis-foodkeeper-data1` (succeeded, confirmed
no independent copy of the file exists there either).
