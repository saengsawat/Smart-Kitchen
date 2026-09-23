# M3-T4b review: add food (S6 hub, S7 camera scan, S8 confirm with the allergen row, S9 manual add, fixture lookup and item creation)

**Reviewer:** independent Opus session, read-only. **Branch:** `m3-t4b-add-food` @ `ba4e2bf`. **Baseline:** `main` @ `dd3a88d`. Committed by the architect at acceptance (CLAUDE.md rule 29); rulings and the re-review outcome are appended at the end.

## Verdict

**FAIL.** One safety-surface defect decides it: the dairy fixture ships a household verdict of `ALLOWED` that the real engine does not produce for that record. Running `screenSubject` over `tests/fixtures/products/dairy-003.json` against the Chen household (Dean none; Maya peanut severe, sesame severe) returns `ALLOWED_WITH_UNKNOWNS` with two severe `NO_ALLERGEN_DATA` unknowns and two critical `SEVERE_ALLERGY_UNKNOWN_DATA` warnings. S8 rendered "No known household match" for a product the engine cannot clear for two severe allergies: the permissive direction, the one that hurts someone (SR-2, D-017 P5, the ticket's own invariant). Everything else is good work: copy verbatim, no verdict computed in the client, boundary holds, commands green and accurately reported.

## Findings

**F1 (major)** `fixture-products.ts:73-139`: the derivation invents a rule that a `KNOWN_FACT` manufacturer-label allergen tag licenses a completeness declaration. The engine (`screen.ts:463-478`) requires an explicit `AllergenDeclaration`; no corpus record carries one (`types.ts:137`), so no record can reach `ALLOWED` today. Minting that declaration is the OPEN half of D-017 P5 and OQ-D7, resolved here by assumption in the permissive direction (rules 3, 4).
**F2 (major)** tahini fixture drops the peanut `NO_ALLERGEN_DATA` unknown and its critical warning; the engine also returns three evidence entries (assertion "sesame", name term "tahini", ingredient text "sesame seeds"), not two.
**F3 (major)** `allergen-copy.ts:36-44`: only one unknown and one evidence entry ever render (`primaryUnknown`, `primaryEvidence`); the eggs fixture's second critical unknown (peanut) never shows (copy rules 3 and 4); the fixture's ordering, not the engine's, decides which line appears.
**F4 (medium)** nutrition strip has no per-field tier chips while its helper line claims "tier shown per field" (P2, §4).
**F5 (medium)** the allergen row has no tier of its own (§3.3 says it is separately tiered).
**F6 (medium)** BLOCKED copy always says "in the ingredient statement" regardless of `evidence.kind`; for the real tahini result the first entry is a manufacturer assertion.
**F7 (medium)** the unknown line hardcodes "severe" and "no ingredient statement" regardless of `unknown.severity` and `unknown.reason`.
**F8 (medium)** the scan fixture screens against Maya peanut severe + sesame severe while the onboarding fixture seeds sesame standard only; one session shows contradictory severities.
**F9 (medium)** "no float" is unenforced: a float parse in `decimalAmountToMicros` leaves 418/418 green.
**F10 (low-medium)** mirrored-list consistency is one-directional; a phantom DTO member passes.
**F11 (low)** member name falls back to a raw id (§2 forbids).
**F12 (low)** viewfinder brackets and camera hint missing.
**F13 (low)** identity chip reads "✓ Fact"; the sheet header should read "✓ Known fact".
**F14 (low)** the camera scan lock never resets after an error.
**F15 (low)** evidence DTO omits `assertionSource` and `assertionTier`.
**F16 (low)** report claims the §3.1 warning strings are unit-tested; only emptiness is asserted (rule 19).
**F17 (low)** S9 stepper reaches zero and the save throws ZERO_DELTA.
**F18 (low)** `productRef` accepted then discarded by the fixture ledger.

## Fixture derivation table (real engine over the real records)

| Record | Engine verdict | Worker's fixture | Agree |
|---|---|---|---|
| dairy-003 yogurt | ALLOWED_WITH_UNKNOWNS; peanut + sesame NO_ALLERGEN_DATA severe; 2 critical warnings | ALLOWED, no unknowns | **no** |
| condiment-102 tahini | BLOCKED; 3 evidence entries; peanut unknown + critical warning | BLOCKED; 2 evidence; no unknowns | verdict yes, payload **no** |
| dairy-008 eggs | ALLOWED_WITH_UNKNOWNS; peanut then sesame | same set, sesame first | content yes, order no |
| 040000519073 | not-found | not-found | yes |

## Safety-copy table

Every §3.3 and §3.1 string verbatim; the caveat clause appended to both non-ALLOWED rows; §7 S7 permission copy with `Linking.openSettings()`; miss panel per the prototype and it does not reuse the Estimated chip; retained-code note verbatim; S6 helper and phase labels verbatim; ALLOWED and ALLOWED_WITH_UNKNOWNS distinct (mutation fails 4 tests); `danger` only on the BLOCKED row; BLOCKED CTA not terracotta (mutation fails); copy scan green. Defects are in what the strings are fed (F6, F7) and how many render (F3), not in the strings.

## Acceptance criteria

Pass: S6, permission denied, miss to S9, S9 manual item, component tests, root commands, boundary (source and bundle), expo-camera pinned to the SDK 57 pair, lockfile, no test weakened. Fail: dairy verdict (F1) and per-field tiers (F4); tahini payload (F2); second critical unknown never renders (F3). Not verified: camera on a device (typed fallback exercised; stated plainly).

## Commands

Worktree: frozen-lockfile install clean; lint, typecheck, format:check clean; test 98 files, 1449 passed / 246 skipped (matches the report); mobile export iOS 2.6 MB, Android 2.9 MB; bundle has `CameraView` and no test-support symbols. Mutations: verdict-string swap fails 4; blocked CTA colour fails 1; float parse fails 0 (F9); phantom DTO member fails 0 (F10); `fl oz` added fails the units consistency test (confirms the worker's conflict report).

## Scope and deviations

File scope clean incl. the single vitest alias and `app.json` camera plugin. `fl oz` omission correct (`registry.ts:12-19` documents fluid ounces as unsupported); architect amends the ticket. Household mismatch correctly refused in-scope; recommended resolution: one source of truth for the Chen restrictions (Maya peanut severe + sesame severe) read by both onboarding and scan fixtures.

## Opinions

Derive fixture screening results by running the real engine offline and pasting its output, with the script kept in `packages/adapters` so drift is caught; that kills F1, F2 and F3's ordering guesswork at once. `primaryUnknown`/`primaryEvidence` are a client-side priority rule in a module that claims to reorder nothing. Take F15 now.

## Architect rulings after the first review (2026-09-23)

Fixture screening results are generated by running the real engine (`packages/adapters/scripts/gen-screening-fixtures.mjs`) and committed as JSON with a drift test in adapters; no hand-written verdict again. No fixture can be `ALLOWED` until D-017 gate b lands (the ticket's dairy criterion amended; the dairy record was replaced by `meat-026`). The scan sheet renders one line per unknown and per evidence entry using §3.1's per-reason and per-kind strings with the inline caveat (deck §3.3 amended). One shared Chen restriction fixture (Maya peanut severe, sesame severe) read by onboarding and the generator. Record tiers rendered as-is (A8/OQ-D7 open). The `fl oz` conflict report ratified. `eslint.config.js` glob, `packages/adapters/scripts/**` and the mobile tsconfig include ratified as scope (fallout of the generator ruling).

## Re-review 1 (same reviewer, commit `c72e2e3`)

**PASS WITH FIXES.** Independently re-derived all three committed JSON files byte for byte with a differently written subject builder; generator idempotent; drift test fails when a warning is dropped and also forbids an `ALLOWED` fixture while gate b is open; S8 maps every evidence entry and unknown (slicing to one fails the tahini test); all 16 unknown strings and 5 evidence strings verbatim against the deck; tier chips on nutrition and evidence lines; F8 both fixtures read the shared JSON; F10 phantom DTO member fails; F11 to F18 present and tested; commands green (1475 passed / 246 skipped; bundle has `CameraView`, no `screenSubject` or test-support symbols); diff fix-driven only. Remaining: **R1 (required)** the float case `8.675309` is exact in IEEE754 so F9 is still unenforced (the reviewer's own earlier example); use `519.354399` and add a grep-style no-`Number(` guard on both quantity modules. R2 the member name falls back to "a household member" until the household loads on a real network. R3 that fallback string is attributed to the deck but is not in it. R4 deck §3.3 condensed rows are now dead and the caveat repeats per line (architect records). R5 scope files ratified above.

## Re-review 2 (same reviewer, commits `116d727` and `fbcd396`)

**PASS.** R1 closed: a `Number(...)` parse fails the pinned `519.354399` value and the structural guard; the `Math.round(+x)` escape now fails on the `Math.*` pattern. R2/R4 closed by mutation: the two-argument `.then` handles rejection, the error state renders the §8 fallback with a working Try again, Add is disabled by prop, accessibility state and a `handleAdd` guard (removing the guard fails the test on the navigation assertion); retry to success covered. R3 corrected. Commands: install, lint, typecheck, format clean; test 1484 passed / 246 skipped; export clean with `CameraView` present and no `screenSubject`, test-support or mock symbols. Diff fix-driven only. Cosmetic nit: the Try again button was 40px (fixed by the architect at merge). Still open: a real-device camera pass before release.

## Architect acceptance (2026-09-23)

Accepted and squash-merged with one-character fix (Try again button to the full 44pt). Deck: §3.3 superseded-rows note and per-line caveat recorded before merge; new strings ("a household member" fallback, "Checking allergen data for your household.", the S6 tile explanations) and the S6/S8/S9 states added at acceptance. Scope: `eslint.config.js` glob, `packages/adapters/scripts/**`, mobile tsconfig include ratified; `fl oz` omission ratified. Follow-ups: real-device camera pass before release; `evidenceTier` same-result fallback revisited at M2-T4 with real multi-source records; a `productRef` unit guard when M2-T3 creates items from records that print unsupported units.
