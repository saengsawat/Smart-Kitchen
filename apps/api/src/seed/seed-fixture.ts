/**
 * `pnpm --filter api db:seed:fixture` (M2-T2).
 *
 * Puts the fixture identities and the Chen household's inventory into the
 * database `DATABASE_URL` points at, so a developer (or Dean's phone, over the
 * LAN) can read and write real rows instead of the client's in-memory fixture.
 *
 * Two refusals, both deliberate and both before anything connects:
 *
 * - **Environment.** The seed writes the same public, non-secret identities the
 *   fixture adapter serves, so it may only run where that adapter may load:
 *   `NODE_ENV` unset, `development` or `test` (`isFixtureEnvironmentPermitted`,
 *   the one allowlist, shared rather than restated). Seeding fixture users into
 *   a real deployment would be handing out accounts.
 * - **Target.** No `DATABASE_URL`, no seed. There is no default connection
 *   string, because a default is how a script ends up writing to whatever was
 *   convenient.
 *
 * It is safe to run repeatedly: identities insert with `ON CONFLICT DO
 * NOTHING`, and the inventory skips any item it already wrote (the ids are
 * derived, so "already wrote" is decidable). Rows belonging to anything other
 * than the fixture households are never read, updated or deleted; the seed only
 * ever inserts.
 *
 * `runFixtureSeed` returns an exit code instead of calling `process.exit`, so
 * the refusals are testable without spawning a process. The module tail is the
 * only part that touches the real process, and it only runs when this file is
 * the entry point.
 */

import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  isFixtureEnvironmentPermitted,
  loadFixtureIdentityData,
  FIXTURE_PERMITTED_NODE_ENVS,
  type EnvironmentLike,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { seedChenInventory } from "./fixture-inventory.js";

/** Where the seed reports. Injected so tests never write to the real console. */
export interface SeedIo {
  out(line: string): void;
  error(line: string): void;
}

const DEFAULT_IO: SeedIo = {
  out(line: string): void {
    process.stdout.write(`${line}\n`);
  },
  error(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};

/** The fixture household whose inventory the prototype draws. */
const CHEN_HOUSEHOLD_NAME = "Chen household";

/** The member every seeded chicken-breast row is attributed to. */
const CHEN_OWNER_TOKEN = "fixture.dean.chen";

/**
 * Seeds, and returns a process exit code: `0` on success, `1` after writing one
 * clear line saying why it refused.
 */
export async function runFixtureSeed(
  env: EnvironmentLike = process.env,
  io: SeedIo = DEFAULT_IO,
): Promise<number> {
  if (!isFixtureEnvironmentPermitted(env)) {
    io.error(
      `smart-kitchen seed: refusing to run with NODE_ENV=${env["NODE_ENV"] ?? ""}. ` +
        `This seed writes the repository's public fixture identities and their inventory, ` +
        `so it runs only with NODE_ENV unset or one of: ` +
        `${FIXTURE_PERMITTED_NODE_ENVS.join(", ")}.`,
    );
    return 1;
  }

  const connectionString = env["DATABASE_URL"];
  if (connectionString === undefined || connectionString.trim() === "") {
    io.error(
      "smart-kitchen seed: DATABASE_URL is not set, so there is no database to seed. " +
        "See .env.example and CONTRIBUTING.md.",
    );
    return 1;
  }

  const data = await loadFixtureIdentityData();
  const household = data.households.find((entry) => entry.name === CHEN_HOUSEHOLD_NAME);
  const owner = data.sessions.find((entry) => entry.token === CHEN_OWNER_TOKEN);
  if (household === undefined || owner === undefined) {
    io.error(
      `smart-kitchen seed: the identity fixture no longer contains ${CHEN_HOUSEHOLD_NAME} ` +
        `and ${CHEN_OWNER_TOKEN}, which the seeded inventory is attributed to.`,
    );
    return 1;
  }

  const pool = new Pool({ connectionString });
  try {
    await seedFixtureIdentities(pool, data);
    const summary = await seedChenInventory(pool, household.householdId, owner.userId);
    io.out(
      `smart-kitchen seed: identities ready; inventory items created ` +
        `${String(summary.itemsCreated)}, already present ${String(summary.itemsAlreadyPresent)}, ` +
        `ledger rows appended ${String(summary.rowsAppended)}.`,
    );
    return 0;
  } catch (error) {
    // Never the connection string, and never a driver error verbatim: it can
    // quote a stored row.
    io.error(
      `smart-kitchen seed: failed. ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  process.exitCode = await runFixtureSeed();
}
