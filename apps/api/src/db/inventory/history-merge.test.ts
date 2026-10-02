/**
 * The history merge rule (M2-T6), without a database: ledger rows keep their
 * sequence order, a move goes before the first ledger row recorded after it,
 * a tie puts the ledger row first, and moves among themselves go by time then
 * id. Deterministic: the same inputs give the same order, whatever order the
 * moves arrive in.
 */

import { describe, expect, it } from "vitest";
import { mergeMovesIntoHistory, type TimedEntry, type TimedMove } from "./history-merge.js";

const T = (second: number, micros = 0): string =>
  `2026-10-01T12:00:${String(second).padStart(2, "0")}.${String(micros).padStart(6, "0")}Z`;

const ledger = (...rows: [string, string][]): TimedEntry<string>[] =>
  rows.map(([at, value]) => ({ at, value }));

const moves = (...rows: [string, string, string][]): TimedMove<string>[] =>
  rows.map(([at, id, value]) => ({ at, id, value }));

describe("mergeMovesIntoHistory", () => {
  it("with no moves, returns the ledger rows untouched and in order", () => {
    expect(mergeMovesIntoHistory(ledger([T(1), "L1"], [T(2), "L2"]), [])).toEqual(["L1", "L2"]);
  });

  it("with no ledger rows, returns the moves oldest first", () => {
    expect(mergeMovesIntoHistory([], moves([T(5), "b", "M2"], [T(3), "a", "M1"]))).toEqual([
      "M1",
      "M2",
    ]);
  });

  it("puts a move between the ledger rows recorded before and after it", () => {
    expect(
      mergeMovesIntoHistory(ledger([T(1), "L1"], [T(3), "L2"]), moves([T(2), "m", "M"])),
    ).toEqual(["L1", "M", "L2"]);
  });

  it("puts a move after every ledger row when it is the newest, and before every row when it is the oldest", () => {
    const rows = ledger([T(2), "L1"], [T(3), "L2"]);
    expect(mergeMovesIntoHistory(rows, moves([T(9), "m", "M"]))).toEqual(["L1", "L2", "M"]);
    expect(mergeMovesIntoHistory(rows, moves([T(1), "m", "M"]))).toEqual(["M", "L1", "L2"]);
  });

  it("on a tie to the microsecond, the ledger row comes first", () => {
    expect(mergeMovesIntoHistory(ledger([T(2, 500), "L1"]), moves([T(2, 500), "m", "M"]))).toEqual([
      "L1",
      "M",
    ]);
  });

  it("separates events inside one millisecond (microsecond precision)", () => {
    // 12:00:02.000100 and .000900 are the same JS millisecond.
    expect(mergeMovesIntoHistory(ledger([T(2, 900), "L1"]), moves([T(2, 100), "m", "M"]))).toEqual([
      "M",
      "L1",
    ]);
  });

  it("orders moves among themselves by time, then by id, whatever order they arrive in", () => {
    const a = moves([T(4), "z", "Mz"], [T(4), "a", "Ma"], [T(2), "q", "Mq"]);
    const b = [...a].reverse();
    const expected = ["Mq", "Ma", "Mz"];
    expect(mergeMovesIntoHistory([], a)).toEqual(expected);
    expect(mergeMovesIntoHistory([], b)).toEqual(expected);
  });

  it("never re-sorts ledger rows against each other, even when their timestamps run backwards", () => {
    // Sequence order is authoritative (domain-model.md §2): L2 was appended
    // second although its clock reads earlier.
    expect(
      mergeMovesIntoHistory(ledger([T(5), "L1"], [T(3), "L2"]), moves([T(4), "m", "M"])),
    ).toEqual(["M", "L1", "L2"]);
  });

  it("interleaves several moves with several ledger rows", () => {
    expect(
      mergeMovesIntoHistory(
        ledger([T(1), "L1"], [T(4), "L2"], [T(7), "L3"]),
        moves([T(2), "a", "M1"], [T(3), "b", "M2"], [T(8), "c", "M3"]),
      ),
    ).toEqual(["L1", "M1", "M2", "L2", "L3", "M3"]);
  });
});
