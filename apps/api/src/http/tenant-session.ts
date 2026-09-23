/**
 * Request-scoped database sessions (M2-T1, over M1-T2's `db/session.ts`).
 *
 * Every statement a request issues runs inside `withHouseholdTransaction`, so
 * the transaction-local `app.household_id` the migration-0006 policies compare
 * against is set before any application SQL, and unset afterwards. There is no
 * other way for a route to reach the pool: handlers are handed a
 * {@link TenantSessionRunner}, never the `Pool` itself (data-model.md §5, "no
 * query path exists without a mandatory household context").
 *
 * **`assumeRole` is pinned, always.** Every transaction issues
 * `SET LOCAL ROLE sk_app`, whatever the pool happens to be connected as. In a
 * deployment that connects as `sk_app` it is a no-op. In the test harness,
 * which connects as the database owner so it can seed across households, it is
 * what makes the policies apply at all, and an owner connection that skipped
 * it would read every household's rows while every test passed. Pinning the
 * role removes the difference between the two, so the isolation the tests prove
 * is the isolation production gets.
 *
 * The household comes from the session, which comes from the identity port.
 * Nothing here accepts a household id from a caller.
 */

import type { Pool, PoolClient } from "pg";
import { withRetriedHouseholdTransaction } from "../db/retry.js";
import { withHouseholdTransaction } from "../db/session.js";
import type { Session } from "../identity/index.js";

/**
 * The runtime role created by migration 0001 and granted by 0006.
 *
 * Restated here rather than imported from `db/test-support/harness.ts`: the
 * harness is test-only and production code must not depend on it. Consolidating
 * the two into one shared constant is proposed in the M2-T1 handoff.
 */
export const SK_APP_ROLE = "sk_app";

/**
 * The two ways a handler may touch the database, and there are only two.
 *
 * `read` is one plain transaction. `write` is the same transaction with the
 * M1-T9 retry wrapper around it, because a ledger append can lose a race with
 * a concurrent append to the same item and the answer to that is to re-run the
 * whole thing, not to patch up a stale sequence (`db/retry.ts` explains which
 * two Postgres error shapes mean exactly that, and why no other error is
 * retried). Re-running is safe precisely because every write is idempotent
 * under its key (INV-LEDGER-3), so a retried attempt lands once or reports
 * itself as a duplicate.
 *
 * Split into two named entry points rather than one runner with a `retry`
 * option: whether a request is a read or a write is a property of the endpoint,
 * decided when it is written, not a flag somebody can forget to pass. Handlers
 * still never see the `Pool`.
 */
export interface TenantSessionRunner {
  read<T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T>;
  write<T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

/**
 * There is no option to change the role.
 *
 * An earlier revision took one, defaulted to {@link SK_APP_ROLE}, and was used
 * by nothing but its own test (M2-T1 review finding F5). A parameter that turns
 * row-level security off is worth having only if something needs it; nothing
 * does, and leaving it reachable from production code makes the strongest claim
 * in this module ("every request transaction runs as `sk_app`") conditional on
 * an argument. The tenancy suite exercises the unpinned path by calling
 * `withHouseholdTransaction` directly, which is where that capability belongs.
 */
export function createTenantSessionRunner(pool: Pool): TenantSessionRunner {
  return {
    read<T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T> {
      return withHouseholdTransaction(pool, session.householdId, fn, { assumeRole: SK_APP_ROLE });
    },
    write<T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T> {
      return withRetriedHouseholdTransaction(pool, session.householdId, fn, {
        assumeRole: SK_APP_ROLE,
      });
    },
  };
}
