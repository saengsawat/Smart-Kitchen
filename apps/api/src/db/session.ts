/**
 * Request-scoped database sessions (M1-T2).
 *
 * Every household-scoped read or write happens inside one of these. The
 * transaction establishes two things before any application SQL runs:
 *
 * - `app.household_id`, transaction-local, which is what the row-level
 *   security policies in migration 0006 compare against. Setting it locally
 *   (`set_config(..., true)`) means it cannot leak to the next borrower of a
 *   pooled connection.
 * - optionally the role to act as. In production the pool connects as `sk_app`
 *   directly and no role change is needed; the test harness connects as the
 *   owner (so it can seed fixtures across households) and assumes `sk_app`
 *   here, which is what makes the policies apply to it.
 *
 * There is deliberately no way to run a household-scoped query without going
 * through this helper — data-model.md §5's "no query path exists without a
 * mandatory household context", made structural.
 */

import type { Pool, PoolClient } from "pg";

/** Postgres identifiers we are willing to `SET ROLE` to. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Thrown when `COMMIT` was issued on a transaction Postgres had already put
 * into the ABORTED state (M1-T11, from the M1-T9 review's finding F4).
 *
 * Postgres does not report this as an error. `COMMIT` on an aborted
 * transaction succeeds at the protocol level and answers with the **`ROLLBACK`
 * command tag** — observed on Postgres 17.10 through node-postgres 8.23:
 * `QueryResult.command === "ROLLBACK"`, `rowCount === null`, no notice, no
 * exception. Everything the transaction did is discarded.
 *
 * Any code that swallows a database error and then returns normally lands
 * here: the swallowed error aborted the transaction, and without this check
 * the caller would be handed `fn`'s return value as if the writes behind it
 * were durable. Silent data loss is the one outcome a ledger write path may
 * never produce (ADR-008), so the session fails loudly instead.
 *
 * Nothing was committed when this is thrown — the name is literal.
 */
export class TransactionAbortedAtCommitError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "the transaction was in an aborted state at COMMIT, so Postgres rolled it back " +
          "(COMMIT answered with the ROLLBACK command tag): nothing was committed. " +
          "Some earlier statement failed and its error was swallowed instead of propagating.",
    );
    this.name = "TransactionAbortedAtCommitError";
  }
}

export interface HouseholdSessionOptions {
  /**
   * Role to assume for the duration of the transaction (`SET LOCAL ROLE`).
   * Must be a plain lowercase identifier — it cannot be parameterised, so it
   * is validated rather than escaped.
   */
  readonly assumeRole?: string;
}

/**
 * Runs `fn` inside a transaction bound to one household, committing on success
 * and rolling back on any throw.
 *
 * Passing `null` for `householdId` establishes **no** household context — used
 * by the tenancy suite to prove that a code path which forgets to set it sees
 * nothing rather than everything.
 *
 * Returning normally means the work committed. If `fn` returns after leaving
 * the transaction in an aborted state — it swallowed a database error — this
 * throws {@link TransactionAbortedAtCommitError} rather than handing back a
 * result for work Postgres discarded.
 */
export async function withHouseholdTransaction<T>(
  pool: Pool,
  householdId: string | null,
  fn: (client: PoolClient) => Promise<T>,
  options: HouseholdSessionOptions = {},
): Promise<T> {
  const role = options.assumeRole;
  if (role !== undefined && !SAFE_IDENTIFIER.test(role)) {
    throw new Error(`refusing to SET ROLE to a non-identifier: ${role}`);
  }

  const client = await pool.connect();
  let poisoned = false;
  let abortedAtCommit = false;
  try {
    await client.query("BEGIN");
    if (role !== undefined) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
    if (householdId !== null) {
      await client.query("SELECT set_config('app.household_id', $1, true)", [householdId]);
    }
    const result = await fn(client);
    // `COMMIT` is not the same thing as "committed". See
    // {@link TransactionAbortedAtCommitError}: on an aborted transaction
    // Postgres answers COMMIT with the ROLLBACK command tag and no error, so
    // the tag — not the absence of a throw — is what says the work is durable.
    const commit = await client.query("COMMIT");
    if (commit.command === "ROLLBACK") {
      abortedAtCommit = true;
      throw new TransactionAbortedAtCommitError();
    }
    return result;
  } catch (error) {
    // The flag, rather than `instanceof`, so that an error of this type thrown
    // by `fn` itself is still rolled back like any other.
    if (abortedAtCommit) {
      // Postgres has already ended the transaction — that is precisely what
      // it just told us. The connection is clean and immediately reusable
      // (verified against the driver: a `SELECT` on it succeeds), and issuing
      // a ROLLBACK here would only draw a "there is no transaction in
      // progress" warning. Release it unpoisoned.
      throw error;
    }
    poisoned = true;
    try {
      await client.query("ROLLBACK");
      poisoned = false;
    } catch {
      /* connection is unusable; it is destroyed on release below. */
    }
    throw error;
  } finally {
    client.release(poisoned);
  }
}
