# apps/mobile

Expo (managed workflow) + Expo Router client (ADR-001, D-005). M3-T1 shipped
the app scaffold, design tokens, the tab shell and a fixture `ApiClient`;
M3-T2 added onboarding (S1 account + household, S2 allergies); M3-T3 added
the inventory list (S4), item detail with ledger history (S5), the provenance
legend, and an `HttpApiClient` that can read the real inventory list over the
network (see "Pointing the app at a local API" below); M3-T4a wired
corrections, removals, undo and AI confirmation to the M2-T2 write endpoints
over that same client. Household/onboarding state stays fixture-only until
M2-T3 adds its endpoints; no real auth yet (D-022). M3-T4c added a web
target (see "Run it in a browser" below) alongside the existing phone path.

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
and history, Add hub, Manual add, Scan (the permission/typed-fallback path is
expected on web, since browsers do not grant `expo-camera` access the same
way a phone does) and the provenance Legend) bundles and renders on web the
same as on a phone: no screen branches on `Platform.OS === "web"` to change
allergen or provenance rendering, only (where needed) layout.

**A known local caveat (Windows + OneDrive, Andy's machine).** If
`pnpm --filter mobile export` fails with an `EINVAL`/`readlink` error naming
some unrelated file under `node_modules/.pnpm/...`, that is OneDrive Files
On-Demand racing Metro's web file-crawler on this exact folder (it is synced
by OneDrive, and the crawler occasionally misreads OneDrive's own
reparse-point bookkeeping on an ordinary file as a symlink, then fails to
`readlink()` it, which is fatal to `export` though not to the dev server).
It reproduces intermittently, on a different file each time, is not caused
by anything in this app's code, dependencies, or config, and could not be
worked around from within this ticket's file scope (see
`docs/handoff/M3-T4c.worker.md` for what was tried). `pnpm --filter mobile
start` (this section, above) does not hit it the same way and is the
reliable way to check a screen in a browser locally; CI's export smoke check
runs on Linux, which has no OneDrive and no NTFS reparse points, so it is not
expected to see this.

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

## Pointing the app at a local API (M3-T3)

By default the app talks to nothing: `src/api/client.ts`'s `apiClient`
singleton is a `FixtureApiClient` (in-memory, no network, no persistence
across restarts). Setting `EXPO_PUBLIC_API_URL` before starting the dev
server switches inventory list reads (`GET /v1/inventory/items`) to a real
`HttpApiClient` against that base URL, bearer-authenticated as the fixture
identity (`fixture.dean.chen`, `tests/fixtures/identity/README.md`):

```powershell
$env:EXPO_PUBLIC_API_URL = "http://localhost:4000"
pnpm --filter mobile start
```

Expo inlines `EXPO_PUBLIC_*` variables into the bundle at build/start time
(its own convention, not something this app configures beyond reading it);
changing the value needs a restart, not just a reload. `src/config/env.ts` is
the one file in this app allowed to read `process.env` (eslint.config.js
carries a matching single-file exemption). Nothing else in the app touches
it directly.

The same `HttpApiClient` also carries the item detail/history read and every
write M2-T2 exposes (corrections, removals, undo) over real `fetch` calls,
wired in M3-T4a; nothing about writes changes based on this section, they
just ride the same `EXPO_PUBLIC_API_URL` switch as the list read. Only
onboarding/household state and `confirmAiProposal` (AI-tier confirmation)
still delegate to an internal fixture client even with the variable set:
those wait on the M2-T3 endpoints (see that class's doc comment in
`src/api/client.ts` for the exact split). Leave the variable unset (the
default) and every one of those calls, reads and writes alike, stays
fixture-backed: in-memory, no network, nothing persists across a restart.

**Giving a local API something to show (M2-T2).** A freshly migrated database
holds no inventory, so the list arrives empty. `pnpm --filter api db:seed:fixture`
writes the fixture identities and the Chen household's inventory, the same nine
items the prototype draws, so S4 shows real rows read over the network. It needs
`DATABASE_URL`, refuses to run unless `NODE_ENV` is unset, `development` or
`test`, and can be re-run as often as you like: a second run changes nothing.
Full instructions are in [CONTRIBUTING.md](../../CONTRIBUTING.md#seeding-a-development-database-m2-t2).

M2-T2 also added the endpoints behind those fixture-only writes:
`POST /v1/inventory/items/{itemId}/transactions` (corrections and removals),
`POST /v1/inventory/items/{itemId}/transactions/{transactionId}/undo`, and
`GET /v1/inventory/items/{itemId}` for the detail screen.

Unset the variable (or leave it unset) to go back to the fixture client.

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
typed fallback instead) — the camera path itself is owed a real-device check
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
