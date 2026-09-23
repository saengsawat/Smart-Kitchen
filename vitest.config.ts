import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Workspace packages resolve to their TypeScript source under vitest, never to
 * their build output (M2-T1 review fix F1).
 *
 * Each package's `exports` points at `dist/` so that the compiled API can
 * actually import them at runtime (`node apps/api/dist/server.js`). Without
 * these aliases vitest would follow the same path and run the tests against
 * whatever was last built, which means a stale `dist` could turn a broken
 * change green, and a clean checkout with no `dist` at all could not run the
 * suite. Mapping the three package names back to `src/index.ts` keeps `pnpm
 * test` a pure source-level run with no build step in front of it.
 */
const workspaceSourceAliases = Object.fromEntries(
  ["domain", "contracts", "adapters"].map((name) => [
    `@smart-kitchen/${name}`,
    path.join(repoRoot, "packages", name, "src", "index.ts"),
  ]),
);

/**
 * `apps/mobile`'s component tests (M3-T4a) alias the real `react-native`
 * package to a hand-written stand-in (`apps/mobile/src/test-support/
 * react-native-mock.ts`) for the vitest run only. `react-native`'s npm
 * package ships raw Flow source with no precompiled build, which vitest's
 * TypeScript-configured transform cannot parse (confirmed empirically: a
 * bare `import { View } from "react-native"` fails with "Flow is not
 * supported" before any test runs). The usual fix is a Babel/Flow transform
 * over `node_modules` (what Jest's `react-native`/`jest-expo` presets do);
 * BACKLOG.md's M3-T4a ticket asks for the opposite: stay on vitest, keep
 * any transform minimal and inside `apps/mobile`, escalate before adding
 * another package, so this repo does not carry that pipeline. The mock (see
 * its own doc comment) plus `apps/mobile/src/test-support/vitest-setup.ts`
 * (which extends the same substitution to a `require("react-native")` called
 * from inside an already-built dependency, e.g.
 * `@testing-library/react-native`'s own query helpers) are the whole of it.
 * Nothing here changes Metro's real resolution (this is vitest-only); the
 * shipped app still bundles the real `react-native`.
 */
const reactNativeMockPath = path.join(
  repoRoot,
  "apps",
  "mobile",
  "src",
  "test-support",
  "react-native-mock.ts",
);

/**
 * `expo-crypto` (added M3-T4a architect ruling, 2026-09-22, for
 * `apps/mobile/src/api/idempotency.ts`'s randomness) gets the same
 * treatment as `react-native` above, for a different reason: its real entry
 * point imports `expo-modules-core`, which reads the RN-only `__DEV__`
 * global at module-load time: confirmed empirically, `ReferenceError:
 * __DEV__ is not defined` before any test runs. See
 * `apps/mobile/src/test-support/expo-crypto-mock.ts`'s doc comment.
 */
const expoCryptoMockPath = path.join(
  repoRoot,
  "apps",
  "mobile",
  "src",
  "test-support",
  "expo-crypto-mock.ts",
);

export default defineConfig({
  resolve: {
    alias: {
      ...workspaceSourceAliases,
      "react-native": reactNativeMockPath,
      "expo-crypto": expoCryptoMockPath,
    },
  },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    setupFiles: [path.join(repoRoot, "apps", "mobile", "src", "test-support", "vitest-setup.ts")],
  },
});
