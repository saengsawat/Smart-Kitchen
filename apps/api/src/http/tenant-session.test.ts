/**
 * The request-scoped tenant session (M2-T1).
 *
 * The behaviour that matters is proved against a real database in
 * `tenancy.db.test.ts`. What is asserted here is the wiring that decides *what*
 * the database is asked: that the household comes from the session and that the
 * role is pinned on every transaction, so a pool connected as something more
 * privileged than `sk_app` still runs under the policies.
 */

import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { createTenantSessionRunner, SK_APP_ROLE } from "./tenant-session.js";

const SESSION = {
  userId: "f1c70001-0000-4000-8000-000000000001",
  householdId: "f1c70000-0000-4000-8000-000000000001",
  role: "owner" as const,
};

/** A pool that records every statement its single client is asked to run. */
function recordingPool(): { pool: Pool; statements: string[]; released: number } {
  const statements: string[] = [];
  const state = { released: 0 };
  const client = {
    query: (text: string): Promise<{ command: string; rows: unknown[] }> => {
      statements.push(text);
      return Promise.resolve({ command: text.split(" ")[0] ?? "", rows: [] });
    },
    release: (): void => {
      state.released += 1;
    },
  } as unknown as PoolClient;

  const pool = { connect: (): Promise<PoolClient> => Promise.resolve(client) } as unknown as Pool;
  return {
    pool,
    statements,
    get released(): number {
      return state.released;
    },
  };
}

describe("createTenantSessionRunner", () => {
  it("assumes the sk_app role before any application SQL", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool)(SESSION, async (client) => {
      await client.query("SELECT 1");
      return null;
    });

    expect(recorder.statements[0]).toBe("BEGIN");
    expect(recorder.statements[1]).toBe(`SET LOCAL ROLE ${SK_APP_ROLE}`);
    expect(recorder.statements.indexOf("SELECT 1")).toBeGreaterThan(1);
  });

  it("sets the household context from the session, transaction-locally", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool)(SESSION, () => Promise.resolve(null));

    expect(recorder.statements).toContain("SELECT set_config('app.household_id', $1, true)");
    expect(recorder.statements.indexOf("SELECT set_config('app.household_id', $1, true)")).toBe(2);
  });

  it("assumes sk_app and nothing else, with no way for a caller to ask for another role", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool)(SESSION, () => Promise.resolve(null));

    const roleStatements = recorder.statements.filter((sql) => sql.startsWith("SET LOCAL ROLE"));
    expect(roleStatements).toEqual([`SET LOCAL ROLE ${SK_APP_ROLE}`]);
    // The runner takes a pool and nothing else: there is no options argument
    // through which row-level security could be turned off (review fix F5).
    expect(createTenantSessionRunner.length).toBe(1);
  });

  it("commits and returns what the callback returned", async () => {
    const recorder = recordingPool();
    const result = await createTenantSessionRunner(recorder.pool)(SESSION, () =>
      Promise.resolve("value"),
    );

    expect(result).toBe("value");
    expect(recorder.statements).toContain("COMMIT");
  });

  it("rolls back when the callback throws, and does not swallow the error", async () => {
    const recorder = recordingPool();
    await expect(
      createTenantSessionRunner(recorder.pool)(SESSION, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("COMMIT");
  });
});
