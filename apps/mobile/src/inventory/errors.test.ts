import { describe, expect, it } from "vitest";
import { GENERIC_LEDGER_ERROR_MESSAGE, messageForLedgerError, ZERO_DELTA_MESSAGE } from "./errors";
import { ZeroDeltaError } from "./ledger";

describe("messageForLedgerError (review F3, copy-deck.md §8)", () => {
  it("a ZeroDeltaError gets its own copy-deck.md §8 sentence", () => {
    expect(messageForLedgerError(new ZeroDeltaError())).toBe(ZERO_DELTA_MESSAGE);
  });

  it("any other Error gets the generic fallback, never its own message", () => {
    expect(messageForLedgerError(new Error("unknown itemId not-a-real-item"))).toBe(
      GENERIC_LEDGER_ERROR_MESSAGE,
    );
  });

  it("a non-Error rejection also gets the generic fallback", () => {
    expect(messageForLedgerError("network down")).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });
});
