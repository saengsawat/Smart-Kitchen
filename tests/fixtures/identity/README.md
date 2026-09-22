# Identity fixtures (M3-T1 / M2-T1)

Synthetic sign-ins for the stubbed identity port (D-022: build against a stubbed identity first, no
vendor, no signup, no cost). Two households, three people.

The three token strings were written down here by M3-T1 first, because the mobile scaffold needed a
token for its fixture `ApiClient` before this side existed. **M2-T1 adopts those exact strings**
rather than minting its own, so the two sides agree with no follow-up change. `sessions.json` in
this directory is the machine-readable version the API loads.

## These tokens are not secrets

`fixture.dean.chen`, `fixture.maya.chen` and `fixture.owner.other` are literal, obviously fake
strings. They are not credentials, they are not derived from a credential, and they authenticate
nothing outside this repo:

- they are matched by an exact string comparison in an in-process adapter
  (`apps/api/src/identity/fixture-identity-port.ts`);
- that adapter is only registered when `SK_IDENTITY=fixture`;
- the API **refuses to start** (non-zero exit, one line on stderr) unless `NODE_ENV` is unset or one
  of `development` / `test`. An allowlist, not a check against the literal string `production`, so
  `Production`, `prod` and a stray trailing space all fail closed;
- with `SK_IDENTITY` unset the API also refuses to start, because there is no other identity adapter
  yet and no anonymous mode. That is deliberate: deny by default (ARCHITECTURE.md §7.2);
- no `.env*` file carries them. They are literal constants in fixture data and in this README.

The user ids, household ids, names and email addresses in `sessions.json` are equally synthetic.
Addresses use the reserved `.invalid` TLD (RFC 2606) so they can never be delivered to anybody.
Nothing here is real personal data, and nothing here is a secret (CLAUDE.md rules 12 and 18).

## Who is who

| Token | Person | Household | Role | Initials |
| --- | --- | --- | --- | --- |
| `fixture.dean.chen` | Dean Chen | Chen household | `owner` | DC |
| `fixture.maya.chen` | Maya Chen | Chen household | `member` | MC |
| `fixture.owner.other` | Ada Okafor | Okafor household | `owner` | AO |

The second household exists for one reason: it is the household the tenancy tests try, and fail, to
reach from a Chen session (INV-TENANT-1).

## Household ids differ between the two sides, on purpose for now

| Side | Chen | Second household |
| --- | --- | --- |
| API (`sessions.json`, M2-T1) | `f1c70000-0000-4000-8000-000000000001` | `f1c70000-0000-4000-8000-000000000002` |
| Mobile fixtures (`packages/adapters/src/inventory/fixture-inventory-items.ts`, M3-T1) | `hh-fixture-chen` | `hh-fixture-other` |

The API's ids have to be UUIDs: `households.id` is a `uuid` column (migration 0002) and the fixture
users and households are inserted as real rows so the foreign keys and the row-level security
policies mean something. M3-T1's readable ids were written before that constraint was visible and
are fine where they are, because the mobile fixture `ApiClient` never talks to the database.

They converge when the client first calls the real endpoint (M3-T3): the response carries no
household id at all, so the client stops needing one. Until then, do not assume a household id is
the same string on both sides. Raised as a follow-up in `docs/handoff/M2-T1.worker.md`.

## Using them

```
SK_IDENTITY=fixture pnpm --filter api start
curl -H "Authorization: Bearer fixture.dean.chen" http://localhost:3000/v1/inventory/items
```

## Household join code (M3-T2)

S1's "Join with a code" form (`apps/mobile/app/onboarding/account.tsx`) goes through
`FixtureApiClient.joinHousehold` (`apps/mobile/src/api/client.ts`), not this directory's
`sessions.json` (there is no household-join endpoint yet; M2-T3 is the ticket that adds one behind
the same client port). The mobile fixture accepts exactly one code:

| Code | Result |
| --- | --- |
| `CHEN-482` | Joins the Chen household (Dean owner, Maya member) with its existing inventory. |
| Anything else | Rejected with the exact copy "That code didn't match a household. Check it with whoever invited you." |

Like the tokens above, `CHEN-482` is a literal, obviously fake fixture string, not a secret: it
authenticates nothing outside an in-memory, session-only comparison in
`apps/mobile/src/api/client.ts`, and no `.env*` file carries it (CLAUDE.md rules 12 and 18).

## Shape of `sessions.json`

`households[]` carries `householdId` and `name`. `sessions[]` carries `token`, `userId`,
`householdId`, `role` (`owner` or `member`), `displayName`, `displayInitials` and `email`. Every
field is required, every id must be a UUID, every token and every id must be unique, and every
`householdId` on a session must name a declared household. The loader validates all of that and
refuses a malformed file rather than starting with a half-understood identity map.

Only `userId`, `householdId` and `role` ever leave the port. `displayName`, `displayInitials` and
`email` exist so the client has something to render and so the log-redaction tests have a real name
and a real address to prove never appear in a log line (ARCHITECTURE.md §7.15).
