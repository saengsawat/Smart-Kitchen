/**
 * `readCorrectionTelemetry` (M1-T7): the period-bounded read path over the
 * correction-rate definitions in migration 0007.
 *
 * Every transaction here goes in through the real write path
 * (`appendTransactionToDb`), never raw SQL — the point of this suite is that
 * the *counts the KPI reports* match what a household actually did, including
 * the ledger's own auto-generated over-consumption clamp (0004).
 */

import { randomUUID } from "node:crypto";
import type {
  Actor,
  AppendResult,
  CreateInventoryItemInput,
  Outcome,
  TransactionInput,
} from "@smart-kitchen/domain";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendTransactionToDb, insertInventoryItem } from "../inventory/repository.js";
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
import { readCorrectionTelemetry, type CorrectionTelemetryTotals } from "./correction-rate.js";

const SUITE = "correction-rate telemetry — readCorrectionTelemetry";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";
const BASE_EPOCH_MS = Date.UTC(2026, 2, 6, 18, 0, 0);

/** Canonical UTC instant `step` seconds after the base epoch. */
function instantAt(step: number): string {
  return new Date(BASE_EPOCH_MS + step * 1000).toISOString();
}

const USER_ACTOR = (userId: string): Actor => ({ kind: "user", userId });
const SYSTEM_ACTOR: Actor = { kind: "system", component: "meal-planner" };

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("correction-rate");
    household = await seedHousehold(db.pool, "Correction rate");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  /** Creates an item with one lot. */
  async function createItem(itemId: string, lotId: string): Promise<void> {
    await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        const shell: CreateInventoryItemInput = {
          itemId,
          householdId: household.householdId,
          unit: UNIT,
          lots: [{ lotId }],
        };
        const created = await insertInventoryItem(client, shell);
        expect(created.ok).toBe(true);
      },
      { assumeRole: APP_ROLE },
    );
  }

  /** Appends one transaction through the real write path, failing loudly if it did not append. */
  async function append(itemId: string, input: TransactionInput): Promise<AppendResult> {
    return withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        const result: Outcome<AppendResult> = await appendTransactionToDb(
          client,
          household.householdId,
          itemId,
          input,
        );
        if (!result.ok) {
          throw new Error(`append failed: ${result.error.code} — ${result.error.message}`);
        }
        return result.value;
      },
      { assumeRole: APP_ROLE },
    );
  }

  function txInput(
    lotId: string,
    overrides: Partial<TransactionInput> &
      Pick<TransactionInput, "type" | "qtyDelta"> & {
        idempotencyKey: string;
      },
  ): TransactionInput {
    return {
      lotId,
      unit: UNIT,
      actor: USER_ACTOR(household.userId),
      occurredAt: instantAt(0),
      recordedAt: instantAt(0),
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      ...overrides,
    };
  }

  /** Reads telemetry for one item, via the read function, with no period bound. */
  async function readItem(
    itemId: string,
  ): Promise<(CorrectionTelemetryTotals & { itemId: string }) | undefined> {
    const result = await withHouseholdTransaction(
      db.pool,
      household.householdId,
      (client) => readCorrectionTelemetry(client, household.householdId, {}),
      { assumeRole: APP_ROLE },
    );
    return result.items.find((row) => row.itemId === itemId);
  }

  /** Reads the view row for one item directly, as `sk_app`. */
  async function readViewRow(itemId: string): Promise<Record<string, unknown> | undefined> {
    const rows = await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client: PoolClient) => {
        const result = await client.query(
          `SELECT * FROM inventory_correction_telemetry WHERE item_id = $1`,
          [itemId],
        );
        return result.rows as Record<string, unknown>[];
      },
      { assumeRole: APP_ROLE },
    );
    return rows[0];
  }

  describe("composition (ticket's worked example)", () => {
    it("statement_count=5, user_adjustment_count=1, clamp_count=1, correction_event_count=2, correction_rate=0.4", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await createItem(itemId, lotId);

      // 1. INITIAL_STOCK — a statement.
      const initial = await append(
        itemId,
        txInput(lotId, {
          type: "INITIAL_STOCK",
          qtyDelta: 10,
          idempotencyKey: `${itemId}-initial`,
        }),
      );
      expect(initial.status).toBe("appended");

      // 2 & 3. CONSUME, CONSUME — statements.
      const consume1 = await append(
        itemId,
        txInput(lotId, { type: "CONSUME", qtyDelta: -3, idempotencyKey: `${itemId}-consume-1` }),
      );
      expect(consume1.status).toBe("appended");
      const consume2 = await append(
        itemId,
        txInput(lotId, { type: "CONSUME", qtyDelta: -2, idempotencyKey: `${itemId}-consume-2` }),
      );
      expect(consume2.status).toBe("appended");

      // 4. A user ADJUSTMENT — a statement AND a correction event. Balance
      // after: 10 - 3 - 2 - 1 = 4.
      const adjustment = await append(
        itemId,
        txInput(lotId, {
          type: "ADJUSTMENT",
          qtyDelta: -1,
          idempotencyKey: `${itemId}-adjustment`,
        }),
      );
      expect(adjustment.status).toBe("appended");

      // 5. An over-consuming CONSUME: only 4 lb on hand, but 6 is requested.
      // The ledger records the full statement and appends its own clamp
      // (system_flag_kind = OVER_CONSUMPTION) for the 2 lb residual — a
      // statement AND a correction event, but not a user adjustment.
      const overConsume = await append(
        itemId,
        txInput(lotId, {
          type: "CONSUME",
          qtyDelta: -6,
          idempotencyKey: `${itemId}-over-consume`,
        }),
      );
      expect(overConsume.status).toBe("appended");
      if (overConsume.status === "appended") {
        expect(overConsume.clampAdjustment).toBeDefined();
        expect(overConsume.item.currentQty.micros).toBe(0n);
      }

      // Six rows exist (five statements + one system clamp); the view groups
      // them into exactly the composition the ticket specifies.
      const viewRow = await readViewRow(itemId);
      expect(viewRow).toBeDefined();
      expect(viewRow?.["statement_count"]).toBe("5");
      expect(viewRow?.["user_adjustment_count"]).toBe("1");
      expect(viewRow?.["clamp_count"]).toBe("1");
      expect(viewRow?.["correction_event_count"]).toBe("2");
      // Compared as numbers to be robust to Postgres's numeric text scale
      // (e.g. "0.4" vs "0.40000...") while still proving exactness (2/5 has
      // no rounding error at any scale).
      expect(Number(viewRow?.["correction_rate"])).toBe(0.4);
      expect(viewRow?.["correction_rate"]).toMatch(/^0\.4(0*)$/);

      // The read function reports the identical composition for the same
      // item, over the whole (unbounded) period.
      const itemTelemetry = await readItem(itemId);
      expect(itemTelemetry).toBeDefined();
      expect(itemTelemetry?.statementCount).toBe(5n);
      expect(itemTelemetry?.userAdjustmentCount).toBe(1n);
      expect(itemTelemetry?.clampCount).toBe(1n);
      expect(itemTelemetry?.correctionEventCount).toBe(2n);
      expect(itemTelemetry?.correctionRate).toMatch(/^0\.4(0*)$/);
      expect(itemTelemetry?.firstRecordedAt).toBe(instantAt(0));
      expect(itemTelemetry?.lastRecordedAt).toBe(instantAt(0));
    });
  });

  describe("a system ADJUSTMENT that is not a clamp", () => {
    it("counts as a statement, not a correction", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await createItem(itemId, lotId);

      await append(
        itemId,
        txInput(lotId, {
          type: "INITIAL_STOCK",
          qtyDelta: 5,
          idempotencyKey: `${itemId}-initial`,
        }),
      );

      // An automated recompute correcting its own earlier estimate — actor
      // kind "system", type ADJUSTMENT, but *not* the ledger's own reserved
      // clamp key, so system_flag_kind stays NULL on this row.
      const systemAdjustment = await append(
        itemId,
        txInput(lotId, {
          type: "ADJUSTMENT",
          qtyDelta: 0.5,
          actor: SYSTEM_ACTOR,
          idempotencyKey: `${itemId}-system-recompute`,
        }),
      );
      expect(systemAdjustment.status).toBe("appended");

      const telemetry = await readItem(itemId);
      expect(telemetry).toBeDefined();
      // Two statements (the initial stock and the system adjustment), zero
      // corrections: not a user adjustment (wrong actor kind), not a clamp
      // (system_flag_kind is null on an ordinary ADJUSTMENT).
      expect(telemetry?.statementCount).toBe(2n);
      expect(telemetry?.userAdjustmentCount).toBe(0n);
      expect(telemetry?.clampCount).toBe(0n);
      expect(telemetry?.correctionEventCount).toBe(0n);
      expect(Number(telemetry?.correctionRate)).toBe(0);
      // Matched loosely: Postgres numeric division picks its own display
      // scale (e.g. "0" or "0.00000000000000000000"), and the exact scale is
      // not part of this KPI's contract — only the value is.
      expect(telemetry?.correctionRate).toMatch(/^0(\.0+)?$/);
    });
  });

  describe("tenancy", () => {
    it("household A sees only A's items, B only B's, null context sees none", async () => {
      const alpha = await seedHousehold(db.pool, `alpha-${randomUUID()}`);
      const beta = await seedHousehold(db.pool, `beta-${randomUUID()}`);

      const alphaItemId = randomUUID();
      const alphaLotId = randomUUID();
      await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        async (client) => {
          await insertInventoryItem(client, {
            itemId: alphaItemId,
            householdId: alpha.householdId,
            unit: UNIT,
            lots: [{ lotId: alphaLotId }],
          });
          await appendTransactionToDb(client, alpha.householdId, alphaItemId, {
            lotId: alphaLotId,
            type: "INITIAL_STOCK",
            qtyDelta: 1,
            unit: UNIT,
            actor: { kind: "user", userId: alpha.userId },
            occurredAt: instantAt(0),
            recordedAt: instantAt(0),
            provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
            idempotencyKey: "alpha-initial",
          });
        },
        { assumeRole: APP_ROLE },
      );

      const betaItemId = randomUUID();
      const betaLotId = randomUUID();
      await withHouseholdTransaction(
        db.pool,
        beta.householdId,
        async (client) => {
          await insertInventoryItem(client, {
            itemId: betaItemId,
            householdId: beta.householdId,
            unit: UNIT,
            lots: [{ lotId: betaLotId }],
          });
          await appendTransactionToDb(client, beta.householdId, betaItemId, {
            lotId: betaLotId,
            type: "INITIAL_STOCK",
            qtyDelta: 1,
            unit: UNIT,
            actor: { kind: "user", userId: beta.userId },
            occurredAt: instantAt(0),
            recordedAt: instantAt(0),
            provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
            idempotencyKey: "beta-initial",
          });
        },
        { assumeRole: APP_ROLE },
      );

      const asAlpha = await withHouseholdTransaction(
        db.pool,
        alpha.householdId,
        (client) => readCorrectionTelemetry(client, alpha.householdId, {}),
        { assumeRole: APP_ROLE },
      );
      expect(asAlpha.items.map((row) => row.itemId)).toEqual([alphaItemId]);
      expect(asAlpha.household.statementCount).toBe(1n);

      const asBeta = await withHouseholdTransaction(
        db.pool,
        beta.householdId,
        (client) => readCorrectionTelemetry(client, beta.householdId, {}),
        { assumeRole: APP_ROLE },
      );
      expect(asBeta.items.map((row) => row.itemId)).toEqual([betaItemId]);
      expect(asBeta.household.statementCount).toBe(1n);

      // Asking for Alpha's householdId while no RLS context is established:
      // the session sees zero rows regardless of what the parameter claims,
      // which is what "fails closed" means at the database boundary.
      const asNoContext = await withHouseholdTransaction(
        db.pool,
        null,
        (client) => readCorrectionTelemetry(client, alpha.householdId, {}),
        { assumeRole: APP_ROLE },
      );
      expect(asNoContext.items).toEqual([]);
      expect(asNoContext.household.statementCount).toBe(0n);
      expect(asNoContext.household.correctionRate).toBeNull();
      expect(asNoContext.household.firstRecordedAt).toBeNull();
      expect(asNoContext.household.lastRecordedAt).toBeNull();
    });
  });

  describe("since/until period bounds", () => {
    it("since is inclusive and until is exclusive on recorded_at", async () => {
      const itemId = randomUUID();
      const lotId = randomUUID();
      await createItem(itemId, lotId);

      const t0 = instantAt(0);
      const t1 = instantAt(60);
      const t2 = instantAt(120);

      for (const [label, at] of [
        ["t0", t0],
        ["t1", t1],
        ["t2", t2],
      ] as const) {
        const appended = await append(itemId, {
          lotId,
          type: "PURCHASE",
          qtyDelta: 1,
          unit: UNIT,
          actor: USER_ACTOR(household.userId),
          occurredAt: at,
          recordedAt: at,
          provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
          idempotencyKey: `${itemId}-${label}`,
        });
        expect(appended.status).toBe("appended");
      }

      async function statementCountBetween(
        since: string | undefined,
        until: string | undefined,
      ): Promise<bigint> {
        const result = await withHouseholdTransaction(
          db.pool,
          household.householdId,
          (client) => readCorrectionTelemetry(client, household.householdId, { since, until }),
          { assumeRole: APP_ROLE },
        );
        const row = result.items.find((item) => item.itemId === itemId);
        return row?.statementCount ?? 0n;
      }

      // [t1, t2): only t1 — t1 counted (inclusive lower bound), t2 excluded
      // (exclusive upper bound).
      expect(await statementCountBetween(t1, t2)).toBe(1n);

      // [t0, t2): t0 and t1, not t2.
      expect(await statementCountBetween(t0, t2)).toBe(2n);

      // [t0, t0): the upper bound excludes the very instant it names, even
      // when a row exists exactly there.
      expect(await statementCountBetween(t0, t0)).toBe(0n);

      // [t2, undefined): only t2, proving the lower bound alone is inclusive.
      expect(await statementCountBetween(t2, undefined)).toBe(1n);

      // (undefined, t0): nothing before t0.
      expect(await statementCountBetween(undefined, t0)).toBe(0n);

      // No bounds at all: every row in this item's history.
      expect(await statementCountBetween(undefined, undefined)).toBe(3n);

      const bounded = await withHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) =>
          readCorrectionTelemetry(client, household.householdId, { since: t1, until: t2 }),
        { assumeRole: APP_ROLE },
      );
      const boundedRow = bounded.items.find((item) => item.itemId === itemId);
      expect(boundedRow?.firstRecordedAt).toBe(t1);
      expect(boundedRow?.lastRecordedAt).toBe(t1);
    });
  });
});
