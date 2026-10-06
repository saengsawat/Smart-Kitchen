# M2-T4c review

Reviewer: Sonnet 5.5 (independent, read-only). Branch `ticket/M2-T4c`, commit c322fe2, then fix b896163. Outcome: **PASS WITH FIXES, fix re-checked PASS.** Squashed to main as c82a642.

## Acceptance
- (a) `productLookupPath(code, type?)` builds `?type=`. The scan screen sends `asScannableBarcodeType(result.type)`, and the typed fallback sends none. Met.
- (b) A hinted code is parsed as that symbology only. `upc_e` expands to UPC-A, `ean8` stays EAN-8, `upc_a` needs 12 digits and `ean13` needs 13, each with its check digit. A length or check-digit failure, or an unknown `type`, is 400 `BAD_REQUEST` with the existing message. Met in the server.
- (c) Unhinted parsing is unchanged, including EAN-8 precedence. Met.
- (d) GTIN-14 normalisation in both ports (fixture and OFF). Indicator 0 gives the EAN-13 key. Indicators 1 to 9 give `INVALID_CODE` and nothing is sent. Met.
- (e) The `11234502` to `112000003452` pin is in the service and route tests. Met.
- The both-valid case is covered: 04016007 and 12345670, hinted and unhinted, and the `upc_e` hint looks up the UPC-A. Met.

## Findings
1. **HIGH, iOS UPC-A regression (fixed in b896163).**
   - `apps/mobile/node_modules/expo-camera/ios/Current/BarcodeScannerUtils.swift` lines 30-39: AVFoundation reports a UPC-A as `ean13`, and expo strips the leading 0 from `data`.
   - So the screen sent `type=ean13` with 12 digits. The server's `ean13` branch wants 13 digits and refused the scan with 400.
   - Unhinted, the same scan parsed as UPC_A, so this broke the invariant that nothing parsing today without a hint starts failing.
   - The architect confirmed the Swift source and chose option (a): the client maps `ean13` with exactly 12 digits to `upc_a`, and the server stays strict.
2. **LOW, expo-camera spellings verified.**
   - Android emits `upc_a`, `upc_e`, `ean13`, `ean8`.
   - iOS `CameraView` emits `upc_e`, `ean13`, `ean8` and never `upc_a`.
   - The `VNBarcodeSymbology*` spellings appear only on the VisionKit `launchScanner` path, which the app doesn't use.
   - Anything else is dropped and no hint is sent, which is safe.
3. **LOW, query strictness.** A repeated `type`, an empty `?type=`, a comma list and wrong case are all refused with 400 `BAD_REQUEST`. Acceptable.
4. **Deviation 1 accepted.** A hinted code of PLU length gets 400 `BAD_REQUEST`, not `PLU_NOT_SUPPORTED`. The unhinted path is unchanged.
5. **Deviation 2 accepted.** The two new test files sit inside the ticket's scope globs.
6. **Doc line.** The architect applied it at acceptance in `docs/architecture/system-context.md` ("Product lookup route"), including the iOS note.

## Invariants and boundaries
- The hint only narrows.
- The invalid path logs `outcome: "invalid-code"` and never the code.
- The scan lock and held-key logic are unchanged.
- The fixture client ignores the hint.
- No live OFF calls in tests, no new dependencies.
- 16 files changed, all in scope.

## Checks (worktree)
- `pnpm lint`, `pnpm typecheck` and `pnpm format:check`: clean.
- `pnpm vitest run packages/contracts packages/adapters apps/api/src/products apps/mobile/src/api apps/mobile/src/scan`: 804 passed, 8 skipped (DB suites skip without Postgres; no DB path touched).

## Re-check (rule 24a, fix only): b896163 on c322fe2
**PASS.**
- The hint is `upc_a` exactly when `result.type === "ean13"` and `result.data` matches `^\d{12}$`. Otherwise it is `asScannableBarcodeType(result.type)`.
- Non-digit data, and 12 digits under any other type, are unaffected.
- A bad check digit is still 400, so the mapping can only turn a refused request into the UPC_A parse the unhinted path already gave.
- The scan lock is untouched.
- Two new tests: a 12-digit `ean13` sends `upc_a`, and a 13-digit `ean13` sends `ean13`.
- Three files changed, all in scope.
- Checks: lint and typecheck clean; `vitest run apps/mobile/src/scan apps/mobile/app`: 141 passed.

On main after the squash, the architect ran `vitest run apps/mobile/src/scan apps/mobile/app apps/api/src/products packages/contracts packages/adapters/src/product-lookup`: 521 passed, 1 skipped. Eslint on `scan.tsx` and `product-routes.ts` was clean.

**Owed:** the real-device camera pass confirms the UPC-A and UPC-E type strings on iOS and Android.
