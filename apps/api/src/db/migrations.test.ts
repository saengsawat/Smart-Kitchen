/**
 * Migration reversibility (M1-T2, testing-strategy.md §1 "Database tests" and
 * "Data migration tests").
 *
 * Reversibility is not a nicety here: the ticket's downstream milestones all
 * build on this schema, and a migration that cannot be rolled back turns a bad
 * deploy into a restore-from-backup. Both directions are exercised on an empty
 * database *and* on a seeded one, because a `DROP TABLE` that works on empty
 * tables can still fail on rows a foreign key points at.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, MIGRATIONS_TABLE, migrateDownAll, migrateUp } from "./migrate.js";
import { createTestDatabase, dbTestsEnabled, noteDbSuiteSkipped } from "./test-support/harness.js";
import type { TestDatabase } from "./test-support/harness.js";

const SUITE = "migrations (up/down reversibility)";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const APP_TABLES = [
  "users",
  "households",
  "household_memberships",
  "inventory_items",
  "inventory_lots",
  "inventory_transactions",
];

async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

/** Writes one household, item, lot and transaction — enough to exercise every FK. */
async function seedProdShapedRows(pool: Pool): Promise<void> {
  const userId = randomUUID();
  const householdId = randomUUID();
  const itemId = randomUUID();
  const lotId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO users (id, email) VALUES ($1, 'seed@example.test')`, [userId]);
    await client.query(`INSERT INTO households (id, name) VALUES ($1, 'Seed household')`, [
      householdId,
    ]);
    await client.query(
      `INSERT INTO household_memberships (id, household_id, user_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), householdId, userId],
    );
    await client.query(
      `INSERT INTO inventory_items (id, household_id, unit, storage_location)
       VALUES ($1, $2, 'lb', 'FRIDGE')`,
      [itemId, householdId],
    );
    await client.query(
      `INSERT INTO inventory_lots (id, household_id, item_id) VALUES ($1, $2, $3)`,
      [lotId, householdId, itemId],
    );
    await client.query(
      `INSERT INTO inventory_transactions
         (household_id, item_id, lot_id, sequence, type, qty_delta, qty_delta_micros, unit,
          actor_kind, actor_user_id, occurred_at, recorded_at,
          provenance_tier, provenance_source, idempotency_key)
       VALUES ($1, $2, $3, 1, 'PURCHASE', 2.0, 2000000, 'lb',
               'user', $4, now(), now(), 'KNOWN_FACT', 'manual-entry', 'seed-purchase')`,
      [householdId, itemId, lotId, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("migration files", () => {
  it("are all reversible: every file declares a Down Migration", () => {
    expect(MIGRATION_FILES.length).toBeGreaterThan(0);
    for (const file of MIGRATION_FILES) {
      const contents = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      expect(contents, `${file} has no "-- Up Migration" marker`).toMatch(
        /^\s*--\s*Up Migration/im,
      );
      expect(contents, `${file} has no "-- Down Migration" marker`).toMatch(
        /^\s*--\s*Down Migration/im,
      );
    }
  });

  it("are ordered by a zero-padded numeric prefix", () => {
    for (const [index, file] of MIGRATION_FILES.entries()) {
      expect(file.slice(0, 4)).toBe(String(index + 1).padStart(4, "0"));
    }
  });
});

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("migrations", { migrate: false });
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  it("migrates up cleanly on an empty database", async () => {
    const applied = await migrateUp(db.url);
    expect(applied.map((name) => name.slice(0, 4))).toEqual(
      MIGRATION_FILES.map((file) => file.slice(0, 4)),
    );

    const tables = await tableNames(db.pool);
    for (const table of APP_TABLES) expect(tables).toContain(table);
    expect(tables).toContain(MIGRATIONS_TABLE);
  });

  it("is a no-op when everything is already applied", async () => {
    const applied = await migrateUp(db.url);
    expect(applied).toEqual([]);
  });

  it("migrates down cleanly, leaving only the migrations table", async () => {
    const reverted = await migrateDownAll(db.url);
    expect(reverted).toHaveLength(MIGRATION_FILES.length);

    const tables = await tableNames(db.pool);
    for (const table of APP_TABLES) expect(tables).not.toContain(table);
    expect(tables).toEqual([MIGRATIONS_TABLE]);

    const remaining = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${MIGRATIONS_TABLE}`,
    );
    expect(remaining.rows[0]?.count).toBe("0");
  });

  it("migrates back up after a full rollback", async () => {
    const applied = await migrateUp(db.url);
    expect(applied).toHaveLength(MIGRATION_FILES.length);
    const tables = await tableNames(db.pool);
    for (const table of APP_TABLES) expect(tables).toContain(table);
  });

  it("rolls back a seeded database and comes back empty", async () => {
    await seedProdShapedRows(db.pool);
    const before = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_transactions`,
    );
    expect(before.rows[0]?.count).toBe("1");

    await migrateDownAll(db.url);
    await migrateUp(db.url);

    const after = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_transactions`,
    );
    expect(after.rows[0]?.count).toBe("0");
    const households = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM households`,
    );
    expect(households.rows[0]?.count).toBe("0");
  });

  it("leaves the runtime role's privileges revoked after a rollback", async () => {
    // Roles are cluster-scoped, so 0001 down revokes rather than drops. What
    // must be true after a rollback is that the role can no longer reach
    // anything in this database.
    await migrateDownAll(db.url);
    const privileges = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.role_table_grants
        WHERE grantee = 'sk_app'`,
    );
    expect(privileges.rows[0]?.count).toBe("0");
    await migrateUp(db.url);
  });
});
