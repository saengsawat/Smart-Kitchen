/**
 * BUG-006: which amount a shopping row answers with as `buyMicros`.
 *
 * Pure: `rowBuyMicros` takes what the row SQL joined on, so no database is
 * needed. The DB suite (`shopping-http.db.test.ts`) proves the join itself.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LedgerIntegrityError } from "../inventory/write-service.js";
import { rowBuyMicros, type LandedPurchase } from "./service.js";

const NONE: LandedPurchase = {
  addedTransactionId: null,
  purchaseMicros: null,
  purchaseUnit: null,
  purchaseType: null,
};

function landed(micros: string, unit = "lb", type = "PURCHASE"): LandedPurchase {
  return {
    addedTransactionId: "11111111-1111-4111-8111-111111111111",
    purchaseMicros: micros,
    purchaseUnit: unit,
    purchaseType: type,
  };
}

describe("rowBuyMicros (BUG-006)", () => {
  it("before a PURCHASE lands, answers the live gap unchanged, zero included", () => {
    expect(rowBuyMicros("lb", NONE, 750_000n)).toBe(750_000n);
    expect(rowBuyMicros("lb", NONE, 0n)).toBe(0n);
  });

  it("once a PURCHASE has landed, answers its ledger amount, not the live gap (chicken: 0.75 lb, live gap 0)", () => {
    expect(rowBuyMicros("lb", landed("750000"), 0n)).toBe(750_000n);
  });

  it("the landed amount wins whatever the live gap is (stock rose, or an undo took it back down)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (bought, live) => {
          expect(rowBuyMicros("oz", landed(bought.toString(), "oz"), live)).toBe(bought);
        },
      ),
    );
  });

  it("a row naming a PURCHASE the join did not find fails loudly, never falls back to the live gap", () => {
    const missing: LandedPurchase = { ...NONE, addedTransactionId: landed("1").addedTransactionId };
    expect(() => rowBuyMicros("lb", missing, 750_000n)).toThrow(LedgerIntegrityError);
  });

  it("refuses a landed row that is not a positive PURCHASE in the row's unit", () => {
    expect(() => rowBuyMicros("lb", landed("750000", "oz"), 0n)).toThrow(LedgerIntegrityError);
    expect(() => rowBuyMicros("lb", landed("750000", "lb", "ADJUSTMENT"), 0n)).toThrow(
      LedgerIntegrityError,
    );
    expect(() => rowBuyMicros("lb", landed("0"), 0n)).toThrow(LedgerIntegrityError);
    expect(() => rowBuyMicros("lb", landed("-750000"), 0n)).toThrow(LedgerIntegrityError);
  });
});
