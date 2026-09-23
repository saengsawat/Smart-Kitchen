# M3-T4b worker report: Add food (S6 hub, S7 camera scan, S8 scan confirm with the allergen row, S9 manual add, fixture lookup and item creation)

Branch `m3-t4b-add-food`, on top of `dd3a88d`. First pass: seven commits plus
this report (`ba4e2bf`), submitted for review. **Independent Opus review
returned FAIL** on a safety defect (fixture verdicts derived by hand, not by
the engine) with the rest endorsed; §9 below is the fix round, eight more
commits addressing every finding (F1-F18) plus the architect's rulings.

## 1. What was built

**(a) Contracts.** `packages/contracts/src/allergens.ts` (new): `ScreeningVerdictDto`,
`UnknownReasonDto`, `WarningCodeDto`, `WarningSeverityDto`, `EvidenceKindDto` and the
evidence/unknown/warning/member/result shapes, hand-mirrored from `packages/domain/src/allergens/
types.ts`, `RestrictionSeverityDto` reused from `household.ts`. `products.ts` (new):
`ScannedProductDto`, `ProductLookupResultDto`, `ProductCodeTypeDto` (mirrors adapters' `CodeType`),
`SCANNABLE_BARCODE_TYPES_DTO` (the three barcode symbologies the camera scans for).
`inventory.ts` gains `CreateItemRequestDto`/`CreateItemSourceDto`. `units.ts` (new): `UnitKindDto`,
`UNITS_BY_KIND_DTO` mirrored from the M1-T3 registry, restricted to mass (g/kg/oz/lb), volume
(ml/l/tsp/tbsp/cup — **`fl oz` omitted, see §5**) and count (each).

**(b) Consistency tests.** `packages/adapters/src/contracts-consistency/`: `allergens-contracts-
consistency.test.ts` proves the four allergen unions plus `WarningSeverity` by compile-time
exhaustive switch (the domain exports no runtime array for any of these — confirmed by reading
`domain/src/index.ts`'s barrel, only the *types* cross for `ScreeningVerdict`/`UnknownReason`/
`WarningCode`/`EvidenceKind`/`WarningSeverity`), plus a light regression net that exercises the real
`screenSubject` engine for a representative sample (all three verdicts, one `EvidenceKind`, one
`UnknownReason`, `NO_SAFETY_GUARANTEE` and `SEVERE_ALLERGY_UNKNOWN_DATA`). `units-contracts-
consistency.test.ts` proves every restricted unit symbol resolves via the domain's real `lookupUnit`
to the claimed kind (a genuine runtime check, since the unit registry is a real table).
`products-contracts-consistency.test.ts` is the same exhaustive-switch pattern for
`ProductCodeTypeDto` against adapters' own `CodeType`.

**(c) Fixture product lookup + screening data.** `apps/mobile/src/scan/fixture-products.ts`: three
hand-authored `ScannedProductDto` + `ScreeningResultDto` literals (derivations in §2 below and in
that file's own doc comments), plus the prototype's miss code. **No allergen engine runs in the
client** — `apps/mobile` imports neither `@smart-kitchen/domain` nor `@smart-kitchen/adapters`
(the latter's own `FixtureProductLookupPort` reads the fixture corpus off disk via `node:fs`, which
is exactly what M3-T3 removed from this app to fix `expo export`'s bundle). `allergen-copy.ts`
renders copy-deck.md §3.3's three verdict lines verbatim, keyed off `verdict`/evidence/unknown codes
only, plus §3.1's `UNRECOGNIZED_ALLERGEN_DATA`/`CROSS_CONTACT` strings when present (not exercised by
these three fixtures, but implemented and unit-tested for future ones). `quantity.ts` adds exact
`bigint`-micros math: `packageQuantityMicros` (S8: count × package size) and `wholeUnitQuantityMicros`
(S9), neither ever touching `Number`/`parseFloat`.

**(d) `ApiClient.lookupProduct`/`createItem`.** `FixtureApiClient.lookupProduct` returns the fixture
map's typed result; `createItem` (via a new `ledger.ts` helper, `createFixtureItem`) builds a new item
with one opening lot and appends a `PURCHASE` (barcode) or `INITIAL_STOCK` (manual) row through the
existing `appendIncrease`, so the item is immediately readable through `getInventoryItems`/
`getInventoryItem` exactly like every other fixture item (S4/S5 read paths need no special-casing).
`HttpApiClient` rejects both with a clear "not available yet: the real endpoint lands in M2-T3."
error; both screens route that rejection through the existing `messageForLedgerError`, which already
falls through unrecognised errors to copy-deck.md §8's generic fallback.

**(e) Screens.** `app/add.tsx` (S6): four mode tiles, phase labels exact, the fast-follow/future
tiles explain themselves on tap via a toast built from copy-deck.md §6's own phase definitions
("fast-follow · built after MVP launch, already planned", "future · not yet scheduled") — never
"not in mockup"; "Recently added" reads `src/scan/recently-added.ts`'s session-only list.
`app/add/scan.tsx` (S7 + S8 in one screen, matching the prototype's single `#scr-scan` with its
match/miss/permdenied states rather than splitting into two routes): camera permission requested
once via `useCameraPermissions`, the denied state renders copy-deck.md §7 S7 verbatim with a working
"Open Settings" (`Linking.openSettings()`) and "Enter manually"; a typed-code fallback field works
regardless of permission state; a miss renders the prototype's exact copy and hands off to `/add/
manual` with the code as a route param; the confirm sheet renders the identity Known Fact line,
nutrition strip, the allergen row via `allergen-copy.ts`, best-by with its (fixture-authored,
`ESTIMATED`) tier, a package-count stepper, location chips and an Add CTA that loses its terracotta
background when `BLOCKED` (P5) but still creates the item. `app/add/manual.tsx` (S9): unit-kind chips
driving the unit-symbol row, a stepper, location chips, a name-required gate, the retained-code note
when reached from a miss; manual entries are Known Fact for identity and quantity throughout.

**(f) Test support.** `expo-camera-mock.ts` (new, same pattern as `expo-crypto-mock.ts`): `CameraView`
(a plain host element) and `useCameraPermissions` with test-only `__setMockCameraPermission`/
`__resetMockCameraPermission`, aliased in root `vitest.config.ts`. `react-native-mock.ts` gains a
minimal `Linking.openSettings()` (S7's "Open Settings" action).

**(g) Tests.** New: `quantity.test.ts`, `fixture-products.test.ts`, `allergen-copy.test.ts`,
`scan-screen.test.ts` (permission-denied, miss, all three S8 verdict states including the Add
button's colour and a read-back of the created item's exact quantity/location/ledger row),
`manual-screen.test.ts` (name gate, unit/location selection, a read-back of the created item, the
retained-code note), `no-screening-import.test.ts` (greps the real `apps/mobile/src`/`app` trees for
`screenSubject`/`screenSubjects`/`partitionByVerdict`, independent of the eslint-rule proof
`domain-boundary.test.ts` already carries). Extended `client.test.ts` for both new port methods on
both `FixtureApiClient` and `HttpApiClient`. `copy-scan.test.ts`'s allow-list gained three exact
entries (the §3.3 `ALLOWED` line, the caveat suffix, and the `NO_SAFETY_GUARANTEE` code string — see
that file's own updated doc comment for why each is a negation/machine-code, not a claim). Mobile
suite: 418 tests green (was 375 before this ticket started; +43).

## 2. Hand-derived fixture verdicts, with reasoning

All three are transcribed from the real fixture corpus (`tests/fixtures/products/{dairy-003,
condiment-102,dairy-008}.json`) against the household this ticket specifies: **Dean — no
restrictions; Maya — peanut severe, sesame severe.** Full derivations, with the exact `screen.ts`
code paths cited, live as doc comments on each literal in `fixture-products.ts`; summarised here:

- **Dairy hit, `ALLOWED`** (`060000100025`, "Sunrise Greek Yogurt Plain", milk `CONTAINS` at
  `KNOWN_FACT`/`manufacturer-label`, full ingredient statement). Neither of Maya's restrictions
  (peanut, sesame) match the milk assertion. A US packaged product's `KNOWN_FACT`/manufacturer-label
  allergen tag is treated as licensing a `majorAllergens: COMPLETE_FOR_MAJOR_ALLERGENS` completeness
  declaration at the same tier/source (FALCPA: a label declaring any major allergen must declare all
  nine it contains) — `screen.ts`'s `licensesAbsence` then resolves both restrictions to
  `NO_KNOWN_MATCH` → `ALLOWED`. Household verdict `ALLOWED` (Dean has nothing to violate either).
- **Tahini, `BLOCKED` for Maya** (`060000100810`, sesame `CONTAINS`, ingredient statement "Ground
  sesame seeds."). Maya's sesame restriction matches the `CONTAINS` assertion directly →
  `MATCH` → `BLOCKED`, unconditional (INV-ALRG-1) regardless of any completeness declaration;
  the ingredient text also contains "sesame" as free text, so a second `INGREDIENT_TEXT_TERM`
  evidence entry exists alongside the `ASSERTION_CONTAINS` one, both `matchedText: "sesame"`.
  Peanut resolves `ALLOWED` by the same completeness reasoning as the dairy hit. Household
  verdict `BLOCKED` (worst of Dean `ALLOWED`, Maya `BLOCKED`).
- **Eggs, `ALLOWED_WITH_UNKNOWNS` for Maya's severe sesame (and peanut)** (`060000100070`, egg
  `CONTAINS` only, **no ingredient statement, no completeness declaration on file** — deliberately
  modelled without the FALCPA inference the other two records get, representing a thinner label
  scrape). Neither of Maya's restrictions match egg; with no declaration at all,
  `unknownReasonFor` falls through to `NO_ALLERGEN_DATA` → `UNKNOWN` → `ALLOWED_WITH_UNKNOWNS`,
  carrying `SEVERE_ALLERGY_UNKNOWN_DATA` for each. S8 renders the sesame line specifically
  (`primaryUnknown` picks the first `severe` unknown), matching copy-deck.md §3.3's own worked
  example (Maya/sesame); both restrictions' unknowns/warnings are present in the DTO regardless.
- **Miss code** `040000519073` (the prototype's "0 40000 51907 3"): no product record; any code not
  in the three-entry map resolves `not-found`.

**Discrepancy flagged, not silently fixed:** `FixtureApiClient.returningUser()`'s onboarding fixture
(`src/api/client.ts`) seeds Maya's restrictions as sesame-`standard` only — no peanut at all — not
peanut-severe + sesame-severe as this ticket's household profile specifies. The scan fixture follows
this ticket's explicit instruction regardless of the live onboarding fixture's current state; the two
are independent modules and reconciling them (does the onboarding fixture need updating, or was this
ticket's profile always meant as an illustrative baseline independent of it?) is an architect decision,
not something to resolve by editing M3-T2's already-accepted fixture inside this ticket's scope.

## 3. Dependency justification (rule 11)

**Added:** `expo-camera@~57.0.5`, a runtime dependency of `apps/mobile`. MIT licence (Expo's own
module, same family as `expo-font`/`expo-crypto`/`expo-router` already in this app). Version pin:
`expo`'s own SDK-57 bundled-native-modules manifest
(`https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo/bundledNativeModules.json`) names
`expo-camera: "~57.0.5"` for this SDK line — the same manifest that names `expo-crypto: "~57.0.3"`
and `expo-font: "~57.0.4"`, both already exact matches to this app's existing pins, confirming the
manifest is the right source rather than `@latest`.

**Why:** S7's one live path is barcode scanning; `expo-camera` is Expo's own camera module (the
rule-11 precedent `idempotency.ts`'s own doc comment already named this ticket for), with a
`CameraView` component that accepts a `barcodeScannerSettings.barcodeTypes` list and reports scans
via `onBarcodeScanned`.

**Alternatives considered:** (1) `react-native-vision-camera`: a popular, capable alternative, but
not an Expo module — it needs its own native-module linking/config outside the managed workflow this
app uses, and would be a new rule-11 case with a materially bigger native surface for one barcode
field. Rejected as heavier than the ticket needs. (2) A third-party barcode-only library
(`react-native-camera`, unmaintained; various `*-barcode-scanner` wrappers): rejected, unmaintained or
thin wrappers around exactly what `expo-camera` already does natively and with first-party support.
(3) No camera at all, typed-only entry: rejected outright by the ticket's own objective (b), though
notably the typed fallback this ticket also builds is what made every test in this ticket possible
without a device (see §4).

**Test-support handling:** confirmed empirically (not assumed, matching the `expo-crypto-mock.ts`
precedent) — `await import("expo-camera")` under vitest throws `ReferenceError: __DEV__ is not
defined` from `expo`'s own `async-require/setup.ts`, reached through `expo-camera`'s entry point,
before any test runs. `expo-camera-mock.ts` stands in for it; wired via the one permitted root
change, one more `resolve.alias` entry in `vitest.config.ts` alongside the existing
`react-native`/`expo-crypto` entries.

## 4. What was verified live vs. on the typed fallback

**No physical device or simulator was available to this worker.** Every S7/S8 test in
`scan-screen.test.ts` drives the flow through the typed-code fallback field (`getByLabelText("Barcode
number")` → `getByLabelText("Look up code")`), never a simulated `onBarcodeScanned` camera event —
this is exactly the scenario ux-plan.md names the fallback for ("manual code entry fallback ... which
also makes the flow testable without a camera"). What this proves: `lookupProduct`'s three outcomes
(hit/miss, error unreachable from this ticket's own client paths) drive the screen's state machine
correctly; the confirm sheet renders every verdict correctly from a `ScreeningResultDto`; `createItem`
appends the right row and the screen navigates/toasts correctly afterward; the permission-denied
render and its two actions work; the miss panel's hand-off to S9 carries the code.

**Not verified on this ticket:** the real `CameraView`'s `onBarcodeScanned` callback actually firing
for a physical UPC-A/EAN-13/EAN-8 label (Metro bundling of `expo-camera` was smoke-tested via `pnpm
--filter mobile export`, confirming the real module is linked into the bundle and no test-support
symbol leaks in — see §6 — but that is not the same as a lens actually reading a barcode); the laser
sweep's actual visual smoothness/frame rate on a device; the camera permission OS dialog's real
copy/flow (only the app-side denied state was exercised); Fraunces/Inter rendering on this ticket's
new screens on Android (an open item already carried from M3-T1). Recommend a real-device pass before
this ships, flagged for the architect same as M3-T1's font-rendering item.

## 5. Deviations, judgment calls, and what the reviewer should attack first

**ARCHITECTURE CONFLICT (narrow, resolved conservatively, not a full ticket stop) — `fl oz` omitted
from `UNITS_BY_KIND_DTO`.** The ticket's objective (f) names the volume unit list as "ml, l, tsp,
tbsp, cup, fl oz", matching prototype v4's own `UNIT_OPTIONS.volume`. The domain's unit registry
(`packages/domain/src/units/registry.ts`) documents fluid ounces as *intentionally* unsupported: "a
second, differently-valued `oz` would make unit lookup ambiguous, which is exactly the kind of guess
this module must never make" — an existing domain invariant, not an oversight (BACKLOG.md's own M1-T3
accepted follow-ups already list "fl-oz disambiguation guard if fluid ounces ever needed" as open and
undone). Shipping `fl oz` in the DTO would mean either a unit S9 offers that the ledger cannot record
(a client bug by construction) or weakening `units-contracts-consistency.test.ts` to stop checking it
(CLAUDE.md rule 13 forbids weakening an invariant test to make a change pass) — both unacceptable, and
adding `fl oz` to the domain registry itself is outside this ticket's file scope and the domain's
stated invariant. I omitted `fl oz` (five volume units instead of six) rather than either, documented
the reasoning in `units.ts`'s own doc comment, and am flagging it here rather than silently deciding
it: **recommended next action** — the architect either ratifies the registry gap as pre-existing and
accepts the omission for MVP, or opens a small M1-T3-adjacent ticket to add `fl oz` with its own
disambiguation guard before S9 is asked to offer it. This is the one place I did not build exactly
what the ticket's prose named; everything else in objective (f) is as specified.

**Household mismatch** between this ticket's specified profile and `FixtureApiClient.returningUser()`
— see §2's closing paragraph. Not fixed here; flagged for reconciliation.

**Reviewer should attack first:** (1) the fixture verdict derivations in §2 — re-derive at least the
tahini `BLOCKED` case by hand against `screen.ts` independently; (2) `allergen-copy.ts`'s exact
strings against copy-deck.md §3.3 character-for-character, especially the caveat-suffix placement on
the two non-`ALLOWED` rows (the deck's prose is slightly ambiguous about whether the suffix is
*additional* to each row's own text or already included — I read it as additional, appended once, and
documented that reading in the module doc comment); (3) the `fl oz` omission above; (4) whether the
`quantityProvenance`/`bestByProvenance` sources I invented for `createItem` calls ("scanned barcode",
"manual entry" — both reused verbatim from existing fixture-household.ts conventions) are the right
call, versus something M2-T3's real endpoint might name differently.

**Not done, out of scope, matching the ticket's own exclusions:** receipt/shelf-photo flows beyond
their tiles; product search; expiry *estimation* (the best-by values are hand-authored fixture
estimates in the same spirit as `fixture-household.ts`'s existing lots, not a real estimator); torch
control (expo-camera's own toggle is out of scope per the ticket).

## 6. Commands and results, empty build state, CI order

```
rm -rf apps/api/dist apps/mobile/dist packages/{adapters,contracts,domain}/dist \
       apps/api/tsconfig.tsbuildinfo packages/{adapters,contracts,domain}/tsconfig.tsbuildinfo
pnpm install            # Already up to date (0 new packages beyond expo-camera, already fetched
                         # when it was added to package.json earlier in this ticket)
pnpm lint               # clean
pnpm typecheck          # clean (packages/domain, packages/contracts, apps/mobile, apps/api,
                         # packages/adapters, in dependency order)
pnpm test               # 98 test files, 1449 passed, 246 skipped (DB/build-gated suites — no
                         # DATABASE_URL, expected; CI always runs them)
pnpm --filter mobile export
                         # Exported: dist (iOS 2.6MB, Android 2.9MB Hermes bytecode bundles).
                         # grep -ac "CameraView" apps/mobile/dist/_expo/static/js/ios/*.hbc -> 1
                         #   (the real expo-camera component is bundled)
                         # grep -ac "test-support" / "expo-camera-mock" -> 0 for both
                         #   (no test-support symbol leaked into the shipped bundle — structurally
                         #   guaranteed anyway, since the alias lives only in vitest.config.ts,
                         #   which Metro never reads, but checked directly rather than assumed)
pnpm format:check        # clean
```

`git status --short` after the full run: clean (dist/tsbuildinfo outputs are gitignored, nothing
tracked changed from running the pipeline itself).

## 7. Escalations

None required a stop-and-ask beyond the `fl oz` architecture conflict in §5, which I resolved
conservatively (omit, document, flag) rather than halting the whole ticket, per the judgment call
that a single unit's absence is a narrow, correctly-scoped deviation rather than grounds to abandon
an otherwise-compliant ticket. No new external resource, paid service, or irreversible action was
created (rule 17 n/a).

## 8. Proposed copy-deck.md additions (S6/S8/S9 states, new strings)

copy-deck.md §7 currently states S6/S8/S9 states are "owed by M3-E0-T1 / M3 screen tickets". This
ticket's implementation proposes the following for the architect to fold in at acceptance:

**S6 (new §7 entry):**
- Fast-follow tile tap: "Scan receipt is fast-follow · built after MVP launch, already planned."
- Future tile tap: "Photograph a shelf is future · not yet scheduled."
- Empty "Recently added": "Nothing added yet this session." (no action; the session list is the
  only state).

**S8 (new §7 entry, alongside §3.3's existing verdict-line table):**
- Lookup failure (`HttpApiClient`'s "not available yet", pre-M2-T3): copy-deck.md §8's existing
  generic fallback, no new string needed — flagging only that this is the first surface it renders
  on.

**S9 (new §7 entry):**
- Name-required gate: "Name this item before adding it." (inline, not a toast — clears the moment
  typing starts).
- Retained-code note (prototype v4 verbatim, already in the ticket's own text, restated here for
  §7's record): "Barcode {code} kept on file. If it is added to a data source later, we will offer
  to fill in these facts automatically."

**Toast (already in copy-deck.md §6's spirit, adding the exact S8/S9 forms for the record):**
"Added {n} × {name} to {location} · Known Fact" (S8, prototype's own `confirmAdd()` wording, ×
verbatim not "x"); "Added {name} · {n} {unit} to {location} · Known Fact" (S9 — the ticket's own
`saveManual()` wording, adapted from "Added {name} · {qty} {unit} to {loc}" since S9 has no fixed
count-of-packages framing).

No new copy-deck.md §3.1/§3.3 allergen strings were invented; every allergen-adjacent string
rendered on S8 is copy-deck.md's own text, verbatim, per `allergen-copy.ts`.

## 9. Review fixes (round 2)

Independent Opus review of the first pass (§1-§8 above) returned **FAIL** on one root-cause safety
defect (F1/F2/F3), with everything else in the ticket endorsed (copy verbatim, no client-side
computation elsewhere, the domain/adapters boundary held, the commands and results reported
accurately). This section is the fix round: eight commits (`08e4775`..`b4d7e36`) addressing every
finding and architect ruling in the review, plus a second full empty-build-state verification pass.

### 9.1 Root cause (F1/F2/F3) and the fix

The first pass's `src/scan/fixture-products.ts` derived three `ScreeningResultDto` literals **by
reasoning about the corpus records' labels by hand**, then wrote down what I believed `screen.ts`
would conclude. The reviewer instead **ran the real `screenSubject` engine** over the same corpus
records against the same household and found every hand-derived verdict wrong: `dairy-003` (the
"ALLOWED dairy hit") is really `ALLOWED_WITH_UNKNOWNS` (the engine does not license absence from a
bare `manufacturer-label`-tier allergen tag the way I had inferred — no corpus record carries an
actual `AllergenDeclaration`, and inferring one from an allergen tag's own tier is not something
`screen.ts` does); the tahini's evidence list was incomplete (missing the `NAME_TERM` "tahini" match
and the peanut unknown); the eggs record's unknown ordering was invented, not observed.

**Architect ruling: fixture screening results are never hand-written again.** A new
`packages/adapters/scripts/gen-screening-fixtures.mjs` is the only thing allowed to produce them —
see §1(c) above (already updated in the main body of this report) for what it does and how the
consistency test guards it. This report's original §"Hand-derived fixture verdicts" section (the
old §2) is superseded entirely by the table below, which is what the engine actually produces, not
what I predicted it would.

**No corpus record can screen `ALLOWED` today**, because none carries an `AllergenDeclaration`
(D-017 gate b — who may mint a `KNOWN_FACT` allergen declaration — is still open). The ticket's
"a dairy hit that is ALLOWED" fixture requirement is amended by the architect: `ALLOWED`'s exact
copy-deck.md §3.3 string is exercised only by a synthetic, clearly-labelled `ScreeningResultDto` in
`allergen-copy.test.ts`, never by a real corpus product. The dairy-003 fixture (the erroneous
"ALLOWED" example) was dropped from S8's three fixture products; it is replaced by `meat-026`
(Boneless Chicken Breast — no allergen data at all, and a fractional 1.5 lb package size, covering
review F9's "a fractional package size in one fixture" requirement in a real, engine-screened
product rather than only in a synthetic unit test).

### 9.2 Engine-derived verdict table (replaces the old hand-derived one)

Generated by `node packages/adapters/scripts/gen-screening-fixtures.mjs` against
`apps/mobile/src/household/fixture-restrictions.json`'s Chen household (Dean: no restrictions;
Maya: peanut severe, sesame severe, peanut listed first) and committed as
`apps/mobile/src/scan/fixtures/{condiment-102,dairy-008,meat-026}.json`. Re-derivable at any time;
never hand-edited (the consistency test in `packages/adapters/src/contracts-consistency/
screening-fixtures-consistency.test.ts` fails the build if the committed files ever drift from a
fresh run).

| Product | Barcode | Household verdict | Maya's verdict | Evidence | Unknowns |
|---|---|---|---|---|---|
| `condiment-102` (Stone-Ground Tahini) | `060000100810` | `BLOCKED` | `BLOCKED` | `ASSERTION_CONTAINS` "sesame" (assertionTier `KNOWN_FACT`, assertionSource `manufacturer-label`); `NAME_TERM` "tahini"; `INGREDIENT_TEXT_TERM` "sesame seeds" — three lines, all sesame/severe | 1: peanut, `NO_ALLERGEN_DATA`, severe |
| `dairy-008` (Grade A Large Eggs) | `060000100070` | `ALLOWED_WITH_UNKNOWNS` | `ALLOWED_WITH_UNKNOWNS` | none | 2: peanut then sesame, both `NO_ALLERGEN_DATA`, both severe |
| `meat-026` (Boneless Chicken Breast, 1.5 lb — fractional package, F9) | `060000100100` | `ALLOWED_WITH_UNKNOWNS` | `ALLOWED_WITH_UNKNOWNS` | none | 2: peanut then sesame, both `NO_ALLERGEN_DATA`, both severe |

Dean's verdict is `ALLOWED` on every product (no restrictions to violate) in all three rows. Every
result also carries the standing `NO_SAFETY_GUARANTEE` warning plus one `SEVERE_ALLERGY_UNKNOWN_DATA`
(critical) per severe unknown — omitted from the table above for space, present in every committed
JSON file and asserted in `screening-fixtures-consistency.test.ts`/`fixture-products.test.ts`.

### 9.3 Every finding, what changed, where

| Finding | Fix | Commit |
|---|---|---|
| F1/F2/F3 (root cause) | Generator script + committed generated JSON + consistency test; hand-derivation removed entirely | `b6f7e0b`, `afb85b7` |
| F3/F6/F7 (rendering ruling) | One line per unknown (copy-deck §3.1's 8 reason x severity strings) and one line per evidence entry (§3.1's 5 `EvidenceKind` strings), each with the inline caveat; `primaryUnknown`/`primaryEvidence` deleted | `6e9d9be`, `676ed3d` |
| F4/F5 (tier chips) | A tier chip on the nutrition block (the profile's own tier) and on each `BLOCKED` evidence line (`evidenceTier`: the line's own `assertionTier`, or another evidence entry's in the same result as fallback) — never overriding the record's tier | `6e9d9be`, `676ed3d` |
| F8 (one household source) | `apps/mobile/src/household/fixture-restrictions.{json,ts}`; `FixtureApiClient.returningUser()` and the generator both read it | `08e4775` |
| F9 (float-losing case + fractional fixture) | `decimalAmountToMicros("8.675309") === 8675309n` pinned; `meat-026`'s 1.5 lb package covers the fractional-fixture requirement for real | `b4d7e36`, `b6f7e0b` |
| F10 (bidirectional exhaustiveness) | `allergens-contracts-consistency.test.ts` adds DTO -> domain switches (`dtoToVerdict` etc.) alongside the existing domain -> DTO ones | `08e4775` |
| F11 (member names from the household DTO) | `MemberNameResolver` built by `app/add/scan.tsx` from `apiClient.getOnboardingState()`, never a fixed name map; `UNKNOWN_MEMBER_FALLBACK` when a resolver can't name someone | `6e9d9be`, `676ed3d` |
| F12 (viewfinder brackets + hint) | Four corner-bracket `View`s plus "Point the camera at a barcode" added alongside the existing laser sweep | `676ed3d` |
| F13 (identity chip text) | S8's identity chip now reads the literal "✓ Known fact" (not the compact row form "✓ Fact") | `676ed3d` |
| F14 (scan-lock reset) | `scanLockRef.current = false` on a lookup error and on a miss, so one bad scan/lookup failure never permanently strands the camera | `676ed3d` |
| F15 (evidence provenance fields) | `ScreeningEvidenceDto` gains optional `assertionSource`/`assertionTier`, mirrored from the domain field pair, populated by the generator | `08e4775` |
| F16 (synthetic warning-string tests + report correction) | `allergen-copy.test.ts` adds synthetic-DTO tests for `UNRECOGNIZED_ALLERGEN_DATA` (both co-occurrence forms) and `CROSS_CONTACT`; this report's §4 claim about `extraWarningLines` is corrected to note it is synthetic-only coverage, not a real-fixture path | `6e9d9be` |
| F17 (disable Add at zero) | S9's "Add to inventory" is disabled (button + guard) when the stepper reads zero | `b4d7e36` |
| F18 (productRef through createItem) | `MutableItemFixture.productRef`, threaded through `createFixtureItem`/`toSummaryDto`/`client.ts`'s `createItem`, asserted in `scan-screen.test.ts` | `fec6bb4` |
| `fl oz` | Ratified as a genuine architecture conflict; no further action (ticket text on `main` already amended) | n/a |

### 9.4 Verification, empty build state, CI order (repeated after the fix round)

Same sequence as §6 above, re-run after the fix commits:

```
rm -rf apps/api/dist apps/mobile/dist packages/{adapters,contracts,domain}/dist \
       apps/api/tsconfig.tsbuildinfo packages/{adapters,contracts,domain}/tsconfig.tsbuildinfo
pnpm install            # Already up to date
pnpm lint               # clean
pnpm typecheck          # clean
pnpm test               # 99 test files, 1475 passed, 246 skipped (DB/build-gated, no DATABASE_URL)
pnpm --filter mobile export
                         # Exported: dist (iOS 2.6MB, Android 2.9MB)
                         # grep -ac "CameraView" ios .hbc -> 1
                         # grep -ac "test-support" / "expo-camera-mock" / "screenSubject" -> 0 / 0 / 0
pnpm format:check        # clean
node packages/adapters/scripts/gen-screening-fixtures.mjs   # idempotency re-check
git status --short apps/mobile/src/scan/fixtures            # (no output — no diff)
```

`git status --short` at the repo root after the full run: clean.

### 9.5 What the reviewer should attack first, this round

(1) The engine-derived table in §9.2 — re-run the generator independently and diff against the
committed JSON (the consistency test already does this on every `pnpm test`, but an independent
re-derivation is the strongest check). (2) `evidenceTier`'s fallback rule (§ "F4/F5" in `allergen-
copy.ts`'s doc comment) — confirm the reading of "the record's allergens tier" against what the
ruling intended; this was the one part of F4/F5 open to interpretation. (3) The household mismatch
this report's §2 originally flagged is now resolved by F8 (one shared source), so that specific
concern is closed — worth confirming Maya's restrictions read the same everywhere (S2 onboarding,
S8 screening, this report's table) now that they come from one file.

## 10. Review fixes (round 3)

Re-review of `c72e2e3` returned **PASS WITH FIXES**: the root cause is closed and independently
verified (byte-identical re-derivation, drift test bites, per-line rendering, all strings
verbatim). Three items, addressed in the commit immediately following this report update.

**R1 (required) — F9's pinned case proved nothing.** `8.675309 * 1e6` is exactly representable in
IEEE754 (`519354398.99999994` is not; `8675309` is), so the earlier pin passed regardless of
whether the implementation ever touched a float. Fixed both ways the review asked for:

- (a) `quantity.test.ts` now pins `decimalAmountToMicros("519.354399") === 519_354_399n` — a value
  where `Number("519.354399") * 1_000_000 === 519354398.99999994`, so a *truncating* float path
  (`Math.trunc`/`| 0` instead of `Math.round`) would read `519_354_398`, one micro short.
  `decimalAmountToMicros` never constructs a `Number` at all, so it gets the exact value regardless.
- (b) `apps/mobile/src/lint-rules/no-float-in-quantity-math.test.ts` (new): a grep-style,
  comment-stripped structural guard (same pattern as `no-screening-import.test.ts`) asserting
  `src/scan/quantity.ts` and `src/inventory/quantity.ts` contain none of `Number(`, `parseFloat`,
  `parseInt` or `.toFixed(` in real code (`Number.isInteger`/`Number.isNaN` explicitly allowed —
  pure predicates on an already-integer value, never a parse). Confirmed by mutation: the suite
  includes tests that feed the checker an in-memory `Number(text) * 1_000_000`-shaped source string
  and assert the guard flags it, plus one each for `parseFloat`/`parseInt`/`.toFixed`, and one
  proving a doc comment merely *naming* these functions is not flagged (both `quantity.ts` files'
  own doc comments do this, to explain what they avoid — a bare substring search would have
  false-positived on those sentences, the same trap `no-screening-import.test.ts` had already hit
  once this ticket).

**R2 (low) — the allergen block now gates on the household having loaded.** `app/add/scan.tsx`
adds a `householdLoaded` boolean (distinct from `household` itself being non-null: the point is
telling "the fetch is still in flight" apart from "the fetch resolved and there genuinely is no
household"), set once `apiClient.getOnboardingState()` resolves. `ConfirmSheet`'s allergen block
renders "Checking allergen data for your household." (a new, honest loading line — see R3 below)
until then, instead of every unknown/evidence line falling back to the neutral "a household member"
phrase for the whole fetch window over a real network. `scan-screen.test.ts` adds a test that holds
the household fetch open with a manually-resolved promise, asserts the loading line (and *not* the
fallback phrase, and *not* any real finding) shows first, then resolves it and asserts the real
per-member lines render.

**R3 (doc) — corrected `UNKNOWN_MEMBER_FALLBACK`'s attribution.** Its doc comment wrongly cited
copy-deck.md §3.1 as the source of "a household member"; §3.1 has no such string. Corrected to say
plainly that this is a new string this ticket proposes for the deck. Adding it, alongside R2's new
loading line, to this report's §8 proposed-strings list:

- **S8, allergen block loading state (new, review R2):** "Checking allergen data for your
  household." (no action; replaced by the real per-line findings once the household DTO loads).
- **S8, neutral member-name fallback (new, review R3; was mis-cited as copy-deck.md §3.1 in an
  earlier comment — it is not there):** "a household member" — used only when a resolver built from
  the household DTO cannot name a `memberId` (should not happen in practice once R2's loading gate
  is in place and the household has actually loaded, but the fallback stays as defence-in-depth
  rather than rendering a raw id).

**Rulings taken as-is, no code change:** the `eslint.config.js` glob and `packages/adapters/
scripts/**` being in scope are ratified as mechanical fallout of the F1/F2/F3 generator ruling;
`evidenceTier`'s same-result fallback stays with its existing comment, to be revisited at M2-T3;
copy-deck.md §3.3's condensed-row form and the repeated caveat are the architect's to record at
acceptance, not a worker action.

### 10.1 Verification (existing build state; nothing packaging-related changed)

```
pnpm lint               # clean
pnpm typecheck           # clean
pnpm test                # 100 test files, 1482 passed, 246 skipped (DB/build-gated, no DATABASE_URL)
pnpm --filter mobile export
                         # Exported: dist (iOS 2.6MB, Android 2.9MB)
                         # grep -ac "CameraView" ios .hbc -> 1
                         # grep -ac "test-support" / "expo-camera-mock" / "screenSubject" -> 0 / 0 / 0
pnpm format:check        # clean
```

## 11. Review fixes (round 4)

The architect, reading the R2 fix, found `app/add/scan.tsx`'s household fetch had no rejection
handler at all: `getOnboardingState().then(...)` with a single callback leaves `householdLoaded`
false forever on a rejection (the "Checking allergen data for your household." loading line never
clears) and produces an unhandled promise rejection. Separately, the reviewer found the R1(b)
structural guard itself had a gap: `BigInt(Math.round(+unsigned * 1_000_000))` dodges every
forbidden pattern (unary `+` is not the identifier `Number`, and `Math.round` keeps the pinned test
value exact) while still routing through IEEE754 double arithmetic.

**Household-fetch rejection (R4).** `app/add/scan.tsx`'s fetch effect now uses the two-argument
form of `.then` (`onFulfilled`, `onRejected`), so a rejection is handled right there — no unhandled
rejection, ever. A new `householdError` boolean (distinct from `householdLoaded`) drives the
allergen block: on error it shows copy-deck.md §8's generic fallback ("Something went wrong saving
that. Try again, and tell us if it keeps happening.") plus a "Try again" button that re-runs the
fetch (`householdRetryToken`, incrementing it re-triggers the effect) — never a verdict with
unnamed members. The Add CTA (`canAdd = householdLoaded && !householdError`) is disabled — both the
`disabled` prop/`accessibilityState` and a guard clause at the top of `handleAdd` itself, since a
disabled prop alone is not guaranteed to be enforced by every renderer — for the *entire* time the
household hasn't successfully loaded, whether that's still in flight or has failed outright, not
just during the loading window R2 already covered.

**Structural guard gap (Math.\*).** `no-float-in-quantity-math.test.ts`'s `FORBIDDEN_PATTERNS` gains
`{ name: "Math.*", pattern: /\bMath\./ }`, since neither guarded module has any legitimate reason to
reach for the `Math` namespace at all. A new mutation-check test feeds the checker the exact escape
string (`"BigInt(Math.round(+unsigned * 1_000_000))"`), confirms it does *not* trip the `Number(...)`
pattern (proving it really is a distinct escape, not redundant with the existing check), and confirms
it does trip the new `Math.*` pattern.

**Tests added:** `scan-screen.test.ts` extends the R2 loading-state test to assert the Add CTA's
`accessibilityState.disabled` is `true` during loading and `false` after a successful resolve; a new
test rejects the household fetch and asserts the error text, the "Try again" button, the disabled
CTA (plus that pressing it anyway does not navigate), and that pressing "Try again" resolves the
fetch, renders the real per-line findings, and re-enables the CTA.

### 11.1 Verification

```
pnpm lint               # clean
pnpm typecheck          # clean
pnpm test               # 100 test files, 1484 passed, 246 skipped (DB/build-gated, no DATABASE_URL)
pnpm --filter mobile export
                        # Exported: dist (iOS 2.6MB, Android 2.9MB)
                        # grep -ac "CameraView" ios .hbc -> 1
                        # grep -ac "test-support" / "expo-camera-mock" / "screenSubject" -> 0 / 0 / 0
pnpm format:check       # clean
```
