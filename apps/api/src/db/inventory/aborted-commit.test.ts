/**
 * Aborted-transaction COMMIT: the ledger write path must never report work it
 * discarded (M1-T11; M1-T9 review finding F4, probe P9).
 *
 * The defect these tests pin was two halves of one mistake:
 *
 *   1. `appendTransactionToDb` caught the idempotency-key `23505` and returned
 *      a typed `rejected` outcome — but catching a Postgres error does not
 *      un-abort the transaction that error aborted. Every statement after it
 *      fails with `25P02`, and the transaction can only be rolled back.
 *   2. `withHouseholdTransaction` then issued `COMMIT`, which on an aborted
 *      transaction Postgres answers with the **`ROLLBACK` command tag and no
 *      error**. The caller was handed `fn`'s return value — `{ good:
 *      "appended", bad: "rejected" }` — for a ledger that held zero rows.
 *
 * The fix is a savepoint around the insert block and a command-tag check after
 * `COMMIT`. These tests assert the two properties that follow from it: a
 * transaction reported `appended` is durable, and a typed `rejected` costs its
 * siblings nothing (ADR-008 durability, INV-LEDGER-3, data-model.md §6).
 *
 * The suite checks *durability*, not just return values — every assertion
 * about an append is re-read from the database after the transaction returned,
 * because the whole defect was a return value that lied about what the
 * database held.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TransactionInput } from "@smart-kitchen/domain";
import type { ClientBase, PoolClient } from "pg";
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
import { insertRawTransaction, pgFailure } from "../test-support/inventory-fixtures.js";
import {
  appendTransactionToDb,
  insertInventoryItem,
  reconcileItemInDb,
  type ReconciliationRow,
} from "./repository.js";

const SUITE = "M1-T11 — aborted-transaction COMMIT never reports success";
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
    db = await createTestDatabase("aborted-commit");
    household = await seedHousehold(db.pool, "Abort");
  }, 60_000);

  afterAll(async () => {
    // Optional-chained so a failure in beforeAll surfaces its own error rather
    // than a teardown TypeError stacked on top of it.
    await db?.drop();
  });

  function purchase(lotId: string, key: string, qty = 1): TransactionInput {
    return {
      lotId,
      type: "PURCHASE",
      qtyDelta: qty,
      unit: UNIT,
      actor: { kind: "user", userId: household.userId },
      occurredAt: "2026-03-06T18:00:00.000Z",
      recordedAt: "2026-03-06T18:00:01.000Z",
      provenance: { tier: "KNOWN_FACT", source: "manual-entry" },
      idempotencyKey: key,
    };
  }

  function consume(lotId: string, key: string, qty: number): TransactionInput {
    return { ...purchase(lotId, key, -qty), type: "CONSUME" };
  }

  /** Creates an item with one lot through the repository, as `sk_app`. */
  async function newItem(): Promise<{ itemId: string; lotId: string }> {
    const itemId = randomUUID();
    const lotId = randomUUID();
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
    return { itemId, lotId };
  }

  /**
   * Burns an idempotency key on a *different* item in this household, so that
   * a later append reusing it passes the domain (which only knows about the
   * item it is given) and is refused by the household-scoped unique index —
   * the exact path that used to abort the whole transaction.
   */
  async function burnKey(key: string): Promise<void> {
    const other = await newItem();
    await insertRawTransaction(
      db.pool,
      {
        householdId: household.householdId,
        itemId: other.itemId,
        lotId: other.lotId,
        userId: household.userId,
        unit: UNIT,
      },
      { idempotency_key: key },
    );
  }

  /**
   * A client whose `n`-th ledger insert fails with `error` and whose every
   * other statement is passed straight through to the real connection.
   *
   * Only the *error* is injected; everything else — the lock, the load, the
   * inserts that are allowed through, the savepoint statements — is real SQL
   * on a real transaction. That is what makes it usable for the cases the
   * schema puts out of reach of a fixture (see the callers).
   */
  function failingOnLedgerInsert(client: PoolClient, error: Error, n = 1): ClientBase {
    let inserts = 0;
    return new Proxy(client, {
      get(target, property, receiver): unknown {
        if (property !== "query") return Reflect.get(target, property, receiver);
        return (text: unknown, values: unknown): unknown => {
          if (typeof text === "string" && text.includes("INSERT INTO inventory_transactions")) {
            inserts += 1;
            if (inserts === n) return Promise.reject(error);
          }
          return target.query(text as string, values as unknown[]);
        };
      },
    });
  }

  /** A driver-shaped idempotency-key conflict, the one error this module translates. */
  function idempotencyConflict(): Error {
    return Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "inventory_transactions_idempotency_key",
    });
  }

  /** Ledger row count for one item, read after the transaction returned. */
  async function ledgerRowCount(itemId: string): Promise<number> {
    const rows = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
      [itemId],
    );
    return Number(rows.rows[0]?.count ?? "-1");
  }

  async function reconciliation(itemId: string): Promise<ReconciliationRow | undefined> {
    const client = await db.pool.connect();
    try {
      return await reconcileItemInDb(client, household.householdId, itemId);
    } finally {
      client.release();
    }
  }

  /**
   * Runs `work` inside a hand-rolled household transaction that is **always
   * rolled back**, so a test may deliberately leave the transaction aborted
   * (or assert on a statement that aborts it) without that being a failure of
   * its own. `withHouseholdTransaction` cannot be used for those: it now
   * throws precisely when a test wants to inspect the aborted state.
   */
  async function inRolledBackTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await client.query("SELECT set_config('app.household_id', $1, true)", [
        household.householdId,
      ]);
      return await work(client);
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* the transaction may already be gone; releasing the client is what matters */
      }
      client.release();
    }
  }

  describe("(a) the F4 repro: a rejected append must not take its siblings down", () => {
    it("keeps the good append durable when a burnt key is reused in the same transaction", async () => {
      const { itemId, lotId } = await newItem();
      const goodKey = `good-${randomUUID()}`;
      const burntKey = `burnt-${randomUUID()}`;
      await burnKey(burntKey);

      const verdict = await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          const good = await appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            purchase(lotId, goodKey, 2),
          );
          const bad = await appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            purchase(lotId, burntKey, 3),
          );
          return {
            good: good.ok ? good.value.status : "outcome-error",
            bad: bad.ok ? bad.value.status : "outcome-error",
            badError: bad.ok && bad.value.status === "rejected" ? bad.value.error.code : undefined,
          };
        },
        { assumeRole: APP_ROLE },
      );

      expect(verdict.good).toBe("appended");
      expect(verdict.bad).toBe("rejected");
      expect(verdict.badError).toBe("IDEMPOTENCY_KEY_CONFLICT");

      // Before the fix this was 0: the COMMIT that reported success had in
      // fact rolled the whole transaction back.
      expect(await ledgerRowCount(itemId), "the appended row must be durable").toBe(1);
      const recon = await reconciliation(itemId);
      expect(recon?.ok).toBe(true);
      expect(recon?.snapshot_micros).toBe("2000000");
      expect(recon?.next_sequence).toBe(2);
    });

    it("leaves the transaction usable after a rejection: a later append still lands", async () => {
      const { itemId, lotId } = await newItem();
      const burntKey = `burnt-${randomUUID()}`;
      await burnKey(burntKey);

      const verdict = await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          const bad = await appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            purchase(lotId, burntKey, 3),
          );
          // A plain read after the rejection: on an aborted transaction this
          // is `25P02 current transaction is aborted`, so its success is the
          // assertion.
          const probe = await client.query<{ alive: number }>("SELECT 1 AS alive");
          const good = await appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            purchase(lotId, `after-${randomUUID()}`, 5),
          );
          return {
            bad: bad.ok ? bad.value.status : "outcome-error",
            alive: probe.rows[0]?.alive,
            good: good.ok ? good.value.status : "outcome-error",
          };
        },
        { assumeRole: APP_ROLE },
      );

      expect(verdict.bad).toBe("rejected");
      expect(verdict.alive).toBe(1);
      expect(verdict.good).toBe("appended");

      expect(await ledgerRowCount(itemId)).toBe(1);
      const recon = await reconciliation(itemId);
      expect(recon?.ok).toBe(true);
      expect(recon?.snapshot_micros).toBe("5000000");
    });

    it("rewinds the first insert too when the clamp row is the one that collides", async () => {
      // An over-consuming decrease writes *two* rows under one savepoint: the
      // CONSUME at its full magnitude and the compensating clamp (M1-T1). If
      // the second collides, `ROLLBACK TO SAVEPOINT` has to undo work of the
      // repository's own, not merely tidy up after a failed statement.
      //
      // The conflict is injected rather than seeded: the clamp's key is
      // derived (`<key>::over-consumption-clamp`) and the schema's
      // reserved-marker check plus `inventory_transactions_clamp_cause_fkey`
      // between them make a *pre-existing* clamp row impossible unless the
      // CONSUME's own key is already burnt — in which case the first insert
      // would fail instead, which is the case above. Everything except the
      // error itself is real SQL on a real transaction here.
      const { itemId, lotId } = await newItem();
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) =>
          appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            purchase(lotId, `stock-${randomUUID()}`, 1),
          ),
        { assumeRole: APP_ROLE },
      );

      const observed = await inRolledBackTransaction(async (client) => {
        const result = await appendTransactionToDb(
          failingOnLedgerInsert(client, idempotencyConflict(), 2),
          household.householdId,
          itemId,
          consume(lotId, `over-${randomUUID()}`, 5),
        );
        // Read inside the same transaction: what survived the rewind, before
        // anything is committed or rolled back.
        const rows = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
          [itemId],
        );
        return {
          status: result.ok ? result.value.status : "outcome-error",
          rowsInTransaction: rows.rows[0]?.count,
        };
      });

      expect(observed.status).toBe("rejected");
      // Exactly the one PURCHASE from before: the CONSUME that did land must
      // have been rewound with the clamp that failed.
      expect(observed.rowsInTransaction, "the first insert was not rewound").toBe("1");
      expect(await ledgerRowCount(itemId)).toBe(1);
      const recon = await reconciliation(itemId);
      expect(recon?.ok).toBe(true);
      expect(recon?.snapshot_micros).toBe("1000000");
    });
  });

  describe("(c) savepoint hygiene", () => {
    it("releases the savepoint after a successful append", async () => {
      const { itemId, lotId } = await newItem();

      const failure = await inRolledBackTransaction(async (client) => {
        const appended = await appendTransactionToDb(
          client,
          household.householdId,
          itemId,
          purchase(lotId, `release-${randomUUID()}`, 1),
        );
        expect(appended.ok && appended.value.status).toBe("appended");
        // If the append left its savepoint open, this would succeed. It must
        // not: `3B001 savepoint "ledger_append" does not exist`.
        try {
          await client.query("RELEASE SAVEPOINT ledger_append");
          return undefined;
        } catch (error) {
          return pgFailure(error);
        }
      });

      expect(failure?.code, "a savepoint was left open after a successful append").toBe("3B001");
      expect(failure?.message).toMatch(/ledger_append/);
    });

    it("releases the savepoint after a rejected append", async () => {
      const { itemId, lotId } = await newItem();
      const burntKey = `burnt-${randomUUID()}`;
      await burnKey(burntKey);

      const failure = await inRolledBackTransaction(async (client) => {
        const rejected = await appendTransactionToDb(
          client,
          household.householdId,
          itemId,
          purchase(lotId, burntKey, 1),
        );
        expect(rejected.ok && rejected.value.status).toBe("rejected");
        try {
          await client.query("RELEASE SAVEPOINT ledger_append");
          return undefined;
        } catch (error) {
          return pgFailure(error);
        }
      });

      expect(failure?.code, "a savepoint was left open after a rejected append").toBe("3B001");
    });
  });

  describe("(d) errors this module does not understand still propagate", () => {
    it("rethrows a real constraint failure and leaves the transaction aborted", async () => {
      const { itemId, lotId } = await newItem();

      const observed = await inRolledBackTransaction(async (client) => {
        // Makes the DEFERRABLE INITIALLY DEFERRED non-negativity triggers of
        // migration 0004 fire at statement time instead of at COMMIT, so a
        // genuine database error — not an injected one — is raised *inside*
        // the repository's insert block.
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        let thrown: unknown;
        try {
          await appendTransactionToDb(
            client,
            household.householdId,
            itemId,
            consume(lotId, `overshoot-${randomUUID()}`, 5),
          );
        } catch (error) {
          thrown = error;
        }
        // An aborted transaction refuses everything but ROLLBACK: `25P02` here
        // is the proof that the error was not swallowed behind a savepoint the
        // repository has no business rolling back to.
        let afterCode: string | undefined;
        try {
          await client.query("SELECT 1");
        } catch (error) {
          afterCode = pgFailure(error).code;
        }
        return { failure: pgFailure(thrown), afterCode };
      });

      expect(observed.failure.code, "the trigger's own error must reach the caller").toBe("23514");
      expect(observed.failure.message).toMatch(/INV-LEDGER-4/);
      expect(observed.afterCode, "the transaction must be left aborted for the wrapper").toBe(
        "25P02",
      );
      expect(await ledgerRowCount(itemId)).toBe(0);
    });

    /*
     * The sequence-key `23505` and the trigger's `40001` are what the M1-T9
     * retry helper exists for. Through the repository they only arise under
     * real concurrency (the `SELECT … FOR UPDATE` serialises writers, so they
     * cannot be produced on demand), so they are injected at the insert here:
     * the assertion is about *classification* — only the idempotency-key
     * constraint may become a typed rejection, everything else comes back out.
     */
    const injected = [
      {
        label: "sequence-key 23505 (the retryable concurrency loser)",
        error: Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint: "inventory_transactions_item_sequence_key",
        }),
      },
      {
        label: "the trigger's 40001",
        error: Object.assign(new Error("sequence 1 is not item's next sequence"), {
          code: "40001",
        }),
      },
      {
        label: "a 23505 naming no constraint at all",
        error: Object.assign(new Error("duplicate key"), { code: "23505" }),
      },
    ];

    for (const { label, error } of injected) {
      it(`rethrows ${label} by identity rather than translating it`, async () => {
        const { itemId, lotId } = await newItem();
        const thrown = await inRolledBackTransaction(async (client) => {
          try {
            await appendTransactionToDb(
              failingOnLedgerInsert(client, error),
              household.householdId,
              itemId,
              purchase(lotId, `inject-${randomUUID()}`, 1),
            );
          } catch (caught) {
            return caught;
          }
          return undefined;
        });
        expect(thrown, "a non-idempotency failure was swallowed into an outcome").toBe(error);
      });
    }
  });

  describe("(e) a deferred constraint failing at COMMIT still raises its own error", () => {
    it("surfaces INV-LEDGER-4, not the aborted-commit error", async () => {
      const { itemId, lotId } = await newItem();
      // Raw rows, deliberately bypassing the domain: an over-consuming CONSUME
      // with no compensating clamp. Both inserts succeed (the non-negativity
      // triggers are DEFERRABLE INITIALLY DEFERRED, migration 0004); the
      // failure happens inside COMMIT itself, which is the same statement the
      // new command-tag check inspects.
      const context = {
        householdId: household.householdId,
        itemId,
        lotId,
        userId: household.userId,
        unit: UNIT,
      };
      let thrown: unknown;
      try {
        await withHouseholdTransaction(
          db.pool,
          household.householdId,
          async (client) => {
            await insertRawTransaction(client, context);
            await insertRawTransaction(client, context, {
              sequence: 2,
              type: "CONSUME",
              qty_delta: "-50",
              qty_delta_micros: "-50000000",
            });
          },
          { assumeRole: APP_ROLE },
        );
      } catch (error) {
        thrown = error;
      }

      const failure = pgFailure(thrown);
      expect(failure.message, "the trigger's own error must survive").toMatch(/INV-LEDGER-4/);
      expect(failure.code).toBe("23514");
      expect(await ledgerRowCount(itemId)).toBe(0);
    });
  });
});
