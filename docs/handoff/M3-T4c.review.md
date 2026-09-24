# M3-T4c review: web target for desk review, Expo start hygiene, SDK-aligned navigation dependencies

**Reviewer:** independent Sonnet session, read-only, working from a detached worktree outside OneDrive. **Branch:** `worktree-agent-a0410b3928f0bf320` @ `a4d2a3e`. **Baseline:** `main` @ `d9d04c4`. Committed by the architect at acceptance (CLAUDE.md rule 29); architect rulings and the environment finding are appended at the end.

## Verdict

**PASS WITH FIXES.** The tooling change is sound and every command the reviewer ran matched the worker's report. Two items had to close before DONE: (1) the README stated an unconfirmed root cause for the local export crash as settled fact where the worker's own report hedged it (rule 19); (2) the acceptance criterion "walk S1 to S9 and the legend in a browser" was verified by nobody, because neither agent can open a browser.

## Findings

**F1 (medium)** `apps/mobile/README.md`, "Run it in a browser" OneDrive paragraph: states "OneDrive Files On-Demand racing Metro's file crawler ... misreads reparse-point bookkeeping" as fact. The worker report says "most likely"; the architect's `attrib` check showed plain `A` on the failing files afterwards. Reword as a hypothesis or prove it.
**F2 (low, informational)** the dev-mode web bundle contains two `screenSubject` hits, both inside JSDoc comments in `fixture-restrictions.ts` and `fixture-products.ts`; `no-screening-import.test.ts` confirms no live reference. The exported, minified web bundle is clean for `test-support`, `__mocks__` and `screenSubject` (0 hits in both JS files).
**F3 (informational)** the real CI quality-job order is install, lint, typecheck, test, export, format:check, audit. `ci.yml` is untouched by this ticket. Verification ran in that order.
**F4 (low, informational)** local export timing outside OneDrive, warm cache: android+ios+web 25.4 s against android+ios 26.4 s, a wash. Not a proxy for CI's cold Linux run.
**F5 (verified, no issue)** `.npmrc` `shell-emulator=true` checked against every other script in the repo (root, `apps/api`, `packages/*`): none uses `VAR=value cmd` or other syntax the emulator would parse differently.

## Independently reproduced

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm lint` | pass, 0 errors, 0 warnings |
| `pnpm typecheck` | pass |
| `pnpm test` | 101 files, 1488 passed, 246 skipped (15 `[db-tests] SKIPPED`), matches the worker |
| `pnpm format:check` | pass |
| `pnpm --filter mobile export` (android, ios, web) | pass outside OneDrive, 25.4 s; web entry bundle 1.3 MB |
| exported web bundle grep `test-support`, `__mocks__`, `screenSubject` | 0 hits in both files |
| `pnpm --filter mobile start` then `git status --short` | clean; "Skipping TypeScript setup" printed; `tsconfig.json` byte-identical to main |
| negative control: `env -u EXPO_NO_TYPESCRIPT_SETUP npx expo start` | reproduces the rewrite (extends added, comments stripped) and writes `.gitignore`; the guard is load-bearing |
| mutation: drop the env var from `start`, run `start-script-env.test.ts` | 1 of 4 fails as intended; restored |
| dev server web bundle fetch | HTTP 200, 4.6 MB JS, no "Unable to resolve" |
| `npx expo install --check` | up to date |
| `grep -rn "Platform.OS" apps/mobile/app apps/mobile/src` | 0 hits |
| diff under `apps/mobile/app` and `apps/mobile/src` | only the new test file; no screen touched |
| em dash (U+2014) across the diff | 0 |
| eslint ignore justification: remove the two new entries, re-lint | reproduces the hard failure ("was not found by the project service", 2 errors); restored |
| `pnpm audit --audit-level=high` | 2 moderate, 0 high |
| lockfile `react-dom` resolution | 19.2.3 everywhere |

## Acceptance criteria

Pass: fresh-worktree install, lint, typecheck, format, test, export; clean tree after start; `expo install --check` up to date; web bundle exists and is clean; README followed literally works; tsconfig byte-identical plus negative-control proof; no test weakened; copy scan, boundary lint, float guard green; no em dashes. **Not verified:** the browser walk of S1 to S9 and the legend at phone width. Strong indirect evidence (full route tree bundles, no web branches) but nobody has looked at a rendered screen.

## Scope

All nine changed files inside the declared file scope. No screen, no `docs/**` beyond the handoff report, no ADR or DECISIONS change.

## Architect rulings and acceptance (2026-09-24)

**F1 closed by proving the mechanism, then rewriting the paragraph.** On the main checkout the file Metro could not find (`@expo/metro-runtime/src/location/install.ts`, 0 bytes, 67 hard links) carries reparse tag `0x9000201a` (OneDrive cloud placeholder) per `fsutil reparsepoint query`; Node's `readdir` reports it as a symlink, `lstat` does not, `readlink` returns `EINVAL`. 10,795 files under the main `node_modules` and 7,022 blobs in the global pnpm store carry the tag (hard links share the inode); 0 are cloud-only, 59 are zero-byte. `apps/mobile/src` and `app` files carry no tag; `packages/domain/src` and most of `docs` do. A checkout of the same branch under `%TEMP%` against the same store exports all three platforms cleanly, because its directory entries were never stamped. From the main checkout, the dev server's web bundle fails with `Unable to resolve "./location/install"` (HTTP 500), so pressing `w` there fails today. Conclusion: environmental, caused by the repo living inside OneDrive; nothing in the ticket. README paragraph rewritten to state exactly this and to point at a clone outside OneDrive as the fix. Recorded in STATUS.md as a PO decision item.

**Browser walk** reassigned from "reviewer" to the PO (agents cannot open a browser); owed and tracked in BACKLOG and STATUS like the real-device camera pass. The ticket is accepted on the verified criteria.

**Also fixed at merge:** one pre-existing em dash in the README (M3-T4b acceptance text). **Noted, not a ticket finding:** pnpm 12 forwards a literal `--` to scripts with the emulator on or off (`tsc -b --pretty "--"`), so `pnpm --filter mobile start -- --port N` does not reach Expo's `--port`; the README documents no such flag.

**Merged:** squash to main; verification on the merged tree from an empty build state: lint, typecheck, format:check, test (1488 passed, 246 skipped) all green; export verified outside OneDrive on the branch tip and left to CI (Linux) on main.
