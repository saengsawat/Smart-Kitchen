/**
 * The seed's refusals (M2-T2).
 *
 * Both of them happen before anything connects, which is what makes them
 * testable here with no database at all, and is also the point: a seed that
 * decided whether it was allowed to run *after* opening a connection to a
 * production database would already have been too late.
 *
 * The environment allowlist is the fixture identity adapter's, shared and not
 * restated (M2-T1 review finding F3: a denylist on the literal `production`
 * lets `Production`, `prod` and a trailing space through), so the spellings
 * asserted here are the spellings that matter.
 */

import { describe, expect, it } from "vitest";
import { runFixtureSeed } from "./seed-fixture.js";

function capture(): {
  io: { out(line: string): void; error(line: string): void };
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    io: {
      out(line: string): void {
        lines.push(`out:${line}`);
      },
      error(line: string): void {
        lines.push(`err:${line}`);
      },
    },
  };
}

describe("runFixtureSeed refusals", () => {
  it.each(["production", "Production", "PRODUCTION", "prod", "production ", "staging"])(
    "refuses with NODE_ENV=%s, without touching a database",
    async (nodeEnv) => {
      const { io, lines } = capture();
      // A DATABASE_URL is present on purpose: the refusal must not depend on
      // there being nothing to connect to.
      const code = await runFixtureSeed(
        { NODE_ENV: nodeEnv, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" },
        io,
      );

      expect(code).toBe(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("refusing to run");
      expect(lines[0]).toContain("public fixture identities");
    },
  );

  it.each([
    ["unset", undefined],
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("refuses when DATABASE_URL is %s", async (_case, url) => {
    const { io, lines } = capture();
    const code = await runFixtureSeed(
      { NODE_ENV: "test", ...(url === undefined ? {} : { DATABASE_URL: url }) },
      io,
    );

    expect(code).toBe(1);
    expect(lines[0]).toContain("DATABASE_URL is not set");
  });

  it("says nothing about the connection string it was given", async () => {
    const { io, lines } = capture();
    await runFixtureSeed(
      { NODE_ENV: "production", DATABASE_URL: "postgres://someone:hunter2@db.example.test/app" },
      io,
    );

    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).not.toContain("db.example.test");
  });
});
