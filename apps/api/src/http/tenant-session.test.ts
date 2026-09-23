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
    await createTenantSessionRunner(recorder.pool).read(SESSION, async (client) => {
      await client.query("SELECT 1");
      return null;
    });

    expect(recorder.statements[0]).toBe("BEGIN");
    expect(recorder.statements[1]).toBe(`SET LOCAL ROLE ${SK_APP_ROLE}`);
    expect(recorder.statements.indexOf("SELECT 1")).toBeGreaterThan(1);
  });

  it("sets the household context from the session, transaction-locally", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool).read(SESSION, () => Promise.resolve(null));

    expect(recorder.statements).toContain("SELECT set_config('app.household_id', $1, true)");
    expect(recorder.statements.indexOf("SELECT set_config('app.household_id', $1, true)")).toBe(2);
  });

  it("assumes sk_app and nothing else, with no way for a caller to ask for another role", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool).read(SESSION, () => Promise.resolve(null));

    const roleStatements = recorder.statements.filter((sql) => sql.startsWith("SET LOCAL ROLE"));
    expect(roleStatements).toEqual([`SET LOCAL ROLE ${SK_APP_ROLE}`]);
    // The runner takes a pool and nothing else: there is no options argument
    // through which row-level security could be turned off (review fix F5).
    expect(createTenantSessionRunner.length).toBe(1);
  });

  it("commits and returns what the callback returned", async () => {
    const recorder = recordingPool();
    const result = await createTenantSessionRunner(recorder.pool).read(SESSION, () =>
      Promise.resolve("value"),
    );

    expect(result).toBe("value");
    expect(recorder.statements).toContain("COMMIT");
  });

  it("pins the role and the household on a write exactly as on a read", async () => {
    const recorder = recordingPool();
    await createTenantSessionRunner(recorder.pool).write(SESSION, () => Promise.resolve(null));

    expect(recorder.statements[0]).toBe("BEGIN");
    expect(recorder.statements[1]).toBe(`SET LOCAL ROLE ${SK_APP_ROLE}`);
    expect(recorder.statements[2]).toBe("SELECT set_config('app.household_id', $1, true)");
  });

  it("re-runs a write that lost a race, and only a write", async () => {
    // The two entry points differ in exactly one way, and this is it: `write`
    // goes through the M1-T9 retry helper, `read` does not. A read that
    // retried would re-run a query for no reason; a write that did not would
    // fail a request for a concurrent append it is designed to survive.
    const recorder = recordingPool();
    const runner = createTenantSessionRunner(recorder.pool);
    let writeAttempts = 0;
    let readAttempts = 0;

    const lostRace = (): Error & { code?: string } => {
      const error: Error & { code?: string } = new Error("serialization failure");
      error.code = "40001";
      return error;
    };

    const written = await runner.write(SESSION, () => {
      writeAttempts += 1;
      return writeAttempts === 1 ? Promise.reject(lostRace()) : Promise.resolve("landed");
    });
    await expect(
      runner.read(SESSION, () => {
        readAttempts += 1;
        return Promise.reject(lostRace());
      }),
    ).rejects.toThrow("serialization failure");

    expect(written).toBe("landed");
    expect(writeAttempts).toBe(2);
    expect(readAttempts).toBe(1);
  });

  it("rolls back when the callback throws, and does not swallow the error", async () => {
    const recorder = recordingPool();
    await expect(
      createTenantSessionRunner(recorder.pool).read(SESSION, () =>
        Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");

    expect(recorder.statements).toContain("ROLLBACK");
    expect(recorder.statements).not.toContain("COMMIT");
  });
});
