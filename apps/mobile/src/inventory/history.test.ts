/**
 * S5's history view model (M2-T6): moves are told apart from ledger rows, the
 * "Move to" chips offer exactly the other locations, the row wording, and the
 * fixture's merge rule (the same rule as the API's `history-merge.ts`).
 */
import { describe, expect, it } from "vitest";
import type {
  InventoryMoveEntryDto,
  InventoryTransactionDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import {
  isMoveEntry,
  ledgerRowsOf,
  mergeMovesIntoDetailHistory,
  movedRowCaption,
  movedRowTitle,
  otherLocations,
} from "./history";

function ledgerRow(id: string, recordedAt: string): InventoryTransactionDto {
  return {
    transactionId: id,
    type: "PURCHASE",
    deltaMicros: "1000000",
    amount: "1",
    recordedAt,
    actor: { kind: "user", displayInitials: "DC" },
    provenance: { tier: "KNOWN_FACT", source: "manual-entry", confidence: null, recordedAt: null },
    reason: null,
  };
}

function move(
  id: string,
  recordedAt: string,
  from: StorageLocationDto | null,
  to: StorageLocationDto,
): InventoryMoveEntryDto {
  return {
    type: "MOVED",
    moveId: id,
    fromLocation: from,
    toLocation: to,
    recordedAt,
    actor: { kind: "user", displayInitials: "DC" },
  };
}

describe("isMoveEntry / ledgerRowsOf", () => {
  it("tells a move from a ledger row and keeps only ledger rows for quantity work", () => {
    const rows = [ledgerRow("a", "2026-10-01T10:00:00.000Z")];
    const entries = [rows[0]!, move("m", "2026-10-01T11:00:00.000Z", "FRIDGE", "PANTRY")];
    expect(entries.map(isMoveEntry)).toEqual([false, true]);
    expect(ledgerRowsOf(entries)).toEqual(rows);
  });
});

describe("otherLocations", () => {
  it.each<[StorageLocationDto | null, StorageLocationDto[]]>([
    ["FRIDGE", ["FREEZER", "PANTRY", "OTHER"]],
    ["FREEZER", ["FRIDGE", "PANTRY", "OTHER"]],
    ["PANTRY", ["FRIDGE", "FREEZER", "OTHER"]],
    ["OTHER", ["FRIDGE", "FREEZER", "PANTRY"]],
    [null, ["FRIDGE", "FREEZER", "PANTRY", "OTHER"]],
  ])("from %s offers %j", (current, expected) => {
    expect(otherLocations(current)).toEqual(expected);
  });
});

describe("row wording", () => {
  it("reads 'Moved to Pantry' with the source as its caption, and no caption for an unassigned source", () => {
    const entry = move("m", "2026-10-01T11:00:00.000Z", "FRIDGE", "PANTRY");
    expect(movedRowTitle(entry)).toBe("Moved to Pantry");
    expect(movedRowCaption(entry)).toBe("from Fridge");
    expect(movedRowCaption(move("m2", "2026-10-01T11:00:00.000Z", null, "OTHER"))).toBeNull();
    expect(movedRowTitle(move("m2", "2026-10-01T11:00:00.000Z", null, "OTHER"))).toBe(
      "Moved to Other",
    );
  });
});

describe("mergeMovesIntoDetailHistory", () => {
  const L1 = ledgerRow("L1", "2026-10-01T10:00:00.000Z");
  const L2 = ledgerRow("L2", "2026-10-01T12:00:00.000Z");

  it("with no moves, returns the ledger rows as they were", () => {
    expect(mergeMovesIntoDetailHistory([L1, L2], [])).toEqual([L1, L2]);
  });

  it("places a move between the rows recorded before and after it", () => {
    const m = move("m", "2026-10-01T11:00:00.000Z", "FRIDGE", "PANTRY");
    expect(mergeMovesIntoDetailHistory([L1, L2], [m])).toEqual([L1, m, L2]);
  });

  it("puts a newer move last and an older one first", () => {
    const late = move("late", "2026-10-01T13:00:00.000Z", "FRIDGE", "PANTRY");
    const early = move("early", "2026-10-01T09:00:00.000Z", "FRIDGE", "PANTRY");
    expect(mergeMovesIntoDetailHistory([L1, L2], [late])).toEqual([L1, L2, late]);
    expect(mergeMovesIntoDetailHistory([L1, L2], [early])).toEqual([early, L1, L2]);
  });

  it("on a tie the ledger row comes first, and moves order by time then id whatever order they arrive in", () => {
    const tie = move("tie", "2026-10-01T10:00:00.000Z", "FRIDGE", "PANTRY");
    expect(mergeMovesIntoDetailHistory([L1], [tie])).toEqual([L1, tie]);

    const b = move("b", "2026-10-01T14:00:00.000Z", "PANTRY", "FREEZER");
    const a = move("a", "2026-10-01T14:00:00.000Z", "FRIDGE", "PANTRY");
    expect(mergeMovesIntoDetailHistory([], [b, a])).toEqual([a, b]);
    expect(mergeMovesIntoDetailHistory([], [a, b])).toEqual([a, b]);
  });

  it("never re-sorts ledger rows against each other", () => {
    const backwards = [
      ledgerRow("first", "2026-10-01T12:00:00.000Z"),
      ledgerRow("second", "2026-10-01T10:00:00.000Z"),
    ];
    const m = move("m", "2026-10-01T11:00:00.000Z", "FRIDGE", "PANTRY");
    expect(mergeMovesIntoDetailHistory(backwards, [m])).toEqual([m, backwards[0], backwards[1]]);
  });
});
