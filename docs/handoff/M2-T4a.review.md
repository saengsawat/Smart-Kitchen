# M2-T4a review: product lookup over Open Food Facts

Reviewer: Opus (independent session, read-only). Base: origin/main 32abd27. Branch: m2-t4a-off-lookup @ e5066e6.

## Round 1 verdict: PASS WITH FIXES

The data boundary holds. Nothing from OFF reaches the record or the wire as KNOWN_FACT. The only provenance object in the mapper is a single `ESTIMATED`/`open-food-facts` constant, and the route passes tiers through unchanged. No declaration field exists on the item, so an OFF-only product cannot screen `ALLOWED`. 429, 5xx, timeout, network failure, malformed JSON and a wrong-code answer are all `error`. PLUs never reach the port. The suite made zero non-loopback connections under the reviewer's own socket and fetch shim. 40 mutants were run against the new code and 38 were killed; the two survivors are test gaps, not behaviour bugs, and one of them is allergen-relevant: the `en:molluscs -> shellfish` mapping can be deleted with every test still green.

## Findings

- **F1 [minor, fix before merge]** `packages/adapters/src/product-lookup/open-food-facts/mapping.ts:115-120`. The "404 without OFF's miss body is error" guard can be deleted with no test failing (the existing 404 cases still hit the later `status !== 1` branch). The body that tells them apart is `404` plus `{"status":1,"product":{"product_name":"X"}}`: with the guard deleted, that becomes a `hit`. Fix: add that case to the `UPSTREAM_MALFORMED` table in `mapping.test.ts`.
- **F2 [minor, fix before merge; allergen-relevant]** `allergen-tag-map.ts:46` (`"en:molluscs": "shellfish"`). Deleting this entry survives the whole suite; the consistency test only checks that shellfish is covered, and `en:crustaceans` already covers it. With the entry gone a mollusc CONTAINS tag passes through raw and becomes an unknown; once M2-T4 runs the engine, a shellfish-allergic member would get `ALLOWED_WITH_UNKNOWNS` instead of `BLOCKED` (D-017 P2). Fix: pin the map with an exact `toEqual` of all entries in `off-lookup-contracts-consistency.test.ts`.
- **F3 [minor]** `open-food-facts-port.ts:132-141`. Cache and in-flight keys are the raw code string, so `096619555505` (UPC-A) and `0096619555505` (EAN-13, also what a GTIN-14 with indicator 0 becomes) are separate entries: two OFF reads and two budget slots for one product (reproduced against the compiled API). No safety impact. Fix: key on the 13-digit form.
- **F4 [minor, next ticket]** `mapping.ts:250-262`. OFF's `_100g` values mean per 100 ml for liquids; the adapter labels them `PER_100G`, so liquid products go out with the wrong basis. Nothing renders them today (client lookup is M3-T4e). Record a `PER_100ML` basis decision before any nutrition arithmetic or display uses OFF data (rule 7).
- **F5 [minor, doc ruling]** `apps/mobile/app/add/scan.tsx` (tier chips on name, brand and size). Fixture products now show "✓ Fact" on label fields; copy-deck §3.3 says Known Fact on this surface is scoped to product identity. The chip truthfully reports the record's tier (725 of 739 fixture provenances are KNOWN_FACT) and §4/P2 require every fallible fact to wear a chip. Recommendation: keep the chips, add one sentence to §3.3.
- **F6 [minor, backlog]** `apps/api/src/products/lookup-service.ts:167-183`. UPC-E is not handled: an 8-digit UPC-E typed from a US small pack is checked as EAN-8 and usually answers 400. `SCANNABLE_BARCODE_TYPES_DTO` does not scan `upc_e` either, so not a regression. Backlog: expand UPC-E to UPC-A server-side and add `upc_e` to the scanner types.

## Acceptance criteria check
- Real barcode on S8 via `EXPO_PUBLIC_API_URL`: not met in this ticket, by design (the HTTP client's `lookupProduct` still rejects until M3-T4e). The server half is verified: a compiled-API curl returns every field `ESTIMATED` and screening `NOT_RUN`. S8's NOT_RUN row is verified by component tests only; no device run.
- Staging real-barcode check by hand: reported by the worker (Nutella on `world.openfoodfacts.net`); not re-verified, the reviewer made no OFF calls.
- Unknown code is `not-found` with the code kept: met (curl and tests).
- PLU answers 400: met (curl `4011` gives 400 `PLU_NOT_SUPPORTED`; the stub saw no request).
- Simulated 429 and timeout answer `error`: met (curl 429 gave `UPSTREAM_RATE_LIMITED`; a stub stalling 8 s gave `error` after 5.06 s with `UPSTREAM_TIMEOUT` logged).
- HTTP matrix for the four tokens: met (tests plus curls: Dean and Maya 200, `fixture.new.user` 403, no token 401).
- Fixture app still renders the three verdict states: met.
- Drift test green: met.
- DB and non-DB suites green from an empty build state: met.
- Nothing in CI touched the network: met (reviewer's shim, 0 blocks; the live test is `describe.skipIf(SK_OFF_LIVE_TEST !== "1")`; no `SK_OFF*` in `.github/`).

## Invariants check
- No OFF field is KNOWN_FACT except the code match: pinned ("every provenance is ESTIMATED", route shape test; mutants M06, M07 killed).
- No completeness declaration from OFF: structural (no `declaration` field on the item); pinned by the "never reaches ALLOWED" test over every recording for severe and standard members and the "no declaration key" test.
- Missing allergen field is absence of data: pinned (`no-allergen-fields-almond-breeze`, every restriction stays unknown); a non-array allergen field is `UPSTREAM_MALFORMED` (M10 killed).
- 429/5xx/timeout/malformed are never `not-found`: pinned (M01, M02, M24, M31 killed); the 404-with-status-1 case unpinned (F1).
- Unmapped tags pass through raw and fail closed: pinned (M16 killed); an individual map entry can be dropped unnoticed (F2).
- Suite never opens a network connection to OFF: verified by the reviewer's run.
- NOT_RUN never reads as a verdict or uses red or green: pinned (M32 green glyph, M33 blocked style, M34 NOT_RUN blocks Add, M35 ALLOWED wording, all killed).
- No PLU reaches OFF: pinned at the route (M28) and in the port (M25).
- Throttle 12 per rolling 60 s and the 60 s cooldown after 429 or 503: pinned with a fake clock (M17, M18, M20 off-by-one, M19 throttle off, M21 no cooldown on 503, all killed).
- Cache TTL, bound and errors-never-cached: pinned (M22, M23, M26, M27 killed).
- No persisted product data: structural (in-memory `TtlCache`; the route opens no tenant session, asserted).
- No secrets: `.env.example` names only; the staging `off:off` pair is published by OFF and sent only to the staging host (M40 killed); the default User-Agent has no email.
- No em dashes in UI text: pinned by a test on the NOT_RUN string.

## Scope deviations: ruling recommendation per file
- `apps/api/package.json`, `apps/api/tsconfig.json`, `pnpm-lock.yaml`: accept. The lockfile gains exactly one `link:../../packages/adapters` importer entry and no outside package; `--frozen-lockfile` passes.
- `packages/adapters/src/contracts-consistency/screening-fixtures-consistency.test.ts`: accept, not weakened (also asserts `status === "RUN"`; the inner-verdict check still runs).
- `apps/mobile/src/api/client.test.ts`: accept; one assertion around line 797 (`screening.verdict` to `{ status: "RUN", result: { verdict } }`); a one-line merge touch against M3-T4d.
- Nothing else outside scope; the only `docs/**` change is the worker report.

## Judgment calls
- No product name maps to not-found: accept (nothing invented; the miss path keeps the code; `not-found` claims nothing about allergens). Backlog: fall back to `product_name_en`.
- NOT_RUN renders before the household loads: accept (names nobody; a loading line would falsely claim a check in progress; Add keeps its household gate).
- Tier chips on name, brand and size: accept, with the §3.3 note (F5).
- GTIN-14 and the check digit: accept (indicator 0 is the EAN-13 per OFF's normalisation; scanners validate check digits themselves; a typed typo is refused instead of looking up a wrong product; manual add stays open). UPC-E is the real gap (F6).
- 12 per minute and the 60 s back-off: accept. OFF's API page (checked 2026-09-29) reads "15 req/min/IP address for all read product queries (GET /api/v*/product requests or product page)" and 10 per minute for search; the ticket's 100 was wrong. The page also confirms the `AppName/Version (ContactEmail)` User-Agent requirement and the staging host `world.openfoodfacts.net` with basic auth off/off. Refusing instead of queueing is right.

## M3-T4e / M2-T4 questions: this ticket or next
- Nutrition strip unrounded, no basis label, PER_100G first: M3-T4e, blocking there (pick the profile, round it, label the basis; take F4 per-100 ml with it).
- Add records quantity as Known Fact and toasts "· Known Fact" when package size is Estimated: M3-T4e, blocking there (a rule-8 tier error the moment lookup is wired).
- Error bodies (400 `PLU_NOT_SUPPORTED`, `BAD_REQUEST`, the `error` body) to §8 strings: M3-T4e.
- pt/qt/gal refused by item creation: M3-T4e (unit mapping or manual-add fallback).
- Non-English `ingredients_text`: M2-T4 (gate text matching on OFF's `lang`, or treat non-English text as not read; tags still apply).
- Net vs total carbs, multi-process throttle, OFF usage form and a contact email in the User-Agent (PO, rule 17): backlog.

## Verification
All runs from an empty build state (no `dist/`, no `*.tsbuildinfo` before starting).
- `pnpm install --frozen-lockfile`: ok. `pnpm lint`: exit 0. `pnpm typecheck`: exit 0.
- `pnpm test` without `DATABASE_URL`: 119 files passed, 1 skipped (the live test); **1870 passed, 351 skipped**.
- `pnpm test` with `DATABASE_URL` on a throwaway PG17 cluster (port 55433): **2201 passed, 20 skipped**. Both match the worker.
- `pnpm format:check`: clean. `pnpm --filter mobile export`: exit 0 (web, iOS, Android); output deleted. Cluster stopped, data directory removed.
- Network-free proof: a reviewer-written preload (`--import` via `NODE_OPTIONS`) patching `net.Socket.prototype.connect`, `dns.lookup` and global `fetch` to throw or record on any non-loopback host; sanity-checked against world.openfoodfacts.org (blocked and logged); loaded into 127 processes per suite run; the block log was never created, so 0 attempts.
- Recordings: all seven carry `capturedAt` 2026-09-29 and host `https://world.openfoodfacts.org`; bodies match OFF's v2 schema and carry OFF-added fields consistent with real captures.
- Mutation run: 40 mutants over the new files, 38 killed, 2 survived (F1, F2). Worktree restored, `git status` clean.
- Compiled API against a stub replaying the recordings (`SK_OFF_BASE_URL=http://127.0.0.1:4011`): hit 200 all ESTIMATED with `recordedAt` from `last_modified_t`, NOT_RUN, repeat served from cache; miss 200 not-found with the code kept; `4011` 400 with no stub request; bad check digit 400; GTIN-14 with indicator 1 400; stub 429 gives `error` `UPSTREAM_RATE_LIMITED` and the next three lookups refused inside the cooldown without sending; after the cooldown a stalled stub gives `error` in 5.06 s with `UPSTREAM_TIMEOUT`; the stub saw the twelve-field URL, the default User-Agent and no Authorization header; the API log carries only `productCode`, `outcome` and `lookupError`. Server and stub stopped. No requests to OFF by the reviewer.

## Notes for the architect
- ADR-006: adopt the worker's §10 tier-policy wording and the R-4 note; add that `_100g` is per 100 ml for liquids and basis handling is open (F4).
- Ticket M2-T4a: correct the rate limit to 15 per minute per IP (OFF API page, checked 2026-09-29); throttle 12 per rolling minute per process, 60 s cooldown after 429 or 503.
- Copy-deck §3.3: "Label fields (name, brand, size) wear their own tier chip; from a live source they read Estimated; only the identity chip is Known Fact." NOT_RUN tone note: leads with the neutral glyph in the secondary ink.
- Backlog endorsed: M3-T4e blocking items (profile, rounding and basis; quantity tier and toast; §8 error mapping; pt/qt/gal); cache key normalisation (F3); UPC-E (F6); GTIN-14 code type; `product_name_en` fallback; M2-T4 language gate; net vs total carbs; `PER_100ML`; multi-process throttle; OFF usage form (PO, rule 17); v3 migration (low).

## Architect rulings on round 1 (2026-09-29)
- F1, F2, F3: fix in round 1 (two test additions and the cache key), then a scoped re-check by the same reviewer.
- Judgment calls accepted as the reviewer recommends; the ticket's rate-limit figure was the architect's error and is corrected at acceptance.
- The M3-T4e items are lifted into that ticket as blocking requirements; F4 (per 100 ml) with them.
