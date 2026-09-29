/**
 * S11's in-session offline check-off queue (M3-T5 Objective (f), ADR-010
 * option C).
 *
 * A pure, screen-agnostic module (no React, no `ApiClient`) so it can be
 * unit-tested in isolation (BACKLOG.md M3-T5 "Tests required": "queue unit
 * tests (offline enqueue, ordered replay, key reuse on replay, failed replay
 * keeps the entry, no duplicate delivery, online path bypasses the queue)").
 * The screen decides *whether* to enqueue (by reading `ApiClient.isOffline()`
 * at tap time) and supplies the `apply` function `replay` calls; this module
 * only holds and replays entries.
 *
 * ## Design
 *
 * - **Keyed by row, one pending entry per row (a `Map<rowId, entry>`).** A
 *   second `enqueue` for the same row (the user taps the check control twice
 *   before reconnecting) replaces the first entry rather than appending a
 *   second: the row's *current* desired state is one boolean, and only the
 *   latest tap's idempotency key is meaningful — the superseded key was
 *   never sent anywhere, so discarding it loses no server-visible state
 *   (module doc comment continued below). `Map` also preserves insertion
 *   order for keys that have not been re-set, which is what gives replay its
 *   "in order" guarantee: a row's position in replay order is when it was
 *   *first* queued, not when it was last updated.
 * - **The idempotency key is minted by the caller at tap time and stored
 *   verbatim** (never re-minted here, including on replay): `enqueue`'s
 *   `entry.idempotencyKey` is exactly what `replay` later passes to `apply`.
 * - **Ordered, per-entry replay.** `replay` walks entries in `Map` iteration
 *   order and calls `apply` once per entry; a failure removes nothing (the
 *   entry, and its "Queued" tag, stay visible) but does not stop the walk —
 *   one bad entry must not silently strand every entry after it. Confirmed
 *   entries are removed only after `apply` resolves, never optimistically.
 * - **No duplicate delivery.** Because there is at most one entry per row,
 *   and a confirmed entry is deleted before any later tap could enqueue a
 *   new one, `apply` is never called twice for the same tap.
 * - **At most one replay walk in flight, plus one collapsed follow-up
 *   (review round 1 F4, tightened at round 2 R2).** A `replay` call while a
 *   walk is already running does not just return that walk's promise (F4
 *   alone): the walk's own snapshot (taken when *it* started) cannot see an
 *   entry `enqueue`d after that, so a naive "share the in-flight promise"
 *   fix left such an entry stranded until the next flap or tap (round 1
 *   left it there; round 2 R2 closes it). Instead, the *first* `replay`
 *   call made while a walk is running schedules exactly one follow-up walk
 *   to run immediately after the current one finishes; every other
 *   `replay` call made before that follow-up starts collapses into the
 *   same pending follow-up rather than scheduling another one. This still
 *   guarantees at most one delivery per entry per settled state (F4's
 *   promise): the follow-up is a genuinely new walk, snapshotting
 *   `entries` fresh when *it* starts, so it only ever redelivers an entry
 *   the first walk did not already confirm.
 */

export interface QueuedCheckOff {
  readonly rowId: string;
  readonly checked: boolean;
  readonly idempotencyKey: string;
}

/** Applies one queued entry to the real port (e.g. `apiClient.checkOffShoppingRow`); rejects on failure. */
export type ApplyQueuedCheckOff = (entry: QueuedCheckOff) => Promise<void>;

export interface ReplayResult {
  /** Rows whose queued entry was confirmed and removed this replay. */
  readonly confirmed: readonly string[];
  /** Rows whose queued entry failed and is still queued. */
  readonly failed: readonly string[];
}

export class ShoppingCheckOffQueue {
  private readonly entries = new Map<string, QueuedCheckOff>();
  private replayInFlight: Promise<ReplayResult> | null = null;
  private followUpReplay: Promise<ReplayResult> | null = null;

  /** Queues (or replaces the still-pending entry for) one row. */
  enqueue(entry: QueuedCheckOff): void {
    this.entries.set(entry.rowId, entry);
  }

  /** Whether `rowId` has a still-unconfirmed entry (drives the row's "Queued" tag). */
  isQueued(rowId: string): boolean {
    return this.entries.has(rowId);
  }

  /**
   * The still-pending entry for `rowId`, or `undefined` if none (review
   * round 1, F1): lets a caller reconstruct a row's optimistic display
   * state after this queue has outlived a remount — the screen no longer
   * has to have been mounted continuously since the tap that queued it.
   */
  get(rowId: string): QueuedCheckOff | undefined {
    return this.entries.get(rowId);
  }

  /** Every row currently queued, oldest-queued first. */
  queuedRowIds(): readonly string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drops every pending entry with no replay attempt (test/session-reset hygiene only; never called by the screen itself). */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Drops every pending entry whose `rowId` is not in `validRowIds` (review
   * round 2, R3): a row that disappeared from a fresh load (removed, or
   * simply no longer part of the list) has nothing left to sync, and
   * retrying it forever would only ever fail every replay from then on.
   * No confirmation/failure is reported for a dropped entry: there is
   * nothing left for the user to act on, so no toast either (the caller
   * decides that; this just stops the entry from being replayed again).
   */
  pruneToKnownRows(validRowIds: ReadonlySet<string>): void {
    for (const rowId of this.entries.keys()) {
      if (!validRowIds.has(rowId)) {
        this.entries.delete(rowId);
      }
    }
  }

  /**
   * Replays every queued entry, in order, via `apply`. A confirmed entry is
   * removed; a failed one stays queued (module doc comment). Never throws:
   * a rejected `apply` is caught per entry so one failure does not abort the
   * rest of the walk. A call made while a walk is already running schedules
   * (or joins) exactly one follow-up walk immediately after the current one
   * finishes (module doc comment, F4/R2), so an entry queued mid-walk is
   * never stranded until the next flap or tap.
   */
  replay(apply: ApplyQueuedCheckOff): Promise<ReplayResult> {
    if (this.replayInFlight) {
      if (!this.followUpReplay) {
        this.followUpReplay = this.replayInFlight
          .then(() => this.replay(apply))
          .finally(() => {
            this.followUpReplay = null;
          });
      }
      return this.followUpReplay;
    }
    const walk = this.runReplay(apply).finally(() => {
      this.replayInFlight = null;
    });
    this.replayInFlight = walk;
    return walk;
  }

  private async runReplay(apply: ApplyQueuedCheckOff): Promise<ReplayResult> {
    const confirmed: string[] = [];
    const failed: string[] = [];
    // A snapshot: `apply` must not observe (or race) mutations `enqueue`
    // makes to `this.entries` mid-walk from a fresh tap during replay.
    for (const entry of [...this.entries.values()]) {
      try {
        await apply(entry);
        // Only clear this exact entry: if a fresh tap re-queued the row
        // (a new idempotency key) while this replay was in flight, that
        // newer entry must survive, not be deleted by the older replay
        // that raced it.
        if (this.entries.get(entry.rowId) === entry) {
          this.entries.delete(entry.rowId);
        }
        confirmed.push(entry.rowId);
      } catch {
        failed.push(entry.rowId);
      }
    }
    return { confirmed, failed };
  }
}
