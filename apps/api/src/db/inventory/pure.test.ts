/**
 * Pure-helper unit tests (M1-T10-f).
 *
 * `microsToDecimalText` (repository.ts), `canonicalizeInstant`,
 * `toRecordedTransaction`, `toStorageLocation` and `toExpiryTier` (mapping.ts)
 * do no I/O — they are plain functions over strings/bigints/rows already in
 * memory — but until now they were only ever exercised indirectly, behind
 * `DATABASE_URL`-gated suites (constraints.test.ts, ledger-roundtrip.test.ts,
 * …). That meant a `pnpm test` run with no database configured — the default
 * developer experience per test-support/harness.ts — never actually ran a
 * single assertion against these functions. This file runs unconditionally,
 * no `dbTestsEnabled` guard anywhere in it, and no behaviour changes: every
 * case here is something the DB-gated suites already implied indirectly,
 * pinned directly and cheaply instead.
 */

import { describe, expect, it } from "vitest";
import { microsToDecimalText, pgConstraint, pgErrorCode } from "./repository.js";
import {
  canonicalizeInstant,
  toExpiryTier,
  toRecordedTransaction,
  toStorageLocation,
  type InventoryTransactionRow,
} from "./mapping.js";

describe("microsToDecimalText (repository.ts)", () => {
  it("renders a whole number with no fractional part", () => {
    expect(microsToDecimalText(2_000_000n)).toBe("2");
  });

  it("renders a fractional value as the full 6-digit micros fraction, never stripped", () => {
    expect(microsToDecimalText(1_250_000n)).toBe("1.250000");
  });

  it("pads a small fractional remainder to 6 digits", () => {
    expect(microsToDecimalText(1_000_001n)).toBe("1.000001");
  });

  it("renders exactly zero with no sign and no fractional part", () => {
    expect(microsToDecimalText(0n)).toBe("0");
  });

  it("renders a negative value with a single leading minus, never on the fractional part alone", () => {
    expect(microsToDecimalText(-1_250_000n)).toBe("-1.250000");
    expect(microsToDecimalText(-1_000_000n)).toBe("-1");
  });

  it("is built from integer arithmetic, not division — 100000+200000 micros is exactly 0.3", () => {
    // A float-division implementation (0.1 + 0.2, effectively) is the classic
    // case IEEE754 gets wrong; this function never divides at all, so the
    // two ways of arriving at 300_000n agree exactly.
    expect(microsToDecimalText(100_000n + 200_000n)).toBe("0.300000");
    expect(microsToDecimalText(300_000n)).toBe("0.300000");
  });
});

describe("pgErrorCode / pgConstraint (repository.ts)", () => {
  it("reads a string code/constraint off a driver-shaped error", () => {
    const error = { code: "23505", constraint: "inventory_transactions_idempotency_key" };
    expect(pgErrorCode(error)).toBe("23505");
    expect(pgConstraint(error)).toBe("inventory_transactions_idempotency_key");
  });

  it("returns undefined for anything that is not a Postgres driver error", () => {
    for (const notAnError of [undefined, null, "boom", 42, new Error("plain")]) {
      expect(pgErrorCode(notAnError)).toBeUndefined();
      expect(pgConstraint(notAnError)).toBeUndefined();
    }
  });

  it("returns undefined when the field is present but not a string", () => {
    expect(pgErrorCode({ code: 500 })).toBeUndefined();
    expect(pgConstraint({ constraint: null })).toBeUndefined();
  });
});

describe("canonicalizeInstant (mapping.ts)", () => {
  it("rewrites a non-UTC offset to the equivalent Z instant", () => {
    expect(canonicalizeInstant("2026-03-06T20:00:00+02:00")).toBe("2026-03-06T18:00:00.000Z");
  });

  it("adds a zero milliseconds component when none was given", () => {
    expect(canonicalizeInstant("2026-03-06T18:30:00Z")).toBe("2026-03-06T18:30:00.000Z");
  });

  it("is a no-op on an already-canonical instant", () => {
    const canonical = "2026-03-06T18:30:00.123Z";
    expect(canonicalizeInstant(canonical)).toBe(canonical);
  });

  it("passes unparseable input through untouched rather than throwing", () => {
    expect(canonicalizeInstant("not-a-date")).toBe("not-a-date");
  });
});

/** A minimal, valid `InventoryTransactionRow` — tests override only what they need. */
function baseRow(overrides: Partial<InventoryTransactionRow> = {}): InventoryTransactionRow {
  return {
    household_id: "11111111-1111-1111-1111-111111111111",
    item_id: "22222222-2222-2222-2222-222222222222",
    lot_id: "33333333-3333-3333-3333-333333333333",
    sequence: 1,
    type: "PURCHASE",
    qty_delta: "1",
    qty_delta_micros: "1000000",
    unit: "lb",
    reason: null,
    actor_kind: "user",
    actor_user_id: "44444444-4444-4444-4444-444444444444",
    actor_component: null,
    actor_model_ref: null,
    occurred_at: new Date("2026-03-06T18:00:00.000Z"),
    recorded_at: new Date("2026-03-06T18:00:01.000Z"),
    provenance_tier: "KNOWN_FACT",
    provenance_source: "manual-entry",
    provenance_confidence: null,
    provenance_model_ref: null,
    provenance_observed_at: null,
    provenance_confirmed_by: null,
    correlation_kind: null,
    correlation_id: null,
    idempotency_key: "test-key",
    system_flag_kind: null,
    system_flag_residual_micros: null,
    system_flag_caused_by_sequence: null,
    system_flag_caused_by_idempotency_key: null,
    ...overrides,
  };
}

describe("toRecordedTransaction (mapping.ts)", () => {
  it("maps a well-formed user-actor row", () => {
    const result = toRecordedTransaction(baseRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actor).toEqual({
        kind: "user",
        userId: "44444444-4444-4444-4444-444444444444",
      });
      expect(result.value.qtyDeltaMicros).toBe(1_000_000n);
      expect(result.value.occurredAt).toBe("2026-03-06T18:00:00.000Z");
    }
  });

  it("maps a system actor", () => {
    const result = toRecordedTransaction(
      baseRow({ actor_kind: "system", actor_user_id: null, actor_component: "meal-planner" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.actor).toEqual({ kind: "system", component: "meal-planner" });
  });

  it("maps an ai-confirmed actor", () => {
    const result = toRecordedTransaction(
      baseRow({ actor_kind: "ai-confirmed", actor_model_ref: "vision@2026-02" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.actor).toEqual({
        kind: "ai-confirmed",
        userId: "44444444-4444-4444-4444-444444444444",
        modelRef: "vision@2026-02",
      });
    }
  });

  it("maps a fully populated system flag", () => {
    const result = toRecordedTransaction(
      baseRow({
        system_flag_kind: "OVER_CONSUMPTION",
        system_flag_residual_micros: "250000",
        system_flag_caused_by_sequence: 2,
        system_flag_caused_by_idempotency_key: "eat-1",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemFlag).toEqual({
        kind: "OVER_CONSUMPTION",
        residualMicros: 250_000n,
        residual: 0.25,
        causedBySequence: 2,
        causedByIdempotencyKey: "eat-1",
      });
    }
  });

  it("maps a correlation reference", () => {
    const result = toRecordedTransaction(
      baseRow({ correlation_kind: "meal-log", correlation_id: "meal-1" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.correlationRef).toEqual({ kind: "meal-log", id: "meal-1" });
  });

  it("rejects a type outside the known transaction types", () => {
    const result = toRecordedTransaction(baseRow({ type: "TELEPORT" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CORRUPT_LEDGER");
  });

  it("rejects a non-integer qty_delta_micros", () => {
    const result = toRecordedTransaction(baseRow({ qty_delta_micros: "1.5" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not an integer/);
  });

  it("rejects a user actor with no user id", () => {
    const result = toRecordedTransaction(baseRow({ actor_user_id: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/no user id/);
  });

  it("rejects an unknown actor_kind", () => {
    const result = toRecordedTransaction(baseRow({ actor_kind: "robot" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not a known actor kind/);
  });

  it("rejects an unknown provenance_tier", () => {
    const result = toRecordedTransaction(baseRow({ provenance_tier: "GUESS" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not a known tier/);
  });

  it("rejects a half-populated correlation reference", () => {
    const result = toRecordedTransaction(baseRow({ correlation_kind: "meal-log" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/half-populated/);
  });

  it("rejects an incomplete system flag", () => {
    const result = toRecordedTransaction(baseRow({ system_flag_kind: "OVER_CONSUMPTION" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/incomplete/);
  });
});

describe("toStorageLocation (mapping.ts)", () => {
  it("passes a known location through", () => {
    expect(toStorageLocation("FRIDGE")).toEqual({ ok: true, value: "FRIDGE" });
  });

  it("maps null to undefined", () => {
    expect(toStorageLocation(null)).toEqual({ ok: true, value: undefined });
  });

  it("rejects an unknown location", () => {
    const result = toStorageLocation("GARAGE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CORRUPT_LEDGER");
  });
});

describe("toExpiryTier (mapping.ts)", () => {
  it("passes a known tier through", () => {
    expect(toExpiryTier("ESTIMATED")).toEqual({ ok: true, value: "ESTIMATED" });
  });

  it("maps null to undefined", () => {
    expect(toExpiryTier(null)).toEqual({ ok: true, value: undefined });
  });

  it("rejects an unknown tier", () => {
    const result = toExpiryTier("GUESSED");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CORRUPT_LEDGER");
  });
});
