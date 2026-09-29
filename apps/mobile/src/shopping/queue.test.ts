import { describe, expect, it } from "vitest";
import { ShoppingCheckOffQueue, type QueuedCheckOff } from "./queue";

function entry(overrides: Partial<QueuedCheckOff> = {}): QueuedCheckOff {
  return { rowId: "row-1", checked: true, idempotencyKey: "key-1", ...overrides };
}

describe("ShoppingCheckOffQueue (M3-T5 Objective (f))", () => {
  it("enqueue marks a row as queued", () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry());
    expect(queue.isQueued("row-1")).toBe(true);
    expect(queue.size).toBe(1);
  });

  it("replays entries in the order they were first queued", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ rowId: "row-a", idempotencyKey: "key-a" }));
    queue.enqueue(entry({ rowId: "row-b", idempotencyKey: "key-b" }));
    queue.enqueue(entry({ rowId: "row-c", idempotencyKey: "key-c" }));

    const applied: string[] = [];
    const result = await queue.replay((e) => {
      applied.push(e.rowId);
      return Promise.resolve();
    });

    expect(applied).toEqual(["row-a", "row-b", "row-c"]);
    expect(result.confirmed).toEqual(["row-a", "row-b", "row-c"]);
    expect(queue.size).toBe(0);
  });

  it("reuses the exact idempotency key minted at tap time on replay, never a new one", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ idempotencyKey: "key-original" }));

    const seenKeys: string[] = [];
    await queue.replay((e) => {
      seenKeys.push(e.idempotencyKey);
      return Promise.resolve();
    });

    expect(seenKeys).toEqual(["key-original"]);
  });

  it("a confirmed entry is removed and its Queued tag clears", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry());
    await queue.replay(() => Promise.resolve());
    expect(queue.isQueued("row-1")).toBe(false);
  });

  it("a failed replay leaves the entry queued (the tag stays visible)", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry());
    const result = await queue.replay(() => Promise.reject(new Error("network still down")));
    expect(result.failed).toEqual(["row-1"]);
    expect(queue.isQueued("row-1")).toBe(true);
  });

  it("one entry's failure does not stop the rest of the walk", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ rowId: "row-fails", idempotencyKey: "key-fails" }));
    queue.enqueue(entry({ rowId: "row-ok", idempotencyKey: "key-ok" }));

    const result = await queue.replay((e) => {
      if (e.rowId === "row-fails") {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve();
    });

    expect(result.confirmed).toEqual(["row-ok"]);
    expect(result.failed).toEqual(["row-fails"]);
    expect(queue.isQueued("row-fails")).toBe(true);
    expect(queue.isQueued("row-ok")).toBe(false);
  });

  it("re-queuing the same row replaces the pending entry (no duplicate delivery) and keeps its original queue position", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ rowId: "row-a", idempotencyKey: "key-1", checked: true }));
    queue.enqueue(entry({ rowId: "row-b", idempotencyKey: "key-2", checked: true }));
    // row-a is tapped again before reconnecting (checked off, then undone).
    queue.enqueue(entry({ rowId: "row-a", idempotencyKey: "key-3", checked: false }));

    expect(queue.size).toBe(2);

    const applied: QueuedCheckOff[] = [];
    await queue.replay((e) => {
      applied.push(e);
      return Promise.resolve();
    });

    // Exactly one call for row-a, carrying the latest key/state, and it
    // still replays in its original (first-queued) position.
    expect(applied.map((e) => e.rowId)).toEqual(["row-a", "row-b"]);
    expect(applied[0]).toEqual({ rowId: "row-a", checked: false, idempotencyKey: "key-3" });
  });

  it("queuedRowIds lists every still-pending row", () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ rowId: "row-a" }));
    queue.enqueue(entry({ rowId: "row-b" }));
    expect(queue.queuedRowIds()).toEqual(["row-a", "row-b"]);
  });

  it("a fresh tap queued mid-replay is not clobbered by the in-flight (stale) replay call for the same row", async () => {
    const queue = new ShoppingCheckOffQueue();
    queue.enqueue(entry({ rowId: "row-1", idempotencyKey: "key-old" }));

    let resolveApply: (() => void) | undefined;
    const applyPromise = queue.replay(
      () =>
        new Promise<void>((resolve) => {
          resolveApply = resolve;
        }),
    );

    // A fresh tap re-queues row-1 with a new key while the old apply call
    // (for key-old) is still in flight.
    queue.enqueue(entry({ rowId: "row-1", idempotencyKey: "key-new" }));
    resolveApply?.();
    await applyPromise;

    // The stale in-flight call must not delete the newer entry.
    expect(queue.isQueued("row-1")).toBe(true);
  });
});
