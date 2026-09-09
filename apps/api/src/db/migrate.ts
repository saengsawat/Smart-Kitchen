/**
 * Migration runner (M1-T2).
 *
 * Tooling: `node-pg-migrate` driving **raw SQL** migrations in
 * `apps/api/db/migrations`. The schema's load-bearing parts — row-level
 * security policies, column-level grants, SECURITY DEFINER trigger functions,
 * deferrable constraint triggers — have no faithful representation in a
 * TypeScript schema DSL, so expressing them as anything other than SQL would
 * mean writing SQL inside an escape hatch and losing the DSL's only benefit.
 * The runner contributes what we actually need: ordered up/down execution, a
 * ledger table of what has run, an advisory lock, and one transaction per
 * migration.
 *
 * The `dir` is resolved relative to this module rather than `process.cwd()`
 * (which node-pg-migrate would otherwise use), so migrations run the same from
 * the repo root, from `apps/api`, or from a test worker. `src/db/migrate.ts`
 * and `dist/db/migrate.js` sit at the same depth, so one path serves both.
 */

import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

/** Absolute path of the SQL migration directory. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));

/**
 * Table recording applied migrations. Named for this project rather than
 * node-pg-migrate's `pgmigrations` default so the tool is replaceable without
 * a table rename.
 */
export const MIGRATIONS_TABLE = "sk_migrations";

/**
 * An upper bound on how many migrations could ever exist, used as
 * node-pg-migrate's way of saying "all of them". It is not a count of the
 * migrations in this repo.
 */
const ALL = 1_000_000;

function silent(): void {
  /* node-pg-migrate logs each migration to the console; tests are noisy enough. */
}

/** Applies every pending migration. Returns the names applied, in order. */
export async function migrateUp(databaseUrl: string): Promise<readonly string[]> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction: "up",
    count: ALL,
    checkOrder: true,
    singleTransaction: true,
    advisoryLockMode: "wait",
    log: silent,
  });
  return applied.map((migration) => migration.name);
}

/**
 * Rolls back exactly `count` migrations.
 *
 * `count` is required, and {@link migrateDownAll} is a separate function, on
 * purpose: `node-pg-migrate down` on the command line rolls back **one**
 * migration, so a programmatic `migrateDown(url)` that defaulted to *all* of
 * them would mean the same word had opposite blast radii depending on where it
 * was typed. Destroying a schema should never be the default argument.
 */
export async function migrateDown(databaseUrl: string, count: number): Promise<readonly string[]> {
  const reverted = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction: "down",
    count,
    checkOrder: true,
    singleTransaction: true,
    advisoryLockMode: "wait",
    log: silent,
  });
  return reverted.map((migration) => migration.name);
}

/** Rolls the database all the way back to empty. Named for what it destroys. */
export async function migrateDownAll(databaseUrl: string): Promise<readonly string[]> {
  return migrateDown(databaseUrl, ALL);
}
