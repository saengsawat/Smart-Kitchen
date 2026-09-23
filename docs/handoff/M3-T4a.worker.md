# M3-T4a worker report: client plumbing, wire writes/detail/undo, idempotency keys, §8 error strings, component test library, global toast host

Branch `m3-t4a-client-plumbing`, four commits on top of `1cbd948` plus this report.

## 1. What was built

**(a) Real endpoints.** `HttpApiClient` (`apps/mobile/src/api/client.ts`) now implements every
M2-T2/M2-T1 inventory endpoint for real, over a mocked-in-tests `fetch`:

- `getInventoryItem`: `GET /v1/inventory/items/{id}`, 404 answers `null` (byte-identical to "does
  not exist", data-model.md §5), a shape guard on the body (same shallow rule the M3-T3 list read
  already used).
- `correctQuantity`: `POST .../transactions`, `type: "ADJUSTMENT"`, `targetAmount` as exact decimal
  text (`microsToAmountText`, never the raw micros this method receives).
- `removeQuantity`: same endpoint, the mapped `TransactionType`, `amount` omitted (the whole on-hand
  quantity), `reason` only when a sub-reason chip was picked.
- `undo`: `POST .../{transactionId}/undo`, its own key.

**(b) Idempotency keys.** `apps/mobile/src/api/idempotency.ts` is a second, independent UUIDv7
generator (same 128-bit layout as `apps/api/src/ids/uuidv7.ts`, restated rather than imported:
`apps/mobile` cannot depend on `apps/api`). `HttpApiClient` mints exactly one key per write/undo
call and reuses it, unchanged, across its own internal retry of a genuine network failure
(`postWrite`, one retry: two attempts total, an engineering inference; the ticket did not specify a
count). A well-formed refusal (any non-2xx with a parseable body) is never retried.

**(c) `ledgerErrorMessage`.** `apps/mobile/src/inventory/errors.ts` adds `ledgerErrorMessage(code)`
and `LedgerRefusedError`. One switch, copy-deck §8 verbatim for the seven user-facing
`LedgerErrorCodeDto`s plus the three API-level codes (`IDEMPOTENCY_KEY_CONFLICT`, the 409 conflict
path, which overrides the ledger table's own "internal-only" classification for that code, see the
function's doc comment, plus `UNDO_NOT_POSSIBLE`, `NOT_FOUND`), generic fallback otherwise.
`messageForLedgerError` (existing, review F3) now delegates to it for both `ZeroDeltaError` (fixture)
and `LedgerRefusedError` (`HttpApiClient`). A test enumerates every `LEDGER_ERROR_CODES_DTO` entry.

**(d) `reason` tightened to required.** `packages/contracts/src/inventory.ts`:
`InventoryTransactionDto.reason` is now `string | null` (was optional). Checked every `apps/api`
producer first: `apps/api/src/db/inventory/detail.ts`'s `toEntry` already sets `reason: row.reason`
unconditionally, so **no `apps/api` change was needed**, exactly as the ticket predicted. The fixture
ledger (`apps/mobile/src/inventory/ledger.ts`) now sets it on every row: a removal's picked
sub-reason lands in `reason` (the M3-T3 `provenance.source` workaround removed), `provenance.source`
reverts to a fixed `"manual-entry"` constant matching the API's own `MANUAL_ENTRY_SOURCE` exactly, and
the clamp row's `reason`/`source` now match the domain's `CLAMP_REASON`/`CLAMP_SOURCE` constants too
(a small fidelity improvement found while writing the manual round trip in §4). `appendUndo` sets
`reason: "undo:<transactionId>"`, matching `write-service.ts`'s `UNDO_REASON_PREFIX` convention.
`why.ts` and `[itemId].tsx`'s history caption read `tx.reason` for a removal row, not
`tx.provenance.source`.

**(e) Component tests.** `@testing-library/react-native` (devDependency, see §2) plus
`react-test-renderer`. Tests: S4 and S5 render safely on the pre-redirect frame; S5's real detail
GET; a correction round trip against a mocked `fetch` (request body, idempotency-key reuse across a
simulated network-failure retry, the success toast, a coded refusal's exact copy-deck string, the
generic fallback for a persistent network failure); a removal (top chip + sub-reason) posting the
mapped type/reason with no `amount`, its "Discarded. Undo" toast surviving a simulated S5-to-S4
navigation, and its Undo hitting the item-scoped undo endpoint; Confirm reachable from S5; the tab
shell's five slots; the toast host surviving a simulated route change on its own. 371 mobile tests
green (was 309 before this ticket).

**(f) Global toast host.** `Toast.tsx` is now a context (`ToastProvider`/`useToast`/`ToastHost`)
instead of per-screen `useState`. `_layout.tsx` mounts `ToastProvider` once, with `ToastHost` as a
sibling of `<Slot />` (not inside it), so a route change never remounts it: the exact shape the
acceptance criterion needs (a removal's toast surviving the S5→S4 navigation it triggers).

**(g) Confirm from S5.** Same condition (`needsConfirmation`, tier `AI_INTERPRETATION`), same action
(`apiClient.confirmAiProposal`), same label ("Confirm") as the S4 tray/row.

**(h) `metro.config.js` comment.** Added, corrected against what CI actually does: there is no
separate "build" script; `tsc -b` (`pnpm typecheck`, build mode) emits `dist/` as a side effect, which
is what makes it exist by the time `pnpm --filter mobile export` runs.

## 2. Dependency justification (rule 11)

**Added:** `@testing-library/react-native@9.2.0` and `react-test-renderer@19.2.3`, both
devDependencies of `apps/mobile` only. MIT licence, same as the rest of the React ecosystem already
in this repo.

**Why this exact version, not `@latest` (14.0.1):** `@testing-library/react-native@14.x` declares a
peer dependency on `jest` (`>=29.0.0`) and a new `test-renderer` package (not `react-test-renderer`),
because recent versions couple its query helpers to Jest's `expect`/matcher machinery. That directly
conflicts with the ticket's "stay on vitest" instruction and the explicit "no jest-expo" rule. `9.2.0`
is the last release before that coupling, with a plain `react-test-renderer` peer: it is
**deprecated** ("no longer maintained", `pnpm install` warns), which I judge acceptable for a *test*
dependency with no runtime/production exposure and no security advisory attached (`pnpm audit
--audit-level=high` is clean; two pre-existing moderate advisories are transitive from Expo's own
tooling, unrelated to this change). Flagged for the architect: if a future ticket wants an actively
maintained RNTL, it will need either a Jest-based test runner for component tests specifically, or a
different harness: see §5.

**Alternatives considered:** (1) `@latest`: rejected, conflicts with the vitest mandate as above. (2)
No component-test library at all, keep testing pure logic modules only: rejected, the ticket's
Objective (e) and several acceptance criteria (the correction round trip, the toast surviving
navigation, the tab shell) are specifically about rendered behaviour a logic-only test cannot see. (3)
`react-native-testing-library` under Jest via `jest-expo`: explicitly ruled out by the ticket.

**Added (architect ruling, 2026-09-22, post-review):** `expo-crypto@~57.0.3`, a runtime dependency of
`apps/mobile` (not a devDependency: it ships in the production bundle, confirmed in §6). MIT licence.
Same version-pinning convention as `expo-font`/`expo-router` already in this app: Expo's own SDK-57
bundled-module manifest (`expo/bundledNativeModules.json`) names `expo-crypto: "~57.0.3"` as the
version that matches this project's `expo@~57.0.24`/`react-native@0.86.3` pair, so that is the range
used rather than `@latest`.

**Why:** the worker report's original escalation (§7) found that Hermes exposes no `crypto` global at
all on Expo SDK 57, so the idempotency-key generator's only path was `Math.random()` on every real
device. The architect's ruling resolves that escalation by adding `expo-crypto`, Expo's own module
and the same rule-11 precedent already used for `expo-font` (bundled fonts) and planned for
`expo-camera` (M3-T4b's barcode scan), rather than leaving the fallback as the only path, or reaching
for a third-party polyfill (`react-native-get-random-values`, not an Expo module, would need its own
separate rule-11 case) or a Web-standard polyfill package (`expo-standard-web-crypto`, which itself
wraps `expo-crypto`, so adding it directly is the same dependency one layer higher).

**What changed:** `apps/mobile/src/api/idempotency.ts`'s randomness source is now three tiers, in
order: (1) a global `crypto.getRandomValues`, kept so this generator uses the real Web Crypto API
automatically if a future Hermes/engine version ever adds it, with no code change here; (2)
`expo-crypto`'s synchronous `getRandomBytes`: the real answer on every device today; (3)
`Math.random()`, reached only if both of the above are unavailable (e.g. `expo-crypto`'s own native
binding is missing, its `UnavailabilityError` case), logging one `console.warn` the first time this
happens per process rather than silently. See that file's doc comment for the full three-tier
rationale, and `apps/mobile/src/api/idempotency.test.ts` for a test of each tier (including that the
tier-3 warning fires exactly once, not once per key).

**Alternatives considered (for this addition specifically):** (1) leave the Math.random-only fallback
as originally shipped: rejected by the architect's ruling, since it is the *only* path on every real
device today, not a rare fallback. (2) `react-native-get-random-values` (a popular non-Expo polyfill
that patches `global.crypto`), rejected because it is not an Expo module, so it does not carry the
same rule-11 precedent the ruling asks for, and it works by mutating a global rather than being
called directly, which this module's explicit tiering makes unnecessary. (3) `expo-standard-web-crypto`: rejected as a
redundant extra layer over `expo-crypto` for what this module needs (two functions, called directly,
no need for a global `crypto` polyfill elsewhere in the app).

**Test-support handling (kept separate from the `react-native` stand-in, per the ruling):**
`expo-crypto`'s real entry point imports `expo-modules-core`, which reads the RN-only `__DEV__` global
at module-load time: confirmed empirically, `ReferenceError: __DEV__ is not defined` before any test
runs, the same class of "real native-module code has no meaning under a plain Node test runner"
problem as `react-native`, just a different symptom (a missing global, not unparseable Flow syntax).
`apps/mobile/src/test-support/expo-crypto-mock.ts` is a second, separate stand-in (not folded into
`react-native-mock.ts`, which stays scoped to `react-native` itself): it implements exactly the two
functions `idempotency.ts` calls (`getRandomBytes`, `getRandomValues`), backed by real `node:crypto`
randomness rather than canned data, so a test exercising "expo-crypto succeeded" is exercising a real
random source. Wired the same way as the `react-native` alias, one more `resolve.alias` entry in root
`vitest.config.ts` (documented there); no `Module._load` patch was needed for this one, because
nothing outside `apps/mobile`'s own source imports `expo-crypto` (unlike `@testing-library/react-native`'s
internal `require("react-native")`, nothing reaches `expo-crypto` through an already-built dependency's
CommonJS output).

## 3. The Flow-parsing blocker and the test harness (escalated, not silently worked around)

Before writing a single component test, `import { View } from "react-native"` under vitest was tried
directly and failed: `react-native`'s npm package ships raw Flow source (including the newer
`component Foo(...) {}` declaration syntax) with no precompiled build, and vitest's transform
(esbuild/Rolldown, configured for TypeScript) cannot parse it: confirmed with the exact error
("Flow is not supported") before building anything further. The standard fix is a Babel/Flow
transform over `node_modules` (what Jest's `react-native`/`jest-expo` presets do); the ticket asks the
opposite: stay on vitest, keep any transform minimal and inside `apps/mobile`, escalate before
adding a further package: so that pipeline was not added.

What exists instead, all under `apps/mobile/src/test-support/`:

- `react-native-mock.ts`: a hand-written stand-in for exactly the `react-native` primitives the
  screens under test import (`View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `StyleSheet`,
  `AccessibilityInfo`), each a plain host-tagged component built from nothing but `react`.
- `vitest-setup.ts`: the alias alone is not enough: `@testing-library/react-native`'s own query
  helpers (`getByText`, `fireEvent`'s text-input detection) call a bare `require("react-native")`
  from inside their own pre-built CommonJS output, which Node's native module loader resolves
  directly, bypassing Vite's resolver (and the alias) entirely: confirmed empirically (adding the
  package to vitest's `server.deps.inline` did not change this). This file patches `Module._load`,
  the actual hook Node's CJS loader calls for every `require`, so that one specifier resolves to the
  same mock module the alias hands out everywhere else.
- `flush.ts`: `@testing-library/react-native`'s own `waitFor` (wrapped in one outer `act()`) was not
  reliably sufficient to make `react-test-renderer` commit a `setState` call a screen's `useEffect`
  triggers asynchronously after `render()` has already returned: confirmed empirically with a
  debug harness before writing real tests; the update visibly never flushed even after a 2-second
  `waitFor` timeout. An explicit `act(async () => { await macrotask ×N })` reliably unblocks it. This
  is plausibly a `react-test-renderer`-under-React-19 gap (the package itself warns it is
  deprecated); flagged for the reviewer.

**Root `vitest.config.ts` touch (deviation from the literal file scope).** Making the mock take
effect for both static imports (the screens themselves) and the runtime `require` above needs a
`resolve.alias` entry and one `setupFiles` entry in the root config: there is nowhere else to put
resolution/setup that vitest reads. This mirrors the precedent already in this repo: M3-T1/M3-T2
similarly touched root `eslint.config.js` (Node-global containment rules scoped to `apps/mobile`)
despite a file scope that did not name it. Kept to the minimum: two lines, both pointing at files
that live inside `apps/mobile`, with the substantive comment there rather than in the root file.
Flagged explicitly per rule 14 rather than left for the reviewer to discover.

## 4. What was verified live vs mocked

**Mocked (all automated tests):** every `HttpApiClient`/component test above runs against a mocked
global `fetch`, never a real socket.

**Live (manual, this session, not part of the automated suite):** a throwaway native PostgreSQL 17
cluster (`initdb`/`pg_ctl`, port 55433, CONTRIBUTING.md's recipe), migrated, built, seeded
(`db:seed:fixture`: 9 items created, 15 ledger rows), and the compiled API started
(`SK_IDENTITY=fixture`, port 4177). Against it, with `curl` sending exactly what the client sends:

- `GET /v1/inventory/items` and `GET /v1/inventory/items/{id}`: real rows back.
- A correction (`targetAmount` from 1.25 to 1.5 lb): one `ADJUSTMENT` row, balance updated.
- A replay of the same idempotency key/payload: `"replayed":true`, no new row, same 5-row history.
- An undo of that correction: one compensating row, balance restored to 1.25.
- `targetAmount` equal to the current balance: 400, `ledgerCode: "ZERO_DELTA"`.
- A key reused with a **different** payload after its first use had actually landed: 409,
  `"code":"CONFLICT"`, `"ledgerCode":"IDEMPOTENCY_KEY_CONFLICT"`, message
  `"That request was already used for a different change, so it was not applied again."`: **the
  exact string `ledgerErrorMessage` renders**, confirmed byte-for-byte against the live server, not
  just against the API's own source.

Server and database cluster stopped and the scratch directory removed afterward; no state left
running.

**Not run:** `apps/api/src/db/**`'s own suites need `DATABASE_URL` for `pnpm test` itself: out of
this ticket's scope, unaffected here, and I did not re-run them against the throwaway cluster (they
are gated in CI already, per CONTRIBUTING.md).

## 5. Deviations, judgment calls, and what the reviewer should attack first

In roughly descending priority:

1. **`postWrite`'s retry logic** (`apps/mobile/src/api/client.ts`). One retry on a genuine `fetch`
   rejection, same key reused, never retrying a well-formed non-2xx. Try: a retry racing a slow
   success (does the first, now-late response get used after the retry already resolved? No, the
   retry loop is sequential, awaits each attempt fully before deciding); whether "genuine network
   failure" vs "well-formed refusal" is classified correctly for every fetch-rejection shape a real
   device could produce (DNS failure, TLS error, abort).
2. **The `vitest.config.ts` touch** (§3). Confirm the alias/setupFiles addition is truly minimal and
   does not leak into non-mobile tests (it doesn't: the alias only intercepts the literal specifier
   `"react-native"`, which nothing outside `apps/mobile` imports).
3. **`react-native-mock.ts`'s fidelity gap.** It only implements the primitives today's screens use.
   A future screen importing an unmocked `react-native` export (e.g. `Modal`, `Animated`) will fail
   the same Flow-parse way until the mock is extended: there is no test that would catch this before
   it happens; flagged as a known limitation, not fixed speculatively (module doc comment says so).
4. **RNTL pinned to a deprecated `9.2.0`** (§2). Whether that is acceptable long-term, or whether a
   future ticket should introduce a Jest-based runner for component tests specifically, is an
   architect call.
5. **`WRONG_SIGN`'s `{action}` placeholder** (`errors.ts`). Unreachable from this ticket's screens (no
   manual entry sends a signed amount), so the default filler ("what you're doing") is a judgment
   call, not a sourced string: flagged in the function's own doc comment rather than invented
   silently.
6. **Toast copy for a removal** ("Discarded. Undo", pattern: `{ACTION_LABELS[type]}. Undo`) is an
   ENGINEERING INFERENCE (copy-deck §5 only specifies the correction toast's exact text, "Corrected.
   Undo"), extending the same pattern. Flag for a copy-deck follow-up if the architect wants it
   ratified explicitly.
7. **`ApiClient` interface changes beyond the ticket's literal text**: `removeQuantity` now resolves
   `{ transactionId }` (was `void`) and `undo` takes `(itemId, transactionId)` (was
   `(transactionId)`): both necessary (the real endpoints are item-scoped and a removal's own toast
   needs a row id to undo, mirroring the existing `correctQuantity` rule), but they are a port-surface
   change a strict reading of "wire writes... to existing endpoints" might not have anticipated.
8. **The fixture client is not separately component-tested.** Component tests exercise
   `HttpApiClient` (mocked fetch); `FixtureApiClient`'s parity is unit-tested (`client.test.ts`) and
   guaranteed by both implementations satisfying the same `ApiClient` interface, not by a duplicate
   rendered test suite. Flag if the reviewer wants that duplicated.
9. **S4's own write paths are untouched** (list read only, plus `confirmAiProposal` which still
   delegates to the fixture): correctly out of this ticket's scope, noted for completeness.

## 6. Commands and results, empty build state, CI order

First round (before the `expo-crypto` ruling), all five green from empty:

```
rm -rf apps/api/dist apps/mobile/dist packages/adapters/dist packages/contracts/dist packages/domain/dist
rm -f apps/api/tsconfig.tsbuildinfo packages/adapters/tsconfig.tsbuildinfo packages/contracts/tsconfig.tsbuildinfo packages/domain/tsconfig.tsbuildinfo

pnpm lint            # clean
pnpm typecheck       # clean (tsc -b, all project references, rebuilds dist/)
pnpm test            # 89 files, 1390 passed, 246 skipped (DATABASE_URL unset, loud SKIP notices, as designed)
pnpm --filter mobile export   # Exported: dist (iOS 2.5MB / Android 2.8MB bundles, both platforms)
pnpm format:check    # All matched files use Prettier code style
pnpm audit --audit-level=high   # 2 moderate (pre-existing, transitive from Expo tooling), exit 0
```

Second round, after adding `expo-crypto` (architect ruling), from a genuinely empty build state again,
`pnpm install` included since the lockfile changed:

```
rm -rf apps/api/dist apps/mobile/dist packages/adapters/dist packages/contracts/dist packages/domain/dist
rm -f apps/api/tsconfig.tsbuildinfo packages/adapters/tsconfig.tsbuildinfo packages/contracts/tsconfig.tsbuildinfo packages/domain/tsconfig.tsbuildinfo

pnpm install         # Already up to date (expo-crypto was already fetched during dependency work)
pnpm lint            # clean
pnpm typecheck       # clean
pnpm test            # 89 files, 1392 passed, 246 skipped (+2 tests: the new expo-crypto tier coverage)
pnpm --filter mobile export   # Exported: dist (iOS 2.5MB / Android 2.8MB bundles, both platforms)
pnpm format:check    # All matched files use Prettier code style
```

**Bundle content check (Objective from the ruling):** `.hbc` (Hermes bytecode) is not plain-text
searchable, so this was verified against a throwaway, non-bytecode export
(`npx expo export --platform ios --no-bytecode --no-minify --output-dir <scratch>`, deleted
immediately after) rather than the shipped `dist/`:

- `expo-crypto` genuinely bundled: `expo-crypto`, `ExpoCrypto` and its own internal `CryptoError`
  message string (`` `expo-crypto: ${message}` ``) all appear in the plain-JS bundle.
- No test-support code leaked in: zero occurrences of `react-native-mock`, `expo-crypto-mock`,
  `test-support`, or `patchedLoad`/`Module._load`. `flushPending` **does** appear five times, but as
  React's own internal `flushPendingEffects` (confirmed by inspecting the surrounding bytes), not this
  repo's `test-support/flush.ts`, which nothing in `app/`/production `src/` imports.

Both green, from a genuinely empty build state, in CI's own order.

## 7. Escalations

- **`crypto.getRandomValues` is not available** on Expo SDK 57 / React Native 0.86's Hermes engine
  (verified: no `crypto` global at all). Escalated rather than silently adding a polyfill dependency,
  per the ticket's own instruction; the original fallback (feature-detect, else `Math.random()`) was
  a deliberate stopgap, not a claim that `Math.random()` was an acceptable *primary* source.
  **Resolved by architect ruling (2026-09-22, independent review pass):** add `expo-crypto` and use its
  synchronous `getRandomBytes`/`getRandomValues` as the real middle tier, keeping the global-crypto
  check first (future-proofing) and `Math.random()` only as a last resort with a one-time
  `console.warn` if `expo-crypto` itself is ever unavailable. Implemented in this same round; see §2
  for the dependency justification (why `expo-crypto` specifically, alternatives, licence, exact
  version) and §6 for the confirmation that it is genuinely in the shipped bundle.
- **The Flow-parsing blocker and the resulting test harness** (§3): the single largest technical
  finding of this ticket, documented in full there. `expo-crypto` needed the same treatment
  (§2's last paragraph, and §3's own note): a second, separate test-support stand-in
  (`expo-crypto-mock.ts`), not folded into the `react-native` one.

## 8. Proposed follow-ups (not done here, in scope for later)

- A copy-deck ratification of the removal-toast text pattern (§5.6).
- Extending `react-native-mock.ts` when M3-T4b/later tickets need a primitive it does not yet cover
  (§5.3).
- The architect's call on RNTL's long-term maintenance status (§5.4).
- S4's own write paths (not touched, out of scope) still have no component test: fine for now since
  S4 has no write action of its own beyond Confirm (already tested) and navigation to S5.
