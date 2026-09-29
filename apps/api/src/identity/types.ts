/**
 * The identity port (M2-T1, ADR-004, D-022).
 *
 * ADR-004's lock-in containment rule is the whole design: exactly one module
 * knows how a bearer token becomes a person, and everything downstream sees
 * only `{ userId, householdId, role }`. Swapping the fixture adapter for a real
 * provider is a new implementation of {@link IdentityPort} and nothing else.
 *
 * Two properties of this interface are load bearing and must survive any
 * implementation:
 *
 * 1. **It is the only source of identity.** No header, query parameter or body
 *    field may name a user or a household. A request that carries
 *    `x-household-id` is answered with the household the *token* resolves to,
 *    not the one the header asks for (INV-TENANT-1).
 * 2. **`null` means denied, not "unknown, carry on".** There is no third
 *    "anonymous" answer, because there is no anonymous state at the HTTP layer
 *    (ARCHITECTURE.md §7.2, default-deny).
 */

/** A member's role inside one household (`household_memberships.role`). */
export type HouseholdRole = "owner" | "member";

export const HOUSEHOLD_ROLES: readonly HouseholdRole[] = Object.freeze(["owner", "member"]);

export function isHouseholdRole(value: unknown): value is HouseholdRole {
  return value === "owner" || value === "member";
}

/**
 * The resolved caller.
 *
 * Deliberately three opaque identifiers and nothing else: no name, no email,
 * no profile. The rest of the request pipeline therefore cannot log personal
 * data even by accident, because it never holds any (ARCHITECTURE.md §7.7,
 * §7.15).
 */
export interface Session {
  readonly userId: string;
  readonly householdId: string;
  readonly role: HouseholdRole;
}

/**
 * Turns a bearer token into a session, or refuses.
 *
 * Asynchronous because every real implementation will be: a JWKS fetch, a
 * provider call, a database lookup. The fixture implementation resolves
 * immediately, but callers must not depend on that.
 *
 * Implementations must return `null` for an unknown, malformed, expired or
 * revoked token. They must not throw for those cases, because a rejected token is an
 * ordinary outcome, and making it an exception invites a catch block that
 * treats a provider outage as an anonymous request.
 */
export interface IdentityPort {
  resolveSession(bearerToken: string): Promise<Session | null>;
  /**
   * The caller and **every** household they belong to (M2-T3, OQ-E1).
   *
   * `null` under exactly the same conditions as {@link resolveSession}'s
   * `null`: the token is not a sign-in. A signed-in person with no household
   * yet is **not** `null`; they are a {@link Caller} with an empty
   * `memberships` list, which is what lets them create or join one.
   *
   * `resolveSession(token)` is always `sessionFor(await resolveCaller(token))`,
   * so the single household a request runs as is always one of this set.
   */
  resolveCaller(bearerToken: string): Promise<Caller | null>;
}

/** One household the caller belongs to, as the identity port reports it. */
export interface Membership {
  readonly householdId: string;
  readonly role: HouseholdRole;
  /** When the membership was created. Decides which household a session runs as. */
  readonly joinedAt: string;
}

/**
 * A signed-in person, before any household has been chosen for the request.
 *
 * `memberships` is ordered most recently joined first, and is the whole set
 * of households this person may act in (OQ-E1: the set comes only from the
 * port; a header or body can never add to it).
 */
export interface Caller {
  readonly userId: string;
  readonly memberships: readonly Membership[];
}

/**
 * Orders memberships most recently joined first.
 *
 * Ties (two memberships created in the same instant, which the seed can do)
 * are broken by household id, descending, so the choice is deterministic and
 * the same on every call. It is not meaningful beyond that.
 */
export function orderMemberships(memberships: readonly Membership[]): readonly Membership[] {
  return [...memberships].sort((left, right) => {
    const byTime = Date.parse(right.joinedAt) - Date.parse(left.joinedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    if (left.householdId === right.householdId) return 0;
    return left.householdId < right.householdId ? 1 : -1;
  });
}

/**
 * The one household a request runs as (M2-T3 (g)).
 *
 * With several memberships the most recently joined wins; switching is out of
 * scope for now. No memberships means no session: household-scoped routes
 * answer 403 and only the household-less routes (create, join, list mine)
 * are reachable.
 */
export function sessionFor(caller: Caller | null): Session | null {
  if (caller === null) return null;
  const chosen = orderMemberships(caller.memberships)[0];
  if (chosen === undefined) return null;
  return { userId: caller.userId, householdId: chosen.householdId, role: chosen.role };
}

/**
 * Where a port reads memberships from, when they live in the database.
 *
 * The fixture adapter knows who a token is; the database knows which
 * households that person has created or joined since. Composing the two is
 * what lets a newly created household take effect on the next request.
 */
export interface MembershipDirectory {
  listMemberships(userId: string): Promise<readonly Membership[]>;
}
