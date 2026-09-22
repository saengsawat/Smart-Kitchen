/**
 * Startup refusals (M2-T1).
 *
 * The acceptance criterion is "starting with NODE_ENV=production
 * SK_IDENTITY=fixture exits non-zero with a clear message". `startServer`
 * returns the exit code instead of calling `process.exit`, so the real
 * bootstrap path is exercised here: no spawned process, no compiled bundle,
 * and no way for the guard to be tested in a copy of the code that is not the
 * one that runs.
 *
 * None of these tests bind a port: every case refuses before `listen` is
 * reached, which is itself part of what is being asserted.
 */

import { describe, expect, it } from "vitest";
import { startServer, type StartupIo } from "./server.js";

function capturing(): { io: StartupIo; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: {
      error(line: string): void {
        lines.push(line);
      },
    },
  };
}

const ANY_DB = "postgres://postgres@localhost:1/none";

describe("the production refusal", () => {
  it("exits non-zero with SK_IDENTITY=fixture and NODE_ENV=production", async () => {
    const { io, lines } = capturing();

    const code = await startServer(
      { SK_IDENTITY: "fixture", NODE_ENV: "production", DATABASE_URL: ANY_DB },
      io,
    );

    expect(code).not.toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("refusing to start");
    expect(lines[0]).toContain("SK_IDENTITY=fixture");
    expect(lines[0]).toContain("NODE_ENV=production");
  });

  it("refuses before it looks at the database, so a production build cannot half-start", async () => {
    const { io, lines } = capturing();

    const code = await startServer({ SK_IDENTITY: "fixture", NODE_ENV: "production" }, io);

    expect(code).toBe(1);
    expect(lines[0]).toContain("refusing to start");
    expect(lines[0]).not.toContain("DATABASE_URL");
  });
});

describe("other refusals", () => {
  it("exits non-zero when no identity adapter is named", async () => {
    const { io, lines } = capturing();

    const code = await startServer({ DATABASE_URL: ANY_DB }, io);

    expect(code).toBe(1);
    expect(lines[0]).toContain("SK_IDENTITY is not set");
  });

  it("exits non-zero when SK_IDENTITY names an adapter that does not exist", async () => {
    const { io, lines } = capturing();

    const code = await startServer({ SK_IDENTITY: "auth0", DATABASE_URL: ANY_DB }, io);

    expect(code).toBe(1);
    expect(lines[0]).toContain("names no known identity adapter");
  });

  it("exits non-zero when DATABASE_URL is missing", async () => {
    const { io, lines } = capturing();

    const code = await startServer({ SK_IDENTITY: "fixture", NODE_ENV: "development" }, io);

    expect(code).toBe(1);
    expect(lines[0]).toContain("DATABASE_URL is not set");
  });

  it("exits non-zero on an unusable PORT rather than falling back to a default", async () => {
    const { io, lines } = capturing();

    const code = await startServer(
      { SK_IDENTITY: "fixture", NODE_ENV: "development", DATABASE_URL: ANY_DB, PORT: "http" },
      io,
    );

    expect(code).toBe(1);
    expect(lines[0]).toContain("is not a valid port number");
  });

  it("writes exactly one line, so the reason is not buried", async () => {
    const { io, lines } = capturing();

    await startServer({ SK_IDENTITY: "fixture", NODE_ENV: "production", DATABASE_URL: ANY_DB }, io);

    expect(lines).toHaveLength(1);
  });

  it("never leaks the fixture tokens into the refusal message", async () => {
    const { io, lines } = capturing();

    await startServer({ SK_IDENTITY: "fixture", NODE_ENV: "production", DATABASE_URL: ANY_DB }, io);

    expect(lines.join("\n")).not.toContain("fixture.dean.chen");
  });
});
