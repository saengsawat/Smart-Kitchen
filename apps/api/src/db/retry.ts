/**
 * Bounded retry helper for ledger writes (M1-T9).
 *
 * `apps/api/src/db/inventory/repository.ts` already establishes why two
 * distinct Postgres error shapes mean the same thing — "a concurrent append
 * to this item raced you, and the sequence you computed is stale":
 *
 *   - caller took the item lock (`SELECT … FOR UPDATE`, the repository's own
 *     write path) → the second writer blocks, re-reads after the first
 *     commits, and the migration-0004 trigger's next-sequence check raises
 *     `40001` (serialization_failure) because the read it based its decision
 *     on is now behind;
 *   - caller did not take the lock → the unique index on
 *     `(item_id, sequence)` rejects the collision first, as `23505` on the
 *     constraint `inventory_transactions_item_sequence_key`, before the
 *     trigger's own check ever runs.
 *
 * `isRetryableLedgerError` treats both as the same retryable condition. It
 * does **not** treat every `23505` that way: `inventory_transactions_
 * idempotency_key` is a terminal *business* conflict (a caller reusing an
 * idempotency key for a materially different write), already translated by
 * `appendTransactionToDb` into the domain's typed `IDEMPOTENCY_KEY_CONFLICT`
 * rejection. Retrying that would not change the outcome — the key is used,
 * full stop — and blurring it with the concurrency-loser case would let a
 * business conflict masquerade as a transient one.
 *
 * `withRetriedHouseholdTransaction` wraps `withHouseholdTransaction` and
 * re-runs the *whole* transaction — a fresh `BEGIN`, a fresh call to `fn` —
 * on a retryable error, up to `maxAttempts` times. Re-running `fn` from
 * scratch is safe for ledger appends specifically because of INV-LEDGER-3
 * (testing-strategy.md §2: replaying any write with the same idempotency key
 * is a no-op): a retried attempt either lands as the original append would
 * have, or collides with itself and is reported as the same idempotent
 * `duplicate` / typed conflict outcome — never a double-applied write. `fn`
 * must still be written with that in mind (no side effect outside the
 * transaction it's handed, no assumption that a previous attempt did not
 * partially run — the database already guarantees the previous attempt's
 * work was rolled back, since it never committed). Concretely, `fn` must
 * re-derive any value it reads from the database — a sequence, a balance, a
 * lock — freshly on *every* call, never close over what an earlier attempt
 * read: the whole point of retrying is that an earlier read may already be
 * stale, and a closed-over value defeats that.
 *
 * No `Math.random` anywhere in this module, by ticket instruction: the
 * default backoff is a deterministic function of the attempt number, and
 * both `delay` and `sleep` are injectable so tests never wait on real time.
 */

import type { Pool, PoolClient } from "pg";
import { pgConstraint, pgErrorCode } from "./inventory/repository.js";
import { withHouseholdTransaction, type HouseholdSessionOptions } from "./session.js";

/** The one `23505` constraint that means "concurrency loser", not "business conflict". */
const SEQUENCE_KEY_CONSTRAINT = "inventory_transactions_item_sequence_key";

/**
 * True for a Postgres error that means "re-run the whole transaction from
 * scratch, this one lost a race" — see the module header for the two shapes.
 *
 * Deliberately narrow: only `40001` (any constraint, or none named) and
 * `23505` scoped to exactly {@link SEQUENCE_KEY_CONSTRAINT}. Every other
 * error — including `23505` on the idempotency-key constraint, any other
 * SQLSTATE, and anything that is not a Postgres driver error at all (a plain
 * thrown `Error`, `undefined`, a string) — is not retryable.
 */
export function isRetryableLedgerError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (code === "40001") return true;
  if (code === "23505") return pgConstraint(error) === SEQUENCE_KEY_CONSTRAINT;
  return false;
}

/**
 * Thrown when every attempt up to `maxAttempts` failed with a retryable
 * error. `cause` is the error from the last attempt (standard `Error.cause`,
 * also kept as an explicit readonly property so callers do not need to know
 * about the ES2022 convention to read it).
 */
export class LedgerRetryExhaustedError extends Error {
  readonly attempts: number;
  override readonly cause: unknown;

  constructor(attempts: number, cause: unknown) {
    super(
      `ledger transaction did not succeed after ${String(attempts)} attempt(s); ` +
        `last error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "LedgerRetryExhaustedError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export interface RetryOptions extends HouseholdSessionOptions {
  /** Total attempts before giving up (default 3). Must be at least 1. */
  readonly maxAttempts?: number;
  /** Milliseconds to wait before the given (1-based) retry attempt. */
  readonly delay?: (attempt: number) => number;
  /**
   * Performs the wait. Injectable so tests never sleep on real time. If this
   * rejects, its rejection propagates in place of the ledger error that
   * triggered the wait — with that ledger error attached as `.cause` when the
   * rejection is an `Error` that does not already carry one — rather than the
   * ledger error being silently dropped.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Deterministic exponential backoff, no jitter: 25ms, 50ms, 100ms, …
 * `attempt` is the 1-based attempt that just failed (the wait happens before
 * the *next* one).
 */
function defaultDelay(attempt: number): number {
  return 25 * 2 ** (attempt - 1);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `fn` inside a household-scoped transaction via
 * {@link withHouseholdTransaction}, retrying the whole thing — fresh
 * transaction, fresh call to `fn` — when it fails with
 * {@link isRetryableLedgerError}. Any other error propagates immediately,
 * unchanged, after the first attempt.
 *
 * On exhausting `maxAttempts` retryable failures, throws
 * {@link LedgerRetryExhaustedError} carrying the attempt count and the last
 * error as `cause`.
 */
export async function withRetriedHouseholdTransaction<T>(
  pool: Pool,
  householdId: string | null,
  fn: (client: PoolClient) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a positive integer, got ${String(maxAttempts)}`);
  }
  const delay = options.delay ?? defaultDelay;
  const sleep = options.sleep ?? defaultSleep;
  const sessionOptions: HouseholdSessionOptions =
    options.assumeRole === undefined ? {} : { assumeRole: options.assumeRole };

  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      // Attempts are inherently sequential — each one must complete (or
      // fail) before the next is decided, so a loop with an `await` inside
      // is the right shape, not a parallelised `Promise.all`.
      return await withHouseholdTransaction(pool, householdId, fn, sessionOptions);
    } catch (error) {
      if (!isRetryableLedgerError(error)) throw error;
      lastError = error;
      if (attempt >= maxAttempts) break;
      try {
        await sleep(delay(attempt));
      } catch (sleepError) {
        // The ledger error that triggered this wait must not vanish silently
        // if the (injected, test-controlled in practice) sleep itself
        // rejects — attach it as `cause` when the rejection doesn't already
        // carry one.
        if (sleepError instanceof Error && sleepError.cause === undefined) {
          sleepError.cause = error;
        }
        throw sleepError;
      }
    }
  }
  throw new LedgerRetryExhaustedError(attempt, lastError);
}
