# M3-T4a review: client plumbing (writes, detail and undo wired to M2-T2, idempotency keys, §8 error strings, component test library, global toast host, Confirm from S5)

**Reviewer:** independent Sonnet session, read-only. **Branch:** `m3-t4a-client-plumbing` @ `b695e15`. **Baseline:** `main` @ `1cbd948`. Committed by the architect at acceptance (CLAUDE.md rule 29); the architect's ruling and the follow-up outcome are appended at the end.

## Verdict

**PASS.** All acceptance criteria met, all invariants hold, all commands green, deviations disclosed and reasonable. Two items need an architect decision, not a worker fix: the Math.random fallback's status as the de facto production default, and the root `vitest.config.ts` setup file's repo-wide execution. Neither blocks acceptance.

## Findings

**F1 (info, architect decision)** `idempotency.ts:79-93`: Hermes never exposes `crypto.getRandomValues`, so the Math.random fallback is the only path every real device hits; the crypto branch is dead code today. Reasoning that an idempotency key is not a security token is sound and written down; collision risk negligible given the timestamp plus monotonic counter; version and variant bits are set unconditionally so layout parity holds. Nothing logs the fallback. Recommendation: `expo-crypto` (Expo's own module, MIT, same rule-11 precedent as expo-camera) rather than letting "escalated" become "permanent".
**F2 (info, scope)** root `vitest.config.ts:57`: the `react-native` alias is scoped to the literal specifier, but `setupFiles` runs before every test file in the monorepo; inert for api and packages (the `Module._load` patch special-cases only `"react-native"`), confirmed by identical counts on the pre-existing 84 files. Disclosed, precedented, accept.
**F3 (info, concur with the worker)** the react-native stand-in covers only the primitives today's screens use; a future `Modal`, `Animated` or `FlatList` import fails loud with the same Flow-parse error. Documented limitation.
**F4 (info, concur)** `WRONG_SIGN`'s `{action}` filler is unreachable today and flagged as invented rather than sourced.

No test deleted or weakened (ledger, why, errors, client test diffs all additive).

## Mutation checks

Scratch copy outside the worktree. Retry re-mints the key: exactly the targeted test fails, 59 others pass. `IDEMPOTENCY_KEY_CONFLICT` string mutated: exactly one test fails. `"Discarded safely"` in transactions.ts: the repo-wide copy scan catches `safe`. Bundle grep for `test-support`, `react-native-mock`, `vitest-setup`: zero exact hits in both bundles.

## Acceptance criteria

All nine met: HttpApiClient wired to the M2-T2 endpoints via contracts DTOs and paths; one key per action reused on retry, never re-minted (mutation-tested); every refusal via `ledgerErrorMessage` with verbatim §8 strings, domain message never shown (mutation-tested); `reason` required with the `provenance.source` workaround gone and an empty `apps/api` diff; `@testing-library/react-native` adopted with five component test files that exercise real screen code through a thin rendering shell; toast host survives S5 to S4; Confirm from S5; metro comment; root commands green from an empty build state.

## Commands

Worktree, empty build state: lint clean; typecheck clean; test 89 files, 1391 passed / 246 skipped (main 84 files, 1329 / 246, same skips, +62 new passing); mobile export iOS 2.5 MB, Android 2.8 MB with no test-support symbols; format:check clean; frozen-lockfile install up to date; audit two pre-existing moderate transitive findings, exit 0.

## Scope and deviations

Root `vitest.config.ts` outside literal scope, disclosed, minimal, accept (F2). `packages/contracts/src/inventory.test.ts` in scope. No `apps/api` change needed. Deviations 1 to 9 all accepted: one network-failure-only retry with the same key; the vitest touch; the stand-in's fidelity gap; RNTL pinned to the deprecated 9.2.0 (latest needs a Jest peer; the ticket said stay on vitest; a maintenance item for an architect call); the `WRONG_SIGN` filler; the removal-toast pattern "{Action}. Undo" as an engineering inference extending §5's correction toast (ratify in the deck); the port surface change (`removeQuantity` returns `{ transactionId }`, `undo` takes `itemId`), necessary for item-scoped endpoints; the fixture client covered by interface parity and unit tests; S4 write paths untouched.

## Opinions

The hand-rolled `react-native` stand-in plus `Module._load` patch is more invasive than ideal for a Sonnet plumbing ticket, but the escalation trail is right (direct import tried, Flow-parse failure confirmed, jest-expo rejected against the ticket's instruction) and the tests it enables are meaningful. The RNTL 9.2.0 pin is a maintenance trap worth a standalone decision. Math.random as the 100 percent production default deserves a prompt ruling.

## Architect ruling and targeted re-check (commit `7ecb65d`)

**Ruling (F1):** adopt `expo-crypto` (Expo's own module, MIT, SDK 57 pair `~57.0.3`) as the randomness source for idempotency keys; keep the feature-detected order (global `crypto.getRandomValues`, then expo-crypto's synchronous `getRandomBytes`, then Math.random only if the native binding is missing, with one dev warning). Applied by the worker with a separate `expo-crypto-mock.ts` in test-support (backed by `node:crypto`) aliased in the root vitest config, since `expo-modules-core` reads the RN-only `__DEV__` global under vitest. The worker confirmed expo-crypto present and no test-support symbols in a text export of the bundle. Commands from an empty build state: lint, typecheck, test 1392 passed / 246 skipped, mobile export, format:check all green.

**F2 ruling:** the repo-wide setup file is accepted as inert outside apps/mobile; revisit with the test-infrastructure decision (RNTL pin, vitest stand-in versus a Jest runner) recorded in BACKLOG follow-ups.

**Em dashes in code comments** (worker note): exempt under the M3-T2 ruling that P11 applies to strings and docs, not comments. No action.

**Targeted re-check (same reviewer, commit `7ecb65d`): PASS.** Three-tier order correct with expo-crypto as the real on-device path wrapped in try/catch; the warn fires once per process on the last-resort branch only; the expo-crypto mock is aliased on the literal specifier and imported only by idempotency.ts and its test; commands green (1392 passed / 246 skipped; expo-crypto symbols present in the bundle, no test-support leakage; frozen-lockfile clean); dependency justification complete (alternatives `react-native-get-random-values` and `expo-standard-web-crypto` rejected, MIT, pinned to the SDK 57 pair); diff ruling-driven only.

## Architect acceptance (2026-09-22)

Accepted and squash-merged. Follow-ups in BACKLOG: the component-test infrastructure decision (RNTL pin and vitest stand-in versus a Jest runner) before M3-T5; deck ratification of the removal toast pattern and the `WRONG_SIGN` filler; `confirmAiProposal` still fixture-backed until M2-T3.
