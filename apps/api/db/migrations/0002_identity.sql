-- M1-T2 — identity & tenancy (data-model.md §2 "Identity & tenancy",
-- domain-model.md §2 "Identity & tenancy").
--
-- Scope note: `member_profiles`, `preferences` and `allergy_restrictions` from
-- the data-model sketch are deliberately NOT created here. They are the most
-- sensitive tables in the system (data-model.md §5) and their access rules
-- depend on Q3/OQ-3, which are unresolved — creating them now would mean
-- inventing an access model (CLAUDE.md rule 3). They land with M2's auth work.
--
-- Enum-shaped columns are `text` + CHECK rather than Postgres ENUM types
-- throughout this schema. Rationale: ENUM values cannot be added and used in
-- the same transaction, and removing a value requires recreating the type,
-- which makes reversible migrations (this ticket's acceptance criterion)
-- markedly harder. A CHECK list is diffable against the TypeScript union it
-- mirrors and drops/re-adds cleanly.

-- Up Migration

CREATE TABLE users (
  id                     uuid PRIMARY KEY,
  auth_provider_subject  text UNIQUE,
  email                  text,
  display_name           text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS
  'Authenticated person. Auth identity is external (ADR-004); minimal PII here.';

CREATE TABLE households (
  id          uuid PRIMARY KEY,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE households IS
  'Tenancy + sharing boundary. Every food-domain row is household-scoped.';

CREATE TABLE household_memberships (
  id            uuid PRIMARY KEY,
  household_id  uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_memberships_unique_member UNIQUE (household_id, user_id)
);

CREATE INDEX household_memberships_user_idx ON household_memberships (user_id);

-- Down Migration

DROP TABLE household_memberships;
DROP TABLE households;
DROP TABLE users;
