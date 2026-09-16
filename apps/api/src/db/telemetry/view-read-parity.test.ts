/**
 * View-vs-read-function equivalence (M1-T10-l, review B2).
 *
 * `inventory_correction_telemetry` (migration 0007) and
 * `readCorrectionTelemetry`'s `AGGREGATE_COLUMNS` (correction-rate.ts)
 * restate the *same* seven-column aggregate definition twice — the view has
 * no period argument, so the bounded read function re-derives it in SQL over
 * the same base table rather than selecting from the view. Nothing before
 * this file asserted the two definitions actually agree; a one-character
 * drift between them (an `AND` that should be an `OR`, a filter dropped from
 * one copy) would go unnoticed by either file's own tests, which each check
 * their own definition against hand-picked expectations, never against the
 * other's output.
 *
 * This suite builds a randomly generated multi-item household (several
 * items, each with several transactions spanning purchases, ordinary and
 * over-consuming decreases — which append the ledger's own OVER_CONSUMPTION
 * clamp — and both user and system adjustments) through the real write path,
 * then asserts `readCorrectionTelemetry`'s per-item output and the view's
 * per-item row agree on every column, for every item, on every generated
 * run.
 */

import { randomUUID } from "node:crypto";
import fc from "fast-check";
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
import { readCorrectionTelemetry } from "./correction-rate.js";

const SUITE = "telemetry view vs readCorrectionTelemetry — equivalence (M1-T10-l)";
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";
const BASE_EPOCH_MS = Date.UTC(2026, 2, 6, 18, 0, 0);

function instantAt(step: number): string {
  return new Date(BASE_EPOCH_MS + step * 1000).toISOString();
}

interface ViewRow {
  readonly item_id: string;
  readonly statement_count: string;
  readonly user_adjustment_count: string;
  readonly clamp_count: string;
  readonly correction_event_count: string;
  readonly correction_rate: string | null;
  readonly first_recorded_at: Date | null;
  readonly last_recorded_at: Date | null;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("telemetry-view-parity");
    household = await seedHousehold(db.pool, "Telemetry parity");
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("agrees with the view on every column, for every item, across generated multi-item households", async () => {
    const stepArb = fc.record({
      kind: fc.constantFrom<"purchase" | "consume" | "user-adjust" | "system-adjust">(
        "purchase",
        "consume",
        "user-adjust",
        "system-adjust",
      ),
      qty: fc.integer({ min: 1, max: 12 }),
      // Occasionally requests more than is on hand, to exercise the ledger's
      // own OVER_CONSUMPTION clamp (system actor, not a user adjustment).
      overConsume: fc.boolean(),
    });

    const itemArb = fc.record({
      steps: fc.array(stepArb, { minLength: 2, maxLength: 6 }),
    });

    const householdArb = fc.array(itemArb, { minLength: 2, maxLength: 4 });

    await fc.assert(
      fc.asyncProperty(householdArb, async (items) => {
        const run = randomUUID();
        const itemIds: string[] = [];

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
          const itemId = randomUUID();
          const lotId = randomUUID();
          itemIds.push(itemId);

          await withHouseholdTransaction(
            db.pool,
            household.householdId,
            async (client) => {
              const created = await insertInventoryItem(client, {
                itemId,
                householdId: household.householdId,
                unit: UNIT,
                lots: [{ lotId }],
              });
              expect(created.ok).toBe(true);
            },
            { assumeRole: APP_ROLE },
          );

          const steps = items[itemIndex]?.steps ?? [];
          for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            if (step === undefined) continue;
            const occurredAt = instantAt(itemIndex * 1000 + stepIndex * 10);
            const idempotencyKey = `parity-${run}-${String(itemIndex)}-${String(stepIndex)}`;

            const input =
              step.kind === "purchase"
                ? {
                    lotId,
                    type: "PURCHASE" as const,
                    qtyDelta: step.qty,
                    unit: UNIT,
                    actor: { kind: "user" as const, userId: household.userId },
                    occurredAt,
                    recordedAt: occurredAt,
                    provenance: { tier: "KNOWN_FACT" as const, source: "generated" },
                    idempotencyKey,
                  }
                : step.kind === "consume"
                  ? {
                      lotId,
                      type: "CONSUME" as const,
                      // A large, possibly-overshooting decrease exercises the
                      // clamp path; a small one usually does not.
                      qtyDelta: -(step.overConsume ? step.qty + 50 : step.qty),
                      unit: UNIT,
                      actor: { kind: "user" as const, userId: household.userId },
                      occurredAt,
                      recordedAt: occurredAt,
                      provenance: { tier: "KNOWN_FACT" as const, source: "generated" },
                      idempotencyKey,
                    }
                  : step.kind === "user-adjust"
                    ? {
                        lotId,
                        type: "ADJUSTMENT" as const,
                        qtyDelta: step.qty,
                        unit: UNIT,
                        actor: { kind: "user" as const, userId: household.userId },
                        occurredAt,
                        recordedAt: occurredAt,
                        provenance: { tier: "KNOWN_FACT" as const, source: "generated" },
                        idempotencyKey,
                      }
                    : {
                        lotId,
                        type: "ADJUSTMENT" as const,
                        qtyDelta: step.qty,
                        unit: UNIT,
                        actor: { kind: "system" as const, component: "meal-planner" },
                        occurredAt,
                        recordedAt: occurredAt,
                        provenance: { tier: "KNOWN_FACT" as const, source: "generated" },
                        idempotencyKey,
                      };

            await withHouseholdTransaction(
              db.pool,
              household.householdId,
              async (client) => {
                const result = await appendTransactionToDb(
                  client,
                  household.householdId,
                  itemId,
                  input,
                );
                // Some over-consuming or adjustment attempts may be rejected
                // by the domain (e.g. a negative-adjustment guard) — that is
                // fine; what matters is that the view and the read function
                // agree on whatever *did* land, so a rejection is not an
                // error here.
                expect(result.ok).toBe(true);
              },
              { assumeRole: APP_ROLE },
            );
          }
        }

        const viaFunction = await withHouseholdTransaction(
          db.pool,
          household.householdId,
          (client) => readCorrectionTelemetry(client, household.householdId, {}),
          { assumeRole: APP_ROLE },
        );

        const viaView = await withHouseholdTransaction(
          db.pool,
          household.householdId,
          async (client) => {
            const result = await client.query<ViewRow>(
              `SELECT item_id, statement_count, user_adjustment_count, clamp_count,
                      correction_event_count, correction_rate, first_recorded_at, last_recorded_at
                 FROM inventory_correction_telemetry
                WHERE item_id = ANY($1::uuid[])`,
              [itemIds],
            );
            return result.rows;
          },
          { assumeRole: APP_ROLE },
        );

        expect(viaView).toHaveLength(itemIds.length);

        for (const itemId of itemIds) {
          const fromFunction = viaFunction.items.find((row) => row.itemId === itemId);
          const fromView = viaView.find((row) => row.item_id === itemId);
          expect(fromFunction, `readCorrectionTelemetry missing item ${itemId}`).toBeDefined();
          expect(fromView, `view missing item ${itemId}`).toBeDefined();
          if (fromFunction === undefined || fromView === undefined) continue;

          expect(fromFunction.statementCount).toBe(BigInt(fromView.statement_count));
          expect(fromFunction.userAdjustmentCount).toBe(BigInt(fromView.user_adjustment_count));
          expect(fromFunction.clampCount).toBe(BigInt(fromView.clamp_count));
          expect(fromFunction.correctionEventCount).toBe(BigInt(fromView.correction_event_count));
          // Compared numerically: Postgres's `numeric` division and text
          // formatting can differ in trailing zeros between two structurally
          // identical CASE expressions evaluated in different queries, but
          // the values themselves must agree exactly.
          if (fromView.correction_rate === null) {
            expect(fromFunction.correctionRate).toBeNull();
          } else {
            expect(fromFunction.correctionRate).not.toBeNull();
            expect(Number(fromFunction.correctionRate)).toBe(Number(fromView.correction_rate));
          }
          expect(fromFunction.firstRecordedAt).toBe(
            fromView.first_recorded_at?.toISOString() ?? null,
          );
          expect(fromFunction.lastRecordedAt).toBe(
            fromView.last_recorded_at?.toISOString() ?? null,
          );
        }
      }),
      { numRuns: 10 },
    );
  }, 120_000);
});
