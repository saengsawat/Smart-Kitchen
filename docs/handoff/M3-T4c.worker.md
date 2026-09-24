# M3-T4c worker report

Branch: `worktree-agent-a0410b3928f0bf320` (isolated worktree off `main` at `d9d04c4`).
Implementation model used: Sonnet, per the ticket.

## Summary

Did (a) start hygiene, (b) the web target, (c) dependency alignment, (d) the
export smoke script change, and (e) the docs. Everything is green locally
except one thing I could not get green on this machine: `pnpm --filter
mobile export` (now that it includes `--platform web`) crashes here every
time, on a bug that is specific to this Windows machine's OneDrive-synced
checkout, not to the code. Details and evidence below; short version: the
web target itself works (proven through the dev server), only the static
export command's crawler is affected here, and CI runs on Linux where the
failure mode cannot occur.

## What changed, and why

### (a) Start hygiene

`apps/mobile/package.json`'s `start`, `android` and `ios` scripts now set
`EXPO_NO_TYPESCRIPT_SETUP=1` inline (`EXPO_NO_TYPESCRIPT_SETUP=1 expo start
...`). Root `.npmrc` (new file) sets `shell-emulator=true`, which makes pnpm
run package.json scripts through its own bash-like shell instead of the OS
shell, so that `VAR=value command` syntax parses identically on Windows and
in CI's Ubuntu bash. Chose this over a Node launcher script under
`apps/mobile/scripts/**` because it is a one-line, well-documented pnpm
feature (no new file to maintain, no risk of the launcher itself drifting
from the scripts it wraps) and needs no dependency (rule 11: not a package,
a pnpm config flag; no `cross-env` added).

Verified: `pnpm --filter mobile start -- --port 8082` (timeout-bounded,
non-interactive) printed `Skipping TypeScript setup: EXPO_NO_TYPESCRIPT_SETUP
is enabled.` and `Waiting on http://localhost:8082`; `git status --short`
showed nothing under `apps/mobile` afterward, no `apps/mobile/.gitignore`
was written, and `git diff main -- apps/mobile/tsconfig.json` was empty.
Ran this twice (once mid-ticket, once again after every other change was
committed) with the same clean result both times.

Added `apps/mobile/src/lint-rules/start-script-env.test.ts`: reads
`package.json` off disk and asserts `start`/`android`/`ios` all match
`^EXPO_NO_TYPESCRIPT_SETUP=1\s+expo `, and that `export` does **not** carry
the var (it never runs the TypeScript-setup step, so it would be a
copy-paste that adds nothing). 4 tests, all pass.

`eslint.config.js` ignores gained `**/.expo/**` (the ticket's own ask: the
generated `.expo/types/router.d.ts` was producing a lint warning) and, found
while verifying the above, `apps/mobile/expo-env.d.ts` (see "found along the
way" below).

### (b) Web target

`npx expo install react-native-web react-dom` from `apps/mobile` picked
`react-native-web@0.21.2` and `react-dom@19.2.3` (SDK 57's own pair). Pinned
`react-native-web` to the exact version (`expo install` wrote a caret range,
`^0.21.2`) to match how this file already pins every other non-`expo-*`
dependency (`react`, `react-native`, `react-dom`,
`react-native-safe-area-context`, `react-native-screens` are all exact).

`app.json`: `web.bundler` was already `"metro"` (SDK 57 default, M3-T1); added
`web.output: "single"`. This app has no server-rendered route and no SEO
need, so there is nothing for Expo Router's default `"static"` output mode
(per-route prerendering through a Node SSR context) to buy over a plain
client bundle, and `"static"` additionally requires every screen to also run
correctly under Node, which is untested and unnecessary here. `"single"` is
a plain SPA bundle, the same shape as `expo start`'s dev-server output.

No screen was touched. Every route already renders without a
`Platform.OS === "web"` branch (I checked; none of the app/src screens have
one), so the "layout-only web fixes" allowance in the ticket was not needed.

**Verification split, and why:** I could not get `pnpm --filter mobile
export` to finish once `--platform web` was in the platform list, on any
combination of settings, because of an environment bug unrelated to this
ticket's changes (root-caused below). What I could and did verify instead:

- `pnpm --filter mobile start -- --port 8082` (dev server, not export), then
  `curl -s http://localhost:8082/apps/mobile/node_modules/expo-router/entry.bundle?platform=web&dev=true`
  returned HTTP 200 and a 4.7 MB, well-formed Metro bundle. `grep -c
  UnableToResolveError` on it was 0. `grep -c "test-support\|__mocks__"` was
  0 (the invariant "no test-support or mock symbol in the web bundle" holds,
  at least for the dev-mode bundle: see the export caveat for why I could
  not check the static-export bundle the same way).
- I did not have a browser available to actually click through S1 to S9 and
  the legend (this worker runs headless). The bundle request above proves
  the whole route tree (`expo-router/entry`, which pulls in every route)
  bundles and evaluates without a resolution error, but a reviewer with a
  browser still needs to do the actual visual walk the acceptance criteria
  asks for.

### (c) Dependency alignment

`npx expo install --fix` bumped `react-native-safe-area-context` 5.10.0 →
5.7.0 and `react-native-screens` 4.28.0 → 4.26.2 (both exact pins, matching
the file's existing style). `npx expo install --check` now reports "up to
date".

### (d) CI smoke

`export` script: `expo export --platform android --platform ios --platform
web --output-dir dist`. Could not measure the time this adds on CI (see the
verification gap below); locally, before this ticket, `--platform android
--platform ios` alone took ~20s. Recommend the reviewer or architect note the
actual CI duration delta from the PR's Actions run once this is up, since I
cannot produce a real number for it myself here.

### (e) Docs

`apps/mobile/README.md`:
- New "Run it in a browser (M3-T4c)" section (what to run, what `web.output:
  "single"` means and why, which routes are covered, and the OneDrive/export
  caveat below).
- New "Why `EXPO_NO_TYPESCRIPT_SETUP=1`" subsection under "Run it".
- Fixed the stale "Pointing the app at a local API" paragraph: it said every
  write stayed fixture-only regardless of `EXPO_PUBLIC_API_URL`, but M3-T4a
  already wired corrections/removals/undo to the M2-T2 endpoints over the
  same `HttpApiClient`. Corrected to say what is actually still
  fixture-delegated (onboarding/household state, `confirmAiProposal`, both
  waiting on M2-T3), sourced from `src/api/client.ts`'s own doc comment
  rather than guessed.

`CONTRIBUTING.md`: one line in the mobile run section pointing at the new
browser path.

## The thing I could not fix: `expo export --platform web` on this machine

### What happens

`pnpm --filter mobile export` (with `--platform web` in the list) fails
every time on this machine, always the same shape:

```
Failed to construct transformer:  Error: EINVAL: invalid argument, readlink '<some file under node_modules/.pnpm/...>'
    at async Object.readlink (node:internal/fs/promises:965:10)
    ...
    at async #applyFileDelta (.../@expo+metro-file-map@57.0.3.../build/index.js:481:31)
    ...
TypeError: Cannot read properties of undefined (reading 'get')
```

The specific file named is **not stable across runs**: I saw it point at
`@expo/metro-runtime/src/location/install.ts` on some runs and at an
unrelated file, `css-in-js-utils/es/coverage/lcov-report/prettify.d.ts` (a
leftover coverage-report artifact bundled inside a transitive dependency's
npm package), on others. Same crash, different target file, no code or
config difference between runs.

### Root cause, as far as I traced it

`@expo/metro-file-map`'s crawler (`build/index.js:462`, the code path
`@expo export`'s static/single output modes use) calls `fs.readlink()` on
any directory entry Node's `Dirent.isSymbolicLink()` reports as a symlink.
Every file this crashed on is an ordinary hardlinked file inside pnpm's
`.pnpm` virtual store, not a real symlink (only the top-level package
folders like `apps/mobile/node_modules/@expo/metro-runtime` are symlinks in
pnpm's isolated layout; the files inside the real `.pnpm/<hash>/node_modules/
<pkg>` directories are plain hardlinks). `readlink()` on a non-symlink fails
with `EINVAL` on Windows. In the crawler's own error handling, `ENOENT`/
`EACCES` are treated as "file was deleted, drop it from the map silently";
anything else (including this `EINVAL`) is re-thrown, which crashes
`export`'s "single"/"static" bundling but is caught more gracefully by
`expo start`'s dev server (which logs the same underlying error to its
console but keeps serving).

The most likely explanation for why only this machine's `Dirent` info is
wrong: this repo lives under `C:\Users\Andy\OneDrive\...`, and OneDrive's
Files On-Demand client marks files under a synced folder with NTFS
reparse-point attributes as part of its own bookkeeping (not only for
cloud-only placeholders). Node's `Dirent.isSymbolicLink()` on Windows keys
off that same attribute bit, so it can misreport an ordinary, fully-local
file as a symlink purely because of where it sits on disk, non-deterministic
run to run (matches what I saw: the specific file it trips over changes
each run, consistent with a live attribute race against OneDrive's own
background scanning, not a fixed broken file). This is the same class of
risk already named, un-actioned, in `BACKLOG.md`'s M0-T1 follow-ups list:
"OneDrive-sync concern -> tracked in STATUS.md": this ticket is the first
to actually trip over it, because it is the first to touch Metro's web
bundling path (`android`/`ios` export never invokes `@expo/metro-file-map`
the same way and passed cleanly, repeatedly, throughout this ticket).

### What I ruled out (so the next person does not re-walk this)

All of the following were tested and made **no difference** to the crash:

- File content: emptied, then filled with unique text, then restored to
  exactly the original (verified byte-for-byte against the real npm
  registry tarball for `@expo/metro-runtime@57.0.16`: the file genuinely
  ships empty upstream; that was a red herring, not the cause).
- `@expo/metro-runtime`'s own `exports` map (added a wildcard subpath entry
  as a diagnostic; reverted; no effect either way: relative imports inside
  a package's own source were never gated by its `exports` field to begin
  with, so this was never a live theory, just ruled out for certainty).
- A `public-hoist-pattern` `.npmrc` entry targeting `@expo/metro-runtime`
  (did not change pnpm's peer-context duplication; reverted).
- Clearing every Metro cache directory I could find
  (`%TEMP%\metro-cache`, `%TEMP%\metro-file-map-expo-*`) and forcing a fully
  fresh crawl each time.
- `app.json`'s `web.output` mode (`"static"` default vs. `"single"`): both
  hit the identical root cause, just surfaced differently (`"static"`
  silently drops the misread file and reports a confusing "module not
  found"; `"single"` crashes loudly with the real `EINVAL`). Kept
  `"single"` regardless, since it is still the right choice for a
  client-only app independent of this bug.
- Retrying the same command repeatedly: fails every time, just on a
  different file, confirming it is not a one-off transient glitch that
  clears on retry.

None of the working fixes I could find (excluding `node_modules/.pnpm` from
OneDrive sync, moving the repo outside OneDrive, or switching pnpm's
`node-linker` from `isolated` to `hoisted`) are changes I could make inside
this ticket's file scope. The `node-linker` option in particular would
reverse a recorded M3-T1 decision (`apps/mobile/metro.config.js`'s own
comment: "no root `.npmrc` edit, no `node-linker=hoisted` switch, which was
the least invasive option available"): not something a worker changes
unilaterally per CLAUDE.md rule 25, and outside this ticket's stated file
scope regardless. I did not make that change.

### Why I believe CI is unaffected

`ci.yml`'s `quality` job runs on `ubuntu-latest`. The failure mode above is
an NTFS-reparse-point/`readlink` interaction that has no Linux/ext4
equivalent (`ubuntu-latest` also has no OneDrive client running against the
checkout). I could not actually prove this on a Linux box myself: this
worker has no WSL/Docker/Linux environment available to it in this sandbox
(I tried; both were refused by the harness). This is a real verification
gap, not a "should work": flagging it plainly per rule 19 rather than
claiming a green I do not have. The reviewer or architect should confirm
green on the PR's actual CI run before treating objective (d) as satisfied,
and if CI does fail, it will almost certainly be for a *different* reason
than what I saw locally (worth re-diagnosing fresh from the CI log rather
than assuming it is the same bug).

Documented this whole caveat plainly in `apps/mobile/README.md`'s new "Run
it in a browser" section too, since this is Andy's actual machine (same
OneDrive-synced path) and he will hit this exact failure the first time he
runs `pnpm --filter mobile export` locally, with no way to tell from the
error message alone that it is not his fault or this ticket's bug.

## Found along the way (not asked for, fixed because the ticket's own
verification steps surface it)

`apps/mobile/expo-env.d.ts` (an Expo CLI-generated file, gitignored since
M3-T1, written the first time `expo start`/`export` runs) sits outside
`apps/mobile/tsconfig.json`'s `"include"` list by design. Once it exists on
disk, `pnpm lint` fails outright ("was not found by the project service"),
not just a warning on that one file. Since the ticket's own acceptance
criteria has the reviewer run `pnpm --filter mobile start` as a check, then
presumably re-run the quality gates, they would hit this immediately.
Fixed by adding it to `eslint.config.js`'s ignores (same entry the ticket
already asked for `.expo/**`, one line further). In file scope
("`eslint.config.js` (ignores entry only)").

## Every file touched

- `apps/mobile/package.json`: `start`/`android`/`ios` scripts gain
  `EXPO_NO_TYPESCRIPT_SETUP=1`; `export` gains `--platform web`;
  `react-native-web`, `react-dom` added; `react-native-safe-area-context`,
  `react-native-screens` bumped to SDK 57 pins.
- `pnpm-lock.yaml`: reflects the above.
- `.npmrc` (new, root): `shell-emulator=true`.
- `eslint.config.js`: ignores gain `**/.expo/**` and
  `apps/mobile/expo-env.d.ts`.
- `apps/mobile/app.json`: `web.output: "single"` added.
- `apps/mobile/src/lint-rules/start-script-env.test.ts` (new): pins the env
  var on the three scripts.
- `apps/mobile/README.md`: new sections/paragraph fixes described above.
- `CONTRIBUTING.md`: one line in the mobile run section.
- `docs/handoff/M3-T4c.worker.md` (this file).

No `apps/mobile/app/**` or other `apps/mobile/src/**` screen files were
touched (no web-only layout fix was needed).

## Verification commands and results (empty build state, CI order)

Cleaned `dist/` and `*.tsbuildinfo` under every `apps/*` and `packages/*`
first, each time.

1. `pnpm install`: clean, resolved from the local store, no network
   surprises.
2. `pnpm install --frozen-lockfile`: passes (lockfile matches
   `package.json` across all changed packages).
3. `pnpm lint`: **pass**, 0 errors, 0 warnings.
4. `pnpm typecheck` (`tsc -b --pretty`): **pass**, no output (clean build).
5. `pnpm test` (`vitest run`, no `DATABASE_URL`): **pass**: 101 test files,
   1488 tests passed, 246 skipped (all 15 DB suites, each with its own named
   `[db-tests] SKIPPED: ...` line, exactly as `CONTRIBUTING.md` describes;
   0 failures).
6. `pnpm format:check` (`prettier --check .`): **pass**, "All matched files
   use Prettier code style!".
7. `pnpm --filter mobile export`: **fails** on this machine, every time,
   ~5-8s in, on the OneDrive/`readlink` bug described above. Not a code or
   config problem introduced by this ticket; see that section for the full
   trace, what was ruled out, and why CI should not see it.

Ran the whole sequence twice end-to-end (once mid-ticket after the web
target/dependency work, once again after every commit including the
`expo-env.d.ts` eslint fix) with identical pass/fail results both times.

## What I could not verify

- A real browser walk of S1-S9 and the legend at 390px (no browser in this
  sandbox). Verified the full route tree bundles and evaluates cleanly via
  the dev server instead (see "(b) Web target" above); a reviewer with a
  browser still needs to do the visual pass the acceptance criteria asks
  for.
- `pnpm --filter mobile export`'s actual pass/fail and timing on CI (Linux).
  Argued above why it should not hit the local failure, but did not and
  could not prove it from this sandbox.
- Whether the web bundle produced by `expo export` (as opposed to `expo
  start`'s dev bundle, which I did check) is free of `test-support`/
  `__mocks__` symbols, since I could never get a static export to finish.
  The dev bundle was clean; there is no code-path reason to expect the
  static export bundle to differ (same source, same `sourceExts`/
  `test-support` exclusion), but I want to be honest that I did not
  literally grep the static-export artifact, only the dev one.

## Copy needs

None. No screen needed a new string for the web target (no
`Platform.OS === "web"` branch exists anywhere in `apps/mobile/app` or
`apps/mobile/src`).

## Proposed doc wording for the architect

None beyond what is already written directly into `apps/mobile/README.md`
in this change (workers do not edit `docs/**` outside this report; the
README is in this ticket's own file scope, so that edit is already applied,
not proposed). If the architect wants the OneDrive/pnpm-isolated-linker risk
promoted out of the M0-T1 follow-up note and into a real ticket (e.g. "adopt
`node-linker=hoisted`, or document excluding `node_modules` from OneDrive
sync, or move local dev off OneDrive"), that is a call for the architect/PO,
not something I judged myself.
