/**
 * The gate on the gate (M1-T2).
 *
 * Every database suite in this package skips when `DATABASE_URL` is absent —
 * that is what keeps the local run green on a machine with no Postgres. The
 * obvious failure mode of that design is a CI job that quietly stops setting
 * `DATABASE_URL` and reports a green build in which the schema, the append-only
 * rules and the isolation policies were never exercised at all.
 *
 * These two tests close it: in CI, the variable must be set *and* the database
 * must actually answer. They do not skip.
 */

import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { dbTestsEnabled, runningInCi as inCi } from "./test-support/harness.js";

describe("CI database gate", () => {
  it("CI sets DATABASE_URL so the database suites cannot silently skip", () => {
    if (!inCi) {
      expect(inCi).toBe(false);
      return;
    }
    expect(
      dbTestsEnabled,
      "DATABASE_URL is unset in CI: the database suites would skip and the build would go green " +
        "without testing the schema. Restore the postgres service container and its DATABASE_URL " +
        "in .github/workflows/ci.yml.",
    ).toBe(true);
  });

  it("CI's DATABASE_URL points at a reachable Postgres", async () => {
    if (!inCi) {
      expect(inCi).toBe(false);
      return;
    }
    const client = new Client({ connectionString: process.env["DATABASE_URL"] });
    await client.connect();
    try {
      const result = await client.query<{ answer: number }>("SELECT 1 AS answer");
      expect(result.rows[0]?.answer).toBe(1);
    } finally {
      await client.end();
    }
  });
});
