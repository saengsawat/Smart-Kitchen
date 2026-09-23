// Metro config for apps/mobile inside the pnpm workspace (M3-T1).
//
// pnpm's default node-linker is "isolated": each workspace package's
// node_modules holds symlinks into a shared content-addressed store, rather
// than a single flat tree. Metro's resolver follows symlinks fine for
// packages apps/mobile depends on directly, but two things still need
// pointing at the workspace root:
//   1. watchFolders - so Metro notices changes in workspace-linked packages
//      (@smart-kitchen/contracts, @smart-kitchen/adapters) that live outside
//      apps/mobile/.
//   2. nodeModulesPaths - so Metro can also resolve hoisted dev tooling that
//      lives only in the root node_modules.
// This is scoped entirely to apps/mobile/metro.config.js; nothing about the
// rest of the workspace's install layout changes (no root .npmrc edit, no
// node-linker switch), which was the least invasive option available (see
// M3-T1 worker report).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Retargeted from M2-T1 acceptance, carried by M3-T3, landed here at M3-T4a:
// workspace packages (@smart-kitchen/contracts) resolve through their
// package.json "exports" -> "default" condition, which points at "dist/",
// never at their TypeScript source. Metro does not read tsconfig path
// mappings or run a TypeScript-aware resolver the way vitest's alias config
// does (vitest.config.ts's own comment on why it aliases these same packages
// back to "src/index.ts" for tests); it follows plain Node/"exports"
// resolution. That means a workspace package must be *built* before Metro
// can bundle anything that imports it. There is no separate "build" script:
// `tsc -b` (root `pnpm typecheck`, and CI's "Typecheck" step) is build mode,
// so it emits "dist/" as a side effect of typechecking — that is what makes
// `dist/` exist by the time CI's later "Mobile export smoke check" step
// runs `pnpm --filter mobile export`. Locally, a source change to a
// workspace package is invisible to Metro until the next `pnpm typecheck`;
// this is a real edit-rebuild-refresh cycle, not just a CI detail.
module.exports = config;
