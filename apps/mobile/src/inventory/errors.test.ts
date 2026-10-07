import { describe, expect, it } from "vitest";
import { LEDGER_ERROR_CODES_DTO } from "@smart-kitchen/contracts";
import {
  ApiError,
  COUNT_NOT_WHOLE_MESSAGE,
  GENERIC_LEDGER_ERROR_MESSAGE,
  LedgerRefusedError,
  ledgerErrorMessage,
  messageForLedgerError,
  ZERO_DELTA_MESSAGE,
} from "./errors";
import { ZeroDeltaError } from "./ledger";

describe("messageForLedgerError (review F3, M3-T4a, copy-deck.md §8)", () => {
  it("a ZeroDeltaError gets its own copy-deck.md §8 sentence", () => {
    expect(messageForLedgerError(new ZeroDeltaError())).toBe(ZERO_DELTA_MESSAGE);
  });

  it("a LedgerRefusedError renders through ledgerErrorMessage keyed off its code", () => {
    expect(messageForLedgerError(new LedgerRefusedError("ZERO_DELTA"))).toBe(ZERO_DELTA_MESSAGE);
    expect(messageForLedgerError(new LedgerRefusedError("MIXED_UNITS"))).toBe(
      GENERIC_LEDGER_ERROR_MESSAGE,
    );
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

describe("ledgerErrorMessage (BACKLOG.md M3-T4a: every LEDGER_ERROR_CODES_DTO plus the API-level codes)", () => {
  const USER_FACING_CODES = [
    "ZERO_DELTA",
    "WRONG_SIGN",
    "QUANTITY_OUT_OF_RANGE",
    "PRECISION_EXCEEDED",
    "INVALID_TIMESTAMP",
    "TIMESTAMP_ORDER",
    "UNKNOWN_LOT",
  ] as const;

  // IDEMPOTENCY_KEY_CONFLICT is a LedgerErrorCodeDto too, but every wire
  // occurrence of it is the 409 conflict path, which gets its own sentence
  // (see ledgerErrorMessage's doc comment) rather than the generic fallback
  // the ledger table's "internal-only" classification would otherwise imply.
  const INTERNAL_ONLY_LEDGER_CODES = LEDGER_ERROR_CODES_DTO.filter(
    (code) =>
      !(USER_FACING_CODES as readonly string[]).includes(code) &&
      code !== "IDEMPOTENCY_KEY_CONFLICT",
  );

  it("every LEDGER_ERROR_CODES_DTO entry is classified (user-facing sentence, the 409-conflict override, or the generic fallback)", () => {
    expect(LEDGER_ERROR_CODES_DTO.length).toBe(
      USER_FACING_CODES.length + INTERNAL_ONLY_LEDGER_CODES.length + 1,
    );
  });

  it.each(USER_FACING_CODES)(
    "%s renders its own copy-deck.md §8 sentence, not the fallback",
    (code) => {
      const message = ledgerErrorMessage(code);
      expect(message).not.toBe(GENERIC_LEDGER_ERROR_MESSAGE);
      expect(message.length).toBeGreaterThan(0);
    },
  );

  it.each(INTERNAL_ONLY_LEDGER_CODES)(
    "%s (internal-only) falls through to the generic fallback",
    (code) => {
      expect(ledgerErrorMessage(code)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
    },
  );

  it("IDEMPOTENCY_KEY_CONFLICT renders the API-level conflict sentence, not the ledger table's generic classification", () => {
    expect(ledgerErrorMessage("IDEMPOTENCY_KEY_CONFLICT")).toBe(
      "That request was already used for a different change, so it was not applied again.",
    );
  });

  it("UNDO_NOT_POSSIBLE renders its own sentence", () => {
    expect(ledgerErrorMessage("UNDO_NOT_POSSIBLE")).toBe(
      "That change can't be undone. The stock it added has already been used.",
    );
  });

  it("NOT_FOUND renders its own sentence", () => {
    expect(ledgerErrorMessage("NOT_FOUND")).toBe("Not found.");
  });

  it("an unrecognised code, null, or undefined all fall through to the generic fallback", () => {
    expect(ledgerErrorMessage("SOMETHING_NEW")).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
    expect(ledgerErrorMessage(null)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
    expect(ledgerErrorMessage(undefined)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });

  it("the domain message is never shown: only the fixed sentence, regardless of any Error.message text", () => {
    const error = new LedgerRefusedError("QUANTITY_OUT_OF_RANGE");
    expect(messageForLedgerError(error)).not.toContain(error.message);
  });
});

describe("ApiError (M3-T12)", () => {
  it("carries the typed code and the HTTP status; LedgerRefusedError is an ApiError", () => {
    const error = new LedgerRefusedError("COUNT_NOT_WHOLE", 400);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(LedgerRefusedError);
    expect(error.code).toBe("COUNT_NOT_WHOLE");
    expect(error.status).toBe(400);
    expect(new ApiError("NOT_FOUND").status).toBeUndefined();
  });

  it("a wire code the contracts do not list becomes INTERNAL and renders the generic fallback", () => {
    const error = new ApiError("SOME_FUTURE_CODE", 500);
    expect(error.code).toBe("INTERNAL");
    expect(messageForLedgerError(error)).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });

  // Copy-deck.md §8, verbatim, one row per code: nothing renders a different sentence.
  it.each([
    ["ZERO_DELTA", "Enter an amount to record a change."],
    ["COUNT_NOT_WHOLE", "Use a whole number for this item."],
    ["QUANTITY_OUT_OF_RANGE", "That amount looks too large. Double check it."],
    ["PRECISION_EXCEEDED", "Enter the amount with fewer decimal places."],
    ["INVALID_TIMESTAMP", "That date doesn't look right. Check it and try again."],
    ["TIMESTAMP_ORDER", "That date is in the future. Enter when it actually happened."],
    ["UNKNOWN_LOT", "This batch isn't available anymore. Refresh and try again."],
    [
      "IDEMPOTENCY_KEY_CONFLICT",
      "That request was already used for a different change, so it was not applied again.",
    ],
    ["UNDO_NOT_POSSIBLE", "That change can't be undone. The stock it added has already been used."],
    ["NOT_FOUND", "Not found."],
    ["MIXED_UNITS", GENERIC_LEDGER_ERROR_MESSAGE],
    ["SAME_LOCATION", GENERIC_LEDGER_ERROR_MESSAGE],
    ["INTERNAL", GENERIC_LEDGER_ERROR_MESSAGE],
  ])("%s renders its sentence through messageForLedgerError", (code, sentence) => {
    expect(messageForLedgerError(new ApiError(code, 400))).toBe(sentence);
    expect(messageForLedgerError(new LedgerRefusedError(code, 400))).toBe(sentence);
  });

  it("WRONG_SIGN keeps its action placeholder default", () => {
    expect(messageForLedgerError(new ApiError("WRONG_SIGN", 400))).toBe(
      "That doesn't match what you're doing. Check the amount and try again.",
    );
  });

  it("COUNT_NOT_WHOLE_MESSAGE is the §8 sentence", () => {
    expect(COUNT_NOT_WHOLE_MESSAGE).toBe("Use a whole number for this item.");
  });
});
