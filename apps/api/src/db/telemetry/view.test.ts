/**
 * `inventory_correction_telemetry` (migration 0007) as a database object in
 * its own right: `security_invoker`, grants, tenancy through the view itself
 * (as distinct from through {@link readCorrectionTelemetry}), and migration
 * reversibility. `correction-rate.test.ts` covers the read function and the
 * metric's composition; this file covers the view.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertInventoryItem, appendTransactionToDb } from "../inventory/repository.js";
import { migrateDown, migrateUp } from "../migrate.js";
import { withHouseholdTransaction } from "../session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type SeededHousehold,
  type TestDatabase,
} from "../test-support/harness.js";
import { captureError, pgFailure } from "../test-support/inventory-fixtures.js";

const SUITE = "inventory_correction_telemetry view";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";
const INSTANT = "2026-03-06T18:00:00.000Z";

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let alpha: SeededHousehold;
  let beta: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("correction-telemetry-view");
    alpha = await seedHousehold(db.pool, "Alpha telemetry");
    beta = await seedHousehold(db.pool, "Beta telemetry");

    for (const household of [alpha, beta]) {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertInventoryItem(client, {
            itemId,
            householdId: household.householdId,
            unit: UNIT,
            lots: [{ lotId }],
          });
          const appended = await appendTransactionToDb(client, household.householdId, itemId, {
            lotId,
            type: "INITIAL_STOCK",
            qtyDelta: 1,
            unit: UNIT,
            actor: { kind: "user", userId: household.userId },
            occurredAt: INSTANT,
            recordedAt: INSTANT,
            provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
            idempotencyKey: `${household.householdId}-seed`,
          });
          if (!appended.ok || appended.value.status !== "appended") {
            throw new Error("seed transaction did not append");
          }
        },
        { assumeRole: APP_ROLE },
      );
    }
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  it("is security_invoker=true, per ADR-003 standing rule 3", async () => {
    const result = await db.pool.query<{ reloptions: string[] | null }>(
      `SELECT reloptions FROM pg_class WHERE relname = 'inventory_correction_telemetry'`,
    );
    expect(result.rows[0]?.reloptions).toContain("security_invoker=true");
  });

  describe("tenancy", () => {
    async function itemIdsAs(householdId: string | null): Promise<string[]> {
      return withHouseholdTransaction(
        db.pool,
        householdId,
        async (client) => {
          const result = await client.query<{ item_id: string }>(
            `SELECT item_id FROM inventory_correction_telemetry`,
          );
          return result.rows.map((row) => row.item_id);
        },
        { assumeRole: APP_ROLE },
      );
    }

    it("the owner role sees both households (so the negatives below mean something)", async () => {
      const result = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_correction_telemetry`,
      );
      expect(result.rows[0]?.count).toBe("2");
    });

    it("household Alpha sees only its own row", async () => {
      const rows = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        async (client) => {
          const result = await client.query<{ household_id: string }>(
            `SELECT household_id FROM inventory_correction_telemetry`,
          );
          return result.rows;
        },
        { assumeRole: APP_ROLE },
      );
      expect(rows.every((row) => row.household_id === alpha.householdId)).toBe(true);
      expect(rows).toHaveLength(1);
    });

    it("household Beta sees only its own row", async () => {
      // M1-T10-l (review F3): Alpha's test above asserts household_id
      // identity, not just row count — this one previously checked count
      // only, which a mutation smuggling in a foreign row of the right
      // *count* but wrong household would not have caught.
      const rows = await withHouseholdTransaction(
        db.pool,
        beta.householdId,
        async (client) => {
          const result = await client.query<{ household_id: string }>(
            `SELECT household_id FROM inventory_correction_telemetry`,
          );
          return result.rows;
        },
        { assumeRole: APP_ROLE },
      );
      expect(rows.every((row) => row.household_id === beta.householdId)).toBe(true);
      expect(rows).toHaveLength(1);
    });

    it("no household context sees no rows", async () => {
      const ids = await itemIdsAs(null);
      expect(ids).toEqual([]);
    });
  });

  describe("grants", () => {
    // The view aggregates (COUNT/MIN/MAX with GROUP BY), which makes it
    // structurally non-updatable to *any* role — Postgres refuses these
    // statements with 55000 ("view is not simple") before it ever reaches a
    // grant check, and it does so identically for the owner/superuser (spiked
    // manually against a throwaway database: same 55000, same message, no
    // `SET ROLE` involved). So these three do not exercise `sk_app`'s grants —
    // that is what the fourth test below does, directly against
    // information_schema — they exercise that the write is refused at all,
    // through the exact path a caller would try it.
    it("sk_app cannot INSERT into the view (non-updatable view, not a grant check)", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            alpha.householdId,
            (client) =>
              client.query(
                `INSERT INTO inventory_correction_telemetry
                   (household_id, item_id, statement_count, user_adjustment_count,
                    clamp_count, correction_event_count, correction_rate,
                    first_recorded_at, last_recorded_at)
                 VALUES ($1, $2, 0, 0, 0, 0, NULL, now(), now())`,
                [alpha.householdId, randomUUID()],
              ),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("55000");
      expect(failure.message).toMatch(/cannot insert into view/);
    });

    it("sk_app cannot UPDATE the view (non-updatable view, not a grant check)", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            alpha.householdId,
            (client) =>
              client.query(`UPDATE inventory_correction_telemetry SET statement_count = 0`),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("55000");
      expect(failure.message).toMatch(/cannot update view/);
    });

    it("sk_app cannot DELETE from the view (non-updatable view, not a grant check)", async () => {
      const failure = pgFailure(
        await captureError(() =>
          withHouseholdTransaction(
            db.pool,
            alpha.householdId,
            (client) => client.query(`DELETE FROM inventory_correction_telemetry`),
            { assumeRole: APP_ROLE },
          ),
        ),
      );
      expect(failure.code).toBe("55000");
      expect(failure.message).toMatch(/cannot delete from view/);
    });

    it("sk_app's only privilege on the view is SELECT", async () => {
      const result = await db.pool.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'sk_app' AND table_name = 'inventory_correction_telemetry'
          ORDER BY privilege_type`,
      );
      expect(result.rows.map((row) => row.privilege_type)).toEqual(["SELECT"]);
    });
  });

  describe("migration reversibility", () => {
    async function viewExists(pool: Pool): Promise<boolean> {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_class WHERE relname = 'inventory_correction_telemetry'`,
      );
      return result.rows[0]?.count === "1";
    }

    it("migrate down removes the view cleanly; migrate up restores it", async () => {
      const scratch = await createTestDatabase("correction-telemetry-migration");
      try {
        expect(await viewExists(scratch.pool)).toBe(true);

        const reverted = await migrateDown(scratch.url, 1);
        expect(reverted).toEqual(["0007_correction_telemetry"]);
        expect(await viewExists(scratch.pool)).toBe(false);

        // The table it reads from is untouched by rolling back only this
        // migration.
        const tables = await scratch.pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM information_schema.tables
            WHERE table_name = 'inventory_transactions'`,
        );
        expect(tables.rows[0]?.count).toBe("1");

        const applied = await migrateUp(scratch.url);
        expect(applied).toEqual(["0007_correction_telemetry"]);
        expect(await viewExists(scratch.pool)).toBe(true);
      } finally {
        await scratch.drop();
      }
    }, 60_000);
  });
});
