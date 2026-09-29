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
actually landed and only the response was lost); flagged for the reviewer in §6. A non-2xx
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
`displayInitials`, M2-T3 never sends a full name, wholesale from the server, but preserves
whichever `restrictions`/`noneConfirmed`/`preferences` that same delegate instance already has for a
member id that is still present. `saveMemberRestrictions`/`savePreferences` are unchanged: they still
delegate straight to that same fixture instance, so restrictions keep working exactly as they did
before this ticket, just attached to real member ids instead of the hardcoded Dean/Maya pair. The
S2 gate semantics (M3-T2) are untouched.

**(d) `createItem`.** `POST /v1/inventory/items`, reusing `input.idempotencyKey` (already minted by
the caller, S8/S9, at Save-tap time, the M3-T4a pattern), unchanged across this method's own
network retry (mirrors `postWrite`'s rule). 200 (replay) and 201 (created) both resolve the same
`InventoryItemSummaryDto`. A non-2xx throws `LedgerRefusedError`; 409 `IDEMPOTENCY_KEY_CONFLICT`
and any 400 validation code already render through the existing `ledgerErrorMessage`
switch/default (no change needed there, see §2). No extra "refetch the list" plumbing was added:
`getInventoryItems()` always attempts a fresh network read first (it only falls back to a cache on
failure), so S4 already shows a newly created item the next time it loads.

**(e) `EXPO_PUBLIC_IDENTITY_TOKEN`.** `src/config/env.ts` gained `getIdentityToken()`: trims and
returns the variable when set, else `"fixture.dean.chen"` (restated as a literal, not imported from
`client.ts`, to avoid a module cycle: that file already imports `getApiBaseUrl` from here).
`HttpApiClient.getIdentityToken()`/`authHeaders()` now call it instead of the hardcoded constant.
`FixtureApiClient.getIdentityToken()` is untouched (always the hardcoded constant: the fixture-backed
app's identity is unaffected).

**(f) README.** `apps/mobile/README.md`'s "Pointing the app at a local API" section now documents
the household/item-creation wiring, the restrictions-half client-local note, and a walkthrough
("Running as a fresh user") for `EXPO_PUBLIC_IDENTITY_TOKEN=fixture.new.user`: create or join, add
an item manually, see it on S4/S5. §8 below has the exact env names.

**Invariant fix found along the way.** `HttpApiClient`'s internal delegate used to start from
`FixtureApiClient.returningUser()`, the fully onboarded, hardcoded Chen fixture household. Now that
`getOnboardingState`/`createHousehold`/`joinHousehold` are real, starting there would have been a
household this client invented rather than got from the server. The delegate still starts from
`returningUser()` (kept only for `confirmAiProposal`'s pre-existing, still-fixture-only inventory,
see §5), but a new `FixtureApiClient.clearHouseholdUntilServerSaysOtherwise()` strips just its
household immediately in the constructor, so `HttpApiClient` genuinely starts with no assumed
household.

## 2. Mapping table

| Call | Server DTO in | Client type out | Error code(s) → rendering |
|---|---|---|---|
| `createHousehold` | `CreateHouseholdRequestDto` → `CreateHouseholdResponseDto` | `HouseholdDto & { joinCode?: string }` | any non-2xx → `LedgerRefusedError(code)`; caller (S1) renders via `messageForLedgerError` → the exact household-name sentence for `BAD_REQUEST` (review F9), generic fallback for anything else |
| `joinHousehold` | `JoinHouseholdRequestDto` → `JoinHouseholdResponseDto` | `JoinHouseholdResult` (`{ ok: true, household, alreadyMember }` \| `{ ok: false, message }`) | `JOIN_CODE_INVALID` (404) → `JOIN_CODE_ERROR_MESSAGE` ("That code didn't match a household...") · `RATE_LIMITED` (429) → `RATE_LIMITED_MESSAGE` ("Too many tries. Wait a few minutes and try again.") · anything else (5xx, network) → `GENERIC_LEDGER_ERROR_MESSAGE` |
| `getOnboardingState` | `GET /v1/households/me` → `HouseholdSummaryDto` (or 403) | `OnboardingStateDto` | 403 → `{ household: null }` (not an error); other non-2xx → thrown `Error` (uncaught by any screen today, same convention as every other malformed-response path in this file) |
| `createItem` | `CreateItemRequestDto` → `InventoryItemSummaryDto` | `InventoryItemSummaryDto` | `IDEMPOTENCY_KEY_CONFLICT` (409) → its §8 sentence ("That request was already used for a different change...") · any other `ledgerCode` (e.g. `INVALID_FIELD`, 400) → generic fallback, via the existing `ledgerErrorMessage` default case, no change needed there |

`householdSyncInputFromSummary` (exported, pure) is the `HouseholdSummaryDto` → sync-input mapping
used by all three household calls: `member.displayInitials` becomes the client's `displayName`
(M2-T3 never sends a full name, `household.ts`'s header, rule 2), `isCaller` is dropped (unused by
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
unit is `"each"`), a test-data mistake in this worker's own script, not a product bug (the real S9
screen already sources its unit list from `UNITS_BY_KIND_DTO`, never the literal `"count"`). Caught
and fixed before the clean final run; noted in the live test file's own comment.

## 4. Verification (commands, counts, empty build state, CI order)

From an empty build state (`apps/{api,mobile}/dist`, `packages/{adapters,contracts,domain}/dist`,
every `*.tsbuildinfo` deleted), in CI order, run twice (once before the live-API pass, once again
after fixing a lint violation the live-test file introduced):

- `pnpm install --frozen-lockfile`: lockfile up to date, no changes.
- `pnpm lint`: clean.
- `pnpm typecheck` (`tsc -b --pretty`): clean.
- `pnpm test` (`vitest run`): **114 test files passed, 1 skipped (the gated live-test file); 1719
  tests passed, 355 skipped (350 pre-existing DB suites without `DATABASE_URL` plus 5 in the skipped
  live-test file).** No test deleted or weakened; two pre-existing tests were updated because their
  premise changed (the old "not available yet" rejections), not removed, see §5.
- `pnpm format:check`: clean.
- `pnpm --filter mobile export` (all three platforms): succeeded, output deleted afterward both
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
   join code at all: the interface had nowhere else to put it. **Corrected in review round 1 (F1,
   §9): `FixtureApiClient.createHousehold` originally also returned `joinCode: FIXTURE_JOIN_CODE`,
   "for interface parity"; that premise was wrong (the fixture path never showed a code after
   create) and is now removed, `joinCode` is `HttpApiClient`-only.**
2. **`JoinHouseholdResult`'s `ok: true` branch gained an optional `alreadyMember` field.** Additive,
   `undefined` on the fixture path.
3. **`apps/mobile/app/onboarding/account.tsx` touched** (normally out of scope: "only if a mapping
   forces a change, state it"). Two things forced it: `createHousehold` can now genuinely reject
   (the fixture path never did, the screen had no `try`/`catch` at all), and the one-time join code
   now exists and needs somewhere to be shown once, per the ticket's own acceptance criterion. Both
   are handled with the smallest change that satisfies them: a `try`/`catch` rendering through the
   existing `messageForLedgerError`/notice-box pattern already used for the join-code error, and a
   confirmation card ("Household created. Your join code: XXXX-NNN. Save it to invite others.") with
   a `Continue` button before navigating to S2, rather than showing the code and navigating past it
   in the same tap. This copy is **not yet in copy-deck.md §11**, proposed here for the architect to
   apply at acceptance, same pattern as M3-T2/M3-T4a's own proposed-copy precedent in this file's doc
   comment. **Correction (review F8): the sentence below originally claimed more than was true.** No
   component test exists for `account.tsx` (none existed before this ticket either); the new paths
   were **not verified in the UI**. Only typecheck, the copy-scan lint rule, and the client-level live
   suite (§3) ran, and that suite calls `HttpApiClient`'s methods directly, never `account.tsx`'s own
   rendered screen: it is not a UI walk, and this report should not have implied it stood in for one.
   Flagged for the reviewer (§6) as the thinnest coverage in this diff; round 1 (§9) closes this gap
   with real component tests.
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
   (`apps/mobile/src/inventory/item-detail-screen.test.ts`) passing unmodified: it exercises that
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
  client-side type? The prototype shows the join code on a *profile* screen, not S1, I read the
  ticket's "shown once on S1" literally, but it's the least certain call in this diff. **Resolved by
  review round 1 (F1, §9): the premise was wrong either way, the fixture path never showed a code at
  all; the interstitial is HTTP-only now.**
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

- **Proposed copy-deck.md §11 addition** (S1, new, not yet binding, HTTP path only per F1): after
  "Create household", a confirmation state: "Household created. Your join code: {code}. Save it to
  invite others." button "Continue"; and a failure state reusing the existing generic-fallback
  wording. No em dash, sentence case, consistent with the rest of §11's voice.
- **Resolved in review round 1 (§9):** `account.tsx` had no component test at all (pre-existing gap,
  not introduced by this ticket, but this ticket added two new interactive paths, the failure notice
  and the join-code confirmation, with no automated coverage of either beyond typecheck/lint/manual
  walk-through). §9 adds `account-screen.test.ts` and `account-screen-http.test.ts`.
- **Not a defect, but worth a note for M2-T4a or a shared fixtures doc:** the units a test author
  might reach for by habit (`"count"`) are not what the real registry accepts (`"each"`); nothing to
  fix, just flagging since it cost real time to find live and a comment elsewhere (a shared
  test-fixtures note) might save the next person the same trip.
- **Added in review round 1 (F3, §9):** `app/add/scan.tsx`'s Save path carries the same
  idempotency-key-hold/single-flight shape `app/add/manual.tsx` now has, but that file is M2-T4a's
  territory right now (in flight in parallel); out of scope here, proposed as a follow-up once that
  ticket lands, or for M3-T4e when the client wires `lookupProduct`.
- **Backlog only (F4, from review round 1, not done here):** the server refuses `createHousehold`/
  `joinHousehold` for an already-affiliated caller, or S1 redirects away when a household already
  exists; the Join card is disabled after a successful create (the last bullet of F4, the
  create/join mutual-exclusion guard, *is* done, see §9). None of these three block anything today
  (the fixture path has always allowed re-creating/re-joining, and no current flow lands a caller on
  S1 with a household already on file), but they are real gaps worth their own ticket.

## 8. Env names added and README wording

- **`EXPO_PUBLIC_IDENTITY_TOKEN`** (app-facing, `apps/mobile/README.md`'s "Pointing the app at a local
  API" section): the bearer token `HttpApiClient` authenticates as; unset defaults to
  `fixture.dean.chen`. Documented alongside a "Running as a fresh user" walkthrough using
  `fixture.new.user`.
- **`SK_LIVE_API_TEST`** / **`SK_LIVE_API_BASE_URL`** (test-only, not `EXPO_PUBLIC_*`, never read by
  the shipped app): gate/target `apps/mobile/src/api/client.live.test.ts`. Documented in that file's
  own doc comment and in this report (§4), not added to `apps/mobile/README.md` (a developer-facing
  live-verification harness, not a way to run the app) or `.env.example` (root `.env.example` already
  omits `EXPO_PUBLIC_API_URL`, set inline by convention in this repo, same precedent followed here).

## 9. Review fixes (round 1)

Independent review verdict: **PASS WITH FIXES**. Architect rulings on F1-F11 applied below, same
branch (`m3-t4d-client-wiring`). No architecture conflict. Invariants unchanged; no contracts change;
no new dependency; no em dashes in UI text (or, per F8, in this report from here on: the 31 the
review counted in §1-§8 above are gone too).

**F1 [major]: the fixture path never showed a join code; the interstitial is HTTP-only.**
`FixtureApiClient.createHousehold` (`apps/mobile/src/api/client.ts`) no longer returns `joinCode`.
The ticket's "shown once on S1, exactly as the fixture path shows CHEN-482 today" premise was wrong:
`CHEN-482` was always only the *join* card's placeholder example, never a code the fixture displayed
after creating a household, and the prototype puts a household's code on S12/profile. `HouseholdDto
& { joinCode?: string }` stays the return type (still `HttpApiClient`-only, still additive), but
`FixtureApiClient`'s copy of it is gone; `account.tsx`'s existing `if (created.joinCode)` branch
already did the right thing once that one field stopped being set, no screen logic changed. Added
two new component-test files (this repo's one-file-per-client-type convention, see their own doc
comments): `apps/mobile/src/onboarding/account-screen.test.ts` (fixture path: create lands on S2
directly, no interstitial) and `account-screen-http.test.ts` (HTTP path: the interstitial renders
with the code, `Continue` lands on S2).

**F2 [major]: `app/_layout.tsx` and `app/onboarding/allergies.tsx` now fail CLOSED on a rejected
read.** `_layout.tsx`'s `getOnboardingState()` read gained a `readErrorPathname` state, compared
against the *current* `pathname` before `read` is ever consulted: a rejection (network, 401, 5xx)
at cold start or on a later navigation's re-read both render "Couldn't load your household." plus
the §8 read fallback and a `Try again` button, and neither `<Slot />` nor `<Redirect />` renders on
that branch, so a deep link straight at `/inventory` or `/add` can no longer ride a stale success
past a fresh failure on its own read. `allergies.tsx` got the identical shape (a `loadError` state, a
`load` callback, the same fallback copy) instead of spinning its `ActivityIndicator` forever. New
test files: `apps/mobile/src/onboarding/root-layout.test.ts` (cold-start rejection renders the
fallback and nothing else; a later navigation's rejection does not render the destination; `Try
again` re-reads and, on success, renders it) and `allergies-screen.test.ts` (the same two cases for
S2's own read). Both needed `ActivityIndicator` added to the mocked `react-native` module for that
one test file (`allergies-screen.test.ts`'s own doc comment explains why: the shared stand-in,
`src/test-support/react-native-mock.ts`, does not export it, and every render of S2 passes through
it for one frame before `drafts`/`loadError` settle).

**F3 [major]: `app/add/manual.tsx` holds its `createItem` idempotency key across retaps, plus a
single-flight guard.** A `useRef<string | null>` (`heldIdempotencyKey`) is minted once per Save
attempt and reused on a retap after a failure; every input change (name, the count stepper, unit
kind, unit, location) calls `forgetHeldKey()` first, so a changed payload never replays under a key
minted for a different body. A second `useRef` (`saveInFlight`), the same synchronous-guard shape as
`account.tsx`'s `requestInFlight` (F11), stops two Save taps in the same frame from both reaching
`createItem`. Three new tests in `apps/mobile/src/scan/manual-screen.test.ts`: two taps in one frame
produce exactly one call with one key; a failed save followed by an unchanged retap produces two
calls sharing the same key, and the retap succeeds; a changed input after a failure produces two
calls with two *different* keys. `app/add/scan.tsx`'s Save path is the same shape but is M2-T4a's
territory right now (in flight in parallel); out of scope here, proposed in §7 as a follow-up.

**F4 [minor]: create and join can no longer be in flight together; the rest is backlog.** The last
bullet (the actual guard) is the same `requestInFlight` ref F11 needed anyway: one flag shared by
both `handleCreateHousehold` and `handleJoinHousehold`, so a tap on either while the other is running
is refused, and the UI additionally disables both cards' inputs/buttons while either `householdBusy`
or `joinBusy` is true (a new `anyBusy` in `account.tsx`). The other three items (server-side refusal
for an already-affiliated caller, an S1 redirect when a household already exists, disabling the Join
card after a successful create) are backlog-only per the ruling; recorded in §7, not implemented.

**F5 [minor]: "Signed in as Dean Chen." is fixture-path only.** Gated on
`hasDevOfflineToggle(apiClient)` (`apps/mobile/src/api/client.ts`'s existing fixture-vs-HTTP feature
check: `true` only for `FixtureApiClient`), so the HTTP path (any `EXPO_PUBLIC_IDENTITY_TOKEN`) never
renders it. Covered by both new S1 test files: the fixture-path file asserts it renders, the HTTP
one asserts it does not.

**F6 [minor]: `clearHouseholdUntilServerSaysOtherwise` pinned.** Three new tests in
`apps/mobile/src/api/client.test.ts`: `saveMemberRestrictions` on a fresh `HttpApiClient` (before any
server read) rejects; `savePreferences` does too; and neither ever calls `fetch`, checked both before
and after a real `createHousehold` round trip (one `fetch` call total across both restriction calls
plus the household create). No code change was needed, the behaviour already held; this locks it in.

**F7 [minor]: README: the API start step, the real default port, and the LAN IP.** New "Starting the
local API" subsection in `apps/mobile/README.md` ahead of the fresh-user walkthrough: migrate, build,
seed, then `SK_IDENTITY=fixture NODE_ENV=development node apps/api/dist/server.js`, with an explicit
note that the server's own default port is `3000` (`apps/api/src/server.ts`'s `DEFAULT_PORT`) while
every `EXPO_PUBLIC_API_URL` example on the page uses `4000`, so either set `$env:PORT = "4000"` to
match or use `http://localhost:3000` instead. Added a note that the server binds `0.0.0.0` and logs
every address including a LAN one, pointing a phone at that LAN address rather than `localhost`, the
same rule the existing "Run it on Dean's phone" section already states for Expo's own URL. The one
em dash on the old line 160 is gone (rewritten as a parenthetical), and the whole file was re-checked
for any others.

**F8 [minor]: report corrections.** All 31 em dashes in §1-§8 above are gone (mechanical rewrite,
comma/colon/parenthesis/period as the sentence needed, no meaning changed). §5.3 originally claimed
the new `account.tsx` paths were verified "manually walking the flow against the live API": that
overclaimed what `client.live.test.ts` actually does (it calls `HttpApiClient`'s methods directly,
never renders `account.tsx`), corrected in place to say plainly that the UI was not verified live,
only by typecheck, lint and (now, this round) mocked component tests.

**F9 [minor]: the exact household-name sentence, and rendered-message assertions.** `account.tsx`
now special-cases a `LedgerRefusedError` with `code === "BAD_REQUEST"` (the server's household-name
refusal has no `ledgerCode`, so `messageForLedgerError` alone would have fallen through to the
unrelated ledger-save generic fallback) to the exact copy-deck §8 sentence, "Give the household a
name of 1 to 60 characters.", added locally as `HOUSEHOLD_NAME_REFUSAL_MESSAGE` since
`inventory/errors.ts` (where the equivalent ledger table lives) is outside this ticket's file scope.
Two new `account-screen-http.test.ts` tests assert the rendered text, not just the error code, for
this path and for "any other failure renders the generic fallback instead". The two existing
`createItem` 400/409 tests in `client.test.ts` gained a second assertion each, calling
`messageForLedgerError` on the caught error and checking the exact rendered string
(`GENERIC_LEDGER_ERROR_MESSAGE` for 400 `INVALID_FIELD`, the §8 conflict sentence for 409).

**F10 [minor]: a malformed 2xx join body resolves `ok: false`.** `HttpApiClient.joinHousehold`
(`apps/mobile/src/api/client.ts`) now wraps its `response.json()` parse in a `.catch(() => null)` and
returns `{ ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE }` for both an unparsable body and one
that parses but does not match `JoinHouseholdResponseDto`'s shape, rather than throwing. Two new
`client.test.ts` tests: an empty-object body, and a body that is not JSON at all.

**F11 [minor]: `useRef` single-flight guard for create and join.** `account.tsx` gained
`requestInFlight` (a `useRef<boolean>`, not state): both `handleCreateHousehold` and
`handleJoinHousehold` check and set it synchronously, before any `await`, so two taps dispatched in
the same frame (a double-tap, or two calls issued back to back in a test with no `await` between
them) cannot both reach the network, closing the exact race React state alone cannot (two reads of
`householdBusy`/`joinBusy` before either `setState` commits). Two new `account-screen.test.ts` tests:
two Create-household taps in one frame produce exactly one `createHousehold` call; a Create-household
tap while a join is in flight is refused (the shared-flag half of F4).

**Verification, round 1 (empty build state, CI order, same commands as §4):**
`pnpm install --frozen-lockfile` (up to date), `pnpm lint` (clean), `pnpm typecheck` (clean),
`pnpm test`: **119 test files (118 passed, 1 skipped, the gated live file), 2095 tests (1740 passed,
355 skipped: 350 pre-existing DB suites plus 5 in the skipped live file)**, `pnpm format:check`
(clean, after one `prettier --write` pass on two files this round touched), `pnpm --filter mobile
export` (all three platforms, output deleted). Live suite run a second time this round, against a
second fresh throwaway PG17 cluster built and torn down the same way as §4: **5/5 passed**, server
and cluster stopped and the scratch directory removed afterward.

**What the reviewer should attack first, round 2:** the `ActivityIndicator`-aliased-to-`View` mock in
`allergies-screen.test.ts` (a narrow, file-scoped `vi.mock("react-native", ...)` on top of the shared
stand-in, needed because that stand-in does not export it; check it does not mask a real rendering
difference the shared mock exists to catch); whether `account.tsx`'s new `anyBusy` cross-disabling
(F4) is the right UX for the *rest* of F4 (still backlog) or should have been folded in now; and
whether `forgetHeldKey()` on every keystroke in the name field (F3) is too eager (it is safe, just
mints more keys than strictly necessary if someone edits the name and edits it back).
