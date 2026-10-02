/**
 * How a confirmed AI proposal reads (M2-T5, D-028): the pure presentation rule
 * both read paths share. The end-to-end reads are asserted over real rows in
 * `confirmations.test.ts` and `http/inventory-confirm.db.test.ts`.
 */

import type { FieldProvenanceDto } from "@smart-kitchen/contracts";
import { describe, expect, it } from "vitest";
import { confirmedProvenance, confirmedSource } from "./confirmed-provenance.js";

const AI_ROW: FieldProvenanceDto = {
  tier: "AI_INTERPRETATION",
  source: "receipt read “ORG STRWB 1LB”",
  confidence: "0.620000",
  recordedAt: "2026-09-01T12:00:00.000Z",
};

describe("confirmedSource", () => {
  it("joins the original source and the confirmer's initials", () => {
    expect(confirmedSource("receipt read “ORG STRWB 1LB”", "Dean Chen")).toBe(
      "receipt read “ORG STRWB 1LB” · confirmed by DC",
    );
  });

  it("never carries the confirmer's name, only the chip", () => {
    expect(confirmedSource("receipt", "Maya Chen")).not.toContain("Maya");
  });

  it("still says confirmed when the confirmer cannot be shown", () => {
    expect(confirmedSource("receipt", null)).toBe("receipt · confirmed");
    expect(confirmedSource("receipt", "   ")).toBe("receipt · confirmed");
  });
});

describe("confirmedProvenance", () => {
  it("presents a confirmed AI row as KNOWN_FACT with the confirmed-by source", () => {
    expect(
      confirmedProvenance(AI_ROW, { confirmed: true, confirmerDisplayName: "Dean Chen" }),
    ).toEqual({
      tier: "KNOWN_FACT",
      source: "receipt read “ORG STRWB 1LB” · confirmed by DC",
      confidence: "0.620000",
      recordedAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("leaves an unconfirmed AI row exactly as stored", () => {
    expect(confirmedProvenance(AI_ROW, { confirmed: false, confirmerDisplayName: null })).toBe(
      AI_ROW,
    );
  });

  it.each(["ESTIMATED", "KNOWN_FACT"] as const)(
    "never promotes or relabels a %s row, even if a confirmation is somehow there",
    (tier) => {
      const stored: FieldProvenanceDto = { ...AI_ROW, tier, source: "manual-entry" };
      expect(
        confirmedProvenance(stored, { confirmed: true, confirmerDisplayName: "Dean Chen" }),
      ).toBe(stored);
    },
  );
});
