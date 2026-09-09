/**
 * Request-scoped database sessions (M1-T2).
 *
 * Every household-scoped read or write happens inside one of these. The
 * transaction establishes two things before any application SQL runs:
 *
 * - `app.household_id`, transaction-local, which is what the row-level
 *   security policies in migration 0006 compare against. Setting it locally
 *   (`set_config(..., true)`) means it cannot leak to the next borrower of a
 *   pooled connection.
 * - optionally the role to act as. In production the pool connects as `sk_app`
 *   directly and no role change is needed; the test harness connects as the
 *   owner (so it can seed fixtures across households) and assumes `sk_app`
 *   here, which is what makes the policies apply to it.
 *
 * There is deliberately no way to run a household-scoped query without going
 * through this helper — data-model.md §5's "no query path exists without a
 * mandatory household context", made structural.
 */

import type { Pool, PoolClient } from "pg";

/** Postgres identifiers we are willing to `SET ROLE` to. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface HouseholdSessionOptions {
  /**
   * Role to assume for the duration of the transaction (`SET LOCAL ROLE`).
   * Must be a plain lowercase identifier — it cannot be parameterised, so it
   * is validated rather than escaped.
   */
  readonly assumeRole?: string;
}

/**
 * Runs `fn` inside a transaction bound to one household, committing on success
 * and rolling back on any throw.
 *
 * Passing `null` for `householdId` establishes **no** household context — used
 * by the tenancy suite to prove that a code path which forgets to set it sees
 * nothing rather than everything.
 */
export async function withHouseholdTransaction<T>(
  pool: Pool,
  householdId: string | null,
  fn: (client: PoolClient) => Promise<T>,
  options: HouseholdSessionOptions = {},
): Promise<T> {
  const role = options.assumeRole;
  if (role !== undefined && !SAFE_IDENTIFIER.test(role)) {
    throw new Error(`refusing to SET ROLE to a non-identifier: ${role}`);
  }

  const client = await pool.connect();
  let poisoned = false;
  try {
    await client.query("BEGIN");
    if (role !== undefined) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
    if (householdId !== null) {
      await client.query("SELECT set_config('app.household_id', $1, true)", [householdId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    poisoned = true;
    try {
      await client.query("ROLLBACK");
      poisoned = false;
    } catch {
      /* connection is unusable; it is destroyed on release below. */
    }
    throw error;
  } finally {
    client.release(poisoned);
  }
}
