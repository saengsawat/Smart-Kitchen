# M3-T4e review: lookupProduct over HTTP and the scan sheet on live Open Food Facts data

Reviewer: Opus (independent session, read-only). Base: 8d1217b. Branch: m3-t4e-lookup-http @ d356054.

## Round 1 verdict: PASS WITH FIXES

The part that matters most holds. The tier is never raised: an Estimated OFF package size gives an Estimated quantity and toast, fixture Known Fact sizes stay Known Fact, and flipping or hardcoding the tier in `quantity.ts` or `scan.tsx` fails tests (mutations M1, M2, M8, M9). The adapter gate is exactly R1, and both "gate removed" and "absent treated as 100g" are caught. No server `message` reaches a screen (M15 caught). Double tap and a held key on retry are pinned (M3, M10, M18 caught). The suite is green from an empty build with no network. Two ticket requirements are not met: the quantity provenance source is still "scanned barcode" where Objective (d) says `open-food-facts`, and lookup failures show the save fallback, not the read fallback (R2). One tier question needed a ruling: a real 48 fl oz product arrives with no package size and adds as Known Fact. None is a blocker; all are small, contained fixes.

## Findings

**F1 [major] apps/mobile/app/add/scan.tsx:306: quantity provenance source is not `open-food-facts`.** `quantityProvenance.source` is hardcoded "scanned barcode". For the OFF peanut butter record (793.8 g, Estimated) S5 history reads "Estimated · scanned barcode", crediting an OFF-derived amount to the barcode scan (rule 8). No test asserts the source. Fix: when the quantity uses the package size, send `packageSize.provenance.source` (live "open-food-facts"; fixture corpus "manufacturer-label", which changes the fixture path's history text); with no package size keep "scanned barcode"; add a scan-screen test spying on `createItem`.

**F2 [major] apps/mobile/src/scan/product-lookup-errors.ts:66 and :70: failed or refused lookups show the save fallback (R2).** The `default` branch and the non-`ProductLookupRefusedError` fall-through return "Something went wrong saving that..." for 401, 403, 5xx, a network rejection and the unexpected-2xx-body error. Fix: `GENERIC_READ_ERROR_MESSAGE` in both places; update scan-screen.test.ts:169, the new 401/403 test, the two `GENERIC_LEDGER_ERROR_MESSAGE` expectations in client.test.ts and product-lookup-errors.test.ts; leave the household-load assertions alone.

**F3 [major, ruling needed] apps/mobile/src/scan/quantity.ts, last return of `planScanQuantity`: "anything unparsed" never reaches the Estimated branch.** `parse-quantity.ts` turns every unparsed size, fl oz included, into an absent `packageSize`, so the client cannot tell "unparsed" from "no size" and records Known Fact; Ripple ("48 fl oz") adds as "1 each · Known Fact" while a 1 qt carton adds as "1 each · Estimated". The client's fl oz branch is dead on the live path. Options: (a) rule that "N each" with no size claim is a user count and stays Known Fact, amending the ticket; (b) treat a missing size on a record whose name tier is not KNOWN_FACT as Estimated; (c) have the adapter signal "size present but unreadable" (contracts change). Reviewer leans (b).

**F4 [minor] apps/mobile/app/add/scan.tsx:250-253: refused codes are carried into S9 as "Barcode {code} kept on file".** A PLU ("04061") gets a false promise; a BAD_REQUEST string gets "Barcode not-a-code kept on file"; the code is never actually stored (manual.tsx sends no productRef). Fix: retain the code only for the `error` outcome and generic failures.

**F5 [minor] apps/mobile/app/add/scan.tsx helper caption (~line 683): prototype string rewritten, and the attribution disappears with no nutrition.** Prototype v4 reads "Nutrition & allergens: label data via Open Food Facts · tier shown per field" (prototype wins on non-safety copy); the worker replaced it with "Nutrition ({basis}) via Open Food Facts · tier shown per field", dropping the allergen and label-data attribution, and removed the caption entirely when there is no profile. Fix: keep the prototype sentence, name the basis next to the macros row, keep the attribution when nutrition is absent.

**F6 [minor] Test gaps (surviving mutations).** M4: dropping `forgetHeldKey()` from `updateLocation` (location-change key discard unpinned). M7: dropping `!adding` from `canAdd` (visible disable unpinned; assert `accessibilityState.disabled` while a create is pending). M6 (`forgetHeldKey()` on a fresh hit) currently unreachable, optional.

**F7 [minor] apps/mobile/src/scan/scan-screen.test.ts:433 (`notRunProduct`): hand-built DTO, not the recording.** It carries a PER_100G profile the adapter no longer emits for that recording. Fix: drop the profile so the literal matches what the API sends; optionally add one S8 render of the liquid record's real mapped shape.

**F8 [minor] R3 display form: change.** "1 × 1 qt" next to "Add 1 to Fridge" uses "×" as a multiplier while the toast uses "{n} ×" for item count, so "2 × 1 qt" reads as two quarts stored when the item is really 2 each. "1 package of 1 qt" / "2 packages of 1 qt" with the CTA unchanged says what is stored.

**F9 [note, not this ticket] Expo export probes the network.** Under a strict network shim, `pnpm --filter mobile export` makes Expo CLI's own connectivity probes (dgram DNS for 1.1.1.1 and broadcast addresses, a connect to cdp.expo.dev) and crashes if DNS lookup throws synchronously; it passes with `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1` and a soft-failing DNS shim. Tooling, not app code.

## Rulings check (R1, R2) and recommendation (R3)
- R1 met: `mapping.ts` skips PER_100G unless `nutrition_data_per === "100g"` exactly; absent, "100ml", "serving" and anything else suppress it; the changed peanut butter expectation reflects "absent emits nothing"; mutations M13 and M14 caught. The liquid recording `liquid-per-100ml-ripple.json` (capturedAt 2026-09-29T20:28:14.785Z, host staging, the new field list) looks genuine and not hand-edited (carries OFF-added fields that were never requested; staging's older revision; `energy-kcal_100g` 29.17 = 70 kcal / 2.4). "At most two staging requests" is recorded in the fixtures README but not independently verifiable. A liquid never shows a per-100 g label (the Ripple record renders its PER_SERVING profile); no single test covers liquid plus no serving.
- R2 not met (F2).
- R3 change (F8).

## Acceptance criteria check
- Real branded barcode lands on S8 with identity Known Fact, label fields Estimated, NOT_RUN row, basis-labelled strip: met in component tests; not seen rendered by anyone.
- Add creates the item via POST with an Estimated quantity that S4 lists and S5 history shows: met for the tier (tests plus the worker's curl readback); not met for the source (F1).
- PLU, bad number and upstream outage each render their §8 string on S7 with manual entry offered: met (strings verbatim against the deck).
- Other failures render the §8 generic fallback: met against the ticket text, not met against R2 (F2).
- Liquid never shows a per-100 g label: met (adapter tests on the genuine recording).
- A qt package becomes "1 × 1 qt" as 1 each: met as written; R3 changes the string.
- Double tap on Add creates one item: met (M3 caught).
- Fixture app renders exactly as before: met for numbers and tier; the caption text changed (F5).
- All suites green from an empty build state: met (independently reproduced).
- Worker walks the flow in a browser: not met; neither worker nor reviewer had a browser. Still owed.

## Invariants check
- No tier raised on the client: pinned (`quantity.test.ts` Estimated-size and unsupported-unit tests, scan-screen Estimated toast test; M1, M2, M9 caught). F3 is a spec gap, not a raise.
- No nutrition number without its basis label: pinned (M17 caught).
- No conversion the registry does not define: pinned (qt/pt/gal/fl oz tests, amount "N", unit each).
- Screening rendered exactly as the DTO says: pinned (client.test passthrough plus the NOT_RUN block).
- One key per confirm held across retaps: pinned (M10, M18, M5 caught); location-change discard unpinned (M4).
- In-flight guard is a ref: pinned (M3 caught); the visible disable unpinned (M7).
- No server message on screen: pinned (M15 caught); grep of scan.tsx and src/scan finds no `.message` rendering.
- Fixture path unchanged: pinned for numbers and tier; the caption string changed (F5).
- No new dependency: none. No em dashes in UI text: grep clean.

## Scope
Within scope plus three justified extras: `open-food-facts-port.test.ts` (field-list pin), `test-support.ts` (the recording in `RECORDED_OFF_FILES`), `tests/fixtures/off/README.md` (each recording labelled). No contracts, ADR, DECISIONS, docs or README edits besides the worker report.

## Verification
Fresh worktree, no dist or tsbuildinfo. `pnpm install --frozen-lockfile` without the shim. Then with a `--require` network shim (blocks and logs any non-loopback net connect, dns.lookup or fetch; loaded in eslint, tsc, the vitest parent and 127 fork workers, prettier and expo): lint exit 0; typecheck exit 0; `pnpm test` exit 0, **1980 passed / 356 skipped** (matches the worker); format:check clean; `pnpm --filter mobile export` bundled web, iOS and Android with `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1` (F9), output deleted. Network attempts: zero for lint, typecheck, test and format; only Expo CLI's own probes for the export, all blocked. Mutation run: 19 single-line mutations; 16 caught; M4, M6, M7 survived (F6). Browser walk not done (no browser in the sandbox); the worker's curl walk not repeated.

## Notes for the architect
- Copy-deck at acceptance: §7 S8 toast "Added {n} × {name} to {location} · {tier}"; the stale "Lookup not available (before M2-T4)" line becomes the §8 lookup refusals plus the read fallback; "Nutrition not on file" and the basis labels; the R3 string; the caption decision (F5).
- ADR-006: record that absent `nutrition_data_per` emits no per-100 profile (R1) and the PER_100ML open item the new recording makes concrete.
- README: `apps/mobile/README.md:166` and `:243-245` are stale about `lookupProduct`.
- Backlog endorsed: a PER_100ML contract basis (M4); moving the S8 household-load failure to the read fallback alongside the S4 note; optionally `forgetHeldKey` on no-op taps and freezing the stepper during an in-flight Add (maintenance note).

## Architect rulings on round 1 (2026-09-29)
- F1: quantity source = `packageSize.provenance.source` when the amount derives from the size (live "open-food-facts", fixture "manufacturer-label", accepted as more honest); "scanned barcode" when the amount is just the count.
- F2: read fallback (R2), tests updated.
- F3: option (a), which reverses the ticket's own wording: a user-entered count of packages is the user's fact, so "N each" is KNOWN_FACT whether the size is absent, unparsed or in an unsupported unit; the package size, when present, is shown as text with its own tier chip; only count × size inherits the size's tier. The ticket text is amended at acceptance.
- F4, F6, F7: fix. F5: keep the prototype caption always, basis label beside the macros row, "Nutrition not on file" replaces the numbers only. F8: "{count} package of {qty} {unit}". F9: noted as a CI follow-up.

## Round 1 fixes (worker, 38d96c3)
`planScanQuantity` returns the source with the tier (the package size's source for count × size, "scanned barcode" for a plain count) and `scan.tsx` sends it; both lookup fallback branches return the read fallback; a plain count of packages is Known Fact whether the size is absent, unparsed or unsupported, and only count × size inherits the size's tier (ruling a); refused codes are carried into S9 only for `error` outcomes and generic failures; the prototype caption renders always with the basis label beside the macros row and "Nutrition not on file" replacing the numbers only; the two pinning tests; the test literal matches the adapter output plus a liquid render; "{count} package(s) of {qty} {unit}".

## Re-check verdict: PASS (same reviewer)
All eight findings closed against the rulings. 21 single-line mutations, each undoing one fix or rule, all caught: hardcoding the source back fails both the OFF and the fixture test; swapping either fallback back to the save string is caught; making a plain count Estimated fails 7 tests; forcing Known Fact on count × size fails the OFF tests and forcing Estimated fails the fixture tests; always or never retaining the code is caught; hiding the caption, removing the basis label, removing "Nutrition not on file", skipping the held-key reset on a location change, dropping the disable condition, and reverting the "×" text are all caught. No lookup path reaches the save fallback any more (it remains only on Add failures, which are saves, and on the S8 household-load failure already on the follow-up list with S4). Every changed assertion matches a ruling and none was loosened beyond it. Scope: `apps/mobile/app/add/scan.tsx`, `apps/mobile/src/scan/**`, expectation updates in `apps/mobile/src/api/client.test.ts`, the worker report; no packages, contracts, docs, package.json or lockfile change. Verification from an empty build (dist, tsbuildinfo and node_modules deleted) in CI order under a network shim loaded in 146 processes: lint, typecheck, format:check green; **1983 passed / 356 skipped**; export green with `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1` (the only blocked attempts were Expo CLI's own DNS probes). No browser walk: the rendered S7 and S8 screens are still owed a pass.

## Architect acceptance (2026-09-29)
Squash-merged onto main with no conflict. Merged tree verified from an empty build state: lint, typecheck, format:check, web export green, **127 files, 1983 passed, 356 skipped**; gitleaks clean on the new commit. The ticket's own wording on the count-of-packages tier was the architect's error and is amended in BACKLOG. Docs applied: copy-deck §7 S8 (nutrition basis, "Nutrition not on file", the package-of string, the caption, the quantity source, the toast tier word), ADR-006 (absent `nutrition_data_per` emits no per-100 profile), BACKLOG (DONE, amendment, follow-ups incl. the CI export flags), STATUS, README stale lines, tracker.
