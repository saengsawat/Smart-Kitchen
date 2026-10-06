# M2-T4c worker report

Branch `ticket/M2-T4c`, branched from main at 705b1ae. Implementation worker: Sonnet 5.5.

## What changed

- `packages/contracts/src/products.ts`: `productLookupPath(code, type?)` appends `?type=<type>`; new `asScannableBarcodeType(value)` narrows any value to a `SCANNABLE_BARCODE_TYPES_DTO` member or `undefined`. Exported from `index.ts`. New `products.test.ts`.
- `apps/api/src/products/lookup-service.ts`: `parseLookupCode(raw, type?)`. With a `type` it parses as that symbology only (`parseAsSymbology`): `upc_e` expands to its UPC-A, `ean8` stays EAN-8, `upc_a` needs 12 digits, `ean13` needs 13, each with its check digit; any failure or unknown value is `invalid`. A hinted PLU-length code is `invalid`, not `plu` (the hint says the camera read a barcode). Without `type` nothing changed; doc comment pins `11234502` -> UPC-A `112000003452`.
- `apps/api/src/http/product-routes.ts`: reads the `type` query value; present but not in the list (including `?type=`, a comma list, a repeated parameter) is refused as `invalid-code`, 400 `BAD_REQUEST`, existing message, and the log line still never records the code.
- `packages/adapters/src/product-lookup/schema.ts`: `normalizeLookupCode` / `isLookupCodeRefusal`. Both ports (`FixtureProductLookupPort`, `OpenFoodFactsProductLookupPort`) call it after `validateCodeFormat`: GTIN14 indicator 0 resolves as its EAN-13 (the result's `code` is the EAN-13, so the OFF cache and in-flight keys are shared with the EAN-13); indicator 1 to 9 is `INVALID_CODE`, nothing sent.
- `apps/mobile/src/api/client.ts`: `ApiClient.lookupProduct(code, type?)`; `HttpApiClient` puts `type` on the URL; `FixtureApiClient` takes no second parameter (it ignores the hint by construction; avoided an unused-var lint error).
- `apps/mobile/app/add/scan.tsx`: `handleCode(code, type?)`; the camera path sends `asScannableBarcodeType(result.type)`; the typed fallback sends none. Merged the contracts imports into one statement.

## expo-camera type spelling

Checked against expo-camera's source. Android emits `upc_a`, `upc_e`, `ean13`, `ean8` (the same spellings as `SCANNABLE_BARCODE_TYPES_DTO`). iOS `CameraView` never emits `upc_a`: it reports a UPC-A as `ean13` and strips the leading 0 from `data` (`expo-camera/ios/Current/BarcodeScannerUtils.swift`, "iOS converts upc_a to ean13 and appends a leading 0"). Fix (review round 1, option a): `scan.tsx` sends `upc_a` when the camera reports `ean13` with exactly 12 digit data; the server stays strict. Any other type outside the list is dropped and no hint is sent. No physical device was available; the real-device camera pass is still owed.

## Tests

- New/extended: `packages/contracts/src/products.test.ts`, `apps/api/src/products/lookup-service.test.ts` (hint parsing, `11234502` pin), `apps/api/src/products/product-routes.test.ts` (each symbology with and without `type`, check-digit mismatch under a hint with the code absent from the log, wrong shape, unknown and repeated `type`, both-valid code 04016007 and 12345670 both ways, `11234502` pin), `packages/adapters/src/product-lookup/gtin14-normalization.test.ts` (both ports, indicator 0 and 1 to 9), `apps/mobile/src/api/client.test.ts` (HTTP client URL with and without `type`, fixture client ignores the hint), `apps/mobile/src/scan/scan-symbology.test.ts` (fires the stand-in `CameraView`'s `onBarcodeScanned` with `{ type, data }` through `UNSAFE_getAllByProps({ facing: "back" })`; hint reaches `lookupProduct`; unknown type dropped; typed fallback sends none).
- Runs: `pnpm lint` clean, `pnpm typecheck` clean, `pnpm format:check` clean. `pnpm vitest run packages apps/api apps/mobile` (no database): 159 files passed, 2 skipped; 2536 tests passed, 566 skipped (the DB-backed suites skip without Postgres; I did not run them, and no DB path was touched). After the final lint fixes I re-ran `apps/mobile`, `apps/api/src/products` and `packages`: 1859 passed, 8 skipped.
- No test makes a live OFF call (stub fetch replaying `tests/fixtures/off/`).

## Deviations

- Added two small test files (`products.test.ts`, `gtin14-normalization.test.ts`) instead of editing existing adapter test files; both inside the ticket's file scope directories.
- A hinted code of PLU length (4 or 5 digits) is 400 `BAD_REQUEST`, not `PLU_NOT_SUPPORTED`. Nothing that parses today without a hint changes.
- Did not touch `apps/mobile/src/test-support/**` or `scan-gate-covered.test.ts`.

## Proposed doc line (rule 30)

For the API doc / ARCHITECTURE where `GET /v1/products/{code}` is described:

> `GET /v1/products/{code}?type=<symbology>`: `type` is optional and is the symbology the camera read (`upc_a`, `upc_e`, `ean13`, `ean8`). When present the server parses the code as that symbology only (`upc_e` looks up the expanded UPC-A; a length or check-digit failure, or an unknown `type`, is 400 `BAD_REQUEST`). When absent (typed entry, older clients) the code is parsed by its shape: EAN-8 first for a leading 1, UPC-E first for a leading 0. The scan screen sends `upc_a` when iOS reports `ean13` with 12 digits (iOS strips a UPC-A's leading 0 and calls it ean13). Lookup ports normalise a GTIN-14 with indicator 0 to its EAN-13 and refuse other indicators.

Also worth a line in the M3-T4b / S7 notes: the scan screen sends no hint for the typed fallback.

## Follow-ups

- Real-device camera pass should confirm the `type` strings an actual iOS and Android device report for UPC-E labels.
- A typed 8-digit code still guesses by first digit (the 58% overlap remains for typed entry; only camera scans are now exact).
