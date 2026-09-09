import { describe, expect, it } from "vitest";
import { deriveItemQuantity, deriveLotQuantity, reconcile } from "./derive.js";
import { isDeeplyFrozen } from "./freeze.js";
import {
  appendTransaction,
  appendTransactions,
  createInventoryItem,
  findByIdempotencyKey,
  findClampFor,
  openLot,
  rehydrateInventoryItem,
  CLAMP_KEY_SUFFIX,
  CLAMP_REASON,
  LEDGER_COMPONENT,
} from "./ledger.js";
import { microsToAmount } from "./quantity.js";
import {
  instantAt,
  itemInput,
  serialize,
  txInput,
  TEST_ITEM,
  TEST_LOT,
  TEST_UNIT,
} from "./test-support.js";
import type {
  Actor,
  CorrelationRef,
  CreateInventoryItemInput,
  InventoryItem,
  Provenance,
  RecordedTransaction,
  TransactionInput,
} from "./types.js";

function newItem(overrides: Partial<CreateInventoryItemInput> = {}): InventoryItem {
  const created = createInventoryItem(itemInput(overrides));
  if (!created.ok) throw new Error(`fixture item invalid: ${created.error.message}`);
  return created.value;
}

function appended(item: InventoryItem, input: TransactionInput): InventoryItem {
  const result = appendTransaction(item, input);
  if (result.status !== "appended") {
    throw new Error(
      `expected append, got ${result.status}${result.status === "rejected" ? `: ${result.error.code}` : ""}`,
    );
  }
  return result.item;
}

function rejectionCode(item: InventoryItem, input: TransactionInput): string {
  const result = appendTransaction(item, input);
  return result.status === "rejected" ? result.error.code : `unexpected:${result.status}`;
}

describe("createInventoryItem / openLot", () => {
  it("starts empty, at zero, with sequence 1", () => {
    const item = newItem();
    expect(item.currentQty.micros).toBe(0n);
    expect(item.currentQty.unit).toBe(TEST_UNIT);
    expect(item.transactions).toHaveLength(0);
    expect(item.nextSequence).toBe(1);
    expect(isDeeplyFrozen(item)).toBe(true);
  });

  it("rejects missing identifiers and duplicate lots", () => {
    const noId = createInventoryItem(itemInput({ itemId: "  " }));
    expect(noId.ok ? null : noId.error.code).toBe("INVALID_FIELD");

    const duplicated = createInventoryItem(
      itemInput({ lots: [{ lotId: "lot-1" }, { lotId: "lot-1" }] }),
    );
    expect(duplicated.ok ? null : duplicated.error.code).toBe("DUPLICATE_LOT");
  });

  it("opens further lots without touching the existing ledger", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2));
    const opened = openLot(item, { lotId: "lot-2", acquiredAt: instantAt(0) });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.lots.map((lot) => lot.lotId)).toEqual([TEST_LOT, "lot-2"]);
    expect(serialize(opened.value.transactions)).toBe(serialize(item.transactions));

    const again = openLot(opened.value, { lotId: "lot-2" });
    expect(again.ok ? null : again.error.code).toBe("DUPLICATE_LOT");
  });
});

describe("appendTransaction — validation", () => {
  const item = newItem();

  it("rejects a unit that differs from the item's unit (no silent conversion)", () => {
    expect(rejectionCode(item, txInput("PURCHASE", 2, { unit: "kg" }))).toBe("MIXED_UNITS");
  });

  it("rejects an unopened lot", () => {
    expect(rejectionCode(item, txInput("PURCHASE", 2, { lotId: "lot-nope" }))).toBe("UNKNOWN_LOT");
  });

  it("rejects a zero delta", () => {
    expect(rejectionCode(item, txInput("ADJUSTMENT", 0))).toBe("ZERO_DELTA");
  });

  it("rejects a sign that contradicts the transaction type", () => {
    expect(rejectionCode(item, txInput("PURCHASE", 2, { qtyDelta: -2 }))).toBe("WRONG_SIGN");
    expect(rejectionCode(item, txInput("CONSUME", 1, { qtyDelta: 1 }))).toBe("WRONG_SIGN");
    // ADJUSTMENT is the one signed instrument, so both directions are accepted.
    expect(appendTransaction(item, txInput("ADJUSTMENT", 1, { qtyDelta: 1 })).status).toBe(
      "appended",
    );
    expect(appendTransaction(item, txInput("ADJUSTMENT", 1, { qtyDelta: -1 })).status).toBe(
      "appended",
    );
  });

  it("rejects unrepresentable quantities", () => {
    expect(rejectionCode(item, txInput("PURCHASE", 0.0000001))).toBe("PRECISION_EXCEEDED");
    expect(rejectionCode(item, txInput("PURCHASE", Number.NaN))).toBe("NOT_FINITE");
    expect(rejectionCode(item, txInput("PURCHASE", 1e12))).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("rejects malformed or out-of-order timestamps", () => {
    expect(rejectionCode(item, txInput("PURCHASE", 1, { occurredAt: "yesterday" }))).toBe(
      "INVALID_TIMESTAMP",
    );
    expect(
      rejectionCode(
        item,
        txInput("PURCHASE", 1, { occurredAt: instantAt(10), recordedAt: instantAt(5) }),
      ),
    ).toBe("TIMESTAMP_ORDER");
  });

  it("rejects incomplete attribution", () => {
    expect(
      rejectionCode(item, txInput("PURCHASE", 1, { actor: { kind: "user", userId: "" } })),
    ).toBe("INVALID_FIELD");
    expect(
      rejectionCode(
        item,
        txInput("PURCHASE", 1, { provenance: { tier: "KNOWN_FACT", source: "" } }),
      ),
    ).toBe("INVALID_FIELD");
    expect(
      rejectionCode(
        item,
        txInput("PURCHASE", 1, {
          provenance: { tier: "AI_INTERPRETATION", source: "receipt-ocr", confidence: 1.4 },
        }),
      ),
    ).toBe("INVALID_FIELD");
  });

  it("rejects an idempotency key using the reserved system separator", () => {
    expect(
      rejectionCode(item, txInput("PURCHASE", 1, { idempotencyKey: `abc${CLAMP_KEY_SUFFIX}` })),
    ).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("leaves the aggregate untouched when it rejects", () => {
    const before = serialize(item);
    appendTransaction(item, txInput("PURCHASE", 2, { unit: "kg" }));
    expect(serialize(item)).toBe(before);
  });
});

describe("appendTransaction — idempotency (INV-LEDGER-3)", () => {
  it("treats an identical replay as a no-op and returns the original row", () => {
    const input = txInput("PURCHASE", 2, { idempotencyKey: "r42-l1" });
    const item = appended(newItem(), input);

    const replay = appendTransaction(item, { ...input, recordedAt: instantAt(99) });
    expect(replay.status).toBe("duplicate");
    expect(replay.item).toBe(item);
    if (replay.status !== "duplicate") return;
    expect(replay.transaction.sequence).toBe(1);
    expect(item.transactions).toHaveLength(1);
    expect(item.currentQty.amount).toBe(2);
  });

  it("rejects a key reused by a materially different write instead of swallowing it", () => {
    const input = txInput("PURCHASE", 2, { idempotencyKey: "r42-l1" });
    const item = appended(newItem(), input);
    const conflict = appendTransaction(item, { ...input, qtyDelta: 3 });
    expect(conflict.status).toBe("rejected");
    if (conflict.status !== "rejected") return;
    expect(conflict.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(conflict.item).toBe(item);
  });

  it("replays a clamped write without duplicating its clamp adjustment", () => {
    const purchase = txInput("PURCHASE", 1, { idempotencyKey: "p1" });
    const overuse = txInput("USE_IN_MEAL", 1.5, { idempotencyKey: "m1" });
    const item = appended(appended(newItem(), purchase), overuse);
    expect(item.transactions).toHaveLength(3);

    const replay = appendTransaction(item, overuse);
    expect(replay.status).toBe("duplicate");
    expect(replay.item).toBe(item);
    if (replay.status !== "duplicate") return;
    expect(replay.clampAdjustment?.idempotencyKey).toBe(`m1${CLAMP_KEY_SUFFIX}`);
    expect(item.transactions).toHaveLength(3);
  });
});

describe("appendTransaction — over-consumption clamp (INV-LEDGER-4)", () => {
  it("records the stated consumption in full and a flagged system adjustment for the residual", () => {
    const item = appended(newItem(), txInput("PURCHASE", 1, { idempotencyKey: "p1" }));
    const result = appendTransaction(
      item,
      txInput("USE_IN_MEAL", 1.25, { idempotencyKey: "m1", reason: "chicken curry" }),
    );
    expect(result.status).toBe("appended");
    if (result.status !== "appended") return;

    expect(result.transaction.qtyDelta).toBe(-1.25);
    const clamp = result.clampAdjustment;
    expect(clamp).toBeDefined();
    if (clamp === undefined) return;

    expect(clamp.type).toBe("ADJUSTMENT");
    expect(clamp.qtyDeltaMicros).toBe(250_000n);
    expect(clamp.reason).toBe(CLAMP_REASON);
    expect(clamp.actor).toEqual({ kind: "system", component: LEDGER_COMPONENT });
    expect(clamp.systemFlag).toEqual({
      kind: "OVER_CONSUMPTION",
      residualMicros: 250_000n,
      residual: 0.25,
      causedBySequence: 2,
      causedByIdempotencyKey: "m1",
    });
    expect(clamp.sequence).toBe(3);
    expect(result.item.currentQty.micros).toBe(0n);
    expect(reconcile(result.item).ok).toBe(true);
  });

  it("inherits the correlation of the write that overshot", () => {
    const item = appended(newItem(), txInput("PURCHASE", 1, { idempotencyKey: "p1" }));
    const result = appendTransaction(
      item,
      txInput("USE_IN_MEAL", 2, {
        idempotencyKey: "m1",
        correlationRef: { kind: "meal-log", id: "meal-9" },
      }),
    );
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.clampAdjustment?.correlationRef).toEqual({ kind: "meal-log", id: "meal-9" });
  });

  it("clamps a negative ADJUSTMENT too — no instrument can drive stock below zero", () => {
    const item = appended(newItem(), txInput("PURCHASE", 0.5, { idempotencyKey: "p1" }));
    const result = appendTransaction(
      item,
      txInput("ADJUSTMENT", 2, { qtyDelta: -2, idempotencyKey: "a1" }),
    );
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.item.currentQty.micros).toBe(0n);
    expect(result.clampAdjustment?.qtyDeltaMicros).toBe(1_500_000n);
  });

  it("clamps per lot, so one lot's surplus never covers another's overdraw", () => {
    let item = newItem({ lots: [{ lotId: "lot-1" }, { lotId: "lot-2" }] });
    item = appended(item, txInput("PURCHASE", 3, { lotId: "lot-1", idempotencyKey: "p1" }));
    item = appended(item, txInput("PURCHASE", 1, { lotId: "lot-2", idempotencyKey: "p2" }));
    const result = appendTransaction(
      item,
      txInput("CONSUME", 2, { lotId: "lot-2", idempotencyKey: "c1" }),
    );
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.clampAdjustment?.qtyDeltaMicros).toBe(1_000_000n);
    expect(deriveLotQuantity(result.item, "lot-1").amount).toBe(3);
    expect(deriveLotQuantity(result.item, "lot-2").amount).toBe(0);
    expect(result.item.currentQty.amount).toBe(3);
  });

  it("does not clamp a decrease that fits", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
    const result = appendTransaction(item, txInput("CONSUME", 2, { idempotencyKey: "c1" }));
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.clampAdjustment).toBeUndefined();
    expect(result.item.currentQty.micros).toBe(0n);
    expect(findClampFor(result.item, "c1")).toBeUndefined();
  });
});

describe("immutability (INV-LEDGER-2)", () => {
  it("freezes recorded rows and throws on attempted mutation", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
    const recorded = item.transactions[0];
    expect(recorded).toBeDefined();
    if (recorded === undefined) return;

    expect(isDeeplyFrozen(item)).toBe(true);
    expect(() => {
      (recorded as { qtyDelta: number }).qtyDelta = 99;
    }).toThrow(TypeError);
    expect(() => {
      (recorded.provenance as { source: string }).source = "forged";
    }).toThrow(TypeError);
    expect(() => {
      (item.transactions as RecordedTransaction[]).push(recorded);
    }).toThrow(TypeError);
    expect(recorded.qtyDelta).toBe(2);
  });

  it("corrects by appending an ADJUSTMENT, leaving the mistaken row intact", () => {
    const wrong = txInput("PURCHASE", 2, { idempotencyKey: "p1" });
    const item = appended(newItem(), wrong);
    const before = serialize(item.transactions);

    const corrected = appended(
      item,
      txInput("ADJUSTMENT", 0.5, {
        qtyDelta: -0.5,
        idempotencyKey: "a1",
        reason: "miscounted at entry",
      }),
    );

    expect(serialize(corrected.transactions.slice(0, 1))).toBe(before);
    expect(corrected.transactions).toHaveLength(2);
    expect(corrected.currentQty.amount).toBe(1.5);
  });
});

describe("derivation & reconciliation (INV-LEDGER-1)", () => {
  it("keeps snapshot, item derivation and lot derivation in agreement", () => {
    let item = newItem({ lots: [{ lotId: "lot-1" }, { lotId: "lot-2" }] });
    const batch = appendTransactions(item, [
      txInput("INITIAL_STOCK", 1.5, { lotId: "lot-1", idempotencyKey: "i1" }),
      txInput("PURCHASE", 2.25, { lotId: "lot-2", idempotencyKey: "p1" }),
      txInput("USE_IN_MEAL", 0.75, { lotId: "lot-1", idempotencyKey: "m1" }),
      txInput("EXPIRE", 0.25, { lotId: "lot-2", idempotencyKey: "e1" }),
    ]);
    item = batch.item;
    expect(batch.results.every((result) => result.status === "appended")).toBe(true);

    expect(item.currentQty.amount).toBe(2.75);
    expect(deriveItemQuantity(item).micros).toBe(item.currentQty.micros);
    expect(deriveLotQuantity(item, "lot-1").amount).toBe(0.75);
    expect(deriveLotQuantity(item, "lot-2").amount).toBe(2);
    const report = reconcile(item);
    expect(report.ok).toBe(true);
    expect(report.driftMicros).toBe(0n);
    expect(report.lots.map((lot) => lot.driftMicros)).toEqual([0n, 0n]);
  });

  it("detects a tampered snapshot", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
    const tampered: InventoryItem = {
      ...item,
      currentQty: { unit: TEST_UNIT, micros: 5_000_000n, amount: 5 },
    };
    const report = reconcile(tampered);
    expect(report.ok).toBe(false);
    expect(report.driftMicros).toBe(3_000_000n);
    expect(report.problems[0]?.code).toBe("CORRUPT_LEDGER");
  });

  it("reports every problem it finds, not just the first", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
    const first = item.transactions[0];
    if (first === undefined) throw new Error("missing row");
    const broken: InventoryItem = {
      ...item,
      currentQty: { unit: TEST_UNIT, micros: 0n, amount: 0 },
      transactions: [{ ...first, lotId: "ghost-lot", unit: "kg" }],
      nextSequence: 7,
    };
    const codes = reconcile(broken).problems.map((problem) => problem.code);
    expect(codes).toContain("CORRUPT_LEDGER");
    expect(codes).toContain("MIXED_UNITS");
    expect(codes).toContain("UNKNOWN_LOT");
  });
});

describe("rehydrateInventoryItem", () => {
  it("rebuilds identical state from stored rows", () => {
    let item = newItem({ lots: [{ lotId: "lot-1" }, { lotId: "lot-2" }] });
    item = appended(item, txInput("PURCHASE", 2, { lotId: "lot-1", idempotencyKey: "p1" }));
    item = appended(item, txInput("USE_IN_MEAL", 3, { lotId: "lot-1", idempotencyKey: "m1" }));
    item = appended(item, txInput("PURCHASE", 1, { lotId: "lot-2", idempotencyKey: "p2" }));

    const rebuilt = rehydrateInventoryItem(
      itemInput({ lots: [{ lotId: "lot-1" }, { lotId: "lot-2" }] }),
      // Stored rows arrive in arbitrary order; sequence is the ordering key.
      [...item.transactions].reverse(),
    );
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(serialize(rebuilt.value)).toBe(serialize(item));
    expect(reconcile(rebuilt.value).ok).toBe(true);
    expect(findByIdempotencyKey(rebuilt.value, "m1")?.sequence).toBe(2);
  });

  it("refuses corrupt stored history", () => {
    const item = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
    const row = item.transactions[0];
    if (row === undefined) throw new Error("missing row");

    const gap = rehydrateInventoryItem(itemInput(), [{ ...row, sequence: 4 }]);
    expect(gap.ok ? null : gap.error.code).toBe("CORRUPT_LEDGER");

    const foreign = rehydrateInventoryItem(itemInput(), [{ ...row, itemId: "other-item" }]);
    expect(foreign.ok ? null : foreign.error.code).toBe("ITEM_MISMATCH");

    const negative = rehydrateInventoryItem(itemInput(), [
      { ...row, type: "CONSUME", qtyDelta: -2, qtyDeltaMicros: -2_000_000n },
    ]);
    expect(negative.ok ? null : negative.error.code).toBe("CORRUPT_LEDGER");
  });

  it("keeps the item id and unit of the shell it is given", () => {
    const rebuilt = rehydrateInventoryItem(itemInput(), []);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.value.itemId).toBe(TEST_ITEM);
    expect(rebuilt.value.currentQty.micros).toBe(0n);
    expect(microsToAmount(rebuilt.value.currentQty.micros)).toBe(0);
  });
});

/**
 * Review fix F2 + R3: rehydration is the corruption detector M1-T2's read path
 * leans on, so it must reject every row `appendTransaction` could not have
 * written — not just structurally broken history.
 */
describe("rehydrateInventoryItem — corruption detection (review F2/R3)", () => {
  const seed = appended(newItem(), txInput("PURCHASE", 2, { idempotencyKey: "p1" }));
  const clean = seed.transactions[0];
  if (clean === undefined) throw new Error("missing seed row");

  function rehydrateOne(overrides: Partial<RecordedTransaction>): string {
    // The cast is the point of the test: these are rows no code path of ours
    // could have produced, arriving from storage.
    const row = { ...clean, ...overrides } as RecordedTransaction;
    const result = rehydrateInventoryItem(itemInput(), [row]);
    return result.ok ? "unexpectedly-accepted" : result.error.code;
  }

  it("F2: rejects a row whose qtyDelta and qtyDeltaMicros disagree", () => {
    // The reviewer's case: 2 lb stored against 2_000_000_000 micro-units would
    // otherwise rehydrate to 1999.25 lb and reconcile as "ok".
    expect(rehydrateOne({ qtyDeltaMicros: 2_000_000_000n })).toBe("CORRUPT_LEDGER");
    expect(rehydrateOne({ qtyDelta: 3 })).toBe("CORRUPT_LEDGER");
  });

  it("rejects a row whose stored qtyDelta is not representable", () => {
    expect(rehydrateOne({ qtyDelta: 0.0000001, qtyDeltaMicros: 0n })).toBe("CORRUPT_LEDGER");
    expect(rehydrateOne({ qtyDelta: Number.NaN })).toBe("CORRUPT_LEDGER");
  });

  it("rejects a zero-delta row", () => {
    expect(rehydrateOne({ qtyDelta: 0, qtyDeltaMicros: 0n })).toBe("CORRUPT_LEDGER");
  });

  it("R3: rejects a delta above the representable range", () => {
    expect(rehydrateOne({ qtyDelta: 1e12, qtyDeltaMicros: 1_000_000_000_000_000_000n })).toBe(
      "CORRUPT_LEDGER",
    );
  });

  it("R3: rejects a sign that contradicts the stored type", () => {
    expect(rehydrateOne({ type: "CONSUME" })).toBe("WRONG_SIGN");
    expect(rehydrateOne({ type: "EXPIRE" })).toBe("WRONG_SIGN");
    expect(rehydrateOne({ type: "PURCHASE", qtyDelta: -2, qtyDeltaMicros: -2_000_000n })).toBe(
      "WRONG_SIGN",
    );
  });

  it("R3: rejects a user-actor row carrying a ledger-authored marker", () => {
    const forgedFlag: RecordedTransaction = {
      ...clean,
      systemFlag: {
        kind: "OVER_CONSUMPTION",
        residualMicros: 2_000_000n,
        residual: 2,
        causedBySequence: 1,
        causedByIdempotencyKey: "p1",
      },
    };
    const flagResult = rehydrateInventoryItem(itemInput(), [forgedFlag]);
    expect(flagResult.ok ? null : flagResult.error.code).toBe("CORRUPT_LEDGER");

    // …and the reserved key namespace is equally off-limits to user rows.
    expect(rehydrateOne({ idempotencyKey: `p1${CLAMP_KEY_SUFFIX}` })).toBe("CORRUPT_LEDGER");
    expect(rehydrateOne({ idempotencyKey: "p1::something-else" })).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("R3: rejects a half-formed clamp row even when the ledger is the actor", () => {
    const ledgerActor = { kind: "system", component: LEDGER_COMPONENT } as const;

    // Reserved key, ledger actor, but no flag.
    expect(rehydrateOne({ actor: ledgerActor, idempotencyKey: `p1${CLAMP_KEY_SUFFIX}` })).toBe(
      "CORRUPT_LEDGER",
    );

    // Flag whose residual does not match the row's own delta.
    expect(
      rehydrateOne({
        actor: ledgerActor,
        type: "ADJUSTMENT",
        idempotencyKey: `p1${CLAMP_KEY_SUFFIX}`,
        systemFlag: {
          kind: "OVER_CONSUMPTION",
          residualMicros: 999n,
          residual: 0.000999,
          causedBySequence: 1,
          causedByIdempotencyKey: "p1",
        },
      }),
    ).toBe("CORRUPT_LEDGER");
  });

  it("accepts a genuine clamp pair produced by the ledger itself", () => {
    let item = appended(newItem(), txInput("PURCHASE", 1, { idempotencyKey: "p1" }));
    item = appended(item, txInput("USE_IN_MEAL", 1.5, { idempotencyKey: "m1" }));
    expect(item.transactions).toHaveLength(3);

    const rebuilt = rehydrateInventoryItem(itemInput(), item.transactions);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(serialize(rebuilt.value)).toBe(serialize(item));
  });
});

/**
 * Review fix F1: `systemFlag` marks a row as authored by the ledger itself.
 * A caller must never be able to set it, and no unknown field may ride along
 * into append-only history.
 */
describe("appendTransaction — recorded rows are built, not copied (review F1)", () => {
  const forged = {
    ...txInput("PURCHASE", 2, { idempotencyKey: "p1" }),
    systemFlag: {
      kind: "OVER_CONSUMPTION",
      residualMicros: 999_000n,
      residual: 0.999,
      causedBySequence: 0,
      causedByIdempotencyKey: "forged",
    },
    smuggledField: "should not be persisted",
    itemId: "some-other-item",
    sequence: 99,
  } as unknown as TransactionInput;

  it("never lets a caller-supplied systemFlag reach a recorded row", () => {
    const result = appendTransaction(newItem(), forged);
    expect(result.status).toBe("appended");
    if (result.status !== "appended") return;

    expect(result.transaction.systemFlag).toBeUndefined();
    expect(result.item.transactions.every((row) => row.systemFlag === undefined)).toBe(true);
    // The forged row must not read as a clamp to any consumer.
    expect(result.clampAdjustment).toBeUndefined();
    expect(serialize(result.item.transactions)).not.toContain("OVER_CONSUMPTION");
  });

  it("drops unknown fields and re-derives ledger-owned ones", () => {
    const result = appendTransaction(newItem(), forged);
    if (result.status !== "appended") throw new Error("expected append");
    const row = result.transaction;

    expect(Object.keys(row)).not.toContain("smuggledField");
    expect(row.itemId).toBe(TEST_ITEM);
    expect(row.sequence).toBe(1);
    expect(serialize(row)).not.toContain("smuggled");
  });

  it("stores copies of nested value objects, leaving the caller's own unfrozen (review R2/F4)", () => {
    const actor: Actor = { kind: "user", userId: "user-dean" };
    const provenance: Provenance = { tier: "KNOWN_FACT", source: "manual-entry" };
    const correlationRef: CorrelationRef = { kind: "meal-log", id: "meal-1" };
    const result = appendTransaction(
      newItem(),
      txInput("PURCHASE", 2, { idempotencyKey: "p1", actor, provenance, correlationRef }),
    );
    if (result.status !== "appended") throw new Error("expected append");

    // Recorded copies are frozen…
    expect(Object.isFrozen(result.transaction.provenance)).toBe(true);
    expect(result.transaction.provenance).not.toBe(provenance);
    expect(result.transaction.actor).not.toBe(actor);
    expect(result.transaction.correlationRef).not.toBe(correlationRef);
    // …while the caller's objects remain its own, mutable, property.
    expect(Object.isFrozen(provenance)).toBe(false);
    expect(Object.isFrozen(actor)).toBe(false);
    expect(Object.isFrozen(correlationRef)).toBe(false);
    // Values still match.
    expect(result.transaction.provenance).toEqual(provenance);
    expect(result.transaction.actor).toEqual(actor);
    expect(result.transaction.correlationRef).toEqual(correlationRef);
  });

  it("keeps qtyDelta and qtyDeltaMicros in agreement by construction", () => {
    const result = appendTransaction(
      newItem(),
      txInput("PURCHASE", 2.25, { idempotencyKey: "p1" }),
    );
    if (result.status !== "appended") throw new Error("expected append");
    expect(result.transaction.qtyDelta).toBe(2.25);
    expect(result.transaction.qtyDeltaMicros).toBe(2_250_000n);
    // Rehydration (which now cross-checks the pair) accepts what append writes.
    const rebuilt = rehydrateInventoryItem(itemInput(), result.item.transactions);
    expect(rebuilt.ok).toBe(true);
  });
});
