/**
 * The compiled entry point actually runs, and actually refuses (M2-T1 review
 * fix F1).
 *
 * `server.test.ts` calls `startServer` in-process, which proves the logic and
 * proves nothing about the build. The review found that `node
 * apps/api/dist/server.js` died with `ERR_UNKNOWN_FILE_EXTENSION` before
 * reaching any of it, because the workspace packages pointed `exports` at
 * `src/index.ts`. Every in-process test passed throughout.
 *
 * So this file spawns the real compiled file as a real process and reads its
 * exit code and stderr. It is the only test in the repository that can tell the
 * difference between "the code is right" and "the thing we ship starts".
 *
 * **Skipping.** It needs `apps/api/dist/`, which `pnpm typecheck` (`tsc -b`)
 * produces. Locally, on a clean checkout with no build yet, it skips with a
 * loud notice, following the same rule as the database suites. In CI it must
 * never skip: the `quality` job runs `pnpm typecheck` before `pnpm test`, so
 * `dist` is always there, and a skip means the build step stopped emitting.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./identity/fixture-paths.js";

const SERVER_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "server.js");

const distBuilt = existsSync(SERVER_ENTRY);

const ciFlag = process.env["CI"];
const runningInCi = ciFlag === "true" || ciFlag === "1" || process.env["GITHUB_ACTIONS"] === "true";

const SUITE = "M2-T1: the compiled entry point starts and refuses";

it.runIf(!distBuilt)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  const notice =
    `[build-tests] SKIPPED: "${SUITE}" — ${SERVER_ENTRY} does not exist, so the compiled ` +
    `entry point was not exercised. This suite is the gate on the build actually being ` +
    `runnable (M2-T1 review fix F1); CI always runs it, because the quality job runs ` +
    `pnpm typecheck (tsc -b) before pnpm test. To run it here: pnpm typecheck, or ` +
    `pnpm --filter api build.`;
  process.stderr.write(`${notice}\n`);

  if (runningInCi) {
    throw new Error(
      `"${SUITE}" skipped on CI: apps/api/dist/server.js was missing. The quality job builds ` +
        `it with pnpm typecheck before pnpm test, so this means the build step stopped emitting.`,
    );
  }
  expect(distBuilt).toBe(false);
});

interface SpawnResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the compiled server as a real child process and waits for it to exit. */
function runCompiledServer(overrides: Record<string, string | undefined>): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, ...overrides };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
    }

    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe.skipIf(!distBuilt)(SUITE, () => {
  it("exits non-zero with the refusal on stderr for NODE_ENV=production SK_IDENTITY=fixture", async () => {
    const result = await runCompiledServer({
      NODE_ENV: "production",
      SK_IDENTITY: "fixture",
      DATABASE_URL: "postgres://postgres@localhost:1/unused",
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("refusing to start");
    expect(result.stderr).toContain("SK_IDENTITY=fixture");
    expect(result.stderr).toContain("NODE_ENV=production");
  }, 30_000);

  it("reaches the refusal at all, rather than dying on a module resolution error", async () => {
    const result = await runCompiledServer({
      NODE_ENV: "production",
      SK_IDENTITY: "fixture",
    });

    // The exact failure the review found. If the workspace packages ever
    // point `exports` back at their TypeScript sources, this is what comes
    // back instead of the refusal.
    expect(result.stderr).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.stderr).toContain("smart-kitchen api:");
  }, 30_000);

  it("refuses a mis-cased production environment too (review fix F3, through the build)", async () => {
    const result = await runCompiledServer({ NODE_ENV: "Production", SK_IDENTITY: "fixture" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("refusing to start");
  }, 30_000);

  it("exits non-zero when no identity adapter is named", async () => {
    const result = await runCompiledServer({ NODE_ENV: "development", SK_IDENTITY: undefined });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("SK_IDENTITY is not set");
  }, 30_000);

  it("writes the refusal to stderr and nothing to stdout", async () => {
    const result = await runCompiledServer({ NODE_ENV: "production", SK_IDENTITY: "fixture" });

    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  }, 30_000);

  it("never prints a fixture token while refusing", async () => {
    const result = await runCompiledServer({ NODE_ENV: "production", SK_IDENTITY: "fixture" });

    expect(`${result.stdout}${result.stderr}`).not.toContain("fixture.dean.chen");
  }, 30_000);
});
