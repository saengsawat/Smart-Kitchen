/**
 * `withRetriedHouseholdTransaction` (M1-T9).
 *
 * Two kinds of test live here:
 *
 * - **Control flow, no DB** — a fake `Pool`/`PoolClient` pair whose `query`
 *   never touches a real statement, so attempt counting, delay/sleep
 *   injection, exhaustion and non-retryable passthrough can all be asserted
 *   without `DATABASE_URL`. These run unconditionally.
 * - **Against real Postgres** — the classifier's two retryable shapes forced
 *   through the actual schema (migration 0004's trigger and the sequence
 *   unique index), plus the idempotency-conflict non-retry case through the
 *   real repository path. Gated on `DATABASE_URL` via the harness's
 *   SKIP-NOTICE pattern, same as every other DB suite.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendTransactionToDb, loadInventoryItem } from "./inventory/repository.js";
import { LedgerRetryExhaustedError, withRetriedHouseholdTransaction } from "./retry.js";
import { withHouseholdTransaction } from "./session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type SeededHousehold,
  type TestDatabase,
} from "./test-support/harness.js";
import { insertRawTransaction, seedItem } from "./test-support/inventory-fixtures.js";

// ---------------------------------------------------------------------------
// Control flow, no DB.
// ---------------------------------------------------------------------------

/** Minimal fake client: every statement "succeeds" and does nothing. */
function fakeClient(): PoolClient {
  return {
    query: () => Promise.resolve({ rows: [], rowCount: 0 }),
    release: () => {
      /* no-op */
    },
  } as unknown as PoolClient;
}

/** A `Pool` whose `connect()` hands back a fresh fake client each time. */
function fakePool(): Pool {
  return {
    connect: () => Promise.resolve(fakeClient()),
  } as unknown as Pool;
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}

/**
 * A real `Error` carrying `code`/`constraint`, the way `pg` driver errors do
 * — `@typescript-eslint/only-throw-error` (rightly) refuses a plain thrown
 * object, and `isRetryableLedgerError` only reads these two fields anyway
 * (via `pgErrorCode`/`pgConstraint`), so an `Error` subtype is exactly as
 * good a fixture as a plain object would have been.
 */
function pgError(code: string, constraint?: string): Error & { code: string; constraint?: string } {
  const error = new Error(`synthetic pg-shaped error ${code}`) as Error & {
    code: string;
    constraint?: string;
  };
  error.code = code;
  if (constraint !== undefined) error.constraint = constraint;
  return error;
}

describe("withRetriedHouseholdTransaction — control flow (fake pool, no DB)", () => {
  it("returns fn's result on the first attempt without sleeping", async () => {
    const { sleep, calls } = recordingSleep();
    let invocations = 0;
    const result = await withRetriedHouseholdTransaction(
      fakePool(),
      "household-1",
      (client) => {
        invocations += 1;
        return client.query("SELECT 1").then(() => "ok");
      },
      { sleep },
    );
    expect(result).toBe("ok");
    expect(invocations).toBe(1);
    expect(calls).toEqual([]);
  });

  it("retries once on a retryable error, then succeeds, with the default backoff", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    const result = await withRetriedHouseholdTransaction(
      fakePool(),
      "household-1",
      () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(pgError("40001"));
        return Promise.resolve(attempts);
      },
      { sleep },
    );
    expect(result).toBe(2);
    expect(attempts).toBe(2);
    expect(calls).toEqual([25]);
  });

  it("retries on 23505 scoped to the sequence-key constraint", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    const result = await withRetriedHouseholdTransaction(
      fakePool(),
      "household-1",
      () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(pgError("23505", "inventory_transactions_item_sequence_key"));
        }
        return Promise.resolve("recovered");
      },
      { sleep },
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
    // F6 (M1-T9 review): this call used to build a `recordingSleep()` and
    // discard its `calls` array, so the one wait this test actually forces
    // was never checked against the default backoff.
    expect(calls).toEqual([25]);
  });

  it("does not retry 23505 on the idempotency-key constraint — same object identity", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    const boom = pgError("23505", "inventory_transactions_idempotency_key");
    let thrown: unknown;
    try {
      await withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          attempts += 1;
          return Promise.reject(boom);
        },
        { sleep },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(boom);
    expect(attempts).toBe(1);
    expect(calls).toEqual([]);
  });

  it("does not retry a plain thrown Error — propagates after one attempt, same identity", async () => {
    const { sleep, calls } = recordingSleep();
    const boom = new Error("plain failure, no code at all");
    let attempts = 0;
    let thrown: unknown;
    try {
      await withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          attempts += 1;
          return Promise.reject(boom);
        },
        { sleep },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(boom);
    expect(attempts).toBe(1);
    expect(calls).toEqual([]);
  });

  it("exhausts after the default 3 attempts with LedgerRetryExhaustedError(attempts, cause)", async () => {
    const { sleep, calls } = recordingSleep();
    const errors: unknown[] = [];
    let attempts = 0;
    let thrown: unknown;
    try {
      await withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          attempts += 1;
          const error = pgError("40001");
          errors.push(error);
          return Promise.reject(error);
        },
        { sleep },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LedgerRetryExhaustedError);
    const exhausted = thrown as LedgerRetryExhaustedError;
    expect(exhausted.attempts).toBe(3);
    expect(attempts).toBe(3);
    expect(exhausted.cause).toBe(errors.at(-1));
    // Default backoff: 25 * 2^(attempt-1) for the 2 waits between 3 attempts.
    expect(calls).toEqual([25, 50]);
  });

  it("honours a custom maxAttempts and a custom delay/sleep pair", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    let thrown: unknown;
    try {
      await withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          attempts += 1;
          return Promise.reject(pgError("40001"));
        },
        { sleep, maxAttempts: 2, delay: (attempt) => attempt * 1000 },
      );
    } catch (error) {
      thrown = error;
    }
    expect(attempts).toBe(2);
    expect((thrown as LedgerRetryExhaustedError).attempts).toBe(2);
    // Only one wait between 2 attempts, using the custom delay function.
    expect(calls).toEqual([1000]);
  });

  it("maxAttempts=1 exhausts after a single attempt, no sleep at all", async () => {
    const { sleep, calls } = recordingSleep();
    let attempts = 0;
    let thrown: unknown;
    try {
      await withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          attempts += 1;
          return Promise.reject(pgError("40001"));
        },
        { sleep, maxAttempts: 1 },
      );
    } catch (error) {
      thrown = error;
    }
    expect(attempts).toBe(1);
    expect((thrown as LedgerRetryExhaustedError).attempts).toBe(1);
    expect(calls).toEqual([]);
  });

  it("rejects a non-positive-integer maxAttempts before doing any work", async () => {
    let invoked = false;
    await expect(
      withRetriedHouseholdTransaction(
        fakePool(),
        "household-1",
        () => {
          invoked = true;
          return Promise.resolve();
        },
        { maxAttempts: 0 },
      ),
    ).rejects.toThrow(/maxAttempts/);
    expect(invoked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against real Postgres.
// ---------------------------------------------------------------------------

const SUITE = "ledger write retry helper — withRetriedHouseholdTransaction";
// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped, and a silently absent
// suite is exactly what this warning exists to prevent.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const UNIT = "lb";

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;

  beforeAll(async () => {
    db = await createTestDatabase("retry");
    household = await seedHousehold(db.pool, "Retry");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  function purchaseInput(lotId: string, key: string, userId: string) {
    return {
      lotId,
      type: "PURCHASE" as const,
      qtyDelta: 1,
      unit: UNIT,
      actor: { kind: "user" as const, userId },
      occurredAt: "2026-03-06T18:00:00.000Z",
      recordedAt: "2026-03-06T18:00:01.000Z",
      provenance: { tier: "KNOWN_FACT" as const, source: "manual-entry" },
      idempotencyKey: key,
    };
  }

  describe("(a) two concurrent appends through the locked repository path", () => {
    it("both succeed via the helper, ledger shows both rows, contiguous sequences", async () => {
      const item = await seedItem(db.pool, household.householdId, UNIT);
      const keyA = `race-a-${randomUUID()}`;
      const keyB = `race-b-${randomUUID()}`;

      const append = (key: string): Promise<string> =>
        withRetriedHouseholdTransaction(
          db.pool,
          household.householdId,
          async (client) => {
            const result = await appendTransactionToDb(
              client,
              household.householdId,
              item.itemId,
              purchaseInput(item.lotId, key, household.userId),
            );
            if (!result.ok) throw new Error(`unexpected outer failure: ${result.error.code}`);
            return result.value.status;
          },
          { assumeRole: APP_ROLE },
        );

      const [statusA, statusB] = await Promise.all([append(keyA), append(keyB)]);
      expect([statusA, statusB]).toEqual(["appended", "appended"]);

      const loaded = await withHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) => loadInventoryItem(client, household.householdId, item.itemId),
        { assumeRole: APP_ROLE },
      );
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.transactions.map((row) => row.sequence)).toEqual([1, 2]);
        expect(loaded.value.nextSequence).toBe(3);
        expect(loaded.value.currentQty.micros).toBe(2_000_000n);
      }
    });
  });

  describe("(b)+(f) a forced stale-sequence 23505 is retried and succeeds", () => {
    it("leaves exactly one row for the retried idempotency key, and the item reconciles", async () => {
      const item = await seedItem(db.pool, household.householdId, UNIT);
      const ctx = {
        householdId: household.householdId,
        itemId: item.itemId,
        lotId: item.lotId,
        userId: household.userId,
        unit: UNIT,
      };

      // Simulates a concurrent writer that skipped the item lock and won the
      // race for sequence 1 (repository.ts header comment / M1-T2 worker
      // report F6: an unlocked caller's collision surfaces as 23505 on
      // inventory_transactions_item_sequence_key, not as the trigger's 40001).
      await insertRawTransaction(db.pool, ctx, {
        sequence: 1,
        idempotency_key: `preseed-${randomUUID()}`,
      });

      const sharedKey = `retry-key-${randomUUID()}`;
      const sleeps: number[] = [];
      let attempts = 0;

      const result = await withRetriedHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          attempts += 1;
          // Attempt 1 guesses the same (now-stale) sequence a caller that
          // lost the race would have; the retry re-derives the real next
          // sequence, exactly as a real caller must (module header contract:
          // fn must be safe to re-run from scratch).
          const sequence = attempts === 1 ? 1 : 2;
          await insertRawTransaction(client, ctx, { sequence, idempotency_key: sharedKey });
          return sequence;
        },
        {
          assumeRole: APP_ROLE,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
      );

      expect(result).toBe(2);
      expect(attempts).toBe(2);
      expect(sleeps).toEqual([25]);

      // Retry cannot double-count: attempt 1's insert never committed (the
      // whole transaction rolled back), so exactly one row exists for the key
      // both attempts shared.
      const rowsForKey = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1 AND idempotency_key = $2`,
        [item.itemId, sharedKey],
      );
      expect(rowsForKey.rows[0]?.count).toBe("1");

      // The item reconciles: the pre-seeded row plus the one successful retry.
      const reconciled = await db.pool.query<{ next_sequence: number; current_qty_micros: string }>(
        `SELECT next_sequence, current_qty_micros FROM inventory_items WHERE id = $1`,
        [item.itemId],
      );
      expect(reconciled.rows[0]?.next_sequence).toBe(3);
      expect(reconciled.rows[0]?.current_qty_micros).toBe("4000000");
    });
  });

  describe("(c) an idempotency-key conflict is not retried", () => {
    it("surfaces as the repository's typed IDEMPOTENCY_KEY_CONFLICT after exactly one attempt", async () => {
      const first = await seedItem(db.pool, household.householdId, UNIT);
      const second = await seedItem(db.pool, household.householdId, UNIT);
      const sharedKey = `cross-item-${randomUUID()}`;

      // First use of the key, committed before the retry helper is involved.
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) =>
          appendTransactionToDb(
            client,
            household.householdId,
            first.itemId,
            purchaseInput(first.lotId, sharedKey, household.userId),
          ),
        { assumeRole: APP_ROLE },
      );

      let attempts = 0;
      const sleeps: number[] = [];
      const outcome = await withRetriedHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) => {
          attempts += 1;
          return appendTransactionToDb(
            client,
            household.householdId,
            second.itemId,
            purchaseInput(second.lotId, sharedKey, household.userId),
          );
        },
        {
          assumeRole: APP_ROLE,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
      );

      expect(attempts).toBe(1);
      expect(sleeps).toEqual([]);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.status).toBe("rejected");
        if (outcome.value.status === "rejected") {
          expect(outcome.value.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
        }
      }

      const count = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
        [second.itemId],
      );
      expect(count.rows[0]?.count).toBe("0");
    });
  });

  describe("(d) a permanently failing fn exhausts after maxAttempts", () => {
    it("throws LedgerRetryExhaustedError with the original cause and attempts === maxAttempts", async () => {
      const forced: unknown[] = [];
      const sleeps: number[] = [];

      let thrown: unknown;
      try {
        await withRetriedHouseholdTransaction(
          db.pool,
          household.householdId,
          async (client) => {
            try {
              await client.query(
                `DO $$ BEGIN RAISE SQLSTATE '40001' USING MESSAGE = 'forced retry loop (M1-T9 test)'; END $$;`,
              );
            } catch (error) {
              forced.push(error);
              throw error;
            }
          },
          {
            assumeRole: APP_ROLE,
            sleep: (ms) => {
              sleeps.push(ms);
              return Promise.resolve();
            },
          },
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(LedgerRetryExhaustedError);
      const exhausted = thrown as LedgerRetryExhaustedError;
      expect(exhausted.attempts).toBe(3);
      expect(forced).toHaveLength(3);
      expect(exhausted.cause).toBe(forced.at(-1));
      expect(sleeps).toEqual([25, 50]);
    });
  });

  describe("(e) a non-retryable database error propagates after one attempt", () => {
    it("42501 (snapshot column guard) is not retried, same object identity", async () => {
      const item = await seedItem(db.pool, household.householdId, UNIT);
      let attempts = 0;
      let caught: unknown;

      const fn = async (client: PoolClient): Promise<void> => {
        attempts += 1;
        try {
          await client.query(`UPDATE inventory_items SET current_qty_micros = 999 WHERE id = $1`, [
            item.itemId,
          ]);
        } catch (error) {
          caught = error;
          throw error;
        }
      };

      let thrown: unknown;
      try {
        await withRetriedHouseholdTransaction(db.pool, household.householdId, fn, {
          sleep: () =>
            Promise.reject(new Error("sleep must never be called for a non-retryable error")),
        });
      } catch (error) {
        thrown = error;
      }

      expect(attempts).toBe(1);
      expect(thrown).toBe(caught);
    });
  });

  describe("(g) assumeRole/household context is re-applied on every retried attempt", () => {
    it("current_user is sk_app and app.household_id is the seeded household on both attempts, each a fresh transaction", async () => {
      // Regression coverage (review F1, M1-T9): the RetryOptions -> session
      // options pass-through was previously unpinned by any test — a mutation
      // dropping `assumeRole` on every retried attempt (falling back to `{}`)
      // killed zero of the suite's tests, because `db.pool` connects as the
      // migration/owner role, which can write regardless of RLS. This probes
      // the session the *retry loop itself* establishes on each attempt,
      // independent of whether the write would have succeeded anyway.
      const rows: { current_user: string; hh: string | null; txid: string }[] = [];
      let attempts = 0;

      const result = await withRetriedHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          attempts += 1;
          const probe = await client.query<{
            current_user: string;
            hh: string | null;
            txid: string;
          }>(
            `SELECT current_user, current_setting('app.household_id', true) AS hh, txid_current()::text AS txid`,
          );
          const row = probe.rows[0];
          if (row === undefined) throw new Error("probe query returned no row");
          rows.push(row);
          if (attempts === 1) {
            // A real, retryable driver error, forced after the probe so the
            // probe's own row for this attempt is already recorded.
            await client.query(
              `DO $$ BEGIN RAISE SQLSTATE '40001' USING MESSAGE = 'forced retry (M1-T9 F1 test)'; END $$;`,
            );
          }
          return "ok";
        },
        { assumeRole: APP_ROLE, sleep: () => Promise.resolve() },
      );

      expect(result).toBe("ok");
      expect(attempts).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.current_user).toBe(APP_ROLE);
      expect(rows[1]?.current_user).toBe(APP_ROLE);
      expect(rows[0]?.hh).toBe(household.householdId);
      expect(rows[1]?.hh).toBe(household.householdId);
      // Each attempt got its own BEGIN — a different transaction, not the
      // first attempt's (rolled back) one resumed.
      expect(rows[0]?.txid).not.toBe(rows[1]?.txid);
    });
  });
});
