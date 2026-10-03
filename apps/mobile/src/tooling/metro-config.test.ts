import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// BUG-005: Metro must not crawl agent worktrees or .git. metro.config.js is
// CommonJS, so it is loaded through createRequire.
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspaceRoot = path.resolve(mobileRoot, "..", "..");
const config = createRequire(import.meta.url)(path.join(mobileRoot, "metro.config.js")) as {
  watchFolders: string[];
  resolver: { blockList: RegExp | RegExp[]; nodeModulesPaths: string[] };
};

// Metro tests each block list RegExp against the absolute file path.
const isBlocked = (file: string): boolean =>
  [config.resolver.blockList].flat().some((re) => re.test(file));

describe("metro.config.js", () => {
  it("blocks .claude/ under the workspace root", () => {
    const file = path.join(
      workspaceRoot,
      ".claude",
      "worktrees",
      "agent-x",
      "apps",
      "mobile",
      "app",
      "index.tsx",
    );
    expect(isBlocked(file)).toBe(true);
    expect(isBlocked(path.join(workspaceRoot, ".claude", "worktrees", "agent-x"))).toBe(true);
  });

  it("blocks .git/ under the workspace root", () => {
    expect(isBlocked(path.join(workspaceRoot, ".git", "HEAD"))).toBe(true);
  });

  it("does not block real sources or dependencies", () => {
    for (const file of [
      path.join(workspaceRoot, "apps", "mobile", "app", "index.tsx"),
      path.join(workspaceRoot, "packages", "contracts", "dist", "index.js"),
      path.join(workspaceRoot, "apps", "mobile", "node_modules", "expo", "package.json"),
      path.join(workspaceRoot, ".github", "workflows", "ci.yml"),
      path.join(workspaceRoot, "apps", "mobile", ".claude", "x.ts"),
    ]) {
      expect(isBlocked(file), file).toBe(false);
    }
  });

  it("keeps Expo's default exclusions", () => {
    expect(isBlocked(path.join(mobileRoot, ".expo", "types"))).toBe(true);
    expect(isBlocked(path.join(mobileRoot, "src", "__tests__", "a.ts"))).toBe(true);
  });

  it("leaves watchFolders and nodeModulesPaths unchanged", () => {
    expect(config.watchFolders).toEqual([workspaceRoot]);
    expect(config.resolver.nodeModulesPaths).toEqual([
      path.resolve(mobileRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ]);
  });
});
