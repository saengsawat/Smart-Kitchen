# ADR-004: Authentication

**Status:** PROPOSED (managed provider); vendor OPEN · Target decision point: M2 (first authenticated endpoint)

## Context
Standard email/social auth for household members; sensitive downstream data (allergies, health-adjacent profile) raises the cost of auth mistakes; team must not spend MVP time on credential infrastructure.

## Options considered

**A. Managed auth provider (Clerk, Auth0, Supabase Auth, Cognito, Firebase Auth)** — *Pros:* battle-tested flows (reset, MFA, OAuth), SDKs for RN, fastest to correct. *Cons:* per-MAU cost at scale; vendor dependence; user-migration is real but well-trodden (export + password-hash migration or forced reset).

**B. Self-hosted (Keycloak, Ory)** — *Pros:* no per-MAU cost, control. *Cons:* an ops burden and attack surface a founding team shouldn't carry pre-PMF.

**C. Roll our own** — Rejected. Unjustifiable risk for zero differentiation.

## Recommendation
**A**, with lock-in containment: only `platform/identity` touches the provider; domain stores our own `user.id` keyed by `auth_provider_subject`; every session resolves to our user row immediately.

## Consequences
Provider swap = one module + a migration path, not a schema change. MFA availability becomes a feature checkbox, not a project.

## Open questions
- Vendor choice (price at 10k MAU, RN SDK quality, export story) — compare at M2.
- Social providers offered at launch (product owner, Q-level detail).
- Household invitation flow design (fast-follow UX).
