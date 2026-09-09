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

/** Number of migrations that exist; `migrateDown` uses it to unwind everything. */
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

/** Rolls back `count` migrations (default: all of them). */
export async function migrateDown(
  databaseUrl: string,
  count: number = ALL,
): Promise<readonly string[]> {
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
