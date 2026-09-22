# apps/mobile

Expo (managed workflow) + Expo Router client (ADR-001, D-005). M3-T1 shipped
the app scaffold, design tokens, the tab shell and a fixture `ApiClient`;
M3-T2 added onboarding (S1 account + household, S2 allergies); M3-T3 added
the inventory list (S4), item detail with ledger history (S5), the provenance
legend, and an `HttpApiClient` that can read the real inventory list over the
network (see "Pointing the app at a local API" below). Write actions
(corrections, removals, undo, AI confirmation) and household/onboarding state
stay fixture-only until M2-T2/M2-T3 add their endpoints; no real auth yet
(D-022).

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

Everything else on the `ApiClient` port (single-item detail/history,
onboarding/household state, and every write: corrections, removals, undo, AI
confirmation) has no endpoint yet and stays fixture-backed even with
`EXPO_PUBLIC_API_URL` set. `HttpApiClient` delegates those calls internally
(see that class's doc comment in `src/api/client.ts`). A real API started
this way returns an empty household today: **seeded rows arrive with M2-T2**
(`pnpm --filter api db:seed:fixture`, BACKLOG.md), which also supplies the
write endpoints this ticket's fixture-only methods stand in for. Unset the
variable (or leave it unset) to go back to the fixture client.

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
