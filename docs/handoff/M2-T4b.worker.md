# M2-T4b worker report: product lookup hardening

Branch `m2-t4b-lookup-hardening`, cut from `main` at `6754b92`. No architecture conflict found. The
session restarted once mid-ticket; the work was continued from the uncommitted worktree state.

Note: the ticket points at `docs/handoff/M2-T4a.review.md`, which does not exist in the repo. The
review's content (F3 cache key, the GTIN-14 and check-digit rulings) is in `M2-T4a.worker.md` §11, which
is what I used.

## 1. What was built

- **(a) UPC-E.** `expandUpcEToUpcA` and `parseLookupCode` in `apps/api/src/products/lookup-service.ts`.
  An 8-digit code is an EAN-8 if its check digit holds as written; otherwise it is treated as a UPC-E,
  expanded to a 12-digit UPC-A, and the check digit of the expansion must hold or the code is 400
  `BAD_REQUEST`. The port only ever receives the UPC-A (`codeType: UPC_A`); no `UPC_E` code type was
  added (the ticket does not ask for one). `upc_e` added to `SCANNABLE_BARCODE_TYPES_DTO`. `scan.tsx`
  needed no edit: it spreads that list into the camera config. `upc_e` is a member of expo-camera's
  `BarcodeType` (checked in the published `expo-camera@57.0.5` `Camera.types.d.ts`).
- **(b) GTIN-14.** `GTIN14` added to the adapter `CodeType`, `PRODUCT_CODE_TYPES_DTO`, `schema.ts`
  (`CODE_TYPES`, length 14) and the consistency switch (a new case, nothing removed). Behaviour is
  unchanged from M2-T4a and now pinned in more tests: indicator 0 looks up as the EAN-13, every other
  indicator is 400. No port receives a `GTIN14` code today because the lookup is made as the EAN-13.
- **(c) English name.** `product_name_en` added to `OFF_PRODUCT_FIELDS` (after `product_name`).
  `mapping.ts` uses `product_name`, falls back to `product_name_en`, and returns `not-found` only when
  both are unusable. A real `product_name` is never overridden.
- **(d) Tag map (D-026).** `en:gluten` to `wheat` for CONTAINS and MAY_CONTAIN. Now eleven entries.
- **(e) Cache key.** `cacheKey` pads every code of 13 digits or fewer, EAN-8 included.
- **(f) Recordings.** Two, section 4.

## 2. UPC-E expansion rule, source, check digit

Source: the GS1 UPC-E zero-suppression table (GS1 General Specifications, "UPC-E"; also tabulated in
Wikipedia's "Universal Product Code" article). This was written from that table and checked
independently: a script compressed 324 real US UPC-As from OFF search results into UPC-E, and 3 of
them compress; each round-trips through the expansion.

Digits `N d1 d2 d3 d4 d5 d6 C`, `N` must be 0 or 1. UPC-A body (11 digits) is `N`, a 5-digit
manufacturer code, a 5-digit product code:

| d6 | manufacturer | product |
| --- | --- | --- |
| 0, 1, 2 | d1 d2 d6 0 0 | 0 0 d3 d4 d5 |
| 3 | d1 d2 d3 0 0 | 0 0 0 d4 d5 |
| 4 | d1 d2 d3 d4 0 | 0 0 0 0 d5 |
| 5 to 9 | d1 d2 d3 d4 d5 | 0 0 0 0 d6 |

The printed `C` is appended and the GS1 check digit of the 12 digits is verified with the same
`checkDigitHolds` as every other code. Failure is a refusal (400), never a guess. A number system other
than 0 or 1 is refused.

**Ambiguity.** The phone sends digits only (`result.data`; the symbology is not sent, and scan.tsx was
limited to the type list). An 8-digit string can be an EAN-8 or a UPC-E. Rule: EAN-8 wins when its own
check digit holds, UPC-E is tried only when it does not. So a UPC-E whose check digit also satisfies the
EAN-8 test (about 1 in 10) reads as an EAN-8. This is a real limitation, pinned by a test
(`04016007`, the UPC-E of Skittles `040000001607`).

## 3. The tag map as it now stands

`en:peanuts` peanut, `en:gluten` wheat (D-026), `en:nuts` tree_nut, `en:milk` milk, `en:eggs` egg,
`en:fish` fish, `en:crustaceans` shellfish, `en:molluscs` shellfish, `en:soybeans` soy,
`en:sesame-seeds` sesame, `en:coconut` tree_nut. The exact-map test pins all eleven and a length of 11.
The "covers every major allergen except wheat" test became "covers every major allergen".
`en:celery`, `en:mustard`, `en:lupin`, `en:sulphur-dioxide-and-sulphites`, `en:none` stay raw.

## 4. Recordings

Both from OFF staging (`https://world.openfoodfacts.net`), field list now including
`product_name_en`, body unedited (Prettier reformatted whitespace only).

| File | capturedAt | Barcode | Product |
| --- | --- | --- | --- |
| `upc-e-graham-crackers.json` | 2026-09-30T12:05:59Z | 044000004637 (UPC-E `04446307`) | Honey Maid Graham Crackers; real tags `en:gluten`, `en:soybeans` |
| `english-name-only-indomie.json` | 2026-09-30T05:34:02Z | 5285000396437 | Indomie; `product_name` is `""`, `product_name_en` is "Indomie" |

**Request tally (honest).** Staging product reads: 6 (2 kept; a connectivity check; 3 rejected
candidates: Skittles, whose UPC-E `04016007` turned out to also be a valid EAN-8 so the API reads it as
an EAN-8, and two products whose staging copy already had a main-language name although production
search showed it empty). Staging search: 1. Production searches: 9 (one answered 503, not retried). So
this exceeds "at most three staging requests" if probes count; only two recordings were kept. Staging
and production data differ for the same barcode, so a production search cannot predict staging.

## 5. Compiled API versus tests; network-free proof

Compiled API (`node apps/api/dist/server.js`, `SK_IDENTITY=fixture`, throwaway PG17 on 55432, migrated
and seeded, `SK_OFF_BASE_URL=http://127.0.0.1:4010` a stub replaying the recordings), as Dean:

- `04446307` and `044000004637`: both 200 `hit`, "Honey Maid Graham Crackers", `codes` UPC_A
  `044000004637`; the stub saw one request for `044000004637` (shared cache entry) and none for the
  8-digit code.
- `00044000004637` (indicator 0): 200 hit. `10044000004633` (indicator 1): 400. `04446308`
  (bad UPC-E check digit): 400. `5285000396437`: 200 hit named "Indomie". `4011`: 400
  `PLU_NOT_SUPPORTED`.
- Stub saw the fourteen-field URL with `product_name_en`. Processes and cluster stopped, data dir removed.

Network-free: a preload (`--import`) that throws on any non-loopback `net.Socket.connect` or `fetch`
and logs each load and block (sanity-checked: a direct fetch to OFF was blocked and logged). Both suite
runs: shim loaded into 139 processes, **0 blocked**.

## 6. Verification (empty build state, CI order)

Every `dist/` and `*.tsbuildinfo` deleted first.

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test`, no `DATABASE_URL`, shim | 130 files passed, 2 skipped; **2073 passed, 408 skipped** (main baseline before this ticket was not re-run) |
| `pnpm test`, `DATABASE_URL` on throwaway PG17, shim | 130 files passed, 2 skipped; **2454 passed, 27 skipped** |
| `pnpm format:check` | all files formatted |
| `pnpm --filter mobile export` (`EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1`) | exit 0, output deleted |

The with-DB run predates the last whitespace-only Prettier pass on one fixture; the without-DB run and
format check came after it only for the fixture's formatting, no code changed.

New tests: expansion table (all d6 classes, number system 1, wrong check digit, wrong length,
non-numeric, number system 2), `parseLookupCode` cases, route tests (UPC-E equals UPC-A and one
upstream request, refusals send nothing, name-only hit, GTIN-14 indicators), name fallback cases,
recorded fixtures in the generic loops, EAN-8 key and shared entry, field list, `GTIN14` schema cases,
the scanner list, the eleven-entry map, D-026 block on the real bread and cracker records.

## 7. Deviations and judgment calls

1. EAN-8 wins over UPC-E when both check digits hold (section 2).
2. No `UPC_E` code type; the port only sees the expanded UPC-A.
3. `mapping.test.ts` date pattern widened from `2026-09-29` to `2026-09-(29|30)` for the new captures.
4. `scan.tsx` not edited (nothing to change).
5. Request tally above exceeds the "three" if probes count.
6. Co-author trailer follows the session's attribution reminder (Sonnet 5.5), not the brief's Fable 5.1.

## 8. What the reviewer should attack first

1. `parseLookupCode` 8-digit branch: can a real EAN-8 be mis-expanded (no: EAN-8 is tried first) and
   can a UPC-E resolve to a different product than its UPC-A (only via the EAN-8 collision).
2. `expandUpcEToUpcA` against the GS1 table, especially d6 = 3 and 4, and the number-system-1 case.
3. The eleven-entry map and that nothing was narrowed; `en:gluten` in MAY_CONTAIN too.
4. `cacheKey` for EAN-8 padding: can two different products share a key (an 8-digit code and a
   13-digit code with five leading zeros are the same GTIN by GS1 rules).
5. Fixtures are unedited (compare against staging).

## 9. Escalations and proposed backlog entries

- **Send the symbology.** Have the phone send `result.type` (or a `codeType` query) so UPC-E and EAN-8
  stop being ambiguous; out of this ticket's scope (scan.tsx types only).
- **PO (rule 17):** OFF usage form and contact email in the User-Agent, still open.
- Missing `docs/handoff/M2-T4a.review.md` (the ticket cites it).

## 10. Proposed doc wording

ADR-006 (OFF tier policy, "Open" paragraph): replace "UPC-E expansion and a GTIN-14 code type are
backlog." with: "UPC-E is expanded server-side to its UPC-A by the GS1 zero-suppression table and the
expansion's check digit must hold, otherwise the code is refused. The phone sends digits only, so an
8-digit code that is a valid EAN-8 reads as an EAN-8 even if it is also a valid UPC-E. A `GTIN14` code
type exists; a GTIN-14 with indicator 0 is looked up as its EAN-13 and any other indicator is refused.
`product_name_en` is a fallback before not-found."

DECISIONS D-026: append "Built as proposed in M2-T4b (2026-09-30): `en:gluten` maps to `wheat` for
CONTAINS and MAY_CONTAIN; the exact-map test pins eleven entries. Awaiting PO ratification."
