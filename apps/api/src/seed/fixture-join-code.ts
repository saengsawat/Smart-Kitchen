/**
 * The Chen household's join code for the development seed (M2-T3 (f)).
 *
 * `CHEN-482` is the code the mobile fixture client already accepts
 * (`tests/fixtures/identity/README.md`), so seeding it makes the real join
 * endpoint and the fixture agree. Like the fixture tokens it is a public,
 * non-secret string, and it is only ever written by the seed, which refuses
 * to run outside the fixture environments.
 *
 * Only the hash is stored, under the same pepper the API resolves
 * (`resolveJoinCodePepper`), so the seed and a running API must see the same
 * `SK_JOIN_CODE_PEPPER` (both unset in development is the usual case).
 *
 * Idempotent and insert-only. The code is written when the household has no
 * live code and the code has never been issued; otherwise nothing happens. In
 * particular, if an owner has rotated the code in a development database, a
 * re-run of the seed does not bring `CHEN-482` back: a rotated code stays
 * rotated, which is the property the rotation test proves.
 */

import type { Pool } from "pg";
import { CHEN_FIXTURE_JOIN_CODE, type JoinCodeHasher } from "../db/households/join-code.js";

export interface JoinCodeSeedResult {
  /** True when this run wrote the row; false when it was already there or superseded. */
  readonly issued: boolean;
}

/** Runs as the owner role (it writes across the RLS boundary, like the identity half). */
export async function seedChenJoinCode(
  pool: Pool,
  householdId: string,
  ownerUserId: string,
  hasher: JoinCodeHasher,
): Promise<JoinCodeSeedResult> {
  const result = await pool.query(
    `INSERT INTO household_join_codes (code_hash, household_id, created_by)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (
              SELECT 1 FROM household_join_codes
               WHERE household_id = $2 AND revoked_at IS NULL)
     ON CONFLICT (code_hash) DO NOTHING`,
    [hasher.hash(CHEN_FIXTURE_JOIN_CODE), householdId, ownerUserId],
  );
  return { issued: result.rowCount === 1 };
}
