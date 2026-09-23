/**
 * Snapshot mapping edge cases (M2-T1).
 *
 * The happy path is asserted end to end in `tenancy.db.test.ts`, over real rows.
 * What cannot be reached that way is a stored value outside the union the
 * contract declares, because the schema's CHECK constraints prevent one, so
 * the refusal is exercised here with a stub client. It matters because the
 * alternative behaviour, forwarding an unrecognised tier to a client that
 * renders provenance chips, is how a tier quietly stops meaning anything
 * (design principle P2).
 */

import type { ClientBase } from "pg";
import { describe, expect, it } from "vitest";
import { readInventorySnapshot, UnknownStoredValueError } from "./snapshot.js";

function clientReturning(itemRows: readonly unknown[], lotRows: readonly unknown[]): ClientBase {
  let call = 0;
  return {
    query: (): Promise<{ rows: readonly unknown[] }> => {
      call += 1;
      return Promise.resolve({ rows: call === 1 ? itemRows : lotRows });
    },
  } as unknown as ClientBase;
}

function itemRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_id: "11111111-1111-4111-8111-111111111111",
    unit: "lb",
    display_name: "Jasmine rice",
    product_ref: null,
    ingredient_ref: null,
    storage_location: "PANTRY",
    current_qty_micros: "1250000",
    qty_tier: "KNOWN_FACT",
    qty_source: "manual-entry",
    qty_confidence: null,
    qty_recorded_at: new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

function lotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_id: "11111111-1111-4111-8111-111111111111",
    lot_id: "22222222-2222-4222-8222-222222222222",
    label: null,
    acquired_at: null,
    expires_at: null,
    expiry_tier: null,
    current_qty_micros: "1250000",
    ...overrides,
  };
}

describe("readInventorySnapshot", () => {
  it("maps micros to exact decimal text without touching a float", async () => {
    const rows = await readInventorySnapshot(clientReturning([itemRow()], []), "h");
    expect(rows[0]?.quantity).toEqual({ unit: "lb", micros: "1250000", amount: "1.250000" });
  });

  it("writes a whole quantity with no fractional part at all", async () => {
    const rows = await readInventorySnapshot(
      clientReturning([itemRow({ current_qty_micros: "3000000" })], []),
      "h",
    );
    expect(rows[0]?.quantity.amount).toBe("3");
  });

  it("keeps a negative-free zero as zero rather than -0", async () => {
    const rows = await readInventorySnapshot(
      clientReturning([itemRow({ current_qty_micros: "0" })], []),
      "h",
    );
    expect(rows[0]?.quantity.amount).toBe("0");
  });

  it("reports no quantity provenance for an item with no ledger rows yet", async () => {
    const rows = await readInventorySnapshot(
      clientReturning([itemRow({ qty_tier: null, qty_source: null, qty_recorded_at: null })], []),
      "h",
    );
    expect(rows[0]?.provenance.quantity).toBeNull();
  });

  it("takes the earliest-expiring lot as the item's expiry, with that lot's tier", async () => {
    const rows = await readInventorySnapshot(
      clientReturning(
        [itemRow()],
        [
          lotRow({
            lot_id: "33333333-3333-4333-8333-333333333333",
            expires_at: new Date("2026-10-01T00:00:00.000Z"),
            expiry_tier: "ESTIMATED",
          }),
          lotRow({ expires_at: new Date("2026-12-01T00:00:00.000Z"), expiry_tier: "KNOWN_FACT" }),
        ],
      ),
      "h",
    );

    expect(rows[0]?.earliestExpiresAt).toBe("2026-10-01T00:00:00.000Z");
    expect(rows[0]?.provenance.earliestExpiresAt?.tier).toBe("ESTIMATED");
  });

  it("leaves expiry provenance null when a lot has a date but no tier", async () => {
    const rows = await readInventorySnapshot(
      clientReturning(
        [itemRow()],
        [lotRow({ expires_at: new Date("2026-10-01T00:00:00.000Z"), expiry_tier: null })],
      ),
      "h",
    );

    expect(rows[0]?.earliestExpiresAt).toBe("2026-10-01T00:00:00.000Z");
    expect(rows[0]?.provenance.earliestExpiresAt).toBeNull();
  });

  it("does not attach one item's lots to another", async () => {
    const rows = await readInventorySnapshot(
      clientReturning(
        [itemRow(), itemRow({ item_id: "44444444-4444-4444-8444-444444444444" })],
        [lotRow()],
      ),
      "h",
    );

    expect(rows[0]?.lots).toHaveLength(1);
    expect(rows[1]?.lots).toHaveLength(0);
  });

  it.each([
    ["storage_location", itemRow({ storage_location: "GARAGE" })],
    ["provenance_tier", itemRow({ qty_tier: "PROBABLY" })],
  ])("refuses a stored %s outside the union rather than forwarding it", async (_case, row) => {
    await expect(readInventorySnapshot(clientReturning([row], []), "h")).rejects.toThrow(
      UnknownStoredValueError,
    );
  });

  it("refuses an unrecognised lot expiry tier too", async () => {
    await expect(
      readInventorySnapshot(
        clientReturning(
          [itemRow()],
          [lotRow({ expires_at: new Date("2026-10-01T00:00:00.000Z"), expiry_tier: "GUESS" })],
        ),
        "h",
      ),
    ).rejects.toThrow(UnknownStoredValueError);
  });
});
