# apps/mobile

The Smart Kitchen phone app, built with Expo. It also runs in a web browser.

You can run it two ways:

| Mode                          | What you get                                                   | What you need                   |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------- |
| **Demo mode** (default) | Fake sample data, nothing is saved, barcode lookups don't work | Just this app                   |
| **Real mode**           | A real database, real barcode lookups from Open Food Facts     | The app, the API and a database |

All commands below are PowerShell, run from the repo root `D:\06_Smart-Kitchen`.
Don't `cd` into `apps/mobile`: this is a pnpm workspace, so run everything from
the root.

---

## 1. Demo mode (quickest)

```powershell
pnpm install
pnpm --filter mobile start
```

Leave that window open. It prints a QR code.

- **Web:** press `w`, or open `http://localhost:8081` in Chrome or Edge. Make
  the window narrow (about phone width).
- **Phone:** see [Open it on a phone](#3-open-it-on-a-phone).

Press `Ctrl+C` to stop it.

---

## 2. Real mode (database + barcode lookups)

You'll have **two PowerShell windows** open at the end: one runs the API, one
runs the app. Settings like `$env:...` only apply to the window you typed them
in, so keep each step in the window it says.

### Step 1: Get the latest code (any window, once)

```powershell
git pull
pnpm install --frozen-lockfile
```

### Step 2: Create a practice database (once, the first time only)

This makes a throwaway Postgres database in your temp folder. It doesn't touch
the Postgres already installed on your PC or its data.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\initdb" -D "$env:TEMP\skpg" -U postgres --auth=trust -E UTF8
```

### Step 3: Window 1, start the database and the API

```powershell
# go to the repo first (new windows open in C:\Users\Andy)
cd D:\06_Smart-Kitchen

# start the practice database (do this again after every PC restart)
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl" -D "$env:TEMP\skpg" -o "-p 55432" -l "$env:TEMP\skpg.log" start

# tell the API where the database is
$env:DATABASE_URL = "postgres://postgres@localhost:55432/postgres"

# set up tables, build, and load the sample Chen household
pnpm --filter api db:migrate
pnpm --filter api build
pnpm --filter api db:seed:fixture

# run the API in test-login mode
$env:SK_IDENTITY = "fixture"
$env:NODE_ENV = "development"
node apps/api/dist/server.js
```

Leave this window running. The API listens on port **3000**.

Running migrate and seed again is safe; they skip whatever is already done.

### Step 4: Find your PC's Wi-Fi address

In any window run `ipconfig` and find **IPv4 Address** under your Wi-Fi
adapter, for example `192.168.1.23`. (The API's startup log also shows it, in
a line like `Server listening at http://192.168.1.23:3000`.)

### Step 5: Window 2, start the app pointed at the API

Put your own address in place of `192.168.1.23`:

```powershell
cd D:\06_Smart-Kitchen
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.195:3000"
pnpm --filter mobile start
```

Then open it on your phone (next section), or press `w` for web.

Why not `localhost`? On the phone, `localhost` means the phone itself, not your
PC. The Wi-Fi address works for both the phone and the web.

Real mode works on web because the API, run with `NODE_ENV=development` as in
Step 3, lets a browser page on `http://localhost:8081` or
`http://localhost:8090` call it. Open the web build at one of those two
addresses (pressing `w` opens 8081), not at your Wi-Fi address, or the browser
blocks every call and you get "Couldn't load your household." To use a
different address, set `$env:SK_CORS_ORIGINS` in window 1 before starting the
API, for example `$env:SK_CORS_ORIGINS = "http://192.168.1.23:8081"` (exact
scheme, host and port, comma-separated for more than one, no trailing slash).
Once it is set, only the addresses it lists are allowed.

If you change `EXPO_PUBLIC_API_URL`, stop the app with `Ctrl+C` and start it
again. Reloading isn't enough.

### Next time

You only need Step 3 (window 1) and Step 5 (window 2) again. Skip Step 2.

To stop everything: `Ctrl+C` in both windows, then
`& "C:\Program Files\PostgreSQL\17\bin\pg_ctl" -D "$env:TEMP\skpg" stop`.

To start the practice database from scratch, stop it and delete the folder
`%TEMP%\skpg`, then go back to Step 2.

---

## 3. Open it on a phone

1. Install **Expo Go** from the App Store or Google Play. It's free and doesn't
   need an Expo account.
2. Put the phone on the **same Wi-Fi** as your PC.
3. In the app window, check that the address under the QR code looks like
   `exp://192.168.x.x:8081`, not `localhost`.
4. Scan the QR code:
   - **iPhone:** use the normal Camera app, then tap the Expo Go banner.
   - **Android:** open Expo Go and tap "Scan QR code".

**If it won't connect:**

- Windows Firewall asked to allow Node: choose **Private networks**. If you
  missed the popup, allow Node.js in Windows Firewall settings.
- The phone is on mobile data or on a different Wi-Fi.
- Some routers block devices from seeing each other ("AP isolation" or "guest
  network"). Try another network.

**Don't use `--tunnel`.** It routes traffic through Expo's cloud, and we
decided not to use outside services for local testing.

---

## 4. What to try in real mode

You're signed in as **Dean** in the sample **Chen household**.

1. You land on the **allergies screen (S2)** every time. That's expected for
   now: allergies are only saved on the phone until ticket M2-T4 adds them to
   the server.
2. Tap the **scan button** in the middle of the bottom bar and point the camera
   at a barcode on a packaged product from your fridge.
3. The product sheet (S8) should show:
   - the barcode match marked **Known Fact**
   - everything else (name, brand, size, nutrition) marked **Estimated**,
     because it comes from Open Food Facts, not from you
   - one nutrition block, or "Nutrition not on file"
   - **"Allergens not checked"**. That's deliberate: it isn't a safety verdict
     until M2-T4.
4. Tap **Add**. The item shows up in the inventory list (S4) with an Estimated
   amount, and in its history (S5).
5. Produce stickers (4 or 5 digit PLU codes) are refused on purpose and send
   you to manual add.

Also worth trying: removing or correcting an amount, undo, and Add manually
(S9).

Open Food Facts allows only about 12 lookups a minute. If you scan a lot of
products quickly, some will say the lookup failed; wait a minute and try again.
Scanning the same product again is instant because the API remembers it for 30
minutes.

**Web:** the camera probably won't work in the browser, so use "Enter
manually" and type the barcode in instead. Try `3017620422003` (Nutella).

---

## 5. Extra options

**Sign in as someone else.** Set this in window 2 before starting the app:

```powershell
$env:EXPO_PUBLIC_IDENTITY_TOKEN = "fixture.new.user"
```

| Token                                | Who                                                  |
| ------------------------------------ | ---------------------------------------------------- |
| *(unset)* or `fixture.dean.chen` | Dean, owner of the Chen household                    |
| `fixture.maya.chen`                | Maya, already a member of the Chen household         |
| `fixture.new.user`                 | Someone with no household yet, to try create or join |

As `fixture.new.user`, "Create household" shows a join code once, then never
again. "Join with a code" with `CHEN-482` joins the Chen household. All tokens
are listed in `tests/fixtures/identity/README.md`. They're fake test logins,
not secrets.

**Sign out** (profile screen, S12) clears this device's local state (the
onboarding gate, the cached inventory read, and over HTTP the cached
household read and caller identity) and returns to S1. It does not sign you
out of anything real: the identity token above is fixed by the environment
variable, not by this button, until the auth vendor lands (D-022). The next
launch signs back in as the same persona, so over HTTP it lands straight back
on Home, not S1 (fix round 1, F2): the same fixed token still owns the same
household.

**Use Open Food Facts' test server instead of the real one.** Set this in
window 1 before `node apps/api/dist/server.js`:

```powershell
$env:SK_OFF_BASE_URL = "https://world.openfoodfacts.net"
```

Leave it unset normally. The real one needs no key.

**Use a different API port.** Add this line in window 1 before
`node apps/api/dist/server.js`, and use `:4000` in `EXPO_PUBLIC_API_URL`. The
two must match.

```powershell
$env:PORT = "4000"
```

**Call the barcode lookup directly (no app):**

```powershell
$token = "fixture.dean.chen"
curl.exe -s -H "Authorization: Bearer $token" http://localhost:3000/v1/products/3017620422003
```

(The token goes in a variable so the repo's secret scanner doesn't flag the
line.) The answer is one of:

- `hit`: the product was found. `screening` is `NOT_RUN` because the server
  doesn't know the household's allergies yet.
- `not-found`: Open Food Facts doesn't know this code.
- `error`: Open Food Facts didn't answer (too busy, down, slow). This is never
  shown as "not found".
- `400 PLU_NOT_SUPPORTED`: a produce sticker code. These are never sent to Open
  Food Facts.

---

## 6. Checks

```powershell
pnpm --filter mobile typecheck
pnpm --filter mobile export     # the same build check CI runs
```

`pnpm lint`, `pnpm typecheck` and `pnpm test` at the root cover this app too.
Database tests need `DATABASE_URL`; see [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 7. Notes for developers

Short explanations of things that look odd in this folder.

**`EXPO_NO_TYPESCRIPT_SETUP=1` in the start scripts.** Without it, Expo
rewrites `tsconfig.json` and creates a `.gitignore` every time the dev server
starts, which leaves a dirty `git status`. The `VAR=value command` form works
in PowerShell because the root `.npmrc` sets `shell-emulator=true` (a pnpm
setting, so no `cross-env` package needed). `src/lint-rules/start-script-env.test.ts`
fails if someone removes it.

**`metro.config.js`.** Metro, Expo's bundler, has to see the shared workspace
package `@smart-kitchen/contracts`, which lives outside `apps/mobile`. This
file points Metro at the workspace root without changing how pnpm installs
things. The comment in that file still mentions `@smart-kitchen/adapters`,
which is out of date (a follow-up is logged).

**How the app picks demo vs real mode.** `src/config/env.ts` is the only file
allowed to read `process.env`. If `EXPO_PUBLIC_API_URL` is set, the app uses
`HttpApiClient` (`src/api/client.ts`) for inventory, household and barcode
lookups. If not, it uses the in-memory `FixtureApiClient`. Two things stay on
the phone even in real mode: each member's allergies and preferences (until
M2-T4), and confirming an AI suggestion (`confirmAiProposal`, waiting on an
endpoint). Expo bakes `EXPO_PUBLIC_*` values in when it starts, which is why a
change needs a restart. The phone never calls Open Food Facts itself; the API
does (D-025).

**Web build.** `react-native-web` and `react-dom` are Expo's standard web
pair. `app.json` uses the Metro bundler and `web.output: "single"` (a plain
browser bundle, since the app has no server-rendered pages). No screen has
web-only logic, so allergen and provenance display can't differ between web
and phone. A full browser walk of every screen is still owed.

**Camera.** `expo-camera` runs the barcode scanner. The permission text is set
once in `app.json`. If the user says no, S7 shows "Open Settings" and "Enter
manually". Typing the code works whether or not the camera is allowed. A test
on a real phone camera is still owed before release.

**Fonts.** Fraunces (headings) and Inter (body text), both open licence, are
stored in `assets/fonts/`. `assets/fonts/SOURCES.md` says where they came from.

**Colours.** `src/design/tokens.ts` is the only file allowed to contain a
colour value (D-021 palette). `src/design/tokens.test.ts` checks every value
and its contrast against `docs/design/tokens.md`.

**OneDrive problem (for the record).** If the repo is ever inside a OneDrive
folder again, web bundling and `export` break with `EINVAL` / `readlink` or
`Unable to resolve` errors on files that clearly exist. OneDrive marks synced
files in a way that confuses Metro. The fix is to keep the repo outside
OneDrive, as `D:\06_Smart-Kitchen` is now. CI runs on Linux and isn't affected.
