# M3-T4d review: client wiring to the M2-T3 endpoints

Reviewer: Opus (independent session, read-only). Base: origin/main 32abd27. Branch: m3-t4d-client-wiring @ e8fce7d.

## Round 1 verdict: PASS WITH FIXES

The HTTP plumbing is right. On the client side the household comes only from the server: `getOnboardingState`, create and join all go to the wire, and a 403 maps to `household: null`. `createItem` passes the caller's key through unchanged on its one internal retry and never retries a refusal. The join error mapping renders only deck strings, and the swap mutations are caught. The live suite passes 5/5 against a real API the reviewer ran. Two things keep it off a clean PASS. First, the ticket's AC says the fixture-backed app is unchanged, and it is not: `FixtureApiClient.createHousehold` now returns `CHEN-482`, so the fixture S1 create flow grows a new interstitial that is not in the deck and that no test covers. That traces back to a wrong premise in the ticket, and the worker did not escalate it. Second, a few small in-scope fixes (a misleading identity line, an unpinned defensive line, the README walkthrough, and honesty and em-dash problems in the report). Making `getOnboardingState` network-backed also opens two real risks outside this ticket's file scope: the layout gate fails open when that read fails, and a user-level Save retry mints a new key.

## Findings

F1 [major] `apps/mobile/src/api/client.ts:695-705` (`FixtureApiClient.createHousehold` returns `joinCode: FIXTURE_JOIN_CODE`) together with `app/onboarding/account.tsx:73-78`. On the fixture path, create "The Smiths" and S1 no longer goes to S2; it shows "Household created. Your join code: CHEN-482. Save it to invite others." plus Continue. Breaks the AC "the fixture-backed app is unchanged", and tells The Smiths their code is CHEN-482, which on the fixture joins The Chens. No test pins either flow. Origin: Objective (a) says "exactly as the fixture path shows CHEN-482 today"; the fixture path never showed a code after create (CHEN-482 is the join-field placeholder; the prototype shows the code on S12). Fix: drop `joinCode` from the fixture create so fixture S1 goes straight to S2; keep the interstitial for the HTTP path only; the new string goes into copy-deck §11 at acceptance.

F2 [major, outside file scope] `app/_layout.tsx:50` with `client.ts:1172-1187`. `getOnboardingState` now rejects on network failure, 401 or 5xx over HTTP, and the layout's `.then` has no rejection handler. Cold start with the API down: the app renders nothing forever with an unhandled rejection. Later navigation: `read` keeps the previous pathname, `resolveLayoutRedirectForRead` returns null, and the destination renders with no gate, so a deep link to /inventory or /add bypasses S1 and S2 whenever the read fails. `allergies.tsx:70` has the same missing handler, so S2 spins forever. The server still refuses household routes (403), so no data leaks across households, but the S2 allergy gate fails open. Fix: fail closed on a rejected read (keep blocking, show the §8 read fallback with Try again).

F3 [major, outside file scope] `app/add/manual.tsx:149` (and `app/add/scan.tsx:206`). Both mint `nextIdempotencyKey()` inline on every Save tap with no busy guard: a save whose attempts both fail after the first actually landed, then a retap, gives a second item under a new key; so does a double tap. The invariant "one key per create, reused on every retry" holds only for `HttpApiClient`'s internal retry. `shopping.tsx` already shows the right pattern: hold the key until success or an input change.

F4 [minor, server-side plus client] Verified live: `POST /v1/households` as Dean, who already owns Chen, answered 201; `/me` then returned the new household and Dean's inventory read came back empty. Client side: S1 is reachable by Back from S2 with an empty form; the Join card stays live after a successful create; create and join can be in flight together. A user can silently move themselves out of their household. Backlog: the server refuses create and join for an already-affiliated caller (409), or S1 redirects when a household exists.

F5 [minor] `account.tsx:138`. "Signed in as Dean Chen." renders regardless of `EXPO_PUBLIC_IDENTITY_TOKEN`, so running as `fixture.new.user` tells Noor she is Dean.

F6 [minor] `client.ts:1032` `this.delegate.clearHouseholdUntilServerSaysOtherwise()`: deleting it leaves all 36 files / 551 mobile tests green. Effectively defensive today (server member ids never collide with fixture ids; every read hits the wire first). Pin it: `saveMemberRestrictions` on a fresh `HttpApiClient` before any server read rejects; `saveMemberRestrictions` and `savePreferences` make zero fetch calls.

F7 [minor] `apps/mobile/README.md:171-190`. No API start step; uses `localhost:4000` while the API defaults to port 3000; `localhost` does not reach the dev machine from a phone (LAN IP); line 160 adds an em dash.

F8 [minor, rules 19 and 31] The worker report §5.3 claims the account.tsx paths were verified by "manually walking the flow against the live API"; §3 and §4 describe only the vitest live suite. Correct to "not verified in the UI". 31 em dashes. No fabricated acceptance or review section (checked; the report ends at §8).

F9 [minor] `client.ts:1203-1213`. A create-household 400 renders the generic fallback although §8 has "Give the household a name of 1 to 60 characters."; the createItem 400 test asserts only `code`.

F10 [minor] `client.ts:1262-1264`. A malformed 2xx on join throws into `handleJoinHousehold` (`try/finally`, no catch): unhandled rejection. Resolve as `{ ok: false, message: GENERIC }`.

F11 [minor] `account.tsx:70`. `disabled={householdBusy}` takes effect only after a re-render; two taps in one frame both fire. Add a `useRef` in-flight guard for create and join.

## Acceptance criteria check
- `fixture.new.user` S1 creates and shows the code once: met on the client (live test gets an `XXXX-NNN` code); no UI walk evidence (F8).
- Maya joins Chen with CHEN-482, and again idempotently: met (live, `alreadyMember: true`).
- Wrong code shows the S1 string: met (live and fake-fetch; mutation caught).
- Eleventh wrong try shows the §8 rate-limit string: met (live; mutation caught).
- S9 manual add creates an item that S4 lists and S5 shows with `INITIAL_STOCK`: met at client level (live).
- A retried save after a network failure results in one item: met for the internal retry (mutation caught); not met for a user retap (F3).
- The fixture-backed app is unchanged: **not met** (F1).
- All suites green from an empty build state: met.

## Invariants check
- Never assume a household not from the server: holds on the read paths; the constructor clear is unpinned (F6); the gate fails open when the read fails (F2).
- One key per create, reused on every retry: internal retry pinned (mutation caught); user retap unpinned and broken (F3).
- 409 never retried with a new key: pinned (`calls === 1`).
- Join errors render only deck strings: pinned (404/429/other, "never the server message"); no screen renders a response-body message.
- No restrictions to or from the server: structurally true; no test asserts zero fetches (F6).
- No new dependency: holds.
- No em dashes in UI text: holds; docs violate rule 31 (F7, F8).

## Scope ruling
- `account.tsx`: the try/catch is a legitimate mapping-forced change (create can now reject). Showing the HTTP join code is defensible given Objective (a). Changing the fixture path to show one is not (F1).
- Everything else inside scope. Nothing touched `packages/**`, `apps/api/**`, `apps/mobile/src/scan/**` or `app/add/scan.tsx`. No contracts change.

## Judgment calls
- No retry on create or join household: accept. Without an idempotency key a blind retry could create a second household (F4 shows the server accepts it). A key on those DTOs belongs to OQ-E4.
- Fixture delegate kept (`returningUser()` stripped of its household): accept for now; it only supports `confirmAiProposal`'s pre-existing fixture test. Pin it (F6); retire it when `confirmAiProposal` gets an endpoint.
- Env default `fixture.dean.chen`: accept (read through `src/config/env.ts`, Expo inlines it, 4 tests, README; a fixture persona, not a secret).

## Verification
- Fresh worktree, no `dist/` or `*.tsbuildinfo` before the run. `pnpm install --frozen-lockfile` ok; lint clean; typecheck clean; `pnpm test`: **114 files passed, 1 skipped; 1719 tests passed, 355 skipped** (matches the worker); format:check clean; mobile export ok (all platforms, output deleted).
- Mutations (restored): constructor clear removed: not caught (F6); `JOIN_CODE_INVALID` branch disabled: caught; `RATE_LIMITED` branch disabled: caught; key re-minted on retry: caught.
- Live run: throwaway PG17 cluster (port 55433), migrate, build, seed (9 items, 15 rows), API on port 3917 with `SK_IDENTITY=fixture`; `SK_LIVE_API_TEST=1 ... client.live.test.ts`: **5/5 passed**. Extra curls: `/me` as the Okafor owner 200; bogus token 401 `UNAUTHENTICATED`; Dean creating a second household 201 and `/me` switched to it (F4). Server and cluster stopped, data directory removed.
- The live suite is `describe.runIf(SK_LIVE_API_TEST === "1")`: skipped by default and in CI, weakens nothing when skipped.

## Notes for the architect
- Fix before merge (in scope): F1 (or amend the AC), F5, F6 tests, F7, F8; optional in the same pass F9, F10, F11.
- Backlog: F2 (layout fails closed on a failed onboarding read; §8 read fallback on S2); F3 (hold the createItem key across user retries, busy guard on S8 and S9); F4 (server refuses create or join for an affiliated caller, or S1 redirects; DECISIONS entry on multi-household semantics since `/me` silently follows the newest membership); keys on create and join (OQ-E4); the S1 component test.
- At acceptance: add the S1 post-create confirmation string (HTTP path) to copy-deck §11 once F1 is settled; note in §11 that over HTTP the S2 member headings render initials because M2-T3 sends no full name; correct the ticket's CHEN-482 premise in BACKLOG.
- Every HTTP-path launch lands a returning user on S2, because restrictions are in-memory only. Matches the ticket; say so in STATUS so the PO is not surprised on a device walk.

## Architect rulings on round 1 (2026-09-29)
- F1: the ticket premise was the architect's error. Fixture path unchanged (no code after create); the interstitial stays on the HTTP path only with "Household created. Your join code: {code}. Save it to invite others." and Continue; S1 component test for both paths; string to copy-deck §11 at acceptance.
- F2: scope widened to `app/_layout.tsx` and `app/onboarding/allergies.tsx`: a rejected onboarding read fails closed with "Couldn't load your household." plus the §8 read fallback and Try again; a failed read never renders a destination. This ticket made the failure reachable, so it lands with it.
- F3: scope widened to `app/add/manual.tsx` (key held across retaps, busy guard); `app/add/scan.tsx` is M2-T4a's territory and goes to M3-T4e.
- F4: backlog; the in-flight guard for create-and-join-together lands now (account.tsx is already touched).
- F5 to F11: fix in round 1.

## Round 1 fixes (worker, ebf5714)
F1 fixture create returns no code, the interstitial is HTTP-only, both paths pinned by new S1 tests; F2 the layout and S2 fail closed on a rejected read with "Couldn't load your household." plus the §8 read fallback and Try again; F3 manual.tsx holds the createItem key across retaps with a single-flight guard; F4/F11 one shared in-flight ref for create and join; F5 the "Signed in as" line on the fixture path only; F6 three pinning tests; F7 README API start step, real port, LAN address; F8 report corrected, no em dashes; F9 the household-name 400 string and rendered-message assertions; F10 malformed join body resolves `{ ok: false }`.

## Re-review verdict (round 1): PASS WITH FIXES (same reviewer)
Ten of eleven closed by mutation (restoring the fixture joinCode fails 2 tests; flipping the fail-closed branch fails 3; re-minting the key and removing the single-flight guard each fail their test; the create-side guard is pinned). F2 is only mostly closed: the fail-closed branch fires after a rejection arrives, but while a re-read is in flight the layout still falls back to the M3-T2 F18 "stale read, render the destination" path; a probe showed a deep link to /inventory rendering past the S1/S2 gate for as long as the request hangs (unbounded over HTTP; Try again reopens the window). Minor gaps: the join-side guard at `account.tsx:142` is unpinned; the F6 tests use a member id that rejects either way, so the constructor clear itself is not what they catch. Scope: both widenings used as approved; the new `src/scan/manual-screen.test.ts` accepted as the test half of the manual.tsx widening; new test files under `src/onboarding/` forced by F1/F2; nothing under `packages/**` or `apps/api/**`. ActivityIndicator: keep the file-scoped mock for this merge (it aliases only that primitive to the stand-in's View and masks nothing); add it to the shared stand-in as a host component in the next ticket that touches it. Verification from an empty build state: lint, typecheck, format:check, export green; 119 files, 1740 passed, 355 skipped (the run's exit code was 1 only because the reviewer's own probe file was present; deleted afterwards); live suite 5/5 on a throwaway cluster (stopped and removed).

## Architect rulings on the re-review (2026-09-29)
- F2 pending window: fix in round 2 inside the approved `_layout.tsx` widening (hold, render nothing, while a fresh read is in flight for a non-home, non-onboarding route; a hold never redirects), pinned by the reviewer's probe.
- The two pinning tests (join-side guard; `member-dean` id in one F6 test): round 2.
- ActivityIndicator: as the reviewer recommends; backlog entry at acceptance.

## Round 2 fixes (worker, 1e37581)
`_layout.tsx` holds (renders nothing) when the read is stale, the pathname is not under `/onboarding`, and the stale read's own route (via the existing `resolveOnboardingRoute`) is not `home`, until the fresh read lands; the F18 case (stale route `home`) still falls through. Two pending-window tests, two join-side guard tests, and the F6 tests switched to `member-dean` so the constructor clear is what they catch.

## Re-check verdict (round 2): PASS (same reviewer)
The pending window is closed: the new test runs the probe's scenario (an S1-routed read, then a deep link to /inventory whose read never resolves) and asserts no Slot, no redirect and no error screen; turning the hold off fails exactly that test (1 of 90); the F18 tests still pass; the hold branch only returns null, so it never redirects; Try again no longer reopens the window. Stubbing the join-side guard fails exactly the two new tests (2 of 90); with `member-dean`, commenting out the constructor clear fails exactly the two targeted tests (2 of 110). The round 2 diff touches `_layout.tsx`, three test files and the report; nothing under `packages/**` or `apps/api/**`; no package.json or lockfile change across the branch; zero em dashes. Not re-running the live suite this round is acceptable (no `HttpApiClient` or wire change; round 1's 5/5 stands). Verification from an empty build state with no probe files present: install, lint, typecheck, format:check, export green; **119 files, 1744 passed, 355 skipped**.

## Architect acceptance (2026-09-29)
Squash-merged onto main (after M2-T4a) with no conflict. Merged tree verified from an empty build state: lint, typecheck, format:check, web export green, **123 files, 1923 passed, 356 skipped**; gitleaks clean on the new commit. Docs applied: copy-deck §11 (the HTTP-only post-create string, the failed-read strings, the initials note), BACKLOG (ticket premise corrected, DONE record, follow-ups incl. the ActivityIndicator stand-in addition and the scan.tsx held key for M3-T4e), STATUS, tracker.

## Amendment (2026-10-01, BUG-001)
The round-2 fix for the pending window ("hold, render nothing") had the right requirement and the wrong mechanism: returning `null` from the root layout unmounts expo-router's navigator in the middle of the navigation S2's Continue issues, and the remount/re-read loop crashed with "Maximum update depth exceeded" on Android and web (docs/bugs/BUG-001-s2-max-update-depth.md). The fix keeps the navigator mounted and covers it; every property this review pinned still holds. The component test stand-in's `Slot` did not behave like a navigator, which is why the tests here never caught it. Rule adopted: once the root navigator has mounted it is never unmounted (holds, failures and redirects cover it); before its first mount, rendering nothing or `<Redirect>` is safe and preferred.
