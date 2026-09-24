/// <reference types="node" />
/**
 * M3-T4c start hygiene: `expo start` (and `expo start --android` / `--ios`)
 * rewrite `apps/mobile/tsconfig.json` (stripping the M3-T1/M3-T4b comments
 * and adding `expo/tsconfig.base` + `.expo/types` to `include`) and write a
 * generated `apps/mobile/.gitignore`, unless `EXPO_NO_TYPESCRIPT_SETUP=1` is
 * set before the CLI's TypeScript setup step runs (see `apps/mobile/README.md`
 * "Run it" and "Why EXPO_NO_TYPESCRIPT_SETUP"). package.json's `start`,
 * `android` and `ios` scripts set it inline (`EXPO_NO_TYPESCRIPT_SETUP=1 expo
 * start ...`), which only works identically on Windows and in CI's bash
 * because the root `.npmrc` turns on pnpm's `shell-emulator` (see that
 * file's comment). This test guards the package.json half of that pairing:
 * a future edit that drops the env var from one of the three scripts (e.g.
 * copying `start`'s command into a new script, or "cleaning up" what looks
 * like redundant text) fails loud here instead of silently reintroducing the
 * tsconfig/`.gitignore` rewrite the next time someone runs the dev server.
 *
 * Real filesystem read (this app's tsconfig sets `"types": []`, M3-T1
 * invariant), same pattern as `copy-scan.test.ts` and
 * `node-global-containment.test.ts` in this directory.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, "..", "..", "package.json");

interface MobilePackageJson {
  scripts: Record<string, string>;
}

function readMobilePackageJson(): MobilePackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as MobilePackageJson;
}

const SCRIPTS_REQUIRING_THE_ENV_VAR = ["start", "android", "ios"] as const;

describe("apps/mobile package.json start-hygiene env var", () => {
  const scripts = readMobilePackageJson().scripts;

  it.each(SCRIPTS_REQUIRING_THE_ENV_VAR)(
    "%s carries EXPO_NO_TYPESCRIPT_SETUP=1 before the expo command",
    (scriptName) => {
      const command = scripts[scriptName];
      expect(command, `package.json is missing a "${scriptName}" script`).toBeDefined();
      expect(command).toMatch(/^EXPO_NO_TYPESCRIPT_SETUP=1\s+expo /);
    },
  );

  it("does not set the env var on the export script (expo export never rewrites tsconfig)", () => {
    // Guards against a well-meaning but unnecessary copy-paste onto a script
    // that was never the problem; keeps this test's intent narrow to the
    // three CLI entry points that actually run the TypeScript setup step.
    expect(scripts.export).toBeDefined();
    expect(scripts.export).not.toMatch(/EXPO_NO_TYPESCRIPT_SETUP/);
  });
});
