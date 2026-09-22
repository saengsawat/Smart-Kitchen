/**
 * Puts the fixture identities into a throwaway database (M2-T1).
 *
 * The fixture adapter answers with user and household ids; the schema's foreign
 * keys, policies and `users_shared_household` policy only mean anything if
 * those ids are real rows. So the HTTP tenancy suite seeds them here, through
 * the existing schema, as the migration/owner role (which bypasses RLS, so a
 * cross-household seed is possible and the isolation that follows is a real
 * result rather than an artefact of what could be written).
 *
 * **No migration carries fixture data.** A migration that seeded development
 * identities would run in every environment the migrations run in, which is the
 * one thing the production refusal in `registry.ts` exists to prevent.
 *
 * This module is test support. It lives under `identity/` because that is where
 * the fixture map is understood, and nothing in the production request path
 * imports it.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { FixtureIdentityData } from "../fixture-identity-port.js";

/**
 * Inserts every household, user and membership the fixture map declares.
 *
 * Idempotent (`ON CONFLICT DO NOTHING`) so a suite that seeds twice, or a
 * fixture map that gains a second session in an existing household, does not
 * fail on a re-run.
 */
export async function seedFixtureIdentities(pool: Pool, data: FixtureIdentityData): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const household of data.households) {
      await client.query(
        `INSERT INTO households (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [household.householdId, household.name],
      );
    }

    for (const session of data.sessions) {
      await client.query(
        `INSERT INTO users (id, auth_provider_subject, email, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [session.userId, `fixture|${session.token}`, session.email, session.displayName],
      );
      await client.query(
        `INSERT INTO household_memberships (id, household_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT household_memberships_unique_member DO NOTHING`,
        [randomUUID(), session.householdId, session.userId, session.role],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
