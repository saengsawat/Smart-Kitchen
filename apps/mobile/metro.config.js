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

module.exports = config;
