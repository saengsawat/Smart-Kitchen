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

export default defineConfig({
  resolve: {
    alias: workspaceSourceAliases,
  },
  test: {
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
