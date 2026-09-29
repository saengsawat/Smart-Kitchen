# apps/mobile

Expo (managed workflow) + Expo Router client (ADR-001, D-005). M3-T1 shipped
the app scaffold, design tokens, the tab shell and a fixture `ApiClient`;
M3-T2 added onboarding (S1 account + household, S2 allergies); M3-T3 added
the inventory list (S4), item detail with ledger history (S5), the provenance
legend, and an `HttpApiClient` that can read the real inventory list over the
network (see "Pointing the app at a local API" below); M3-T4a wired
corrections, removals, undo and AI confirmation to the M2-T2 write endpoints
over that same client. M3-T4d wired household create/join/read and manual
item creation to the M2-T3 endpoints (see "Pointing the app at a local API"
below); the *restrictions half* of onboarding state (each member's
allergies/preferences) still stays entirely client-local, because the server
stores none of it until M2-T4 (A3 household permissions). No real auth yet
(D-022). M3-T4c added a web target (see "Run it in a browser" below)
alongside the existing phone path.

## Run it (Windows, Andy's machine)

From the repo root (this is a pnpm workspace; do not `cd` into `apps/mobile`
and run pnpm there):

```powershell
pnpm install
pnpm --filter mobile start
```

This starts the Expo dev server and prints a QR code in the terminal. Press
`w` to open the web build in a browser, or scan the QR code from a phone (see
below).

### Why `EXPO_NO_TYPESCRIPT_SETUP=1`

`start`/`android`/`ios` set `EXPO_NO_TYPESCRIPT_SETUP=1` inline before the
`expo` command. Without it, the Expo CLI's first-run "TypeScript setup" step
rewrites `apps/mobile/tsconfig.json` (adding `extends: expo/tsconfig.base`
and `.expo/types` to `include`, and stripping the M3-T1/M3-T4b comments that
explain why this file deliberately does not extend the workspace base
config) and writes a generated `apps/mobile/.gitignore`, every single time
the dev server starts. Both are tracked files; a background dev server
should never be the reason `git status` shows a diff. The env var makes the
CLI print `Skipping TypeScript setup: EXPO_NO_TYPESCRIPT_SETUP is enabled.`
and leave both files alone. `apps/mobile/src/lint-rules/start-script-env.test.ts`
pins the var onto all three scripts so a future edit can't drop it silently.

This only works identically on Windows and in CI because of the root
`.npmrc`: pnpm's `shell-emulator=true` runs package.json scripts through
pnpm's own bash-like shell instead of the OS shell, so `VAR=value command`
(the everyday POSIX way to scope one env var to one command) parses the same
way on Andy's machine as it does in CI's Ubuntu bash. No `cross-env`
dependency was added for this (CLAUDE.md rule 11: `shell-emulator` is a pnpm
feature, not a package).

## Run it in a browser (M3-T4c)

Same command as above (`pnpm --filter mobile start`), then press `w` in the
terminal, or open the URL it prints (typically `http://localhost:8081`) in
Chrome or Edge directly. `react-native-web` and `react-dom` (SDK 57's Expo
web pair, added this ticket) back the web build; `app.json`'s `web.bundler`
was already `"metro"` (the SDK 57 default, set at M3-T1) and `web.output` is
now `"single"` (a plain client-side bundle: this app has no server-rendered
routes, so there is nothing for Expo Router's default static-prerendering
output mode to buy it, and prerendering would additionally require every
screen to also run in a Node SSR context, which is never true here).

Every route in the app (onboarding S1/S2, Home, Inventory list, item detail
and history, Add hub, Manual add, Scan and the provenance Legend) bundles for
web, and the dev server serves the web bundle with no resolution errors. No
screen branches on `Platform.OS === "web"`, so allergen and provenance
rendering cannot differ between web and phone. What has not been checked by
anyone yet is how each screen looks in a browser: agents cannot open one. The
PO's browser walk (S1 to S9 plus the legend at a phone-width window) is owed
before M3-T4c counts as verified end to end. On web, expect the camera scan
screen to land on its permission or typed-code fallback path; that is a
guess until the walk confirms it.

**A known local caveat (Windows + OneDrive).** Development moved to
`D:_Smart-Kitchen`, outside OneDrive, on 2026-09-24; from there web bundling
and export work. Kept for the record in case a checkout ends up under
OneDrive again. If
`pnpm --filter mobile export` fails with an `EINVAL`/`readlink` error naming
some file under `node_modules/.pnpm/...`, or the web bundle fails with
`Unable to resolve "./location/install"` (or another file that plainly exists),
the checkout is under a OneDrive-synced folder. Confirmed 2026-09-24 at
M3-T4c acceptance: OneDrive Files On-Demand stamps every file it has synced
with a cloud-placeholder reparse tag (`fsutil reparsepoint query` shows tag
`0x9000201a`; 10,795 files under `node_modules` carried it, all hydrated,
none cloud-only). pnpm hard-links package files, so the tag lives on the
shared inode and reaches the global pnpm store and every other link. Metro's
file crawler reads directory entries, where a reparse point looks like a
symlink, and then either fails to `readlink` it (`EINVAL`, fatal to
`export`) or drops the file from its map (`Unable to resolve`). Node's
`lstat` says the same file is not a symlink, which is why nothing else in the
toolchain (tsc, vitest, eslint) notices. A checkout outside OneDrive is not
affected even against the same store, because its directory entries were
never stamped. Nothing in this app's code, dependencies or config causes it.
Fix: develop from a clone outside OneDrive (see STATUS.md, "OneDrive").
Workaround for one run: strip the tags under `node_modules` (safe only while
no file is cloud-only), or run from a checkout under `%TEMP%`. CI runs on
Linux with no OneDrive and is not affected.

## Run it on Dean's phone (Expo Go, same Wi-Fi, no tunnel, no account)

Requirements: Dean's phone and Andy's machine on the **same Wi-Fi network**,
and the **Expo Go** app installed from the iOS App Store or Google Play (free,
no Expo account needed to use it in this mode).

1. On Andy's machine: `pnpm --filter mobile start` (as above). Leave it
   running.
2. Check the terminal output for a URL starting `exp://` with a LAN IP
   address (e.g. `exp://192.168.1.23:8081`), not `exp://localhost:...` or a
   tunnel URL. That confirms it picked the LAN, not a relay.
3. On Dean's phone, open Expo Go and scan the QR code the terminal printed
   (iOS: use the Camera app then tap the Expo Go prompt; Android: use Expo
   Go's own "Scan QR code" button).
4. The app loads directly from Andy's machine over the LAN. No `--tunnel`
   flag, no ngrok, no Expo account sign-in, no cost (CLAUDE.md rule 17).

**If it doesn't connect:** the most common cause is a Windows Firewall
prompt the first time `expo start` binds a port. Allow it on "Private
networks" when prompted. If Dean's phone still can't reach it, confirm both
devices show the same Wi-Fi network name (a phone on mobile data, or a
router that isolates devices from each other "AP isolation", will look
connected but can't actually reach Andy's machine).

**Do not use** `pnpm --filter mobile start --tunnel`: a tunnel relays traffic
through Expo's cloud (an external service, and on Expo's free tier it also
nudges toward an account) which CLAUDE.md rule 17 says to avoid unless
approved; plain LAN mode is enough for same-network testing and was decided
against in D-023 planning ("no tunnel, no Expo account, no paid resource").

## Pointing the app at a local API (M3-T3, extended M3-T4d)

By default the app talks to nothing: `src/api/client.ts`'s `apiClient`
singleton is a `FixtureApiClient` (in-memory, no network, no persistence
across restarts). Setting `EXPO_PUBLIC_API_URL` before starting the dev
server switches every inventory read/write and the M2-T3 household/item
endpoints (below) to a real `HttpApiClient` against that base URL,
bearer-authenticated as `EXPO_PUBLIC_IDENTITY_TOKEN` when set, else the
fixture default (`fixture.dean.chen`, `tests/fixtures/identity/README.md`):

```powershell
$env:EXPO_PUBLIC_API_URL = "http://localhost:4000"
pnpm --filter mobile start
```

Expo inlines `EXPO_PUBLIC_*` variables into the bundle at build/start time
(its own convention, not something this app configures beyond reading it);
changing either value needs a restart, not just a reload. `src/config/env.ts`
is the one file in this app allowed to read `process.env` (eslint.config.js
carries a matching single-file exemption). Nothing else in the app touches
it directly.

The same `HttpApiClient` also carries the item detail/history read and every
write M2-T2 exposes (corrections, removals, undo) over real `fetch` calls,
wired in M3-T4a. M3-T4d (this ticket) added household create/join/read
(`POST /v1/households`, `POST /v1/households/join`, `GET /v1/households/me`,
the household half of S1's onboarding state) and manual item creation
(`POST /v1/inventory/items`, S9). The *restrictions half* of onboarding
state (each member's allergies/preferences) stays entirely client-local even
against a real API: the server stores none of it until M2-T4 (A3 household
permissions), so it keeps running through the same in-memory mechanism the
fixture path always used, just attached to the real member ids the server
returns (`FixtureApiClient.syncHouseholdFromServer`, `src/api/client.ts`).
Only `confirmAiProposal` (AI-tier confirmation) and barcode lookup
(`lookupProduct`, M3-T4e once M2-T4a lands) still reject/delegate to the
fixture: those wait on further endpoints. Leave `EXPO_PUBLIC_API_URL` unset
(the default) and every call, reads and writes alike, stays fixture-backed:
in-memory, no network, nothing persists across a restart.

**Starting the local API (review F7).** The steps above assume something is
already listening at `EXPO_PUBLIC_API_URL`; this is how to get one, migrated
and seeded, on the same machine. From the repo root, with a Postgres 17
database reachable (CONTRIBUTING.md's throwaway-cluster recipe if you do not
already have one running):

```powershell
$env:DATABASE_URL = "postgres://postgres@localhost:5432/postgres"
pnpm --filter api db:migrate
pnpm --filter api build
pnpm --filter api db:seed:fixture
$env:SK_IDENTITY = "fixture"
$env:NODE_ENV = "development"
node apps/api/dist/server.js
```

No `$env:PORT` above: the server's own default is `3000`
(`apps/api/src/server.ts`'s `DEFAULT_PORT`), so `EXPO_PUBLIC_API_URL` in
every example on this page (`http://localhost:4000`) assumes you *did* set
`$env:PORT = "4000"` before starting it: set both to the same port, or drop
`$env:PORT` here and use `http://localhost:3000` above instead. The server
binds `0.0.0.0` and logs every address it is listening on at startup,
including a LAN one (e.g. `http://192.168.1.23:3000`); for a phone on Expo
Go (same Wi-Fi, see "Run it on Dean's phone" below) set
`EXPO_PUBLIC_API_URL` to that LAN address, never `localhost`, the same
"pick the LAN, not a relay" rule that section already states for Expo's own
URL.

**Running as a fresh user (M3-T4d).** `EXPO_PUBLIC_IDENTITY_TOKEN` picks
which fixture identity `HttpApiClient` authenticates as
(`tests/fixtures/identity/README.md`); the API's dev seed
(`pnpm --filter api db:seed:fixture`, above) writes all four. Leave it unset
for Dean Chen (owner of the seeded Chen household, the default), or set it
to try the create/join flow from S1 as someone with no household yet:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://localhost:4000"
$env:EXPO_PUBLIC_IDENTITY_TOKEN = "fixture.new.user"
pnpm --filter mobile start
```

Walking S1 through as `fixture.new.user`: "Create household" posts the name,
shows the one-time join code once (it is never shown again, the plaintext
only ever travels on this one response), then "Continue" moves on to S2. "Join
with a code" against `CHEN-482` (the Chen household's seeded code) joins as a
new member instead. Either way, S9 "Add manually" from the inventory tab then
creates an item through `POST /v1/inventory/items`, which S4 lists and S5
shows with its `INITIAL_STOCK` row. `fixture.maya.chen` is the Chen
household's existing member, useful for trying the join flow's "already a
member" path (`CHEN-482` again resolves the same household, no new row).

**Giving a local API something to show (M2-T2).** A freshly migrated database
holds no inventory, so the list arrives empty. `pnpm --filter api db:seed:fixture`
(part of "Starting the local API" above) writes the fixture identities and
the Chen household's inventory, the same nine items the prototype draws, so
S4 shows real rows read over the network. It needs `DATABASE_URL`, refuses to
run unless `NODE_ENV` is unset, `development` or `test`, and can be re-run as
often as you like: a second run changes nothing. Full instructions are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#seeding-a-development-database-m2-t2).

M2-T2 added the endpoints behind the inventory writes above:
`POST /v1/inventory/items/{itemId}/transactions` (corrections and removals),
`POST /v1/inventory/items/{itemId}/transactions/{transactionId}/undo`, and
`GET /v1/inventory/items/{itemId}` for the detail screen. M2-T3 added the
household endpoints and `POST /v1/inventory/items` (item creation) above.

Unset `EXPO_PUBLIC_API_URL` (or leave it unset) to go back to the fixture
client; `EXPO_PUBLIC_IDENTITY_TOKEN` has no effect on the fixture path.

## Running barcode lookups against the API (M2-T4a)

The API answers `GET /v1/products/{code}` by asking Open Food Facts, server
side (D-025). The phone never talks to OFF. Until M3-T4e wires
`HttpApiClient.lookupProduct` to that endpoint, the app's scan screen still
uses the four fixture barcodes, so try the endpoint itself with curl:

```powershell
# API running as in CONTRIBUTING.md, with SK_IDENTITY=fixture and DATABASE_URL.
# Optional: $env:SK_OFF_BASE_URL = "https://world.openfoodfacts.net"  # OFF staging
# The fixture token is not a secret, but keep it out of the literal curl line so the
# repo's secret scanner (gitleaks, rule curl-auth-header) stays quiet.
$token = "fixture.dean.chen"
curl.exe -s -H "Authorization: Bearer $token" http://localhost:4000/v1/products/3017620422003
```

What comes back:

- `hit` with the product: identity is the barcode match; every label field
  (name, brand, size, nutrition, ingredients) is Estimated, source
  `open-food-facts`; `screening` is `{"status":"NOT_RUN"}` because the server
  does not store the household's allergies yet (M2-T4). S8 renders that as
  "Allergens not checked", never as a verdict.
- `not-found` when OFF does not know the code; the code is kept.
- `error` when OFF could not answer (rate limited, down, slow, unreadable).
  That is never reported as `not-found`.
- 400 `PLU_NOT_SUPPORTED` for a 4 or 5 digit produce code: those are never
  sent to OFF.

OFF allows 15 product reads per minute per IP; the API keeps itself to 12
and caches answers in memory for 30 minutes (misses for 5), so repeat scans
are free. After a 429 or 503 from OFF it sends nothing for a minute and
answers `error`. `SK_OFF_BASE_URL` and `SK_OFF_USER_AGENT` are in
`.env.example`.

## Typecheck / lint / test

These run as part of the root `pnpm lint` / `pnpm typecheck` / `pnpm test`
(see the repo root README and CONTRIBUTING.md). To run only this app's:

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile export   # the same smoke check CI runs
```

## Why a `metro.config.js`

pnpm's default node-linker (`isolated`) still lays out each workspace
package's own `node_modules` correctly, but Metro (Expo's bundler) also needs
to watch and resolve sibling workspace packages that live outside
`apps/mobile/`, today just `@smart-kitchen/contracts`
(`@smart-kitchen/adapters` was a dependency through M3-T2; M3-T3 removed it,
see that ticket's worker report). `metro.config.js` points Metro at the
workspace root for that, without changing anything about how the rest of the
workspace installs its dependencies (no root `.npmrc` edit, no
`node-linker=hoisted` switch). See the M3-T1 worker report for what was
tried and why this was the least invasive option that worked; the config
file itself (`apps/mobile/metro.config.js`, outside this ticket's file
scope) still names `@smart-kitchen/adapters` in its own comment as an
example, now stale, flagged for a small follow-up rather than edited here.

## Camera permission (M3-T4b, S7 barcode scan)

`expo-camera` (Expo's own module, the same rule-11 precedent as
`expo-font`/`expo-crypto`) backs S7's barcode scanner. `app.json`'s
`expo-camera` config plugin sets the iOS `NSCameraUsageDescription` /
Android `CAMERA` permission strings at prebuild time from one place:

```json
["expo-camera", { "cameraPermission": "KitchenSmart uses the camera to scan a barcode when you add food." }]
```

A managed Expo Go session on a phone prompts for camera access the first
time S7 opens; denying it (or dismissing the OS prompt) shows the
permission-denied state (copy-deck.md §7 S7) with a working "Open Settings"
and "Enter manually" (the typed-code fallback, always available whether or
not the camera is granted). No device was available to this ticket's worker
(`docs/handoff/M3-T4b.worker.md` records exactly what was verified on the
typed fallback instead); the camera path itself is owed a real-device check
before this ticket's work ships.

## Fonts

Fraunces (display) and Inter (body) are vendored under `assets/fonts/` from
Google Fonts' own OFL-licensed source repository; see
`assets/fonts/SOURCES.md` for the exact URLs, commit references and a note
on the variable-font weight limitation.

## Design tokens

`src/design/tokens.ts` is the only place a colour literal may appear in this
app (D-021 palette). `src/design/tokens.test.ts` pins every hex and
recomputes contrast for the seven D-021 fixes against
`docs/design/tokens.md` §2's formula.
