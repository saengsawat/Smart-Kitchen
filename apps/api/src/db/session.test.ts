/**
 * `withHouseholdTransaction` returning normally must mean "committed"
 * (M1-T11; M1-T9 review finding F4).
 *
 * Postgres does not report a `COMMIT` on an aborted transaction as an error.
 * It ends the transaction, discards everything it did, and answers with the
 * **`ROLLBACK` command tag** — observed on this cluster as
 * `{ command: "ROLLBACK", rowCount: null }`, no exception and no notice. Any
 * `fn` that catches a database error and then returns therefore used to be
 * handed a result for work the database had thrown away.
 *
 * These tests pin the contract from the caller's side: either the transaction
 * committed and `fn`'s value comes back, or something is thrown. There is no
 * third outcome.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { TransactionAbortedAtCommitError, withHouseholdTransaction } from "./session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type SeededHousehold,
  type TestDatabase,
} from "./test-support/harness.js";
import { pgFailure } from "./test-support/inventory-fixtures.js";

const SUITE = "M1-T11 — withHouseholdTransaction never returns for an aborted transaction";
// A *running* test, so the notice reaches the default reporter (see harness.ts).
it.runIf(!dbTestsEnabled)(`SKIP NOTICE — ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

describe("TransactionAbortedAtCommitError", () => {
  it("is an Error with a name and a message that says nothing was committed", () => {
    const error = new TransactionAbortedAtCommitError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TransactionAbortedAtCommitError");
    expect(error.message).toMatch(/nothing was committed/);
  });
});

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let household: SeededHousehold;
  /**
   * A pool of exactly one connection, so "what the next borrower sees" is
   * literally the physical connection the previous transaction used. Without
   * `max: 1` a leaked transaction hides behind a fresh connection.
   */
  let singleConnectionPool: Pool;

  beforeAll(async () => {
    db = await createTestDatabase("session");
    household = await seedHousehold(db.pool, "Session");
    singleConnectionPool = new Pool({ connectionString: db.url, max: 1 });
  }, 60_000);

  afterAll(async () => {
    await singleConnectionPool?.end();
    await db?.drop();
  });

  /** Inserts an item row directly, so a test can ask whether it survived. */
  async function insertItem(client: PoolClient, itemId: string): Promise<void> {
    await client.query(
      `INSERT INTO inventory_items (id, household_id, unit) VALUES ($1, $2, 'lb')`,
      [itemId, household.householdId],
    );
  }

  async function itemExists(itemId: string): Promise<boolean> {
    const rows = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    return rows.rows[0]?.count !== "0";
  }

  it("commits and returns fn's value when nothing went wrong (positive control)", async () => {
    const itemId = randomUUID();
    const returned = await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        await insertItem(client, itemId);
        return "committed";
      },
      { assumeRole: APP_ROLE },
    );

    expect(returned).toBe("committed");
    expect(await itemExists(itemId)).toBe(true);
  });

  it("throws TransactionAbortedAtCommitError when fn swallows a database error", async () => {
    const itemId = randomUUID();
    let thrown: unknown;
    try {
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertItem(client, itemId);
          // The realistic shape of the bug: a `catch` that decides an error is
          // "handled" and returns a normal-looking result. The transaction is
          // aborted from here on, whatever the caller believes.
          try {
            await client.query("SELECT 1 / 0");
          } catch (error) {
            expect(pgFailure(error).code).toBe("22012");
          }
          return "looks fine";
        },
        { assumeRole: APP_ROLE },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TransactionAbortedAtCommitError);
    expect((thrown as Error).message).toMatch(/aborted state at COMMIT/);
    expect(await itemExists(itemId), "the swallowed error's transaction must not be durable").toBe(
      false,
    );
  });

  it("does not poison the pool: the next transaction commits normally", async () => {
    const lost = randomUUID();
    await expect(
      withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertItem(client, lost);
          try {
            await client.query("SELECT 1 / 0");
          } catch {
            /* swallowed, as the defect's callers did */
          }
          return "ignored";
        },
        { assumeRole: APP_ROLE },
      ),
    ).rejects.toBeInstanceOf(TransactionAbortedAtCommitError);

    const kept = randomUUID();
    const returned = await withHouseholdTransaction(
      db.pool,
      household.householdId,
      async (client) => {
        await insertItem(client, kept);
        return "second";
      },
      { assumeRole: APP_ROLE },
    );

    expect(returned).toBe("second");
    expect(await itemExists(lost)).toBe(false);
    expect(await itemExists(kept)).toBe(true);
    // The aborted-at-COMMIT client is returned to the pool rather than
    // destroyed: Postgres already ended that transaction and the connection is
    // clean, so there is nothing to throw away.
    expect(db.pool.waitingCount).toBe(0);
    expect(db.pool.idleCount).toBeGreaterThan(0);
  });

  it("still propagates an error fn throws, by identity, with nothing committed", async () => {
    const itemId = randomUUID();
    const sentinel = new Error("caller gave up");
    let thrown: unknown;
    try {
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        async (client) => {
          await insertItem(client, itemId);
          throw sentinel;
        },
        { assumeRole: APP_ROLE },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(sentinel);
    expect(await itemExists(itemId)).toBe(false);
  });

  /**
   * The aborted-at-COMMIT path is short-circuited on a local flag rather than
   * on `instanceof TransactionAbortedAtCommitError`, and this is the test that
   * makes that distinction load-bearing (reviewer finding F1).
   *
   * The error type is exported, so `fn` can throw one itself — and when it
   * does, the transaction is a perfectly ordinary open transaction that has
   * not been committed. An `instanceof` check would skip the `ROLLBACK` and
   * hand the connection back to the pool mid-transaction, with `SET LOCAL
   * ROLE` and `app.household_id` still in force. The next borrower of that
   * physical connection would inherit another request's role and household
   * context — a tenancy boundary (data-model.md §5) broken by a connection
   * that was never cleaned up.
   */
  it("rolls back normally when fn itself throws TransactionAbortedAtCommitError", async () => {
    const itemId = randomUUID();
    const sentinel = new TransactionAbortedAtCommitError("thrown by fn, not by the wrapper");

    await expect(
      withHouseholdTransaction(
        singleConnectionPool,
        household.householdId,
        async (client) => {
          await insertItem(client, itemId);
          throw sentinel;
        },
        { assumeRole: APP_ROLE },
      ),
    ).rejects.toBe(sentinel);

    expect(await itemExists(itemId), "an uncommitted insert survived").toBe(false);

    const borrower = await singleConnectionPool.connect();
    try {
      const state = await borrower.query<{
        transaction_state: string;
        role: string;
        household: string | null;
      }>(
        `SELECT CASE WHEN pg_current_xact_id_if_assigned() IS NULL THEN 'idle' ELSE 'in-transaction' END
                 AS transaction_state,
                current_user AS role,
                current_setting('app.household_id', true) AS household`,
      );
      const seen = state.rows[0];
      expect(seen?.transaction_state, "the pool handed out an OPEN transaction").toBe("idle");
      expect(seen?.role, "SET LOCAL ROLE leaked to the next borrower").not.toBe(APP_ROLE);
      expect(seen?.household ?? "", "app.household_id leaked to the next borrower").toBe("");
    } finally {
      borrower.release();
    }
  });

  it("propagates a database error fn does not catch, unchanged", async () => {
    let thrown: unknown;
    try {
      await withHouseholdTransaction(
        db.pool,
        household.householdId,
        (client) => client.query("SELECT 1 / 0"),
        { assumeRole: APP_ROLE },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeInstanceOf(TransactionAbortedAtCommitError);
    expect(pgFailure(thrown).code).toBe("22012");
  });
});
