/**
 * Attempt limiting (M2-T3 (b), ARCHITECTURE.md §7.11).
 *
 * Join codes live in a space of about 1.7e8 (`db/households/join-code.ts`), so
 * the thing that makes guessing hopeless is how few guesses anyone gets:
 * {@link JOIN_ATTEMPT_LIMIT} per user per {@link JOIN_ATTEMPT_WINDOW_MS}.
 *
 * **Every attempt counts, right or wrong**, and it is counted *before* the
 * code is checked. Counting only failures would need the outcome first, and a
 * burst of concurrent guesses would all be checked before any of them was
 * recorded. Reserving the slot synchronously, up front, means the eleventh
 * request in a window is refused whatever the timing.
 *
 * **In-memory, per process.** Correct for the single API instance this
 * milestone runs; a second instance would give each user a second budget.
 * Moving the window into Postgres or a shared cache belongs with deployment,
 * and is raised in the M2-T3 handoff rather than solved here.
 */

/** Join attempts allowed per user per window. */
export const JOIN_ATTEMPT_LIMIT = 10;

/** The window, in milliseconds (ten minutes). */
export const JOIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/** Keys tracked before a sweep drops the ones whose window has fully passed. */
const SWEEP_THRESHOLD = 10_000;

export interface AttemptLimiter {
  /**
   * Records an attempt for `key` and says whether it is allowed. A refused
   * attempt is not recorded, so waiting out the window always works.
   */
  tryAcquire(key: string): boolean;
}

export interface SlidingWindowOptions {
  readonly limit: number;
  readonly windowMs: number;
  /** Clock in milliseconds; injectable so tests can move time. */
  readonly now?: () => number;
}

export function createSlidingWindowLimiter(options: SlidingWindowOptions): AttemptLimiter {
  const { limit, windowMs } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be positive");
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();

  function sweep(at: number): void {
    for (const [key, times] of attempts) {
      const newest = times[times.length - 1];
      if (newest === undefined || newest <= at - windowMs) attempts.delete(key);
    }
  }

  return {
    tryAcquire(key: string): boolean {
      const at = now();
      if (attempts.size > SWEEP_THRESHOLD) sweep(at);
      const recent = (attempts.get(key) ?? []).filter((time) => time > at - windowMs);
      if (recent.length >= limit) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(at);
      attempts.set(key, recent);
      return true;
    },
  };
}

/** The limiter the join endpoint uses unless a test supplies its own. */
export function createJoinAttemptLimiter(now?: () => number): AttemptLimiter {
  return createSlidingWindowLimiter({
    limit: JOIN_ATTEMPT_LIMIT,
    windowMs: JOIN_ATTEMPT_WINDOW_MS,
    ...(now === undefined ? {} : { now }),
  });
}
