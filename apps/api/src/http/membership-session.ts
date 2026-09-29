/**
 * Transactions for the household endpoints that cannot run inside the
 * caller's current household (M2-T3), and the database-backed membership
 * directory the identity port reads.
 *
 * `tenant-session.ts` covers every request that acts *in* a household. Two
 * requests cannot: creating a household (it does not exist yet) and joining
 * one (the caller is not in it yet). They get exactly two more entry points,
 * both pinned to `sk_app` like every other request transaction:
 *
 * - {@link MembershipSessionRunner.outsideHousehold}: no household context at
 *   all. Every household-scoped table reads as empty and refuses writes
 *   (migration 0006 fails closed), so the only things reachable are migration
 *   0008's SECURITY DEFINER doors: redeem a code, list one user's
 *   memberships.
 * - {@link MembershipSessionRunner.inNewHousehold}: bound to a household id
 *   the *server* just minted for a create. The id never comes from a request.
 *
 * Handlers still never see the pool.
 */

import type { Pool, PoolClient } from "pg";
import { listMembershipsForUser } from "../db/households/repository.js";
import { withRetriedHouseholdTransaction } from "../db/retry.js";
import { withHouseholdTransaction } from "../db/session.js";
import type { Membership, MembershipDirectory } from "../identity/index.js";
import { SK_APP_ROLE } from "./tenant-session.js";

export interface MembershipSessionRunner {
  outsideHousehold<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  inNewHousehold<T>(householdId: string, fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export function createMembershipSessionRunner(pool: Pool): MembershipSessionRunner {
  return {
    outsideHousehold<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      return withHouseholdTransaction(pool, null, fn, { assumeRole: SK_APP_ROLE });
    },
    inNewHousehold<T>(householdId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
      return withRetriedHouseholdTransaction(pool, householdId, fn, { assumeRole: SK_APP_ROLE });
    },
  };
}

/**
 * The identity port's view of memberships, read from `household_memberships`
 * through `app_user_memberships` (migration 0008), one short transaction per
 * request.
 */
export function createPostgresMembershipDirectory(pool: Pool): MembershipDirectory {
  const runner = createMembershipSessionRunner(pool);
  return {
    async listMemberships(userId: string): Promise<readonly Membership[]> {
      const rows = await runner.outsideHousehold((client) =>
        listMembershipsForUser(client, userId),
      );
      return rows.map(({ householdId, role, joinedAt }) => ({ householdId, role, joinedAt }));
    },
  };
}
