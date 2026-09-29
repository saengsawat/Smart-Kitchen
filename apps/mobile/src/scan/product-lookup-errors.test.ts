/**
 * S7 product-lookup error copy (M3-T4e Objective (a)): the wire-code ->
 * copy-deck.md §8 string mapping, independent of any HTTP mocking (see
 * src/api/client.test.ts for the fake-fetch coverage of `lookupProduct`
 * itself producing these errors).
 */
import { describe, expect, it } from "vitest";
import { GENERIC_LEDGER_ERROR_MESSAGE } from "../inventory/errors";
import {
  messageForLookupError,
  NOT_A_BARCODE_MESSAGE,
  PLU_NOT_SUPPORTED_MESSAGE,
  ProductLookupRefusedError,
} from "./product-lookup-errors";

describe("messageForLookupError", () => {
  it("PLU_NOT_SUPPORTED renders copy-deck.md §8 verbatim", () => {
    expect(messageForLookupError(new ProductLookupRefusedError("PLU_NOT_SUPPORTED"))).toBe(
      "Produce codes can't be looked up by barcode yet. Add this item by hand.",
    );
    expect(messageForLookupError(new ProductLookupRefusedError("PLU_NOT_SUPPORTED"))).toBe(
      PLU_NOT_SUPPORTED_MESSAGE,
    );
  });

  it("BAD_REQUEST renders copy-deck.md §8 verbatim", () => {
    expect(messageForLookupError(new ProductLookupRefusedError("BAD_REQUEST"))).toBe(
      "That isn't a barcode number we can look up.",
    );
    expect(messageForLookupError(new ProductLookupRefusedError("BAD_REQUEST"))).toBe(
      NOT_A_BARCODE_MESSAGE,
    );
  });

  it("401/403 and any other refusal code fall through to the generic fallback, never a raw code or message", () => {
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "INTERNAL", ""]) {
      expect(messageForLookupError(new ProductLookupRefusedError(code))).toBe(
        GENERIC_LEDGER_ERROR_MESSAGE,
      );
    }
  });

  it("a plain network/parse failure (not a ProductLookupRefusedError) also renders the generic fallback", () => {
    expect(messageForLookupError(new Error("network down"))).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
    expect(messageForLookupError("not even an Error")).toBe(GENERIC_LEDGER_ERROR_MESSAGE);
  });

  it("never leaks the server's own message onto the screen", () => {
    const error = new ProductLookupRefusedError("PLU_NOT_SUPPORTED");
    // The Error's own .message is a diagnostic string for logs, not what
    // messageForLookupError returns — asserted here so nobody "simplifies"
    // this to `error.message` later.
    expect(error.message).not.toBe(PLU_NOT_SUPPORTED_MESSAGE);
    expect(messageForLookupError(error)).toBe(PLU_NOT_SUPPORTED_MESSAGE);
  });
});
