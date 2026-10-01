/**
 * Migration names read from the migrations directory, so a test that rolls
 * back "every migration after N" does not hard-code the list and break each
 * time a migration lands (M9-T0 b).
 */

import { readdirSync } from "node:fs";
import { MIGRATIONS_DIR } from "../migrate.js";

/** Every migration name (file name without `.sql`), oldest first. */
export function allMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -".sql".length))
    .sort();
}

/**
 * The migrations numbered strictly above `number`, oldest first (the order
 * `migrateUp` reports them). `migrateDown` reports the reverse.
 */
export function migrationsAfter(number: number): string[] {
  return allMigrationNames().filter((name) => Number(name.slice(0, 4)) > number);
}
