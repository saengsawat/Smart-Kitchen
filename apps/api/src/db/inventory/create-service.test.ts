/**
 * Item-creation validation (M2-T3 (e)), without a database.
 *
 * Every branch of `planCreation` is a refusal a client can trigger, so the
 * cheap honest way to cover them is to call it directly. The same refusals
 * over HTTP, and the transaction behaviour, are in `http/households.db.test.ts`.
 */

import { CREATE_ITEM_UNITS_DTO } from "@smart-kitchen/contracts";
import { lookupUnit } from "@smart-kitchen/domain";
import { describe, expect, it } from "vitest";
import {
  BARCODE_SCAN_SOURCE,
  canonicalBestBy,
  MANUAL_ENTRY_CREATE_SOURCE,
  planCreation,
  type CreateItemCommand,
} from "./create-service.js";
import { LedgerWriteRejectedError } from "./write-service.js";

const BASE: CreateItemCommand = {
  idempotencyKey: "create-1",
  source: "BARCODE",
  displayName: "Greek yogurt",
  storageLocation: "FRIDGE",
  unit: "g",
  amount: "907",
  quantityProvenance: {
    tier: "KNOWN_FACT",
    source: "scanned barcode",
    confidence: null,
    recordedAt: null,
  },
  productRef: "dairy-011",
  bestByDate: "2026-10-12T00:00:00.000Z",
  bestByProvenance: { tier: "ESTIMATED", source: "shelf-life", confidence: null, recordedAt: null },
  recordedAt: "2026-09-29T12:00:00.000Z",
  actorUserId: "f1c70001-0000-4000-8000-000000000001",
};

function withoutProductRef(command: CreateItemCommand): CreateItemCommand {
  const copy: { -readonly [K in keyof CreateItemCommand]?: CreateItemCommand[K] } = { ...command };
  delete copy.productRef;
  return copy as CreateItemCommand;
}

function refusal(command: CreateItemCommand): { code: string; field: string | undefined } {
  try {
    planCreation(command);
  } catch (error) {
    if (error instanceof LedgerWriteRejectedError) {
      return { code: error.ledgerError.code, field: error.ledgerError.field };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("planCreation: what gets stored", () => {
  it("a scanned item is a PURCHASE in exact micros, keyed into the planner namespace", () => {
    const planned = planCreation(BASE);
    expect(planned.type).toBe("PURCHASE");
    expect(planned.micros).toBe(907_000_000n);
    expect(planned.ledgerKey).toBe("create-1/lot/0");
    expect(planned.provenanceSource).toBe(BARCODE_SCAN_SOURCE);
    expect(planned.productRef).toBe("dairy-011");
  });

  it("a manual item is INITIAL_STOCK with the manual-entry source and no product", () => {
    const planned = planCreation({
      ...withoutProductRef(BASE),
      source: "MANUAL",
      bestByDate: null,
      bestByProvenance: null,
    });
    expect(planned.type).toBe("INITIAL_STOCK");
    expect(planned.provenanceSource).toBe(MANUAL_ENTRY_CREATE_SOURCE);
    expect(planned.productRef).toBeNull();
    expect(planned.expiresAt).toBeNull();
    expect(planned.expiryTier).toBeNull();
  });

  it("passes the best-by tier through, whichever tier it is, and never invents one", () => {
    for (const tier of ["KNOWN_FACT", "ESTIMATED", "AI_INTERPRETATION"] as const) {
      const planned = planCreation({
        ...BASE,
        bestByProvenance: { tier, source: null, confidence: null, recordedAt: null },
      });
      expect(planned.expiryTier).toBe(tier);
    }
    const none = planCreation({ ...BASE, bestByDate: null, bestByProvenance: null });
    expect(none.expiryTier).toBeNull();
  });

  it("records the quantity tier as sent (Known Fact or Estimated)", () => {
    expect(planCreation(BASE).tier).toBe("KNOWN_FACT");
    const estimated = planCreation({
      ...BASE,
      quantityProvenance: { ...BASE.quantityProvenance, tier: "ESTIMATED" },
    });
    expect(estimated.tier).toBe("ESTIMATED");
  });

  it("trims the display name and canonicalises the best-by instant", () => {
    const planned = planCreation({
      ...BASE,
      displayName: "  Greek yogurt  ",
      bestByDate: "2026-10-12",
    });
    expect(planned.displayName).toBe("Greek yogurt");
    expect(planned.expiresAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("keeps fractional amounts exact", () => {
    expect(planCreation({ ...BASE, amount: "0.000001" }).micros).toBe(1n);
    expect(planCreation({ ...BASE, amount: "1.25" }).micros).toBe(1_250_000n);
  });

  it("accepts every unit the create list offers", () => {
    for (const unit of CREATE_ITEM_UNITS_DTO) {
      expect(planCreation({ ...BASE, unit }).unit).toBe(unit);
    }
  });
});

describe("planCreation: refusals", () => {
  it.each([
    ["a key with the ledger's separator", { idempotencyKey: "a::b" }, "INVALID_IDEMPOTENCY_KEY"],
    ["a key in the lot namespace", { idempotencyKey: "a/lot/0" }, "INVALID_IDEMPOTENCY_KEY"],
    ["a key with a space", { idempotencyKey: "a b" }, "INVALID_IDEMPOTENCY_KEY"],
    ["a blank name", { displayName: "   " }, "INVALID_FIELD"],
    ["an over-long name", { displayName: "y".repeat(121) }, "INVALID_FIELD"],
    ["a name with a control character", { displayName: "yog\u0000urt" }, "INVALID_FIELD"],
    ["a unit the registry knows but no screen offers", { unit: "gal" }, "INVALID_FIELD"],
    ["an unknown unit", { unit: "handful" }, "INVALID_FIELD"],
    ["fl oz (deliberately unsupported by the registry)", { unit: "fl oz" }, "INVALID_FIELD"],
    ["a zero amount", { amount: "0" }, "ZERO_DELTA"],
    ["a negative amount", { amount: "-1" }, "WRONG_SIGN"],
    ["a float-ish amount", { amount: "1e3" }, "INVALID_FIELD"],
    ["seven decimal places", { amount: "0.0000001" }, "PRECISION_EXCEEDED"],
    ["an amount past the ledger range", { amount: "100000001" }, "QUANTITY_OUT_OF_RANGE"],
    ["a scan with no product", { productRef: undefined }, "INVALID_FIELD"],
    ["a best-by with no tier", { bestByProvenance: null }, "INVALID_FIELD"],
    ["a tier with no best-by", { bestByDate: null }, "INVALID_FIELD"],
    ["an unparseable best-by", { bestByDate: "next tuesday" }, "INVALID_TIMESTAMP"],
    // Review F1: Date.parse accepted these and read them in the host's zone.
    ["a bare number as best-by", { bestByDate: "1" }, "INVALID_TIMESTAMP"],
    ["a month and day as best-by", { bestByDate: "March 7" }, "INVALID_TIMESTAMP"],
    ["a local time with no offset", { bestByDate: "2026-10-12T00:00:00" }, "INVALID_TIMESTAMP"],
    ["a date that does not exist", { bestByDate: "2026-02-30" }, "INVALID_TIMESTAMP"],
    ["a slashed date", { bestByDate: "2026/10/12" }, "INVALID_TIMESTAMP"],
  ] as const)("refuses %s", (_case, override, code) => {
    const command: CreateItemCommand = { ...BASE, ...override };
    if ("productRef" in override && override.productRef === undefined) {
      expect(refusal(withoutProductRef(command)).code).toBe(code);
      return;
    }
    expect(refusal(command).code).toBe(code);
  });

  it("refuses an AI interpretation as the first quantity fact (rule 8)", () => {
    expect(
      refusal({
        ...BASE,
        quantityProvenance: { ...BASE.quantityProvenance, tier: "AI_INTERPRETATION" },
      }),
    ).toEqual({ code: "INVALID_FIELD", field: "quantityProvenance" });
  });

  it("refuses a client-chosen confidence or recordedAt on the quantity", () => {
    expect(
      refusal({ ...BASE, quantityProvenance: { ...BASE.quantityProvenance, confidence: "0.9" } })
        .field,
    ).toBe("quantityProvenance");
    expect(
      refusal({
        ...BASE,
        quantityProvenance: { ...BASE.quantityProvenance, recordedAt: "2020-01-01T00:00:00Z" },
      }).field,
    ).toBe("quantityProvenance");
  });

  it("refuses a product on a manual item", () => {
    expect(refusal({ ...BASE, source: "MANUAL" })).toEqual({
      code: "INVALID_FIELD",
      field: "productRef",
    });
  });
});

describe("canonicalBestBy (review F1)", () => {
  it("reads a bare date as UTC midnight, whatever the host's zone", () => {
    expect(canonicalBestBy("2026-10-12")).toBe("2026-10-12T00:00:00.000Z");
  });

  it("canonicalises an instant with an offset to UTC", () => {
    expect(canonicalBestBy("2026-10-12T02:00:00+02:00")).toBe("2026-10-12T00:00:00.000Z");
    expect(canonicalBestBy("2026-10-12T00:00:00.000Z")).toBe("2026-10-12T00:00:00.000Z");
  });

  it.each([["1"], ["March 7"], ["2026-10-12T00:00:00"], ["2026-02-30"], [""], ["2026-13-01"]])(
    "refuses %j",
    (text) => {
      expect(canonicalBestBy(text)).toBeUndefined();
    },
  );
});

describe("the create unit list against the domain registry", () => {
  it("every unit resolves", () => {
    for (const unit of CREATE_ITEM_UNITS_DTO) expect(lookupUnit(unit).ok, unit).toBe(true);
  });
});
