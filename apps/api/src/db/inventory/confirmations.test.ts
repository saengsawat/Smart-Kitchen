/**
 * Confirming an AI proposal at the database (M2-T5, D-028; INV-LEDGER-2,
 * INV-TENANT-1).
 *
 * Three things are pinned here, below the HTTP layer:
 *
 * 1. **What a confirmation writes.** One `inventory_confirmations` row per
 *    not-yet-confirmed AI_INTERPRETATION ledger row of the item, and nothing
 *    else anywhere: every `inventory_transactions`, `inventory_items` and
 *    `inventory_lots` row is byte-identical before and after (full-row
 *    comparison through `row_to_json`, plus row counts).
 * 2. **What the schema refuses on its own** (migration 0010), whatever the
 *    service does: a confirmation of a non-AI row, of another household's row,
 *    of a row under a different item, by a non-member, twice, or with a
 *    malformed key; and the row-level security policy.
 * 3. **How the reads present it**: the summary's tier flips to KNOWN_FACT only
 *    when the latest ledger row is a confirmed AI row, and the detail history
 *    shows each confirmed row with the "confirmed by" source.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build in CI.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmAiProposal, NotAProposalError } from "../../inventory/confirm-service.js";
import { migrateDown, migrateUp } from "../migrate.js";
import { withHouseholdTransaction } from "../session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type SeededHousehold,
  type TestDatabase,
} from "../test-support/harness.js";
import {
  captureError,
  insertRawTransaction,
  pgFailure,
  seedItem,
  type SeededItem,
} from "../test-support/inventory-fixtures.js";
import { migrationsAfter } from "../test-support/migration-list.js";
import { readInventoryItemDetail } from "./detail.js";
import { readInventoryItemSummary } from "./snapshot.js";
import { InventoryItemNotVisibleError, LedgerWriteRejectedError } from "./write-service.js";

const SUITE = "M2-T5: AI proposal confirmations at the database";
it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

interface LedgerRowSpec {
  readonly tier: "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";
  readonly type?: string;
  readonly micros?: string;
  readonly source?: string;
  readonly modelRef?: string | null;
}

/** The whole-table image a confirm must leave untouched. */
interface TableImage {
  readonly transactions: readonly string[];
  readonly items: readonly string[];
  readonly lots: readonly string[];
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let home: SeededHousehold;
  let away: SeededHousehold;

  /** Runs `fn` as `sk_app` inside `householdId`'s tenant transaction. */
  function asTenant<T>(
    householdId: string | null,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return withHouseholdTransaction(db.pool, householdId, fn, { assumeRole: APP_ROLE });
  }

  /** An item whose ledger is exactly `rows`, oldest first, written raw as the owner. */
  async function itemWith(
    household: SeededHousehold,
    rows: readonly LedgerRowSpec[],
  ): Promise<SeededItem & { readonly transactionIds: readonly string[] }> {
    const item = await seedItem(db.pool, household.householdId);
    const transactionIds: string[] = [];
    for (const [index, row] of rows.entries()) {
      const id = randomUUID();
      const micros = row.micros ?? "1000000";
      await insertRawTransaction(
        db.pool,
        {
          householdId: household.householdId,
          itemId: item.itemId,
          lotId: item.lotId,
          userId: household.userId,
        },
        {
          id,
          sequence: index + 1,
          type: row.type ?? "PURCHASE",
          qty_delta_micros: micros,
          qty_delta: (Number(micros) / 1_000_000).toFixed(6),
          provenance_tier: row.tier,
          provenance_source: row.source ?? `source-${String(index)}`,
          provenance_model_ref: row.modelRef ?? null,
          provenance_confidence: row.tier === "AI_INTERPRETATION" ? "0.62" : null,
        },
      );
      transactionIds.push(id);
    }
    return { ...item, transactionIds };
  }

  async function confirm(
    household: SeededHousehold,
    itemId: string,
    clientKey: string = randomUUID(),
    userId: string = household.userId,
  ): Promise<Awaited<ReturnType<typeof confirmAiProposal>>> {
    return asTenant(household.householdId, (client) =>
      confirmAiProposal(client, household.householdId, itemId, {
        clientKey,
        actorUserId: userId,
      }),
    );
  }

  async function confirmationsOf(itemId: string): Promise<
    readonly {
      transaction_id: string;
      confirmed_by: string;
      model_ref: string | null;
      client_key: string;
      confirmed_at: Date;
    }[]
  > {
    const rows = await db.pool.query<{
      transaction_id: string;
      confirmed_by: string;
      model_ref: string | null;
      client_key: string;
      confirmed_at: Date;
    }>(
      `SELECT c.transaction_id, c.confirmed_by, c.model_ref, c.client_key, c.confirmed_at
         FROM inventory_confirmations AS c
         JOIN inventory_transactions AS t ON t.id = c.transaction_id
        WHERE c.item_id = $1
        ORDER BY t.sequence`,
      [itemId],
    );
    return rows.rows;
  }

  async function image(): Promise<TableImage> {
    const read = async (table: string): Promise<string[]> => {
      // `table` is one of three literals below, never test input.
      const rows = await db.pool.query<{ json: string }>(
        `SELECT row_to_json(r)::text AS json FROM ${table} AS r ORDER BY r.id`,
      );
      return rows.rows.map((row) => row.json);
    };
    return {
      transactions: await read("inventory_transactions"),
      items: await read("inventory_items"),
      lots: await read("inventory_lots"),
    };
  }

  beforeAll(async () => {
    db = await createTestDatabase("m2t5-confirmations");
    home = await seedHousehold(db.pool, "Confirm");
    away = await seedHousehold(db.pool, "Elsewhere");
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("what a confirmation writes", () => {
    it("records one row per AI row, in ledger order, with the session user, the key and each row's model ref", async () => {
      const item = await itemWith(home, [
        { tier: "AI_INTERPRETATION", modelRef: "receipt-parser@v1" },
        { tier: "KNOWN_FACT", type: "CONSUME", micros: "-250000" },
        { tier: "AI_INTERPRETATION", modelRef: null },
      ]);

      const result = await confirm(home, item.itemId, "first-key");

      expect(result.confirmedTransactionIds).toEqual([
        item.transactionIds[0],
        item.transactionIds[2],
      ]);
      const stored = await confirmationsOf(item.itemId);
      expect(stored.map((row) => row.transaction_id)).toEqual([
        item.transactionIds[0],
        item.transactionIds[2],
      ]);
      expect(stored.map((row) => row.model_ref)).toEqual(["receipt-parser@v1", null]);
      expect(new Set(stored.map((row) => row.confirmed_by))).toEqual(new Set([home.userId]));
      expect(new Set(stored.map((row) => row.client_key))).toEqual(new Set(["first-key"]));
    });

    it("leaves every ledger, item and lot row byte-identical (row counts and full rows)", async () => {
      const item = await itemWith(home, [
        { tier: "AI_INTERPRETATION", source: "receipt read “ORG STRWB 1LB”" },
        { tier: "AI_INTERPRETATION", source: "receipt read “ORG STRWB 1LB”" },
      ]);
      const before = await image();
      expect(before.transactions.length).toBeGreaterThan(0);

      const result = await confirm(home, item.itemId);
      expect(result.confirmedTransactionIds).toHaveLength(2);

      const after = await image();
      expect(after.transactions).toHaveLength(before.transactions.length);
      expect(after.transactions).toEqual(before.transactions);
      expect(after.items).toEqual(before.items);
      expect(after.lots).toEqual(before.lots);
      // And the ledger still says what it always said about these rows.
      const tiers = await db.pool.query<{ provenance_tier: string; confirmed_by: string | null }>(
        `SELECT provenance_tier, provenance_confirmed_by AS confirmed_by
           FROM inventory_transactions WHERE item_id = $1 ORDER BY sequence`,
        [item.itemId],
      );
      expect(tiers.rows).toEqual([
        { provenance_tier: "AI_INTERPRETATION", confirmed_by: null },
        { provenance_tier: "AI_INTERPRETATION", confirmed_by: null },
      ]);
    });

    it("inserts nothing on a second confirm with the same key, and answers the same detail", async () => {
      const item = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const first = await confirm(home, item.itemId, "same-key");
      const stored = await confirmationsOf(item.itemId);

      const second = await confirm(home, item.itemId, "same-key");

      expect(second.confirmedTransactionIds).toEqual([]);
      expect(second.detail).toEqual(first.detail);
      expect(await confirmationsOf(item.itemId)).toEqual(stored);
    });

    it("inserts nothing on a second confirm with a different key, and answers the same detail", async () => {
      const item = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const first = await confirm(home, item.itemId, "key-a");
      const stored = await confirmationsOf(item.itemId);

      const second = await confirm(home, item.itemId, "key-b");

      expect(second.confirmedTransactionIds).toEqual([]);
      expect(second.detail).toEqual(first.detail);
      expect(await confirmationsOf(item.itemId)).toEqual(stored);
    });

    it("confirms only the new AI row when one arrives after a confirm, leaving the earlier confirmation as it was", async () => {
      const item = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      await confirm(home, item.itemId, "early");
      const early = await confirmationsOf(item.itemId);

      const laterId = randomUUID();
      await insertRawTransaction(
        db.pool,
        {
          householdId: home.householdId,
          itemId: item.itemId,
          lotId: item.lotId,
          userId: home.userId,
        },
        {
          id: laterId,
          sequence: 2,
          provenance_tier: "AI_INTERPRETATION",
          provenance_source: "receipt read 2",
        },
      );
      const pending = await asTenant(home.householdId, (client) =>
        readInventoryItemSummary(client, home.householdId, item.itemId),
      );
      expect(pending?.provenance.quantity?.tier).toBe("AI_INTERPRETATION");

      const result = await confirm(home, item.itemId, "late");

      expect(result.confirmedTransactionIds).toEqual([laterId]);
      const all = await confirmationsOf(item.itemId);
      expect(all[0]).toEqual(early[0]);
      expect(all.map((row) => row.client_key)).toEqual(["early", "late"]);
    });

    it("refuses an item with no AI row at all as not a proposal, and writes nothing", async () => {
      const item = await itemWith(home, [
        { tier: "KNOWN_FACT" },
        { tier: "ESTIMATED", micros: "500000" },
      ]);
      const before = await db.pool.query(`SELECT count(*)::text AS n FROM inventory_confirmations`);

      const error = await captureError(() => confirm(home, item.itemId));

      expect(error).toBeInstanceOf(NotAProposalError);
      const after = await db.pool.query(`SELECT count(*)::text AS n FROM inventory_confirmations`);
      expect(after.rows).toEqual(before.rows);
    });

    it("refuses an item with no ledger rows at all as not a proposal", async () => {
      const item = await seedItem(db.pool, home.householdId);
      expect(await captureError(() => confirm(home, item.itemId))).toBeInstanceOf(
        NotAProposalError,
      );
    });

    it("answers another household's AI item exactly as an item that does not exist, and writes nothing", async () => {
      const foreign = await itemWith(away, [{ tier: "AI_INTERPRETATION" }]);

      const foreignError = await captureError(() => confirm(home, foreign.itemId));
      const missingError = await captureError(() => confirm(home, randomUUID()));

      expect(foreignError).toBeInstanceOf(InventoryItemNotVisibleError);
      expect(missingError).toBeInstanceOf(InventoryItemNotVisibleError);
      expect(await confirmationsOf(foreign.itemId)).toEqual([]);
    });

    it.each([["has space"], ["a::b"], ["a/lot/0"], ["x".repeat(129)]])(
      "refuses the malformed client key %j with the typed ledger code, before anything is written",
      async (badKey) => {
        const item = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
        const error = await captureError(() => confirm(home, item.itemId, badKey));
        expect(error).toBeInstanceOf(LedgerWriteRejectedError);
        expect((error as LedgerWriteRejectedError).ledgerError.code).toBe(
          "INVALID_IDEMPOTENCY_KEY",
        );
        expect(await confirmationsOf(item.itemId)).toEqual([]);
      },
    );
  });

  describe("how the reads present a confirmation", () => {
    it("flips the summary's quantity tier to KNOWN_FACT with the confirmed-by source", async () => {
      const item = await itemWith(home, [
        { tier: "AI_INTERPRETATION", source: "receipt read “CREMINI MUSHRM 8OZ”" },
      ]);
      const before = await asTenant(home.householdId, (client) =>
        readInventoryItemSummary(client, home.householdId, item.itemId),
      );
      expect(before?.provenance.quantity?.tier).toBe("AI_INTERPRETATION");

      const result = await confirm(home, item.itemId);

      // "Confirm owner" is the seeded user's display name: initials CO.
      expect(result.detail.summary.provenance.quantity).toMatchObject({
        tier: "KNOWN_FACT",
        source: "receipt read “CREMINI MUSHRM 8OZ” · confirmed by CO",
        confidence: "0.62",
      });
      const after = await asTenant(home.householdId, (client) =>
        readInventoryItemSummary(client, home.householdId, item.itemId),
      );
      expect(after).toEqual(result.detail.summary);
      // The quantity itself never moved.
      expect(after?.quantity).toEqual(before?.quantity);
    });

    it("shows each confirmed row in the history as KNOWN_FACT and every other row as stored", async () => {
      const item = await itemWith(home, [
        { tier: "AI_INTERPRETATION", source: "receipt A" },
        { tier: "ESTIMATED", source: "shelf-life guess", micros: "500000" },
        { tier: "AI_INTERPRETATION", source: "receipt B" },
      ]);
      await confirm(home, item.itemId);

      const read = await asTenant(home.householdId, (client) =>
        readInventoryItemDetail(client, home.householdId, item.itemId),
      );
      expect(
        read?.detail.history.map((row) => [row.provenance.tier, row.provenance.source]),
      ).toEqual([
        ["KNOWN_FACT", "receipt A · confirmed by CO"],
        ["ESTIMATED", "shelf-life guess"],
        ["KNOWN_FACT", "receipt B · confirmed by CO"],
      ]);
      // The actor is still whoever wrote the row; confirming is not authoring.
      expect(read?.detail.history.map((row) => row.actor.kind)).toEqual(["user", "user", "user"]);
    });

    it("leaves the summary alone when the latest row is not AI, while still confirming the older AI row", async () => {
      const item = await itemWith(home, [
        { tier: "AI_INTERPRETATION", source: "receipt C" },
        { tier: "KNOWN_FACT", type: "ADJUSTMENT", micros: "250000", source: "manual-entry" },
      ]);
      const before = await asTenant(home.householdId, (client) =>
        readInventoryItemSummary(client, home.householdId, item.itemId),
      );

      const result = await confirm(home, item.itemId);

      expect(result.confirmedTransactionIds).toEqual([item.transactionIds[0]]);
      expect(result.detail.summary).toEqual(before);
      expect(result.detail.history[0]?.provenance.source).toBe("receipt C · confirmed by CO");
    });
  });

  describe("what migration 0010 refuses on its own", () => {
    async function insertConfirmation(
      executor: Pool | PoolClient,
      values: {
        readonly householdId: string;
        readonly itemId: string;
        readonly transactionId: string;
        readonly confirmedBy: string;
        readonly clientKey?: string;
      },
    ): Promise<void> {
      await executor.query(
        `INSERT INTO inventory_confirmations
                (household_id, item_id, transaction_id, confirmed_by, client_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          values.householdId,
          values.itemId,
          values.transactionId,
          values.confirmedBy,
          values.clientKey ?? "raw-key",
        ],
      );
    }

    it.each(["KNOWN_FACT", "ESTIMATED"] as const)(
      "refuses a confirmation of a %s row, even as the owner",
      async (tier) => {
        const item = await itemWith(home, [{ tier }]);
        const failure = pgFailure(
          await captureError(() =>
            insertConfirmation(db.pool, {
              householdId: home.householdId,
              itemId: item.itemId,
              transactionId: item.transactionIds[0] ?? "",
              confirmedBy: home.userId,
            }),
          ),
        );
        expect(failure.code).toBe("23514");
        expect(failure.message).toMatch(/only an AI_INTERPRETATION ledger row can be confirmed/);
      },
    );

    it("refuses a confirmation naming another household's ledger row, even as the owner", async () => {
      const foreign = await itemWith(away, [{ tier: "AI_INTERPRETATION" }]);
      const local = await seedItem(db.pool, home.householdId);
      const failure = pgFailure(
        await captureError(() =>
          insertConfirmation(db.pool, {
            householdId: home.householdId,
            itemId: local.itemId,
            transactionId: foreign.transactionIds[0] ?? "",
            confirmedBy: home.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_confirmations_transaction_fkey");
    });

    it("refuses a confirmation that names the right row under the wrong item", async () => {
      const ai = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const other = await seedItem(db.pool, home.householdId);
      const failure = pgFailure(
        await captureError(() =>
          insertConfirmation(db.pool, {
            householdId: home.householdId,
            itemId: other.itemId,
            transactionId: ai.transactionIds[0] ?? "",
            confirmedBy: home.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_confirmations_transaction_fkey");
    });

    it("refuses a confirmer who is not a member of the row's household", async () => {
      const ai = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const failure = pgFailure(
        await captureError(() =>
          insertConfirmation(db.pool, {
            householdId: home.householdId,
            itemId: ai.itemId,
            transactionId: ai.transactionIds[0] ?? "",
            confirmedBy: away.userId,
          }),
        ),
      );
      expect(failure.code).toBe("23503");
      expect(failure.constraint).toBe("inventory_confirmations_confirmed_by_fkey");
    });

    it("refuses a second confirmation of the same ledger row, whoever sends it", async () => {
      const ai = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const values = {
        householdId: home.householdId,
        itemId: ai.itemId,
        transactionId: ai.transactionIds[0] ?? "",
        confirmedBy: home.userId,
      };
      await insertConfirmation(db.pool, values);
      const failure = pgFailure(
        await captureError(() => insertConfirmation(db.pool, { ...values, clientKey: "other" })),
      );
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("inventory_confirmations_transaction_key");
    });

    it("refuses a client key outside the one key shape", async () => {
      const ai = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const failure = pgFailure(
        await captureError(() =>
          insertConfirmation(db.pool, {
            householdId: home.householdId,
            itemId: ai.itemId,
            transactionId: ai.transactionIds[0] ?? "",
            confirmedBy: home.userId,
            clientKey: "a::b",
          }),
        ),
      );
      expect(failure.code).toBe("23514");
    });

    it("stamps confirmed_at with the wall clock, so two confirmations in one transaction keep their order", async () => {
      const a = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const b = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      await asTenant(home.householdId, async (client) => {
        await insertConfirmation(client, {
          householdId: home.householdId,
          itemId: a.itemId,
          transactionId: a.transactionIds[0] ?? "",
          confirmedBy: home.userId,
        });
        await client.query("SELECT pg_sleep(0.01)");
        await insertConfirmation(client, {
          householdId: home.householdId,
          itemId: b.itemId,
          transactionId: b.transactionIds[0] ?? "",
          confirmedBy: home.userId,
        });
      });
      const [first] = await confirmationsOf(a.itemId);
      const [second] = await confirmationsOf(b.itemId);
      expect(second?.confirmed_at.getTime()).toBeGreaterThan(first?.confirmed_at.getTime() ?? 0);
    });
  });

  describe("tenancy (INV-TENANT-1) on the new table", () => {
    it("a household sees its own confirmations and none of another's (positive control first)", async () => {
      const mine = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const theirs = await itemWith(away, [{ tier: "AI_INTERPRETATION" }]);
      await confirm(home, mine.itemId);
      await confirm(away, theirs.itemId);

      const owner = await db.pool.query<{ item_id: string }>(
        `SELECT item_id FROM inventory_confirmations WHERE item_id = ANY($1::uuid[])`,
        [[mine.itemId, theirs.itemId]],
      );
      expect(owner.rows).toHaveLength(2);

      const seen = await asTenant(home.householdId, async (client) => {
        const rows = await client.query<{ item_id: string; household_id: string }>(
          `SELECT item_id, household_id FROM inventory_confirmations`,
        );
        return rows.rows;
      });
      expect(seen.map((row) => row.item_id)).toContain(mine.itemId);
      expect(seen.map((row) => row.item_id)).not.toContain(theirs.itemId);
      expect(new Set(seen.map((row) => row.household_id))).toEqual(new Set([home.householdId]));
    });

    it("cannot insert a confirmation into another household as sk_app", async () => {
      const theirs = await itemWith(away, [{ tier: "AI_INTERPRETATION" }]);
      const failure = pgFailure(
        await captureError(() =>
          asTenant(home.householdId, (client) =>
            insertConfirmation(client, {
              householdId: away.householdId,
              itemId: theirs.itemId,
              transactionId: theirs.transactionIds[0] ?? "",
              confirmedBy: away.userId,
            }),
          ),
        ),
      );
      expect(failure.code).toBe("42501");
      expect(await confirmationsOf(theirs.itemId)).toEqual([]);
    });

    it("sees nothing and confirms nothing when no household context is established", async () => {
      const mine = await itemWith(home, [{ tier: "AI_INTERPRETATION" }]);
      const rows = await asTenant(null, async (client) => {
        const result = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM inventory_confirmations`,
        );
        return result.rows;
      });
      expect(rows).toEqual([]);

      const error = await captureError(() =>
        asTenant(null, (client) =>
          confirmAiProposal(client, home.householdId, mine.itemId, {
            clientKey: "no-context",
            actorUserId: home.userId,
          }),
        ),
      );
      // The item row itself is invisible without context, so the confirm
      // reports it as not visible, and nothing was recorded.
      expect(error).toBeInstanceOf(InventoryItemNotVisibleError);
      expect(await confirmationsOf(mine.itemId)).toEqual([]);
    });

    async function insertConfirmation(
      client: PoolClient,
      values: {
        readonly householdId: string;
        readonly itemId: string;
        readonly transactionId: string;
        readonly confirmedBy: string;
      },
    ): Promise<void> {
      await client.query(
        `INSERT INTO inventory_confirmations
                (household_id, item_id, transaction_id, confirmed_by, client_key)
         VALUES ($1, $2, $3, $4, 'tenant-probe')`,
        [values.householdId, values.itemId, values.transactionId, values.confirmedBy],
      );
    }
  });

  describe("migration 0010 rolls back and forward with confirmations present", () => {
    it("drops the table and the ledger constraint, leaves the ledger as it was, and comes back empty", async () => {
      const scratch = await createTestDatabase("m2t5-confirmations-migration");
      try {
        const household = await seedHousehold(scratch.pool, "Scratch");
        const item = await seedItem(scratch.pool, household.householdId);
        await insertRawTransaction(
          scratch.pool,
          {
            householdId: household.householdId,
            itemId: item.itemId,
            lotId: item.lotId,
            userId: household.userId,
          },
          { provenance_tier: "AI_INTERPRETATION", provenance_source: "receipt" },
        );
        await withHouseholdTransaction(
          scratch.pool,
          household.householdId,
          (client) =>
            confirmAiProposal(client, household.householdId, item.itemId, {
              clientKey: "before-rollback",
              actorUserId: household.userId,
            }),
          { assumeRole: APP_ROLE },
        );
        const ledgerBefore = await scratch.pool.query<{ json: string }>(
          `SELECT row_to_json(t)::text AS json FROM inventory_transactions AS t ORDER BY id`,
        );

        const objects = async (): Promise<{ table: number; constraint: number }> => {
          const result = await scratch.pool.query<{ tables: string; constraints: string }>(
            `SELECT (SELECT count(*)::text FROM pg_class WHERE relname = 'inventory_confirmations') AS tables,
                    (SELECT count(*)::text FROM pg_constraint
                      WHERE conname = 'inventory_transactions_household_item_id_key') AS constraints`,
          );
          return {
            table: Number(result.rows[0]?.tables ?? "0"),
            constraint: Number(result.rows[0]?.constraints ?? "0"),
          };
        };
        expect(await objects()).toEqual({ table: 1, constraint: 1 });

        const after = migrationsAfter(10);
        const reverted = await migrateDown(scratch.url, after.length + 1);
        expect(reverted).toEqual([...after].reverse().concat("0010_inventory_confirmations"));
        expect(await objects()).toEqual({ table: 0, constraint: 0 });
        const ledgerDown = await scratch.pool.query<{ json: string }>(
          `SELECT row_to_json(t)::text AS json FROM inventory_transactions AS t ORDER BY id`,
        );
        expect(ledgerDown.rows).toEqual(ledgerBefore.rows);

        const applied = await migrateUp(scratch.url);
        expect(applied).toEqual(["0010_inventory_confirmations", ...after]);
        expect(await objects()).toEqual({ table: 1, constraint: 1 });
        const count = await scratch.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM inventory_confirmations`,
        );
        expect(count.rows[0]?.n).toBe("0");
      } finally {
        await scratch.drop();
      }
    }, 60_000);
  });
});
