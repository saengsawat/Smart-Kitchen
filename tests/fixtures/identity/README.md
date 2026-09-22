# Identity fixtures (M3-T1 / M2-T1)

Fixture bearer tokens for the stubbed identity port (D-022: build against a
stubbed identity first, no vendor, no signup, no cost). These are **not
secrets**. They are obviously-fake, hardcoded strings checked into the repo on
purpose, matching the two households M2-T1's `IdentityPort` fixture
implementation is specified to expose (BACKLOG.md M2-T1): the Chen household
(owner Dean, member Maya) and a second, single-owner household for tenancy
isolation tests.

Defined here first because M3-T1 (mobile scaffold) does not depend on M2-T1
and needed a token to put in its fixture `ApiClient` before M2-T1 merged.
**M2-T1 adopts these exact strings** rather than minting its own, so the two
sides agree without a follow-up change.

| Token | Household | User | Role |
|---|---|---|---|
| `fixture.dean.chen` | Chen (`hh-fixture-chen`) | Dean (`DC`) | owner |
| `fixture.maya.chen` | Chen (`hh-fixture-chen`) | Maya (`MC`) | member |
| `fixture.owner.other` | second household (`hh-fixture-other`) | owner | owner |

Rules (CLAUDE.md rule 12, rule 18):

- These values never touch a real auth vendor, a real user record, or
  production configuration. The fixture identity port (M2-T1) refuses to
  register unless `SK_IDENTITY=fixture` and `NODE_ENV` is not `production`.
- No `.env*` file carries these; they are literal constants in fixture code
  and here in this README.
- Household ids (`hh-fixture-chen`, `hh-fixture-other`) match the ones used by
  `packages/adapters/src/inventory/fixture-inventory-items.ts` (M3-T1), so a
  client authenticated with one of these tokens and reading inventory through
  the fixture `ApiClient` sees a consistent household.
