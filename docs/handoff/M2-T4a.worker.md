# M2-T4a worker report: product lookup over Open Food Facts, `GET /v1/products/{code}`, NOT_RUN on S8

Branch `m2-t4a-off-lookup`, cut from `main` at `32abd27`. Implementation model: Opus-class, as the
ticket says. No architecture conflict found. One factual error in the ticket (OFF's published rate
limit) and five files outside the listed file scope; both are in section 7.

## 1. What was built

**(a) Adapter** (`packages/adapters/src/product-lookup/open-food-facts/`)

- `OpenFoodFactsProductLookupPort` implements the M1-T5 `ProductLookupPort`. One `resolve`:
  refuses a malformed code and every PLU without sending anything; answers from an in-memory TTL
  cache (hits 30 min, misses 5 min, errors never cached, bounded at 1000 codes, oldest evicted);
  joins an identical request already in flight; refuses to send during a 60 s cooldown after a 429
  or 503, or when the process's rolling budget (12 reads per 60 s) is spent; sends
  `GET {base}/api/v2/product/{code}.json?fields=<the twelve fields>` with `User-Agent` and
  `Accept: application/json` under a 5 s `AbortController` timeout that covers headers and body;
  maps the answer. It never throws and logs nothing.
- `config.ts`: production and staging hosts, the default User-Agent
  `SmartKitchen/0.1 (development; https://github.com/saengsawat/Smart-Kitchen)`, the field list,
  timeout, budget, cooldown, TTLs. `offConfigFromEnvironment` reads `SK_OFF_BASE_URL` (https only,
  plain http only on loopback, no credentials, query or fragment) and `SK_OFF_USER_AGENT` (one
  printable line, at most 200 characters, so no header injection). OFF's published staging basic
  auth is sent to `world.openfoodfacts.net` and nowhere else.
- Outcome mapping (`mapping.ts`): 200 or 404 with JSON `status: 0` is `not-found`; 429 is
  `UPSTREAM_RATE_LIMITED`; 5xx `UPSTREAM_UNAVAILABLE`; timeout `UPSTREAM_TIMEOUT`; network failure
  `UPSTREAM_UNAVAILABLE`; any other status `UPSTREAM_REJECTED`; non-JSON, wrong shape, a 404 that is
  not OFF's JSON miss, a `code` naming a different product, or allergen fields that are not arrays
  are `UPSTREAM_MALFORMED`. Five new `AdapterErrorCode`s carry these. None of them is ever
  `not-found`.

**(b) Mapping into `ProductCatalogItem`**: the code match is the identity (it is not a field; S8's
identity chip shows it). `name`, `brand`, `category`, `packageSize`, `servingSize`, `nutrition`,
`ingredientsText`, `imageRef` and every allergen tag are `ESTIMATED`, source `open-food-facts`,
`observedAt` from `last_modified_t` (fetch time when OFF sends none). `allergens_tags` become
`CONTAINS`, `traces_tags` `MAY_CONTAIN`, through one committed map (section 3); unmapped tags pass
through raw. No `declaration` field exists on the item, so no completeness claim can come from OFF.
Nothing OFF does not send is filled in. `packageSize` and `servingSize` come from a strict parser
(`parse-quantity.ts`) and are absent unless the text reads as one amount in a registry unit.
Nutrition: `PER_100G` from `*_100g` keys and `PER_SERVING` from `*_serving` keys, only finite
non-negative JSON numbers; sodium grams to milligrams by shifting the decimal point in the number's
own text, not float multiplication.

**(c) Endpoint** (`apps/api/src/http/product-routes.ts`, `apps/api/src/products/lookup-service.ts`):
`GET /v1/products/:code` behind `householdRoute()`. 4 or 5 digits: 400 `PLU_NOT_SUPPORTED`, nothing
sent. 8, 12, 13 digits with a valid GS1 check digit: EAN-8, UPC-A, EAN-13. 14 digits: indicator 0 is
looked up as its EAN-13, any other indicator is 400 (section 7). Anything else, a bad check digit
included: 400 `BAD_REQUEST`. The body is `ProductLookupResultDto` with HTTP 200 for `hit`,
`not-found` and `error`; `error` carries one fixed sentence, never the upstream detail. Every hit
goes through a `ProductScreeningStep`; the default `notRunScreening` answers
`{ status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" }`. M2-T4 passes an engine-backed
step in `RouteDeps.products.screening` and touches nothing else (a test proves the plug point). The
route reads no table and opens no tenant session. One log line per lookup: `productCode`,
`outcome`, `lookupError` on error; never the response body. The composition root builds the port
from `SK_OFF_BASE_URL`/`SK_OFF_USER_AGENT` and refuses to start on a bad value.

**(d) Contracts** (`packages/contracts/src/products.ts`, `errors.ts`, index appended):
`ScreeningOutcomeDto = { status: "RUN"; result } | { status: "NOT_RUN"; reason }`,
`SCREENING_NOT_RUN_REASONS_DTO = ["HOUSEHOLD_RESTRICTIONS_NOT_STORED"]`,
`ScannedProductDto.screening: ScreeningOutcomeDto`, `ScannedProductDto.packageSize` now optional,
`PRODUCT_LOOKUP_ROUTE = "/v1/products/:code"`, `productLookupPath(code)`, `PLU_NOT_SUPPORTED`
appended to `API_ERROR_CODES`.

**(e) Scan sheet (S8)** (`apps/mobile/app/add/scan.tsx`, `src/scan/allergen-copy.ts`): verdict lines
render only from `ranScreeningResult(outcome)`, which is non-null only for `status: "RUN"`. For
`NOT_RUN` the allergen row shows the neutral glyph `○` (ink2) and the §3.3 string verbatim in plain
ink; no red, amber or green, no member, no verdict word; Add keeps its brand style and its
household gate. Name, brand and package size now each wear their own tier chip (from OFF all read
"≈ Est."; the identity chip stays "✓ Known fact"). A product with no package size adds the chosen
count in `each`. `gen-screening-fixtures.mjs` wraps every generated result in `RUN`; the three
mobile fixtures were regenerated and the drift test passes.

## 2. OFF field names and policies verified against the docs (2026-09-29)

| Checked | Where | What it said |
| --- | --- | --- |
| Product read endpoint | `https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/ref/api.yaml` (the v2 OpenAPI file linked from `.../api/ref-v2/`) | `"/api/v2/product/{code}"`, GET, `code` path param "The barcode of the product to be fetched" |
| `fields` parameter | `.../ref/parameters/product_available_fields.yaml` | `name: fields`, in query, "Custom comma-separated list of product field names", pattern `^[a-zA-Z0-9_.-]+(,[a-zA-Z0-9_.-]+)*$` |
| `status` | `.../ref/responses/get_product_by_barcode_base.yaml` | `status: integer, enum [0, 1]`, plus `code` and `status_verbose`. A real miss (recorded) is HTTP 404 with `{"code":"0481293740567","status":0,"status_verbose":"product not found"}` |
| `code`, `product_name`, `quantity` | `.../ref/schemas/product_base.yaml` | `product_name` "name of the product in the main language"; `quantity` "It should be the value as displayed on the product ... (e.g. '6 eggs')", example `"3 x 150 g"` |
| `serving_size` | `.../ref/schemas/product_misc.yaml` | "Serving size text ... We expect a quantity + unit but the user is free to input any string" |
| `ingredients_text`, `allergens_tags`, `traces_tags` | `.../ref/schemas/product_ingredients.yaml` | `allergens_tags` array of string; `traces_tags` array, items `oneOf` object or string (handled: a non-string tag passes through as its JSON text) |
| `nutriments` keys | `.../ref/schemas/product_nutrition.yaml` | `<nutrient>_100g` "normalized value ... for 100g (or 100ml for liquids), in a standard unit: g for ... sodium ..., kcal for energy-kcal"; `<nutrient>_serving` the same per serving; nutrient ids `energy-kcal`, `proteins`, `carbohydrates` ("available carbohydrates (excluding fiber)"), `fat`, `sugars`, `sodium`; `fiber` confirmed in every recorded response |
| `last_modified_t` | `.../ref/schemas/product_meta.yaml` | integer, "Date when the product page was last modified" (Unix seconds, confirmed against recordings) |
| `brands`, `categories_tags`, `image_front_url` | `product_tags.yaml`, `product_images.yaml`, and the recordings | present as string, array of `en:` tags, and an https image URL |
| User-Agent policy | `https://openfoodfacts.github.io/openfoodfacts-server/api/` "Authentication" | "always use a custom User-Agent ... in the form of AppName/Version (ContactEmail)" |
| Rate limits | same page, "Rate limits" | "15 req/min/IP address for all read product queries (GET /api/v*/product requests or product page)"; 10/min for search; global limits answer 503; IP bans possible |
| Staging | same page, "API Deployments" | "Staging: https://world.openfoodfacts.net (need extra http basic auth with username off and password off)"; "make all API requests to the staging environment" while testing |
| Versions | same page | v3 (v3.6) "recommended for all new integrations"; v2 "Deprecated, still supported for backward compatibility" |
| Barcode normalization | `.../api/ref-barcode-normalization/` | 9 to 12 digit codes are padded to 13; "a request for the 12 digit barcode 034000470693 will return the product saved with code 0034000470693"; GTIN-14 is EAN-13 with a leading packaging digit |
| Allergen taxonomy ids | `https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/allergens.txt` | first `en:` names: none, gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame seeds, sulphur dioxide and sulphites, lupin, molluscs (plus Japanese-list entries); wheat, barley, rye, oats are synonyms under gluten; coconut is not an entry |

## 3. Tier and allergen-tag map

Every OFF-derived field and tag: `ESTIMATED`, source `open-food-facts`. Only the code match is Known
Fact, shown by S8's identity chip. No declaration is ever produced.

| OFF tag | Engine code | Basis |
| --- | --- | --- |
| `en:peanuts` | `peanut` | taxonomy |
| `en:nuts` | `tree_nut` | taxonomy (almonds, hazelnuts, walnuts, cashews, pecans, Brazil, pistachio, macadamia) |
| `en:milk` | `milk` | taxonomy |
| `en:eggs` | `egg` | taxonomy |
| `en:fish` | `fish` | taxonomy |
| `en:crustaceans` | `shellfish` | taxonomy |
| `en:molluscs` | `shellfish` | D-017 P2 |
| `en:soybeans` | `soy` | taxonomy |
| `en:sesame-seeds` | `sesame` | taxonomy |
| `en:coconut` | `tree_nut` | D-017 P3; seen as a raw contributor tag in a real US record |

Unmapped tags pass through raw (`en:gluten`, `en:celery`, `en:mustard`, `en:lupin`,
`en:sulphur-dioxide-and-sulphites`, `en:none`, `en:Grains`, `en:3520367101`, `fr:lait`, ...). The
engine cannot read them, so each adds an `UNRECOGNIZED_ASSERTION_CODE` unknown and an
`UNRECOGNIZED_ALLERGEN_DATA` warning (M1-T6 fail-closed); a test proves every key and every raw tag
seen is unreadable by `normalizeAllergenCode`, so a raw tag cannot silently mean something. `en:gluten`
is deliberately not wheat (same reason the domain refuses that alias). `en:none` is a claim of
absence and is passed raw, so it can only read as unrecognized. Wheat therefore has no mapped tag;
a consistency test pins that as the one uncovered major.

## 4. Recorded fixtures (`tests/fixtures/off/`, all captured 2026-09-29 from production)

| File | Code | Product | Case |
| --- | --- | --- | --- |
| `full-peanut-butter.json` | 096619555505 | Kirkland Organic Creamy Peanut Butter | full record, CONTAINS + MAY_CONTAIN, `en:coconut`, "793.8 g" |
| `traces-only-granola.json` | 856416000703 | Bear Naked Triple Berry Crunch Granola | traces only, "12 oz (340g)" |
| `unmapped-tags-bread.json` | 013764027138 | Dave's Killer Bread 21 Whole Grains and Seeds | `en:gluten` CONTAINS, `en:Grains`/`en:Seeds` traces |
| `unparseable-quantity-ripple.json` | 855643006045 | Ripple Dairy-Free Milk | "48 fl oz" |
| `no-allergen-fields-almond-breeze.json` | 041570056189 | Blue Diamond Almond Breeze | captured with a `fields` list omitting the two allergen fields, so the real body has none (labelled so in the file) |
| `sparse-sandwich.json` | 0999999999993 | a store sandwich | meant as a miss; OFF had it. No quantity, ingredients or categories. Only the `capture.note` was corrected afterwards; the body is untouched |
| `not-found.json` | 481293740567 | none | HTTP 404, `status: 0` |

Each file is `{ capture: {capturedAt, host, request, userAgent, httpStatus, contentType, note}, body }`
with OFF's body unedited. `tests/fixtures/off/README.md` documents them.

## 5. By hand versus by tests

**Requests to OFF, all by hand, sequential:** 1 staging product read (Nutella probe), 1 production
search (to pick candidates), 7 production product reads (the recordings), 1 staging read through the
compiled API, 1 staging read from the opt-in live test. 11 in total, never more than one in flight.

**Compiled API, local stub** (`pnpm --filter api build`; `node dist/server.js` with
`SK_IDENTITY=fixture`, `DATABASE_URL` on the throwaway cluster, migrated and seeded, and
`SK_OFF_BASE_URL=http://127.0.0.1:4010`, a stub replaying the recordings):

- `GET /v1/products/096619555505` as Dean: 200 `hit`, name "Organic Creamy Peanut Butter", every
  provenance `{"tier":"ESTIMATED","source":"open-food-facts","confidence":null,"recordedAt":"2026-09-29T13:02:12.000Z"}`,
  `packageSize {"qty":"793.8","unit":"g"}`, both nutrition profiles, `bestBy: null`,
  `screening {"status":"NOT_RUN","reason":"HOUSEHOLD_RESTRICTIONS_NOT_STORED"}`. The stub saw the
  twelve-field URL and the default User-Agent, no Authorization. A repeat was served from cache.
- `481293740567` as Maya: 200 `{"status":"not-found","code":"481293740567"}`.
- `999999999993` (stub answers 429): 200 `{"status":"error","code":"999999999993","message":"The product database didn't answer. Try again in a moment, or add the item by hand."}`, log `lookupError: UPSTREAM_RATE_LIMITED`.
- `4011`: 400 `PLU_NOT_SUPPORTED`, nothing reached the stub. `fixture.new.user`: 403. No token: 401.
- Server stopped.

**Compiled API, OFF staging by hand** (`SK_OFF_BASE_URL=https://world.openfoodfacts.net`):
`GET /v1/products/3017620422003` answered 200 `hit` "Nutella", all fields ESTIMATED, `NOT_RUN`.
Staging's copy has `quantity: ""`, so no package size came back (correct: absent, not guessed).
Server stopped. **Live smoke test** run once with `SK_OFF_LIVE_TEST=1` against staging: 1 passed.

**Not done:** no device or browser run of S8 with an OFF product (the HTTP client's
`lookupProduct` is M3-T4e); S8's NOT_RUN row is verified by component tests only.

**Network-free proof:** both full suite runs below were executed with
`NODE_OPTIONS=--import <scratchpad>/block-net.mjs`, a preload that makes any non-loopback
`net.Socket.connect` throw and any non-loopback `fetch` reject, and logs each process it loads into
and each block. Sanity check first: a direct `fetch` and `net.connect` to world.openfoodfacts.org
were both blocked and logged. Suite runs: the shim loaded into 127 processes per run (vitest forks),
**0 blocked connections** in either run.

## 6. Verification (empty build state, CI order)

Every `dist/` and `*.tsbuildinfo` deleted first.

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok, lockfile up to date |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test`, no `DATABASE_URL`, network blocked | exit 0: 119 files passed, 1 skipped (the live test); 1870 tests passed, 351 skipped |
| `pnpm test`, `DATABASE_URL` on a throwaway PG17 cluster (port 55432, CONTRIBUTING recipe), network blocked | exit 0: 119 files passed, 1 skipped; 2201 passed, 20 skipped |
| `pnpm format:check` | all files formatted |
| `pnpm --filter mobile export` | exit 0 (android, ios, web); `apps/mobile/dist` deleted |
| cluster | stopped, data directory removed, `pg_isready` no response |

New tests: adapter mapping per recording, outcome mapping (status 0, 404, 429, 5xx, 4xx, malformed,
wrong code, non-array tags, nameless), quantity parser, grams-to-mg, engine-never-ALLOWED on every
recording, port request shape, User-Agent, staging auth scoping, timeout (headers and body), network
error, throttle and cooldown on a fake clock, cache TTL, key, bound, errors-not-cached, in-flight
dedupe, env config; tag map and path-constant consistency; route HTTP matrix across the four tokens,
response shape, pluggable screening step, PLU and bad-code refusal with zero sends, GTIN-14, logging;
mobile NOT_RUN row (verbatim string, colours, no verdict text, Add style, chips, no household wait,
no-package-size add, RUN fixtures never NOT_RUN).

## 7. Deviations and judgment calls

1. **OFF's published limit is 15 product reads per minute per IP, not the ticket's 100.** The
   throttle follows the ticket's intent ("stays under OFF's published product-read limit") with the
   published figure: 12 per rolling minute per process, refusing (an `error`) rather than queueing.
   Added a 60 s cooldown after 429/503 because OFF threatens IP bans. Several API processes on one
   IP would share OFF's 15; one process is the only deployment today.
2. **Files outside the listed scope**, each forced by the ticket itself:
   `apps/api/package.json`, `apps/api/tsconfig.json`, `pnpm-lock.yaml` (the API had no dependency on
   `@smart-kitchen/adapters`; a workspace link, no third-party package);
   `packages/adapters/src/contracts-consistency/screening-fixtures-consistency.test.ts` (an existing
   file; the drift test read `screening.verdict` and now asserts `status: "RUN"` and the verdict
   inside it); `apps/mobile/src/api/client.test.ts` (one assertion in the M3-T4b lookup block,
   `screening.verdict` to `toMatchObject({ status: "RUN", result: { verdict: "BLOCKED" } })`; this
   is M3-T4d's directory, so expect a one-line merge touch there, nothing else in `src/api/` changed).
   The route test lives in `apps/api/src/products/` to stay in scope.
3. **No GTIN-14 code type.** Adding one to the adapter's `CodeType` breaks the existing
   `products-contracts-consistency.test.ts` switch (new test files only there). A 14-digit code with
   indicator 0 is its EAN-13 (OFF's normalization note), so it is looked up as that; any other
   indicator is a case or pallet code and answers 400. Proposed backlog entry in section 9.
4. **A record with no usable `product_name` is `not-found`.** S8 has nothing for its header, the
   miss path already keeps the code for manual add, and inventing a name is out. It is not an
   `error` because retrying will not help.
5. **A 404 that is not OFF's JSON miss is `error`, and so is an answer naming another code.** A wrong
   base URL must not look like "every product is missing" (the R-1 script's decommissioned-endpoint
   lesson). Leading-zero differences are the same product.
6. **Bad check digit is 400 `BAD_REQUEST`**, not a lookup: a typo'd code should not be kept as a
   product ref.
7. **`error` is HTTP 200 with the DTO**, as the ticket's union says; the contracts rule is that every
   non-2xx body is `ApiErrorBodyDto`, so a 503 with the DTO body was not an option.
8. **The NOT_RUN row does not wait for the household to load.** It names nobody, and the loading
   line ("Checking allergen data for your household.") would claim a check is in progress. Add keeps
   its household gate unchanged. If the household fetch fails, the error box still wins.
9. **Tier chips on name, brand and size** (acceptance: "every field chipped Estimated"). The fixture
   products now show "✓ Fact" on those fields too.
10. **Not forwarded to the DTO:** `imageRef` (OQ-D8 photo licensing, S8 renders no image),
    `category`, `servingSize` and the allergen tags (no DTO field, S8 renders the screening outcome,
    not raw tags). All stay on the adapter item for M2-T4.
11. **Quantity parser:** accepts `N unit`, `N unit (M unit)` taking the first, or the bracketed one
    when the first unit is not a registry unit (`1 portion (32 g)`); strips a trailing ℮; no commas;
    emits registry canonical symbols and `each` for counts. `pt`, `qt`, `gal` parse but are not in
    `CREATE_ITEM_UNITS_DTO` (section 9).
12. **Staging basic auth in code**: `off:off` is published by OFF, grants read only, and is sent to
    the staging host only; not put in `.env.example` because that file carries names only.
13. **Default User-Agent has no email** (OFF asks for one) because the ticket forbids personal data
    in the default; `SK_OFF_USER_AGENT` is where a contact goes.
14. **v2, not v3**: the ticket names v2; OFF now marks v2 deprecated but supported.
15. **NOT_RUN string** is built as its prefix plus `SCAN_SHEET_CAVEAT_SUFFIX`, so the copy scan's
    existing allow-list covers it without editing the lint test; the rendered text equals §3.3.

## 8. What the reviewer should attack first

1. `mapping.ts` `mapOffAnswer`: every path to `not-found` (status 0 with matching code, nameless
   product). Try to reach it with a 429, a 5xx, an HTML 404, a truncated body, a wrong-host answer.
2. The tier stamping: `collectTiers` asserts only `ESTIMATED` on every recorded hit, and the route
   test asserts `KNOWN_FACT` never appears in the wire body. Look for any field that bypasses the one
   shared `provenance` object.
3. `allergen-tag-map.ts` and `normalizeAllergenCode`: can a raw tag reach the engine as a *different*
   recognized code, or can `en:none` or a missing field reduce caution anywhere?
4. PLU refusal: the route refuses 4 and 5 digits before the port, and the port refuses `PLU` again.
5. The block-net proof: it patches `net.Socket.prototype.connect` and `fetch` in every forked
   worker. Check whether anything could open a socket another way (vitest `threads` pool is not used
   here; if the pool changes, rerun).
6. S8 NOT_RUN: `ranScreeningResult` is the only gate; check nothing renders verdict styling off a
   missing or unknown `status`.

## 9. Escalations and proposed backlog entries

**Blocking for M3-T4e (lift as a list):**

1. Nutrition display: S8's macro strip renders `nutrition[0]` unrounded and without its basis, and
   OFF puts `PER_100G` first; decide the profile, rounding and basis label.
2. Per 100 ml (reviewer finding): OFF's `_100g` values are per 100 ml for liquids, but the adapter
   labels every such profile `PER_100G`; the basis enum has no `PER_100ML`.
3. Quantity tier: Add records `quantityProvenance: KNOWN_FACT` and toasts "· Known Fact" even when
   the package size is Estimated; decide the item quantity's tier and the toast copy.
4. Refusal mapping: 400 `PLU_NOT_SUPPORTED`, 400 `BAD_REQUEST` and the 200 `error` body need §8
   strings (or new ones).
5. Units: `pt`, `qt` and `gal` from OFF parse but are refused by `POST /v1/inventory/items`.

**Other entries:**

- **GTIN-14 code type** (adapter `CodeType`, contracts mirror, the existing consistency switch).
- **UPC-E expansion** (architect ruling, round 1): 8-digit UPC-E codes are read today as EAN-8.
- **`product_name_en` fallback** (architect ruling, round 1): a record with no `product_name` is
  `not-found` today; fall back to `product_name_en` before giving up.
- **M2-T4 (server screening):** OFF `ingredients_text` is often not English (the staging Nutella
  record is French: "LAIT", "NOISETTES", "SOJA"); the engine's English term lists will not match
  them, so milk, tree nut and soy there rest on the tags alone. Worth a language check (OFF's `lang`)
  before trusting text matching on OFF data.
- **OFF API usage form**: OFF asks integrators to fill one in and to send a contact email in the
  User-Agent before production traffic. External and PO-owned (rule 17); not done.
- **OFF v3 migration**, low priority while v2 is supported.
- **Carbohydrate definition**: OFF documents `carbohydrates` as available (net) carbs, while US
  labels print total carbohydrate; `carbohydrates-total` exists. Decide which feeds `carbsG`.
- **Per 100 ml**: OFF's `_100g` is per 100 ml for liquids; the DTO basis enum has no `PER_100ML`.
- **Multi-process throttling** once the API runs more than one process on one IP.

## 10. Proposed doc wording (architect applies at acceptance, rule 30)

**ADR-006, new section "Open Food Facts tier policy (M2-T4a, D-025)":**

> OFF data enters as a proposal of label facts, never as fact. The barcode match is the only Known
> Fact and it is identity, not a field. Every OFF field (name, brand, category, package size,
> serving size, nutrition, ingredients text, image, allergen and trace tags) is `ESTIMATED` with
> source `open-food-facts` and `observedAt` from `last_modified_t`. OFF data never licenses the
> absence of an allergen: no completeness declaration is produced from it, so a product known only
> from OFF screens `BLOCKED` or `ALLOWED_WITH_UNKNOWNS`, never `ALLOWED` (D-017). A missing allergen
> field is absence of data. OFF allergen tags are mapped by one committed table in
> `packages/adapters/src/product-lookup/open-food-facts/allergen-tag-map.ts`; everything else passes
> through raw and reads as unrecognized data. 429, 5xx, timeouts, network failures and unreadable
> answers are errors, never misses. PLUs are never sent. OFF's published read limit (15 per minute
> per IP, checked 2026-09-29) bounds the throttle; the ticket's 100 was wrong.

**ADR-006, R-4 note:** "M2-T4a keeps OFF answers in a per-process in-memory cache (30 min hits,
5 min misses, 1000 codes) and persists nothing, and does not forward product images to the client,
so no derived database exists and the ODbL share-alike and image-licence questions (R-4, OQ-D8)
stay untouched. Any product table, export or image display reopens them."

**Copy-deck:** §3.3 NOT_RUN row unchanged and rendered verbatim; add to its tone note "leads with
the neutral glyph ○ in ink2". New server-side sentences for the record (the client should show §8
strings, not these): `PLU_NOT_SUPPORTED` "Produce codes can't be looked up by barcode yet. Add this
item by hand."; `BAD_REQUEST` on this route "That isn't a barcode number we can look up."; lookup
`error` "The product database didn't answer. Try again in a moment, or add the item by hand."

**`.env.example` names added:** `SK_OFF_BASE_URL`, `SK_OFF_USER_AGENT`, `SK_OFF_LIVE_TEST`.

## 11. Review fixes (round 1)

Reviewer verdict: PASS WITH FIXES (40 mutants, 38 killed; the two survivors were test gaps). Fixes
in `c2d1fba`, nothing outside the three findings.

- **F1** (`mapping.ts` 404 guard untested): added "404 with a status 1 product body"
  (`{"status":1,"product":{"product_name":"X"}}`) to the `UPSTREAM_MALFORMED` table in
  `mapping.test.ts`. With the guard deleted, that case now fails.
- **F2** (`en:molluscs` removable unnoticed): `off-lookup-contracts-consistency.test.ts` now pins
  `OFF_ALLERGEN_TAG_MAP` with an exact `toEqual` of all ten entries. With the molluscs entry
  deleted, it fails.
- **F3** (two cache entries for one GTIN): the cache and in-flight key is now
  `cacheKey(code)`, the 13-digit form for 9 to 13 digits (`padStart(13, "0")`), EAN-8 unchanged.
  A shared entry answers each caller with its own identity (`id` and `codes` restamped to the code
  that caller asked for), so which spelling filled the cache never decides another caller's
  `productId`. New tests: the 12 and 13 digit spellings resolve with one upstream request, in
  sequence and concurrently, each with its own `id`; `cacheKey` shape. With the key reverted to the
  raw code, both fail.

Each fix was checked against its mutant: the three mutations applied together failed 4 tests; files
restored from git afterwards.

**Architect rulings recorded:** no-name as `not-found` accepted (backlog: `product_name_en`
fallback); NOT_RUN before the household loads accepted; tier chips on name, brand and size accepted
(§3.3 sentence added at acceptance); GTIN-14 and check-digit handling accepted (backlog: UPC-E
expansion, GTIN-14 code type); 12 per minute and the 60 s cooldown accepted, the ticket's 100
corrected at acceptance. The M3-T4e questions, plus the per-100 ml basis finding, are listed at the
top of section 9.

**Re-verification** from an empty build state (every `dist/` and `*.tsbuildinfo` deleted), CI order,
network-blocking preload on both suite runs: see the numbers below.

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test`, no `DATABASE_URL`, network blocked | exit 0: 119 files passed, 1 skipped; 1875 passed, 351 skipped (was 1870: +5 new tests) |
| `pnpm test`, `DATABASE_URL` on a fresh throwaway PG17 cluster, network blocked | exit 0: 119 files passed, 1 skipped; 2206 passed, 20 skipped (was 2201) |
| block-net log, each run | shim loaded into 127 processes, 0 blocked connections |
| `pnpm format:check` | exit 0 |
| `pnpm --filter mobile export` | exit 0; `apps/mobile/dist` deleted |
| cluster | stopped, data directory removed |
