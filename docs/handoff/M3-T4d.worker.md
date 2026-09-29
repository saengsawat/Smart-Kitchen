# M3-T4d worker report: client wiring to the M2-T3 endpoints

Branch `m3-t4d-client-wiring`, cut from `main` at `32abd27`. Implementation model: Sonnet (as the
ticket says). No architecture conflict found.

## 1. What was built

**(a) `createHousehold`.** `HttpApiClient.createHousehold` now does `POST /v1/households` with the
trimmed name. On success it maps the response's `HouseholdSummaryDto` (via
`householdSyncInputFromSummary`) into the client's `HouseholdDto` through
`FixtureApiClient.syncHouseholdFromServer` (see (c)), and returns it with the one-time
`joinCode.code` attached as an extra `joinCode` field (the `ApiClient` interface's
`createHousehold` return type is now `HouseholdDto & { readonly joinCode?: string }`). No
idempotency key exists on `CreateHouseholdRequestDto`, so unlike every write below, a network
failure here is not retried (retrying blindly could create a second household if the first request
actually landed and only the response was lost) — flagged for the reviewer in §6. A non-2xx
response throws a `LedgerRefusedError`.

**(b) `joinHousehold`.** `POST /v1/households/join` with `{ code }`. 404 `JOIN_CODE_INVALID` and 429
`RATE_LIMITED` render their exact copy-deck.md §8 strings (`JOIN_CODE_ERROR_MESSAGE`, already
existed; `RATE_LIMITED_MESSAGE`, added verbatim from the deck); any other failure, including a
`fetch` throw, resolves the generic fallback. `JoinHouseholdResult`'s `ok: true` branch gained an
optional `alreadyMember` field, populated from the wire's `JoinHouseholdResponseDto.alreadyMember`
(the fixture path leaves it `undefined`: it has no server-side membership to check twice against).

**(c) `getOnboardingState` (household half over HTTP, restrictions half stays local).**
`GET /v1/households/me`. Its only 403 (`authorization.ts`: `householdRoute()` carries no role
restriction, so the sole reason this route ever answers 403 is "no household yet") is read as
`household: null`, not a failure. A successful read is folded into `HttpApiClient`'s internal
`FixtureApiClient` delegate through the new `FixtureApiClient.syncHouseholdFromServer`: it replaces
`householdId`/`name`/`members` (identity, role, and `displayName` mapped from the wire's
`displayInitials` — M2-T3 never sends a full name) wholesale from the server, but preserves
whichever `restrictions`/`noneConfirmed`/`preferences` that same delegate instance already has for a
member id that is still present. `saveMemberRestrictions`/`savePreferences` are unchanged: they still
delegate straight to that same fixture instance, so restrictions keep working exactly as they did
before this ticket, just attached to real member ids instead of the hardcoded Dean/Maya pair. The
S2 gate semantics (M3-T2) are untouched.

**(d) `createItem`.** `POST /v1/inventory/items`, reusing `input.idempotencyKey` — already minted by
the caller (S8/S9, at Save-tap time, the M3-T4a pattern) — unchanged across this method's own
network retry (mirrors `postWrite`'s rule). 200 (replay) and 201 (created) both resolve the same
`InventoryItemSummaryDto`. A non-2xx throws `LedgerRefusedError`; 409 `IDEMPOTENCY_KEY_CONFLICT`
and any 400 validation code already render through the existing `ledgerErrorMessage`
switch/default (no change needed there — see §2). No extra "refetch the list" plumbing was added:
`getInventoryItems()` always attempts a fresh network read first (it only falls back to a cache on
failure), so S4 already shows a newly created item the next time it loads.

**(e) `EXPO_PUBLIC_IDENTITY_TOKEN`.** `src/config/env.ts` gained `getIdentityToken()`: trims and
returns the variable when set, else `"fixture.dean.chen"` (restated as a literal, not imported from
`client.ts`, to avoid a module cycle — that file already imports `getApiBaseUrl` from here).
`HttpApiClient.getIdentityToken()`/`authHeaders()` now call it instead of the hardcoded constant.
`FixtureApiClient.getIdentityToken()` is untouched (always the hardcoded constant — the fixture-backed
app's identity is unaffected).

**(f) README.** `apps/mobile/README.md`'s "Pointing the app at a local API" section now documents
the household/item-creation wiring, the restrictions-half client-local note, and a walkthrough
("Running as a fresh user") for `EXPO_PUBLIC_IDENTITY_TOKEN=fixture.new.user`: create or join, add
an item manually, see it on S4/S5. §8 below has the exact env names.

**Invariant fix found along the way.** `HttpApiClient`'s internal delegate used to start from
`FixtureApiClient.returningUser()` — the fully onboarded, hardcoded Chen fixture household. Now that
`getOnboardingState`/`createHousehold`/`joinHousehold` are real, starting there would have been a
household this client invented rather than got from the server. The delegate still starts from
`returningUser()` (kept only for `confirmAiProposal`'s pre-existing, still-fixture-only inventory —
see §5), but a new `FixtureApiClient.clearHouseholdUntilServerSaysOtherwise()` strips just its
household immediately in the constructor, so `HttpApiClient` genuinely starts with no assumed
household.

## 2. Mapping table

| Call | Server DTO in | Client type out | Error code(s) → rendering |
|---|---|---|---|
| `createHousehold` | `CreateHouseholdRequestDto` → `CreateHouseholdResponseDto` | `HouseholdDto & { joinCode?: string }` | any non-2xx → `LedgerRefusedError(code)`; caller (S1) renders via `messageForLedgerError` → generic fallback for an unrecognised code (e.g. `BAD_REQUEST` from an invalid name, defence in depth — the client already validates) |
| `joinHousehold` | `JoinHouseholdRequestDto` → `JoinHouseholdResponseDto` | `JoinHouseholdResult` (`{ ok: true, household, alreadyMember }` \| `{ ok: false, message }`) | `JOIN_CODE_INVALID` (404) → `JOIN_CODE_ERROR_MESSAGE` ("That code didn't match a household...") · `RATE_LIMITED` (429) → `RATE_LIMITED_MESSAGE` ("Too many tries. Wait a few minutes and try again.") · anything else (5xx, network) → `GENERIC_LEDGER_ERROR_MESSAGE` |
| `getOnboardingState` | `GET /v1/households/me` → `HouseholdSummaryDto` (or 403) | `OnboardingStateDto` | 403 → `{ household: null }` (not an error); other non-2xx → thrown `Error` (uncaught by any screen today, same convention as every other malformed-response path in this file) |
| `createItem` | `CreateItemRequestDto` → `InventoryItemSummaryDto` | `InventoryItemSummaryDto` | `IDEMPOTENCY_KEY_CONFLICT` (409) → its §8 sentence ("That request was already used for a different change...") · any other `ledgerCode` (e.g. `INVALID_FIELD`, 400) → generic fallback, via the existing `ledgerErrorMessage` default case — no change needed there |

`householdSyncInputFromSummary` (exported, pure) is the `HouseholdSummaryDto` → sync-input mapping
used by all three household calls: `member.displayInitials` becomes the client's `displayName`
(M2-T3 never sends a full name — `household.ts`'s header, rule 2), `isCaller` is dropped (unused by
onboarding state).

## 3. What was verified against the running API versus tests only

**Tests only (fake `fetch`, `apps/mobile/src/api/client.test.ts`):** path/method/header/body shape
for every call; 200-replay vs 201-create for `createItem`; the network-retry-reuses-the-same-key
test (and the "gives up after exhausting retries" test) for `createItem`, mirroring the existing
`correctQuantity` pattern; 409/400 → `LedgerRefusedError` mapping for `createItem`; 404/429/other →
`JoinHouseholdResult` mapping for `joinHousehold`, including a mutation-style check that the
server's own error `message` never reaches the returned string; `alreadyMember` mapping (`false`
then `true`); `getOnboardingState`'s 403-is-null path and its restrictions-preserved-across-a-resync
path; malformed-body rejection for both new POST calls; the pure `householdSyncInputFromSummary`
mapping and `FixtureApiClient.syncHouseholdFromServer`'s merge/drop behaviour, independent of any
`fetch` mock; env token selection (`apps/mobile/src/config/env.test.ts`).

**Against the real running API** (`apps/mobile/src/api/client.live.test.ts`, gated on
`SK_LIVE_API_TEST=1`, never run in CI or by default `pnpm test`): a throwaway PG17 cluster, migrated,
built, and seeded per CONTRIBUTING.md; the API started with `SK_IDENTITY=fixture` against it. Five
live assertions, all passing on the final clean run (§4):

1. `fixture.new.user` creates a household over HTTP, gets a real one-time join code matching the
   server's `XXXX-NNN` shape, and reads it back via `getOnboardingState`.
2. `fixture.maya.chen` joins the seeded Chen household with `CHEN-482`, and a second join with the
   same code resolves `alreadyMember: true` (no second membership row).
3. A wrong code (`WRONG-000`) resolves the exact S1 string, never the server's own message.
4. The eleventh join attempt in the window (a separate persona, `fixture.owner.other`, never used
   for a join elsewhere in the file) resolves the §8 rate-limit string.
5. `fixture.dean.chen` creates an item via `createItem` (`MANUAL`), and it is readable back through
   both `getInventoryItems()` (present in the list) and `getInventoryItem(itemId)` (matching summary,
   one `INITIAL_STOCK` history row).

One real finding from this pass, not a code defect: my first attempt used `unit: "each"`'s sibling
`"count"`, which `CREATE_ITEM_UNITS_DTO` does not accept (`packages/contracts/src/units.ts`'s count
unit is `"each"`) — a test-data mistake in this worker's own script, not a product bug (the real S9
screen already sources its unit list from `UNITS_BY_KIND_DTO`, never the literal `"count"`). Caught
and fixed before the clean final run; noted in the live test file's own comment.

## 4. Verification (commands, counts, empty build state, CI order)

From an empty build state (`apps/{api,mobile}/dist`, `packages/{adapters,contracts,domain}/dist`,
every `*.tsbuildinfo` deleted), in CI order, run twice (once before the live-API pass, once again
after fixing a lint violation the live-test file introduced):

- `pnpm install --frozen-lockfile` — lockfile up to date, no changes.
- `pnpm lint` — clean.
- `pnpm typecheck` (`tsc -b --pretty`) — clean.
- `pnpm test` (`vitest run`) — **114 test files passed, 1 skipped (the gated live-test file); 1719
  tests passed, 355 skipped (350 pre-existing DB suites without `DATABASE_URL` + 5 in the skipped
  live-test file).** No test deleted or weakened; two pre-existing tests were updated because their
  premise changed (the old "not available yet" rejections), not removed — see §5.
- `pnpm format:check` — clean.
- `pnpm --filter mobile export` (all three platforms) — succeeded, output deleted afterward both
  times.

**Live-API pass** (CONTRIBUTING.md's native-cluster recipe, `C:\Program Files\PostgreSQL\17\bin`):

```
initdb -D <scratch>\pgdata -U postgres --auth=trust -E UTF8
pg_ctl -D <scratch>\pgdata -o "-p 55432" -l <scratch>\pg.log start
DATABASE_URL=postgres://postgres@localhost:55432/postgres pnpm --filter api db:migrate
pnpm --filter api build
DATABASE_URL=... pnpm --filter api db:seed:fixture   # 9 items created, 15 ledger rows appended
SK_IDENTITY=fixture NODE_ENV=development DATABASE_URL=... node apps/api/dist/server.js
SK_LIVE_API_TEST=1 SK_LIVE_API_BASE_URL=http://localhost:3000 \
  npx vitest run apps/mobile/src/api/client.live.test.ts   # 5/5 passed, final clean run
```

Server and cluster stopped afterward (`Stop-Process`, `pg_ctl ... stop`), scratch data directory
removed (`Remove-Item -Recurse -Force`). Nothing left running; the throwaway database no longer
exists.

## 5. Deviations and judgment calls

1. **`createHousehold`'s return type changed** from `Promise<HouseholdDto>` to
   `Promise<HouseholdDto & { readonly joinCode?: string }>`. Backward compatible (every existing
   test/caller reading `.name`/`.members` is unaffected), and the only way to surface the one-time
   join code at all — the interface had nowhere else to put it. `FixtureApiClient.createHousehold`
   now also returns `joinCode: FIXTURE_JOIN_CODE`, for interface parity (that is already the only
   code the fixture ever accepts, so this is not a new fact, just an explicit one).
2. **`JoinHouseholdResult`'s `ok: true` branch gained an optional `alreadyMember` field.** Additive,
   `undefined` on the fixture path.
3. **`apps/mobile/app/onboarding/account.tsx` touched** (normally out of scope: "only if a mapping
   forces a change, state it"). Two things forced it: `createHousehold` can now genuinely reject
   (the fixture path never did — the screen had no `try`/`catch` at all), and the one-time join code
   now exists and needs somewhere to be shown once, per the ticket's own acceptance criterion. Both
   are handled with the smallest change that satisfies them: a `try`/`catch` rendering through the
   existing `messageForLedgerError`/notice-box pattern already used for the join-code error, and a
   confirmation card ("Household created. Your join code: XXXX-NNN. Save it to invite others.") with
   a `Continue` button before navigating to S2, rather than showing the code and navigating past it
   in the same tap. This copy is **not yet in copy-deck.md §11** — proposed here for the architect to
   apply at acceptance, same pattern as M3-T2/M3-T4a's own proposed-copy precedent in this file's doc
   comment. No component test exists for `account.tsx` (none existed before this ticket either); the
   new paths were verified by hand (typecheck, the copy-scan lint rule, and manually walking the flow
   against the live API — see §3) rather than by a new RNTL test, which felt like scope creep for a
   Sonnet plumbing ticket. Flagged for the reviewer (§6) as the thinnest coverage in this diff.
4. **No network retry on `createHousehold`/`joinHousehold`.** `CreateHouseholdRequestDto` and
   `JoinHouseholdRequestDto` carry no idempotency key (M2-T3 never gave either endpoint one), so
   retrying a `fetch` throw blindly could create a second household or double-count a join attempt
   against the rate limiter. `createItem`/`correctQuantity`/etc. all have a key and do retry;
   these two do not, on purpose. `joinHousehold` still resolves the generic fallback on a network
   throw (never retried, never surfaced as a raw exception) since its return type already models
   "this didn't work"; `createHousehold` lets the throw propagate (matches every other malformed/
   network-failure path in this file).
5. **`HttpApiClient`'s internal delegate still starts from `FixtureApiClient.returningUser()`**, not
   `.newUser()`, specifically to keep `confirmAiProposal`'s pre-existing test
   (`apps/mobile/src/inventory/item-detail-screen.test.ts`) passing unmodified — it exercises that
   method against a known fixture item id (`fixture-item-strawberries`) only `returningUser()`'s
   inventory has. Switching to `.newUser()` (my first attempt) broke that test. The new
   `clearHouseholdUntilServerSaysOtherwise()` reconciles both: the inventory fixture
   `confirmAiProposal` still needs stays, the household half it does not need starts null.
   `confirmAiProposal` having no real endpoint at all, and its `this.inventory` being unrelated to
   real HTTP items, is a pre-existing gap this ticket does not close (documented in the module's own
   doc comment, both before and after this change).
6. **`GENERIC_LEDGER_ERROR_MESSAGE` imported from `../inventory/errors`** (a file outside this
   ticket's listed scope) rather than duplicated. Read-only import of an existing exported constant,
   not an edit to that file.

## 6. What the reviewer should attack first

- **`account.tsx`'s scope justification** (§5.3): is the mapping-forced-change bar met, or should the
  join-code display have been left for M3-T6/profile instead, with this ticket only plumbing the
  client-side type? The prototype shows the join code on a *profile* screen, not S1 — I read the
  ticket's "shown once on S1" literally, but it's the least certain call in this diff.
- **The no-retry decision for `createHousehold`/`joinHousehold`** (§5.4): confirm this is the right
  read of "no idempotency key on this endpoint" rather than something this ticket should have
  escalated as a contracts gap.
- **`clearHouseholdUntilServerSaysOtherwise` / keeping `returningUser()` alive under `HttpApiClient`**
  (§5.5): is stripping just the household enough, or does any other `returningUser()` fixture state
  (shopping rows, `appliedShoppingWrites`) need the same treatment? I checked: `HttpApiClient` never
  delegates shopping calls (they all reject "not available yet" directly), so I believe it's inert,
  but it is exactly the kind of leftover-fixture-state risk worth a second look.
- **The `joinCode` field bolted onto `HouseholdDto`** (§5.1): reasonable shape, or should this have
  been a separate return type / a dedicated interface method instead of an intersection type?
- Mutation-test the copy-deck string mapping the way M3-T4a's review did (e.g. mutate
  `RATE_LIMITED_MESSAGE` or swap the 404/429 branches and confirm exactly the targeted tests fail).

## 7. Escalations and proposed backlog entries

- **Proposed copy-deck.md §11 addition** (S1, new, not yet binding): after "Create household",
  a confirmation state — "Household created. Your join code: {code}. Save it to invite others."
  button "Continue" — and a failure state reusing the existing generic-fallback wording. No em dash,
  sentence case, consistent with the rest of §11's voice.
- **Follow-up worth a ticket, not done here:** `account.tsx` has no component test at all (pre-existing
  gap, not introduced by this ticket, but this ticket adds two new interactive paths — the failure
  notice and the join-code confirmation — with no automated coverage of either beyond typecheck/lint/
  manual walk-through). Suggest an RNTL test file for S1 alongside whichever ticket next touches this
  screen (M3-T6 profile is the next one scheduled near it).
- **Not a defect, but worth a note for M2-T4a or a shared fixtures doc:** the units a test author
  might reach for by habit (`"count"`) are not what the real registry accepts (`"each"`); nothing to
  fix, just flagging since it cost real time to find live and a comment elsewhere (a shared
  test-fixtures note) might save the next person the same trip.

## 8. Env names added and README wording

- **`EXPO_PUBLIC_IDENTITY_TOKEN`** (app-facing, `apps/mobile/README.md`'s "Pointing the app at a local
  API" section): the bearer token `HttpApiClient` authenticates as; unset defaults to
  `fixture.dean.chen`. Documented alongside a "Running as a fresh user" walkthrough using
  `fixture.new.user`.
- **`SK_LIVE_API_TEST`** / **`SK_LIVE_API_BASE_URL`** (test-only, not `EXPO_PUBLIC_*`, never read by
  the shipped app): gate/target `apps/mobile/src/api/client.live.test.ts`. Documented in that file's
  own doc comment and in this report (§4), not added to `apps/mobile/README.md` (a developer-facing
  live-verification harness, not a way to run the app) or `.env.example` (root `.env.example` already
  omits `EXPO_PUBLIC_API_URL`, set inline by convention in this repo — same precedent followed here).
