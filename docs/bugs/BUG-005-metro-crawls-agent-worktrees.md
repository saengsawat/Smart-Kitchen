# BUG-005: Metro serves the bundle before its project index is ready because the watch folder includes the agent worktrees

**Reported:** 2026-10-02 by Andy (PO), opening the app in Expo Go on the phone after pulling main at 4e54a1f.
**Status:** FIXED 2026-10-03 (squash `f8a5b51`, review PASS). `apps/mobile/metro.config.js` blocks `.claude/**` and `.git/**` under the workspace root, pinned by a config test; the 34 worktrees were pruned first and CONTRIBUTING.md carries the rule. Handoff: docs/handoff/BUG-005.{worker,review}.md.
**Code at:** main `e6f5d29`.

## What Andy saw

Expo Go's red screen: "The development server returned response error code: 500" for `entry.bundle?platform=android...`, body "Metro has encountered an error: Cannot read properties of undefined (reading 'get')" at `metro/src/node-haste/DependencyGraph.js (28:20)`, in `getOrCreateMap`. The app never ran.

## Cause (architect, from Metro 0.84.5's source and the repo state; not reproduced on the phone)

- `DependencyGraph._resolutionCache` is created only when Metro's initial file crawl finishes (the `.then` of the file-map build, line 73). `resolve` (line 253) reads it synchronously. The crash means a bundle request was served before the crawl had completed.
- `apps/mobile/metro.config.js` sets `watchFolders = [workspaceRoot]` (needed for the workspace packages). Since 2026-10-01 the workspace root also held 34 finished agent worktrees under `.claude/worktrees/`, each with a full `node_modules`: about 45,000 files each, about 1.5 million files in the crawl. Nothing in the config or in Expo's default exclusion list excludes `.claude/`, and this machine has no watchman, so Metro's Node crawler walks all of it on every start.
- The worktrees are the architect's doing (every dispatch used an isolated worktree and none was pruned). They were removed on 2026-10-03 before this ticket was dispatched; this ticket makes the recurrence impossible.

## Fix (the ticket)

- `apps/mobile/metro.config.js`: add `.claude/` under the workspace root (and any `.claude/worktrees/**`) to `config.resolver.blockList` through Metro's `exclusionList` helper (from `expo/metro-config` or `metro-config`), keeping Expo's defaults. Also exclude `**/.git/**` under the workspace root if Metro's defaults do not already. Comment the why in the file in the same voice as the existing comments.
- A unit test `apps/mobile/src/tooling/metro-config.test.ts` (new) that loads the config and asserts: a path like `<workspaceRoot>/.claude/worktrees/agent-x/apps/mobile/app/index.tsx` matches the block list; `<workspaceRoot>/apps/mobile/app/index.tsx` and `<workspaceRoot>/packages/contracts/dist/index.js` do not; `watchFolders` still equals `[workspaceRoot]`. Use Metro's own `blockList` regex semantics (a `RegExp` or an array of them; match the way Metro does, against the absolute path with the platform separator).
- `CONTRIBUTING.md` is out of scope for the worker; the architect records the operational rule (prune agent worktrees; never start Metro with worktrees under the root) at acceptance.

## Acceptance criteria

- The unit test above passes and fails when the block-list addition is removed (state the mutation check in the report).
- `EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 pnpm --filter mobile export` still succeeds from an empty build state.
- `expo start --web` in demo mode plus `apps/mobile/scripts/web-demo-smoke.mjs` still passes (read the script header; use a free port; stop everything you start).
- All suites green from an empty build state in CI order (install, typecheck, lint, test, format:check, export).

## File scope

`apps/mobile/metro.config.js`, `apps/mobile/src/tooling/metro-config.test.ts` (new), `apps/mobile/vitest.config.*` only if the new test directory needs including, `docs/handoff/BUG-005.worker.md`.

## Out of scope

The worktree cleanup itself (done by the architect); watchman; any change to `watchFolders` or `nodeModulesPaths`; the root `vitest.config.ts`.

## Still unknown

Whether the crawl also hit a duplicate-name error on the way (34 copies of every workspace package name); Andy's Metro terminal output before the first 500 would show it. Not needed for the fix.
