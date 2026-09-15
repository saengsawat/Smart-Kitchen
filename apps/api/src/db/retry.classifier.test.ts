/**
 * `isRetryableLedgerError` (M1-T9) — pure classifier, no I/O, no DATABASE_URL
 * gate. Every case is a plain `{ code, constraint }`-shaped object, matching
 * what `pgErrorCode`/`pgConstraint` (apps/api/src/db/inventory/repository.ts)
 * actually read off a driver error — these helpers do not require an `Error`
 * instance, only an object with the right fields, so the fixtures here don't
 * need to be real pg errors to exercise the same code path.
 */

import { describe, expect, it } from "vitest";
import { isRetryableLedgerError } from "./retry.js";

const SEQUENCE_KEY = "inventory_transactions_item_sequence_key";
const IDEMPOTENCY_KEY = "inventory_transactions_idempotency_key";

describe("isRetryableLedgerError", () => {
  describe("40001 (serialization_failure) — retryable regardless of constraint", () => {
    it.each([
      { label: "no constraint named", constraint: undefined },
      { label: "the sequence-key constraint", constraint: SEQUENCE_KEY },
      { label: "the idempotency-key constraint", constraint: IDEMPOTENCY_KEY },
      { label: "some unrelated constraint", constraint: "whatever_check" },
    ])("true with $label", ({ constraint }) => {
      expect(isRetryableLedgerError({ code: "40001", constraint })).toBe(true);
    });
  });

  describe("23505 (unique_violation) — retryable only on the sequence key", () => {
    it("true for the item-sequence unique index", () => {
      expect(isRetryableLedgerError({ code: "23505", constraint: SEQUENCE_KEY })).toBe(true);
    });

    it("false for the idempotency-key unique index (a terminal business conflict)", () => {
      expect(isRetryableLedgerError({ code: "23505", constraint: IDEMPOTENCY_KEY })).toBe(false);
    });

    it("false for any other constraint", () => {
      expect(isRetryableLedgerError({ code: "23505", constraint: "some_other_key" })).toBe(false);
    });

    it("false with no constraint named at all", () => {
      expect(isRetryableLedgerError({ code: "23505", constraint: undefined })).toBe(false);
      expect(isRetryableLedgerError({ code: "23505" })).toBe(false);
    });
  });

  describe("every other SQLSTATE — never retryable", () => {
    it.each([
      { code: "23503", label: "foreign_key_violation" },
      { code: "40P01", label: "deadlock_detected (not in the ticket's retry rule)" },
      { code: "42501", label: "insufficient_privilege (the snapshot-guard triggers use this)" },
      { code: "55000", label: "object_not_in_prerequisite_state" },
      { code: "23514", label: "check_violation (e.g. INV-LEDGER-4)" },
      { code: "0A000", label: "feature_not_supported (append-only violation)" },
    ])("false for $code ($label), with or without a sequence-key constraint", ({ code }) => {
      expect(isRetryableLedgerError({ code, constraint: SEQUENCE_KEY })).toBe(false);
      expect(isRetryableLedgerError({ code })).toBe(false);
    });
  });

  describe("non-driver-error inputs", () => {
    it.each([
      { label: "undefined", value: undefined },
      { label: "null", value: null },
      { label: "a string", value: "boom" },
      { label: "a number", value: 42 },
      { label: "a plain Error with no code", value: new Error("boom") },
      { label: "an object whose code is not a string", value: { code: 40001 } },
      {
        label: "an object whose constraint is not a string",
        value: { code: "23505", constraint: 5 },
      },
      { label: "an empty object", value: {} },
    ])("false for $label", ({ value }) => {
      expect(isRetryableLedgerError(value)).toBe(false);
    });
  });
});
