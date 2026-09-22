/**
 * Process entry point (M2-T1).
 *
 * `startServer` is exported and returns an exit code rather than calling
 * `process.exit`, so the refusal paths are testable without spawning a
 * process. They are the ones that matter, because one of them is "do not
 * accept the repository's public fixture tokens in production". The module
 * tail is the only part
 * that touches the real process, and it only runs when this file is the entry
 * point (never under vitest, where `process.argv[1]` is the test runner).
 */

import { pathToFileURL } from "node:url";
import { createAppFromEnvironment } from "./app.js";
import type { EnvironmentLike } from "./identity/index.js";

/** Where a startup refusal is reported. Injected so tests can capture it. */
export interface StartupIo {
  error(line: string): void;
}

const DEFAULT_IO: StartupIo = {
  error(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};

export const DEFAULT_PORT = 3000;

/**
 * Starts the API. Returns `0` once listening, or a non-zero exit code after
 * writing a single clear line explaining the refusal.
 *
 * Every failure path here is fatal on purpose. There is no configuration this
 * process can partly honour: an API that cannot identify its callers must not
 * accept requests at all (ARCHITECTURE.md §7.2).
 */
export async function startServer(
  env: EnvironmentLike = process.env,
  io: StartupIo = DEFAULT_IO,
): Promise<number> {
  let running;
  try {
    running = await createAppFromEnvironment(env);
  } catch (error) {
    io.error(`smart-kitchen api: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const portValue = env["PORT"];
  const port = portValue === undefined || portValue === "" ? DEFAULT_PORT : Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.error(`smart-kitchen api: PORT="${String(portValue)}" is not a valid port number.`);
    await running.pool.end();
    return 1;
  }

  try {
    await running.app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    io.error(
      `smart-kitchen api: could not listen on port ${String(port)}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    await running.app.close();
    await running.pool.end();
    return 1;
  }

  return 0;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  process.exitCode = await startServer();
}
