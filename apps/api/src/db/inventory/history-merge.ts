/**
 * Merging an item's moves into its ledger history (M2-T6).
 *
 * Pure, so the ordering rule is tested without a database.
 *
 * The rule, and why it is this one:
 *
 * - **Ledger rows keep their `sequence` order, always.** `sequence` is the
 *   ledger's authoritative order, never a timestamp (domain-model.md §2), so
 *   this merge never re-sorts ledger rows against each other. It only decides
 *   where each move goes among them.
 * - **A move goes before the first ledger row recorded after it.** Both sides
 *   are compared at the stored microsecond precision, as fixed-width ISO text
 *   (so a text comparison is a time comparison), not at the millisecond a JS
 *   `Date` would round to.
 * - **A tie goes to the ledger row first**, then the move: at one instant the
 *   quantity fact is listed before the location fact. Deterministic, and the
 *   same on every read.
 * - **Moves among themselves** are ordered by time, then by id, so two moves
 *   at one instant still come out in one fixed order.
 *
 * Oldest first, like the ledger: S5 reverses it for display.
 */

export interface TimedEntry<T> {
  /** Microsecond-precision ISO 8601 UTC, fixed width (`YYYY-MM-DDTHH:MM:SS.ffffffZ`). */
  readonly at: string;
  readonly value: T;
}

export interface TimedMove<T> extends TimedEntry<T> {
  /** Tie-breaker among moves recorded at the same instant. */
  readonly id: string;
}

export function mergeMovesIntoHistory<L, M>(
  /** Ledger entries in `sequence` order, oldest first. Never re-sorted. */
  ledger: readonly TimedEntry<L>[],
  moves: readonly TimedMove<M>[],
): (L | M)[] {
  const orderedMoves = [...moves].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const merged: (L | M)[] = [];
  let l = 0;
  let m = 0;
  while (l < ledger.length || m < orderedMoves.length) {
    const nextLedger = ledger[l];
    const nextMove = orderedMoves[m];
    if (nextMove !== undefined && (nextLedger === undefined || nextMove.at < nextLedger.at)) {
      merged.push(nextMove.value);
      m += 1;
    } else if (nextLedger !== undefined) {
      merged.push(nextLedger.value);
      l += 1;
    }
  }
  return merged;
}
