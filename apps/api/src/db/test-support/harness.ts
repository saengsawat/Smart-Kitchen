/**
 * Database test harness (M1-T2).
 *
 * **Why these tests can skip.** Docker is not installed on the development
 * machine (architect amendment, 2026-09-10), so there is no local Postgres to
 * run against. Rather than pretend, the database suites key off `DATABASE_URL`:
 * absent, they skip and say so loudly; present, they run. CI is the gate — the
 * `quality` job runs a Postgres service container and always sets
 * `DATABASE_URL`, and `ci-guard.test.ts` fails the build if it ever does not.
 * A skipped suite is never a passing suite in CI.
 *
 * **Why a database per test file.** The root `vitest.config.ts` is outside this
 * ticket's file scope, so test files run with vitest's default file-level
 * parallelism. Sharing one database between concurrently-running files would
 * mean one file's `migrate down` truncating another file's fixtures. Each file
 * therefore creates its own database from `template0`, migrates it, and drops
 * it afterwards — a few hundred milliseconds each, and no cross-talk.
 */

import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { migrateUp } from "../migrate.js";

/** The runtime role the application connects as (created by migration 0001). */
export const APP_ROLE = "sk_app";

const databaseUrl = process.env["DATABASE_URL"];

/** True when a Postgres to test against was configured. */
export const dbTestsEnabled = typeof databaseUrl === "string" && databaseUrl.trim() !== "";

const ciFlag = process.env["CI"];

/**
 * True when running on CI, where skipping a database suite is a build failure.
 *
 * `GITHUB_ACTIONS` is checked as well as `CI` so that the gate does not quietly
 * disarm itself if the generic variable ever stops being set — the guards below
 * are only worth having if they cannot be switched off by accident.
 */
export const runningInCi =
  ciFlag === "true" || ciFlag === "1" || process.env["GITHUB_ACTIONS"] === "true";

/**
 * Announces a skipped database suite on stderr — one line per suite, alongside
 * vitest's own skipped-test count — so a green local run can never be mistaken
 * for a run that exercised the schema.
 *
 * **In CI this throws.** Locally a skip is the designed behaviour; in CI it
 * means the schema, the append-only rules or the isolation policies went
 * untested behind a green tick. Because every database suite calls this from a
 * test of its own, each suite carries its own gate: if any one of them skips on
 * CI, that file fails by name, no log reading required.
 */
export function noteDbSuiteSkipped(suiteName: string): void {
  const notice =
    `[db-tests] SKIPPED: "${suiteName}" — DATABASE_URL is not set, ` +
    `so no database test ran in this file. These suites are the gate for the schema, ` +
    `append-only enforcement and household isolation; CI always runs them ` +
    `(see .github/workflows/ci.yml). To run them here, set DATABASE_URL (see .env.example).`;
  // Written straight to the real stderr rather than through `console`: vitest's
  // default reporter swallows console output from passing tests, and a notice
  // nobody sees is the exact failure mode this function exists to prevent.
  process.stderr.write(`${notice}\n`);

  if (runningInCi) {
    throw new Error(
      `Database suite "${suiteName}" skipped on CI. CI must run every database suite: ` +
        `restore the postgres service container and its DATABASE_URL in .github/workflows/ci.yml.`,
    );
  }
}

function requireDatabaseUrl(): string {
  if (!dbTestsEnabled || databaseUrl === undefined) {
    throw new Error("DATABASE_URL is not set — guard the suite with `dbTestsEnabled` first");
  }
  return databaseUrl;
}

/** An isolated, migrated database owned by one test file. */
export interface TestDatabase {
  /** Connection string of the throwaway database. */
  readonly url: string;
  readonly name: string;
  /** Pool connected as the migration/owner role. */
  readonly pool: Pool;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Run the migrations after creating it (default true). */
  readonly migrate?: boolean;
}

function databaseNameFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `sk_t_${slug}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function onAdminConnection<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates (and by default migrates) a throwaway database for one test file.
 *
 * `TEMPLATE template0` rather than the default `template1`: concurrent
 * `CREATE DATABASE` calls from parallel test files fail if anyone is connected
 * to the template, and nothing ever connects to `template0`.
 */
export async function createTestDatabase(
  label: string,
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = databaseNameFor(label);
  await onAdminConnection(async (client) => {
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  });

  const url = urlFor(requireDatabaseUrl(), name);
  if (options.migrate !== false) {
    await migrateUp(url);
  }

  const pool = new Pool({ connectionString: url, max: 4 });

  return {
    url,
    name,
    pool,
    async drop(): Promise<void> {
      await pool.end();
      await onAdminConnection(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      });
    },
  };
}

/** Identifiers of a seeded household and its member. */
export interface SeededHousehold {
  readonly householdId: string;
  readonly userId: string;
}

/**
 * Seeds one household with an owner member, as the migration role (which
 * bypasses RLS) so that the isolation suites can then read it back as `sk_app`
 * and prove what is and is not visible.
 */
export async function seedHousehold(pool: Pool, name: string): Promise<SeededHousehold> {
  const householdId = randomUUID();
  const userId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, auth_provider_subject, email, display_name)
       VALUES ($1, $2, $3, $4)`,
      [userId, `test|${userId}`, `${name}@example.test`, `${name} owner`],
    );
    await client.query(`INSERT INTO households (id, name) VALUES ($1, $2)`, [householdId, name]);
    await client.query(
      `INSERT INTO household_memberships (id, household_id, user_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), householdId, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { householdId, userId };
}
