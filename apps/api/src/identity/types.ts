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
}
