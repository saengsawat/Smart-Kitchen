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

  /** Queues (or replaces the still-pending entry for) one row. */
  enqueue(entry: QueuedCheckOff): void {
    this.entries.set(entry.rowId, entry);
  }

  /** Whether `rowId` has a still-unconfirmed entry (drives the row's "Queued" tag). */
  isQueued(rowId: string): boolean {
    return this.entries.has(rowId);
  }

  /** Every row currently queued, oldest-queued first. */
  queuedRowIds(): readonly string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Replays every queued entry, in order, via `apply`. A confirmed entry is
   * removed; a failed one stays queued (module doc comment). Never throws:
   * a rejected `apply` is caught per entry so one failure does not abort the
   * rest of the walk.
   */
  async replay(apply: ApplyQueuedCheckOff): Promise<ReplayResult> {
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
