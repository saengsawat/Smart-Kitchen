# M3-T4e worker report: `lookupProduct` over HTTP and the scan sheet on live OFF data

Branch `m3-t4e-lookup-http`, cut from `main` at `8d1217b` (M3-T4d, latest at dispatch).
Implementation model: Sonnet, as the ticket says. No architecture conflict found: nothing in
the ticket asked to touch an ADR, DECISIONS.md or a contracts basis (the `PER_100ML` basis stays
out of scope, per the ticket's own "Out of scope" line).

## 1. What was built, per objective letter

**(a) Wiring.** `HttpApiClient.lookupProduct(code)` (`apps/mobile/src/api/client.ts`) now calls
`GET /v1/products/{code}` (via `productLookupPath` from contracts) with the bearer token.
`hit`/`not-found`/200-`error` outcomes pass through as the DTO says, `screening` included,
never re-derived. A non-2xx response throws a new `ProductLookupRefusedError` (carries only the
wire code, same discipline as `LedgerRefusedError`), which `src/scan/product-lookup-errors.ts`'s
`messageForLookupError` maps to copy-deck §8's product-lookup strings for `PLU_NOT_SUPPORTED`/
`BAD_REQUEST`, and to the existing generic fallback for 401/403/5xx/anything else. `app/add/
scan.tsx`'s `handleCode` catch block uses `messageForLookupError` instead of
`messageForLedgerError`; the 200-`error` outcome branch (previously marked "unreachable", now
genuinely reachable) renders `LOOKUP_UPSTREAM_ERROR_MESSAGE`. S7's camera screen gained an
"Enter it manually" button inside the lookup-error box itself (previously only the miss/
permission-denied panels had one), retaining whichever code the refused attempt used - a camera
scan's code, not just a typed one, via a new `lastAttemptedCode` state.

**(b) Nutrition strip.** New `apps/mobile/src/scan/nutrition.ts`: `selectNutritionProfile`
(PER_SERVING over PER_100G, else neither), `NUTRITION_BASIS_LABEL` ("per serving"/"per 100 g"),
`roundForDisplay` (whole calories, one decimal for grams/mg, `undefined` in → `undefined` out).
`app/add/scan.tsx`'s `ConfirmSheet` now renders exactly one profile with its basis named in the
existing helper caption, rounds every macro through `roundForDisplay`, and renders
`NUTRITION_NOT_ON_FILE_TEXT` ("Nutrition not on file") with no numbers when there is none.
Storage/wire values are untouched; rounding is display-only (rule 7).

**(c) Adapter rule.** `packages/adapters/src/product-lookup/open-food-facts/config.ts` adds
`nutrition_data_per` to `OFF_PRODUCT_FIELDS`. `mapping.ts`'s `nutritionProfiles` now takes the
raw `nutrition_data_per` value and skips the `PER_100G` profile unless it is exactly `"100g"`
(absent, `"100ml"`, `"serving"`, anything else all suppress it); `PER_SERVING` is unaffected.

**(d) Quantity tier.** New `planScanQuantity` (`apps/mobile/src/scan/quantity.ts`, pure,
directly tested): count × package size when the size exists and its unit is accepted, tier =
the package size's own tier (never raised past it); no package size at all → count in "each",
Known Fact (the user physically counted). `handleAdd` uses the returned tier for
`quantityProvenance.tier` and the toast's tier word (`"Estimated"` or `"Known Fact"`), replacing
the old hardcoded `"Known Fact"`.

**(e) Unsupported package units.** Same `planScanQuantity`: when a package size exists but its
(normalized) unit is not in `CREATE_ITEM_UNITS_DTO` (`pt`, `qt`, `gal`, `fl oz`, anything
unparsed), the item is recorded as the chosen count of packages, unit `each`, tier fixed
`ESTIMATED`. `ConfirmSheet` shows the record's own size as `"{count} × {qty} {unit}"` text in
that case (e.g. "1 × 1 qt"), never the bare size alone, and it updates live as the stepper
changes. `isCreateItemUnit` (also in `quantity.ts`) is the one client-visible source of truth
for "does the ledger accept this unit" - never a domain-registry lookup client-side.

**(f) Held key + single-flight on Add.** `ScanScreen` gained `heldIdempotencyKey`
(`useRef<string|null>`) and `addInFlight` (`useRef<boolean>`) plus an `adding` state for the
visible disable, mirroring `app/add/manual.tsx`'s F3 pattern exactly: one key per confirm
attempt, reused on a retap after failure, discarded on any real input change (count or location,
via new `updateCount`/`updateLocation` wrappers around the raw setters) or on a fresh scan.

**(g) Fixture path.** Unchanged in behaviour: `FixtureApiClient.lookupProduct` still delegates
to `fixture-products.ts`, whose three corpus records already carry `RUN` screening and
`KNOWN_FACT` label fields (manufacturer-label provenance), so `planScanQuantity` resolves them
to the same Known Fact tier they always got. Confirmed by the existing 35 S7/S8 component tests
(all still green) plus a new regression test pinning this explicitly (§5 below).

## 2. Exact strings rendered for each refusal, and the toast tier words

Product-lookup refusals (`apps/mobile/src/scan/product-lookup-errors.ts`, copy-deck §8
verbatim, unchanged from what the deck already had):

- `PLU_NOT_SUPPORTED` (400): "Produce codes can't be looked up by barcode yet. Add this item by
  hand."
- `BAD_REQUEST` on the lookup route (400): "That isn't a barcode number we can look up."
- 200 `error` outcome (upstream trouble): "The product database didn't answer. Try again in a
  moment, or add the item by hand."
- Everything else (401/403, an unrecognised code, a plain network failure): falls through to
  the existing generic fallback, "Something went wrong saving that. Try again, and tell us if
  it keeps happening." (see §6, judgment call 1, for why this one and not the newer "loading"
  fallback).
- `not-found`: unchanged, the existing S7 miss panel.

Toast tier word (Add success, `app/add/scan.tsx`): `` `Added ${count} × ${name} to ${location} ·
${tierWord}` `` where `tierWord` is `"Known Fact"` or `"Estimated"`, following the quantity
tier `planScanQuantity` returns - never hardcoded.

## 3. Nutrition and quantity rules as implemented

**Nutrition basis and rounding:**

| Situation | Profile shown | Basis label | Rounding |
|---|---|---|---|
| Both PER_SERVING and PER_100G present | PER_SERVING | "per serving" | whole cal, 1dp g/mg |
| Only PER_100G present, `nutrition_data_per: "100g"` | PER_100G | "per 100 g" | same |
| `nutrition_data_per` is `"100ml"`, absent, or anything but `"100g"` | none (PER_100G suppressed) | - | - |
| No profile at all | none | - | "Nutrition not on file", no numbers |

**Quantity tier:**

| Package size | Unit accepted by the ledger | Item unit | Amount | Tier |
|---|---|---|---|---|
| Present, tier X | Yes | the record's own unit | count × size | X (the package size's own tier) |
| Present, tier X | No (`pt`/`qt`/`gal`/`fl oz`/unparsed) | `each` | count | `ESTIMATED` (fixed) |
| Absent | n/a | `each` | count | `KNOWN_FACT` |

`X` is `KNOWN_FACT` for the fixture corpus (manufacturer-label provenance) and `ESTIMATED` for
every live Open Food Facts record (D-025: OFF is always Estimated), so in practice a supported
OFF package size gives an Estimated quantity and the fixture corpus is unaffected - pinned by
a regression test (§5).

## 4. What was seen against live/replayed OFF data, versus tests only

**Automated suite:** everything in §5 below is covered by tests; none of it opened a network
connection during `pnpm test`.

**What I actually ran and watched (not just tests), described here since no browser is
available in this sandbox (see the honest limitation right below):**

- A throwaway PostgreSQL 17 cluster (CONTRIBUTING.md's native recipe, port 55432), migrated,
  built, seeded (`pnpm --filter api db:seed:fixture`).
- The real `apps/api` server (`node apps/api/dist/server.js`, `SK_IDENTITY=fixture`,
  `DATABASE_URL` pointed at that cluster) running against a **local stub** that replays this
  ticket's own recorded OFF fixtures verbatim (never a live OFF request during this walk - the
  two live OFF requests this ticket made are the staging captures in §5/§6, not this walk).
- `GET /v1/products/{code}` over real HTTP, through the real route/adapter/mapping code, for:
  - the peanut-butter fixture (096619555505): `hit`, `nutrition` = `["PER_SERVING"]` only - no
    `PER_100G`, confirming the "absent emits nothing" rule end to end, not just in a unit test.
  - the liquid Ripple fixture (855643006045, `nutrition_data_per: "100ml"`): `hit`, `nutrition`
    = `["PER_SERVING"]` only, `packageSize` absent (still unparseable "48 fl oz") - confirming
    the "100ml emits nothing" rule against a genuine per-100-ml record end to end.
  - a 4/5-digit PLU code: 400 `PLU_NOT_SUPPORTED` with the exact §8 message.
  - a non-barcode string: 400 `BAD_REQUEST` with the exact §8 message.
  - a valid-check-digit code the stub answers 503 for: 200 `error` with the exact §8 upstream
    message, never the raw "upstream simulated outage" text.
  - an unrecognised valid code: `not-found`.
  - no `Authorization` header: 401.
- `POST /v1/inventory/items` over real HTTP, mirroring exactly what `handleAdd` sends for the
  peanut-butter hit above (packageSize `793.8 g`, `quantityProvenance.tier: "ESTIMATED"`,
  `productRef: "096619555505"`): **201**, and the created row's
  `provenance.quantity.tier` came back `"ESTIMATED"` from the real ledger - not asserted by me,
  read straight off the server's own response.
- `GET /v1/inventory/items` (S4) and `GET /v1/inventory/items/{id}` (S5) both showed that same
  row afterward, S4's `provenance.quantity.tier` still `"ESTIMATED"` and S5's `history[0]` a
  `PURCHASE` row with `provenance.tier: "ESTIMATED"` - the acceptance criterion ("an Estimated
  quantity that S4 lists and S5's history shows with its tier") verified against the real
  ledger, not a fixture.
- A double-tap idempotency check: the same `POST /v1/inventory/items` body/key sent twice over
  real HTTP returned 201 then 200, and exactly one item exists with that name afterward.
- Everything was torn down afterward: API process and stub killed, `pg_ctl stop`, the scratch
  data directory removed, ports confirmed free by `netstat`.

**What I could not do (rule 19, said plainly): there is no browser or browser-automation tool
in this sandbox** (no Playwright/Puppeteer in the repo, no browser tool available to me as the
agent). I did not press "w" in Expo or look at rendered pixels; I cannot confirm the nutrition
strip's on-screen layout, the "N × qty unit" text's visual placement, or the "Enter it manually"
button's tap target against a real render. What I verified instead is the real server-side
behaviour (API + Postgres + a stubbed OFF) end to end over HTTP, which the client-side component
tests (§5) then exercise against - the same DTOs, same strings, same codes. The architect/PO
should treat the actual rendered screen as still owed a device or `expo start --web` pass by
someone with a browser, same as the repo's other outstanding "real-device camera pass".

## 5. Verification

**Empty build state, CI order** (all from a clean worktree, in this exact order):

```
rm -rf apps/api/dist apps/mobile/dist packages/adapters/dist packages/contracts/dist \
  packages/domain/dist apps/api/tsconfig.tsbuildinfo packages/adapters/tsconfig.tsbuildinfo \
  packages/contracts/tsconfig.tsbuildinfo packages/domain/tsconfig.tsbuildinfo
pnpm install --frozen-lockfile   # Lockfile up to date, resolution step skipped
pnpm lint                        # clean
pnpm typecheck                   # tsc -b --pretty, clean, builds every dist
pnpm test                        # 1980 passed, 356 skipped (DATABASE_URL unset, loud skip notices)
pnpm format:check                # All matched files use Prettier code style!
pnpm --filter mobile export      # web/android/ios all bundled; output deleted afterward
```

Ran a second time after the live-server walk below (which rebuilt `apps/api/dist`) to confirm
nothing regressed: same result, 1980 passed.

**Test count for this ticket specifically** (`git diff 8d1217b HEAD --stat -- '*.test.ts'`):
7 test files touched, +767/-17 lines. Two wholly new files: `src/scan/nutrition.test.ts` (8
tests) and `src/scan/product-lookup-errors.test.ts` (5 tests). Everything required by the
ticket's "Tests required" list is covered:

- fake-fetch `lookupProduct` tests (hit/not-found/error/400 PLU/400 bad/401/500, screening
  passthrough, no message leak) - `apps/mobile/src/api/client.test.ts`.
- adapter `nutrition_data_per` test (100g emits, 100ml emits nothing, absent emits nothing),
  both as synthetic bodies and against the real recorded liquid fixture - `packages/adapters/
  .../mapping.test.ts`.
- nutrition display tests (profile choice, basis label, rounding, absent):
  `apps/mobile/src/scan/nutrition.test.ts` (pure) and `scan-screen.test.ts` (rendered).
- quantity tier tests (Known Fact size → Known Fact, Estimated size → Estimated, toast word
  follows, no-package-size stays Known Fact) - `quantity.test.ts` (pure) and
  `scan-screen.test.ts` (rendered + toast).
- unsupported-unit fallback tests (qt/pt/gal/fl oz, display text, tier, unit):
  `quantity.test.ts` and `scan-screen.test.ts`.
- held-key and double-tap tests on S8 - `scan-screen.test.ts`, three tests mirroring
  `manual-screen.test.ts`'s F3 coverage exactly.
- S8 component tests on a recorded OFF fixture - the existing NOT_RUN describe block, untouched
  and still green (drift/fixture tests unchanged, objective (g)).

**Live-server walk:** described in full in §4. Two live requests to OFF's staging host this
ticket made in total (both while capturing the new fixture, §6) - the browser-walk stand-in
above used only the local stub, spending none of that budget.

## 6. Deviations and judgment calls

1. **401/403/unrecognised-refusal-code and any plain network failure during `lookupProduct`
   render the existing "…saving that…" generic fallback, not the newer "…loading that…" read
   fallback.** The ticket says "401/403 and other failures render the §8 generic fallback"
   without naming which of the two generic strings now in the deck. `messageForLookupError`
   falls through to `messageForLedgerError`, preserving `handleCode`'s pre-existing catch-all
   behaviour byte for byte (a test from M3-T4b/review F14 already pins the exact "saving that"
   string for a raw network `Error` here) rather than switching to `GENERIC_READ_ERROR_MESSAGE`,
   which this screen has never shown. Flagged for the reviewer to confirm or correct; changing
   it is a one-line fix in `product-lookup-errors.ts`'s default case if the architect wants the
   read-fallback instead.
2. **A liquid fixture was captured for real (2 requests to OFF staging), within the ticket's
   "at most two requests" allowance.** One throwaway connectivity check (`fields=code` only,
   not saved) plus one real capture of the same product `unparseable-quantity-ripple.json`
   already had (855643006045, Ripple Dairy-Free Milk), re-requested with the updated field list
   to get its real `nutrition_data_per` value. It came back `"100ml"`, confirmed for real rather
   than assumed. Saved as `tests/fixtures/off/liquid-per-100ml-ripple.json`; the existing
   `unparseable-quantity-ripple.json` is untouched.
3. **The full-peanut-butter fixture's "per-100g and per-serving" test now asserts per-serving
   only.** That recording predates `nutrition_data_per` joining the field list, so the field is
   genuinely absent from it - under the new rule that is "not 100g", so no `PER_100G` profile
   emits, even though the product is a solid. This is the correct, conservative reading of the
   ticket's own "absent emits nothing" requirement, not a bug; documented inline in the test.
4. **"Enter it manually" was added to S7's inline lookup-error box**, a small UI addition the
   ticket's Objective (a) parenthetical asked for ("with 'Enter it manually' still offered")
   that the pre-existing error box did not have (only the separate miss/permission-denied panels
   did). Tracks whichever code the refused attempt used (typed or scanned) via a new
   `lastAttemptedCode` state, since `typedCode` alone misses a camera scan.
5. **`heldIdempotencyKey`/`addInFlight`/`adding` live in `ScanScreen` (the parent), not
   `ConfirmSheet`.** `count`/`location` already lived there; keeping the held-key state next to
   the values it is keyed on avoids threading three more refs/state through `ConfirmSheet`'s
   props for no behavioural difference (`ConfirmSheet` only needs the resulting `adding`
   boolean to disable Add).
6. **`isCreateItemUnit`/`planScanQuantity` moved into `src/scan/quantity.ts`, not left in
   `scan.tsx`.** Both are pure and directly unit-tested there (matching `decimalAmountToMicros`/
   `packageQuantityMicros` already in that file), avoiding a component-level duplicate of the
   `CREATE_ITEM_UNITS_DTO.includes(...)` check the package-size *display* logic also needs.

## 7. What the reviewer should attack first

1. **The tier-raise invariant.** Confirm `planScanQuantity` never returns `KNOWN_FACT` when the
   package size itself is `ESTIMATED` or `AI_INTERPRETATION` (the `packageSize.tier ===
   "KNOWN_FACT" ? "KNOWN_FACT" : "ESTIMATED"` line) - this is the single most important line in
   the ticket.
2. **The nutrition_data_per gate's default.** Re-derive independently whether "absent" should
   really mean "not 100g" (my reading, and the ticket's "Tests required" line says so
   explicitly) versus "assume 100g, since that's OFF's own contributor default for most
   products" - I went with the stricter reading and it changes an existing fixture's expected
   output (§6.3); worth a second opinion given how safety-sensitive nutrition mislabeling is.
3. **Judgment call 1 in §6** (which generic fallback a refused lookup other than PLU/BAD_REQUEST
   should show) - a real product decision, not just a style question, since the read/save
   fallback split was added for a reason at M3-T5.
4. **Double-tap safety net.** `addInFlight`'s ref-based guard plus the server's own idempotency
   key together should make a double Add impossible even if one layer failed; the reviewer
   should try to find a gap between them (e.g. two different keys reaching the server in the
   same request race) the way M3-T4d review F3 did for `manual.tsx`.
5. **The "N × qty unit" display for unsupported units** - confirm it cannot be mistaken for the
   item's actual stored unit (it reads "1 × 1 qt" right next to an Add button labelled "Add 1 to
   Fridge", which is genuinely 1 *each*, not 1 qt; I judged this unambiguous given the tier chip
   sitting next to it, but it's a UI-safety call worth a second look).

## 8. Escalations and proposed backlog entries

- **`apps/mobile/README.md`'s "Running barcode lookups against the API" section is now stale**
  ("Until M3-T4e wires `HttpApiClient.lookupProduct` to that endpoint, the app's scan screen
  still uses the four fixture barcodes"). Not in this ticket's file scope to edit; proposed for
  the architect to update at acceptance alongside any other M3-T4e doc landing.
- **M4/follow-up:** a `PER_100ML` contracts basis (ADR-006 open item) would let a liquid's real
  per-100-ml figures reach S8 someday instead of showing nothing; explicitly out of this
  ticket's scope per its own "Out of scope" line, re-flagged here since the new liquid fixture
  makes the gap concrete.
- **Maintenance:** `docs/design/copy-deck.md`'s S8 section (§7) does not yet mention the
  nutrition basis label or "Nutrition not on file" - both strings are UI text this ticket
  introduced under the ConfirmSheet's existing helper-caption convention, not full copy-deck
  entries (see §9). If the architect wants them formalised as binding deck strings, that is a
  small doc-only follow-up.

## 9. Proposed copy-deck strings

No new copy-deck string is required: every refusal string this ticket renders (`PLU_NOT_SUPPORTED`,
`BAD_REQUEST`, the lookup `error` outcome) was already added to copy-deck §8 at M2-T4a
acceptance and is reused verbatim (§2 above). The nutrition basis label ("per serving"/
"per 100 g") and "Nutrition not on file" are new UI strings but were fully specified, verbatim,
by the ticket's own Objective (b) text - nothing was invented here that copy-deck does not
already effectively dictate. If the architect wants them promoted into copy-deck §7's S8
section as a formal record (they currently live only in `src/scan/nutrition.ts`'s exported
constants), the exact text to add would be:

> **Nutrition basis:** the strip shows one profile, PER_SERVING when the record has it, else
> PER_100G, labelled inline ("per serving" / "per 100 g"); "Nutrition not on file" with no
> numbers when neither exists.
