/**
 * The inventory write path over HTTP (M2-T2).
 *
 * Everything here goes through `app.inject` against a real throwaway database,
 * with the real fixture identity port and the real tenant session, because
 * every claim this ticket makes is a claim about the whole pipeline: the
 * session decides the household, row-level security backs it, the domain
 * decides the arithmetic, and the ledger decides what a replay is. A test that
 * called the write service directly would prove none of that.
 *
 * The data under test is the development seed, so the acceptance criteria can
 * be asserted in the words the ticket uses ("correct chicken breast to 1.5 lb",
 * "remove spinach with reason spoiled"), and so the seed itself is exercised by
 * the suite that matters most.
 *
 * Each group works on its own item, because the ledger is append-only and
 * tests share one database: chicken for corrections and undo, spinach for a
 * full removal, yogurt for multi-lot FEFO, eggs for the clamp, salmon for a
 * multi-lot undo, mushrooms and rice for refusals.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build in CI.
 */

import { randomUUID } from "node:crypto";
import {
  CORRELATION_ID_HEADER,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  inventoryTransactionUndoPath,
  type ApiErrorBodyDto,
  type InventoryItemDetailDto,
  type InventoryWriteRequestDto,
  type InventoryWriteResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { withHouseholdTransaction } from "../db/session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { seedItem } from "../db/test-support/inventory-fixtures.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { seedChenInventory, seedItemId } from "../seed/fixture-inventory.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./tenant-session.js";

const SUITE = "M2-T2: inventory writes over HTTP (ledger, tenancy, idempotency)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const OKAFOR = "fixture.owner.other";

/** Ledger keys are client-chosen; a uuid is what a real client would send. */
function key(): string {
  return randomUUID();
}

const NOW = "2026-09-22T12:30:00.000Z";

interface WriteAnswer {
  readonly statusCode: number;
  readonly body: InventoryWriteResponseDto;
  readonly error: ApiErrorBodyDto["error"] | undefined;
  readonly correlationId: string;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let app: FastifyInstance;
  let logLines: string[];
  let chenHousehold: string;
  let okaforHousehold: string;
  let okaforItemId: string;
  let lotlessItemId: string;

  function buildWith(tenantSession: TenantSessionRunner): FastifyInstance {
    return buildApp({
      identity: createFixtureIdentityPort(fixture),
      tenantSession,
      logging: {
        level: "info",
        destination: {
          write(line: string): void {
            logLines.push(line);
          },
        },
      },
    });
  }

  async function write(
    itemId: string,
    body: Partial<InventoryWriteRequestDto> & Record<string, unknown>,
    options: { readonly token?: string; readonly instance?: FastifyInstance } = {},
  ): Promise<WriteAnswer> {
    const response = await (options.instance ?? app).inject({
      method: "POST",
      url: inventoryItemTransactionsPath(itemId),
      headers: {
        authorization: `Bearer ${options.token ?? DEAN}`,
        "content-type": "application/json",
      },
      payload: body,
    });
    const parsed: unknown = response.statusCode === 200 ? response.json() : response.json();
    return {
      statusCode: response.statusCode,
      body: parsed as InventoryWriteResponseDto,
      error: (parsed as ApiErrorBodyDto).error,
      correlationId: String(response.headers[CORRELATION_ID_HEADER]),
    };
  }

  async function undo(
    itemId: string,
    transactionId: string,
    body: Record<string, unknown>,
    token = DEAN,
  ): Promise<WriteAnswer> {
    const response = await app.inject({
      method: "POST",
      url: inventoryTransactionUndoPath(itemId, transactionId),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: body,
    });
    const parsed: unknown = response.json();
    return {
      statusCode: response.statusCode,
      body: parsed as InventoryWriteResponseDto,
      error: (parsed as ApiErrorBodyDto).error,
      correlationId: String(response.headers[CORRELATION_ID_HEADER]),
    };
  }

  async function detail(
    itemId: string,
    token = DEAN,
  ): Promise<{ statusCode: number; body: InventoryItemDetailDto }> {
    const response = await app.inject({
      method: "GET",
      url: inventoryItemPath(itemId),
      headers: { authorization: `Bearer ${token}` },
    });
    return { statusCode: response.statusCode, body: response.json<InventoryItemDetailDto>() };
  }

  /** The item's on-hand amount, read straight from the table as the owner. */
  async function storedMicros(itemId: string): Promise<string> {
    const rows = await db.pool.query<{ micros: string }>(
      `SELECT current_qty_micros::text AS micros FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    return rows.rows[0]?.micros ?? "missing";
  }

  async function rowCount(itemId: string): Promise<number> {
    const rows = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1`,
      [itemId],
    );
    return Number(rows.rows[0]?.count ?? "0");
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m2t2-writes");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);

    const dean = fixture.sessions.find((session) => session.token === DEAN);
    const okafor = fixture.sessions.find((session) => session.token === OKAFOR);
    if (dean === undefined || okafor === undefined) throw new Error("fixture map lost a session");
    chenHousehold = dean.householdId;
    okaforHousehold = okafor.householdId;

    await seedChenInventory(db.pool, chenHousehold, dean.userId);

    // A second household's item, to be reached for and not found.
    const foreign = await seedItem(db.pool, okaforHousehold, "can");
    okaforItemId = foreign.itemId;

    // An item with no lot at all, which is the only way to reach UNKNOWN_LOT
    // through an endpoint that never lets a caller name a lot.
    lotlessItemId = randomUUID();
    await db.pool.query(
      `INSERT INTO inventory_items (id, household_id, unit, display_name, storage_location)
       VALUES ($1, $2, 'lb', 'Lotless item', 'PANTRY')`,
      [lotlessItemId, chenHousehold],
    );

    app = buildWith(createTenantSessionRunner(db.pool));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("the correction flow on chicken breast (acceptance criteria)", () => {
    const itemId = seedItemId("chicken");
    const correctionKey = key();
    let correctionTransactionId: string;

    it("corrects 1.25 lb to 1.5 lb with one ADJUSTMENT of +0.25", async () => {
      const answer = await write(itemId, {
        idempotencyKey: correctionKey,
        type: "ADJUSTMENT",
        targetAmount: "1.5",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.replayed).toBe(false);
      expect(answer.body.transactions).toHaveLength(1);
      const row = answer.body.transactions[0];
      expect(row?.type).toBe("ADJUSTMENT");
      expect(row?.deltaMicros).toBe("250000");
      expect(row?.amount).toBe("0.250000");
      expect(row?.systemFlag).toBeUndefined();
      expect(answer.body.item.summary.quantity).toEqual({
        unit: "lb",
        micros: "1500000",
        amount: "1.500000",
      });
      correctionTransactionId = row?.transactionId ?? "";
    });

    it("attributes the row to the session's user, as initials and never a name", async () => {
      const { body } = await detail(itemId);
      const correction = body.history.find((row) => row.transactionId === correctionTransactionId);

      expect(correction?.actor).toEqual({ kind: "user", displayInitials: "DC" });
      expect(JSON.stringify(body)).not.toContain("Dean Chen");
      expect(JSON.stringify(body)).not.toContain("dean.chen@fixture.invalid");
    });

    it("puts the increase on the lot that is actually open", async () => {
      const lots = await db.pool.query<{ id: string; micros: string }>(
        `SELECT id, current_qty_micros::text AS micros FROM inventory_lots
          WHERE item_id = $1 ORDER BY created_at, id`,
        [itemId],
      );
      const nonZero = lots.rows.filter((lot) => lot.micros !== "0");
      expect(nonZero).toHaveLength(1);
      expect(nonZero[0]?.micros).toBe("1500000");
    });

    it("replays the identical request with the identical rows and appends nothing", async () => {
      const before = await rowCount(itemId);
      const answer = await write(itemId, {
        idempotencyKey: correctionKey,
        type: "ADJUSTMENT",
        targetAmount: "1.5",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.replayed).toBe(true);
      expect(answer.body.transactions.map((row) => row.transactionId)).toEqual([
        correctionTransactionId,
      ]);
      expect(await rowCount(itemId)).toBe(before);
      expect(await storedMicros(itemId)).toBe("1500000");
    });

    it("refuses a changed payload under the same key with 409 and the typed code", async () => {
      const before = await rowCount(itemId);
      const answer = await write(itemId, {
        idempotencyKey: correctionKey,
        type: "ADJUSTMENT",
        targetAmount: "3",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(409);
      expect(answer.error?.code).toBe("CONFLICT");
      expect(answer.error?.ledgerCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect(await rowCount(itemId)).toBe(before);
      expect(await storedMicros(itemId)).toBe("1500000");
    });

    it("refuses a changed reason under the same key too, not just a changed quantity", async () => {
      const answer = await write(itemId, {
        idempotencyKey: correctionKey,
        type: "ADJUSTMENT",
        targetAmount: "1.5",
        occurredAt: NOW,
        reason: "Recounted",
      });

      expect(answer.statusCode).toBe(409);
      expect(answer.error?.ledgerCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    });

    it("undoes the correction with a compensating row, back to 1.25 lb", async () => {
      const answer = await undo(itemId, correctionTransactionId, {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions).toHaveLength(1);
      expect(answer.body.transactions[0]?.type).toBe("ADJUSTMENT");
      expect(answer.body.transactions[0]?.deltaMicros).toBe("-250000");
      expect(answer.body.transactions[0]?.reason).toBe(`undo:${correctionTransactionId}`);
      expect(answer.body.item.summary.quantity.micros).toBe("1250000");
    });

    it("never deletes the row it undid: the history keeps both", async () => {
      const { body } = await detail(itemId);
      const deltas = body.history.map((row) => row.deltaMicros);

      expect(deltas).toContain("250000");
      expect(deltas).toContain("-250000");
      expect(body.history.some((row) => row.transactionId === correctionTransactionId)).toBe(true);
    });

    it("replays an undo under its own key without appending twice", async () => {
      const undoKey = key();
      const first = await undo(itemId, correctionTransactionId, {
        idempotencyKey: undoKey,
        occurredAt: NOW,
      });
      const beforeMicros = await storedMicros(itemId);
      const before = await rowCount(itemId);
      const second = await undo(itemId, correctionTransactionId, {
        idempotencyKey: undoKey,
        occurredAt: NOW,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.body.replayed).toBe(true);
      expect(second.body.transactions.map((row) => row.transactionId)).toEqual(
        first.body.transactions.map((row) => row.transactionId),
      );
      expect(await rowCount(itemId)).toBe(before);
      expect(await storedMicros(itemId)).toBe(beforeMicros);
    });
  });

  describe("the item detail read", () => {
    const itemId = seedItemId("chicken");

    it("returns the seeded history in sequence order, clamp row included", async () => {
      const { statusCode, body } = await detail(itemId);

      expect(statusCode).toBe(200);
      const seeded = body.history.slice(0, 4);
      expect(seeded.map((row) => `${row.type} ${row.amount}`)).toEqual([
        "PURCHASE 2",
        "USE_IN_MEAL -2.250000",
        "ADJUSTMENT 0.250000",
        "PURCHASE 1.250000",
      ]);
    });

    it("marks the clamp as the system's own and attributes it to nobody", async () => {
      const { body } = await detail(itemId);
      const clamp = body.history.find((row) => row.systemFlag !== undefined);

      expect(clamp?.systemFlag).toBe("OVER_CONSUMPTION");
      expect(clamp?.actor).toEqual({ kind: "system" });
      expect(clamp?.provenance.tier).toBe("ESTIMATED");
      expect(clamp?.reason).toBe("over-consumption-clamp");
    });

    it("carries the summary the list endpoint would have given for the same item", async () => {
      const { body } = await detail(itemId);
      const list = await app.inject({
        method: "GET",
        url: "/v1/inventory/items",
        headers: { authorization: `Bearer ${DEAN}` },
      });
      const items = list.json<{ items: { itemId: string }[] }>().items;

      expect(body.summary).toEqual(items.find((item) => item.itemId === itemId));
    });

    it("never names a household or an idempotency key on the wire", async () => {
      const { body } = await detail(itemId);
      expect(JSON.stringify(body)).not.toContain(chenHousehold);
      expect(JSON.stringify(body)).not.toContain("fixture-seed.chicken");
      expect(JSON.stringify(body)).not.toContain("/lot/");
    });

    it("answers 404 for an item id that is not a uuid", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/inventory/items/not-a-uuid",
        headers: { authorization: `Bearer ${DEAN}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("removing stock", () => {
    it("discards all of the spinach with a reason, recorded on the row", async () => {
      const itemId = seedItemId("spinach");
      const answer = await write(itemId, {
        idempotencyKey: key(),
        type: "DISCARD",
        occurredAt: NOW,
        reason: "Spoiled",
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions).toHaveLength(1);
      expect(answer.body.transactions[0]?.type).toBe("DISCARD");
      expect(answer.body.transactions[0]?.deltaMicros).toBe("-5000000");
      expect(answer.body.transactions[0]?.reason).toBe("Spoiled");
      expect(answer.body.item.summary.quantity.micros).toBe("0");
    });

    it("refuses a second full removal of an empty item rather than writing a zero row", async () => {
      const answer = await write(seedItemId("spinach"), {
        idempotencyKey: key(),
        type: "DISCARD",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("ZERO_DELTA");
    });

    it("splits a removal across lots by FEFO, with derived per-lot keys", async () => {
      const itemId = seedItemId("yogurt");
      const answer = await write(itemId, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "20",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions.map((row) => row.deltaMicros)).toEqual([
        "-16000000",
        "-4000000",
      ]);
      expect(answer.body.item.summary.quantity.micros).toBe("28000000");
      const keys = await db.pool.query<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM inventory_transactions
          WHERE item_id = $1 AND type = 'CONSUME' ORDER BY sequence`,
        [itemId],
      );
      expect(keys.rows.map((row) => row.idempotency_key.split("/lot/")[1])).toEqual(["0", "1"]);
    });

    it("replays a multi-lot removal as one unit", async () => {
      const itemId = seedItemId("salmon");
      const replayKey = key();
      const body = {
        idempotencyKey: replayKey,
        type: "CONSUME" as const,
        amount: "9",
        occurredAt: NOW,
      };
      const first = await write(itemId, body);
      const before = await rowCount(itemId);
      const second = await write(itemId, body);

      expect(first.body.transactions).toHaveLength(2);
      expect(second.body.replayed).toBe(true);
      expect(second.body.transactions.map((row) => row.transactionId)).toEqual(
        first.body.transactions.map((row) => row.transactionId),
      );
      expect(await rowCount(itemId)).toBe(before);
    });

    it("undoes a multi-lot removal per lot, restoring every lot's balance", async () => {
      const itemId = seedItemId("salmon");
      const lotsBefore = await db.pool.query<{ id: string; micros: string }>(
        `SELECT id, current_qty_micros::text AS micros FROM inventory_lots
          WHERE item_id = $1 ORDER BY created_at, id`,
        [itemId],
      );
      const rows = await db.pool.query<{ id: string }>(
        `SELECT id FROM inventory_transactions
          WHERE item_id = $1 AND type = 'CONSUME' ORDER BY sequence LIMIT 1`,
        [itemId],
      );

      const answer = await undo(itemId, rows.rows[0]?.id ?? "", {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      // Two lots were touched, so two compensating rows, not one lump.
      expect(answer.body.transactions).toHaveLength(2);
      expect(answer.body.item.summary.quantity.micros).toBe("12000000");
      const lotsAfter = await db.pool.query<{ id: string; micros: string }>(
        `SELECT id, current_qty_micros::text AS micros FROM inventory_lots
          WHERE item_id = $1 ORDER BY created_at, id`,
        [itemId],
      );
      expect(lotsAfter.rows.map((lot) => lot.micros)).toEqual(["6000000", "6000000"]);
      expect(lotsBefore.rows.map((lot) => lot.micros)).toEqual(["0", "3000000"]);
    });
  });

  describe("over-consumption: the ledger's clamp, through the API", () => {
    const itemId = seedItemId("eggs");
    let statementId: string;
    let overshootId: string;
    let clampId: string;

    it("records the whole statement and returns the system clamp row with it", async () => {
      const answer = await write(itemId, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "12",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      // 8 on hand, 12 used: the allocation, the overshoot, and the ledger's
      // own correction for the 4 that were never there.
      expect(answer.body.transactions.map((row) => row.deltaMicros)).toEqual([
        "-8000000",
        "-4000000",
        "4000000",
      ]);
      const clamp = answer.body.transactions[2];
      expect(clamp?.systemFlag).toBe("OVER_CONSUMPTION");
      expect(clamp?.actor).toEqual({ kind: "system" });
      expect(answer.body.item.summary.quantity.micros).toBe("0");
      statementId = answer.body.transactions[0]?.transactionId ?? "";
      overshootId = answer.body.transactions[1]?.transactionId ?? "";
      clampId = clamp?.transactionId ?? "";
    });

    it("never leaves a negative balance anywhere", async () => {
      const negatives = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_lots WHERE current_qty_micros < 0`,
      );
      expect(negatives.rows[0]?.count).toBe("0");
    });

    it("refuses to undo the clamp itself", async () => {
      const answer = await undo(itemId, clampId, { idempotencyKey: key(), occurredAt: NOW });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("INVALID_FIELD");
    });

    /**
     * The discriminating case (review F3). Naming the *overshoot* row is what
     * tells the two rules apart: its face value is -4, its clamp is +4, and the
     * group's net across all three rows is -8. A face-value undo would append
     * +4; a net-effect undo appends +8. Undoing the first row instead proves
     * nothing, because there the two numbers happen to coincide.
     */
    it("undoes the whole group by its net effect, not the named row's face value", async () => {
      const answer = await undo(itemId, overshootId, { idempotencyKey: key(), occurredAt: NOW });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions.map((row) => row.deltaMicros)).toEqual(["8000000"]);
      expect(answer.body.item.summary.quantity.micros).toBe("8000000");
    });

    it("undoes the same group again under a new key, appending again, as documented", async () => {
      // An undo does not change the group it compensates, so a second undo
      // under a different client key is a second statement and appends a
      // second compensation. That is the documented behaviour: the client key
      // is what makes a retried tap a no-op, not the fact of having undone.
      const answer = await undo(itemId, statementId, { idempotencyKey: key(), occurredAt: NOW });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.item.summary.quantity.micros).toBe("16000000");
    });
  });

  describe("an undo that arrived too late", () => {
    /**
     * The seed's chicken breast bought 2.0 lb on the Wednesday lot and used it
     * all (and a quarter more) on the Thursday. Undoing that purchase would
     * mean taking 2.0 lb back off a lot that holds nothing.
     *
     * The ledger would accept the row and clamp it, and that clamp would be a
     * lie: `OVER_CONSUMPTION` means our record was short, and here the record
     * was right and the undo was late. It would also be attributed to whoever
     * pressed undo and would count against the correction-rate metric. So the
     * API refuses (review F4).
     */
    it("refuses with 409 UNDO_NOT_POSSIBLE rather than clamping the compensation", async () => {
      const itemId = seedItemId("chicken");
      const rows = await db.pool.query<{ id: string }>(
        `SELECT id FROM inventory_transactions
          WHERE item_id = $1 AND type = 'PURCHASE' ORDER BY sequence LIMIT 1`,
        [itemId],
      );
      const before = await storedMicros(itemId);
      const rowsBefore = await rowCount(itemId);

      const answer = await undo(itemId, rows.rows[0]?.id ?? "", {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(409);
      expect(answer.error?.code).toBe("UNDO_NOT_POSSIBLE");
      expect(answer.error?.message).toBe(
        "That change can't be undone. The stock it added has already been used.",
      );
      // Nothing was appended, and in particular no clamp was minted.
      expect(await rowCount(itemId)).toBe(rowsBefore);
      expect(await storedMicros(itemId)).toBe(before);
    });

    it("carries no ledgerCode, because the ledger did not refuse it", async () => {
      const itemId = seedItemId("chicken");
      const rows = await db.pool.query<{ id: string }>(
        `SELECT id FROM inventory_transactions
          WHERE item_id = $1 AND type = 'PURCHASE' ORDER BY sequence LIMIT 1`,
        [itemId],
      );
      const answer = await undo(itemId, rows.rows[0]?.id ?? "", {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(answer.error?.ledgerCode).toBeUndefined();
    });

    it("still allows the undo when the lot does hold what it would take back", async () => {
      // The control, on its own item so it cannot depend on what the rest of
      // the suite has done: an increase whose stock is still there undoes
      // cleanly, so the refusal above is about the balance and not about
      // undoing an increase at all.
      const itemId = seedItemId("strawberries");
      const added = await write(itemId, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: "0.5",
        occurredAt: NOW,
      });
      const before = await storedMicros(itemId);

      const answer = await undo(itemId, added.body.transactions[0]?.transactionId ?? "", {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(added.statusCode).toBe(200);
      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions.map((row) => row.deltaMicros)).toEqual(["-500000"]);
      expect(BigInt(answer.body.item.summary.quantity.micros)).toBe(BigInt(before) - 500_000n);
    });

    it("refuses once that same stock has been consumed", async () => {
      // The other half of the control: the identical undo, made too late.
      const itemId = seedItemId("strawberries");
      const added = await write(itemId, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: "0.5",
        occurredAt: NOW,
      });
      await write(itemId, {
        idempotencyKey: key(),
        type: "CONSUME",
        occurredAt: NOW,
      });
      const before = await storedMicros(itemId);

      const answer = await undo(itemId, added.body.transactions[0]?.transactionId ?? "", {
        idempotencyKey: key(),
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(409);
      expect(answer.error?.code).toBe("UNDO_NOT_POSSIBLE");
      expect(await storedMicros(itemId)).toBe(before);
    });
  });

  describe("an unknown property in the body is refused, not stripped", () => {
    /**
     * Review F1. Fastify's AJV defaults delete an unknown property and carry
     * on, so `{"type":"DISCARD","amuont":"0.25"}` passed validation with the
     * quantity gone and removed the *entire* item, answering 200. A typo in a
     * quantity field must never become a larger write.
     */
    it("refuses a misspelled quantity field instead of removing everything", async () => {
      const itemId = seedItemId("mushrooms");
      const before = await storedMicros(itemId);

      const answer = await write(itemId, {
        idempotencyKey: key(),
        type: "DISCARD",
        occurredAt: NOW,
        amuont: "0.25",
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.code).toBe("BAD_REQUEST");
      expect(await storedMicros(itemId)).toBe(before);
    });

    it("refuses an unknown property on the undo body too", async () => {
      const itemId = seedItemId("chicken");
      const rows = await db.pool.query<{ id: string }>(
        `SELECT id FROM inventory_transactions WHERE item_id = $1 ORDER BY sequence LIMIT 1`,
        [itemId],
      );
      const before = await rowCount(itemId);

      const response = await app.inject({
        method: "POST",
        url: inventoryTransactionUndoPath(itemId, rows.rows[0]?.id ?? ""),
        headers: { authorization: `Bearer ${DEAN}`, "content-type": "application/json" },
        payload: { idempotencyKey: key(), occurredAt: NOW, transactionId: "someone-elses" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiErrorBodyDto>().error.code).toBe("BAD_REQUEST");
      expect(await rowCount(itemId)).toBe(before);
    });

    it("says nothing about the property it rejected, beyond the generic sentence", async () => {
      const answer = await write(seedItemId("mushrooms"), {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "1",
        occurredAt: NOW,
        amuont: "0.25",
      });

      expect(answer.error?.message).toBe("That request could not be understood.");
      expect(answer.error?.correlationId).toBe(answer.correlationId);
    });
  });

  describe("refusals the client must be able to tell apart", () => {
    const mushrooms = seedItemId("mushrooms");

    /** One refusal per user-facing code the deck has a sentence for. */
    const refusals: readonly [string, string, Record<string, unknown>][] = [
      [
        "ZERO_DELTA",
        "a change of nothing",
        { type: "ADJUSTMENT", deltaAmount: "0", occurredAt: NOW },
      ],
      [
        "WRONG_SIGN",
        "a negative magnitude on a removal",
        { type: "CONSUME", amount: "-1", occurredAt: NOW },
      ],
      [
        "PRECISION_EXCEEDED",
        "more precision than the ledger scale",
        { type: "ADJUSTMENT", deltaAmount: "0.0000001", occurredAt: NOW },
      ],
      [
        "QUANTITY_OUT_OF_RANGE",
        "a fat-fingered extra digit",
        { type: "ADJUSTMENT", deltaAmount: "100000001", occurredAt: NOW },
      ],
      [
        "INVALID_TIMESTAMP",
        "a timestamp that is not an instant",
        { type: "ADJUSTMENT", deltaAmount: "1", occurredAt: "yesterday" },
      ],
      [
        "TIMESTAMP_ORDER",
        "a change that has not happened yet",
        { type: "ADJUSTMENT", deltaAmount: "1", occurredAt: "2099-01-01T00:00:00.000Z" },
      ],
      [
        "INVALID_FIELD",
        "both quantity forms at once",
        { type: "ADJUSTMENT", targetAmount: "1", deltaAmount: "1", occurredAt: NOW },
      ],
      [
        "INVALID_IDEMPOTENCY_KEY",
        "a key inside the derived namespace",
        { type: "ADJUSTMENT", deltaAmount: "1", occurredAt: NOW, idempotencyKey: "a/lot/0" },
      ],
    ];

    it.each(refusals)("answers 400 with %s for %s", async (code, _description, body) => {
      const answer = await write(mushrooms, { idempotencyKey: key(), ...body });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.code).toBe("BAD_REQUEST");
      expect(answer.error?.ledgerCode).toBe(code);
    });

    it("answers 400 with UNKNOWN_LOT when the item has no lot to record against", async () => {
      const answer = await write(lotlessItemId, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "1",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("UNKNOWN_LOT");
    });

    it("opens a lot for an increase on an item that has none, rather than refusing", async () => {
      const answer = await write(lotlessItemId, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        targetAmount: "2",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.item.summary.lots).toHaveLength(1);
      expect(answer.body.item.summary.quantity.micros).toBe("2000000");
    });

    it("refuses a correction to the amount already on hand, whatever that amount is now", async () => {
      const current = (await detail(mushrooms)).body.summary.quantity.amount;
      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        targetAmount: current,
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("ZERO_DELTA");
    });

    it("never returns the domain's own message, only the code", async () => {
      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: "0",
        occurredAt: NOW,
      });

      expect(answer.error?.message).toBe("That change could not be recorded.");
      expect(answer.error?.message).not.toContain("qtyDelta");
      expect(answer.error?.correlationId).toBe(answer.correlationId);
    });

    it("refuses a JSON number that does not read back as a plain decimal", async () => {
      // The contract says quantities travel as exact decimal text. The
      // validator coerces a number to a string before the handler sees it, so
      // the parser is what holds the line: anything that does not stringify as
      // a plain decimal inside the ledger range is refused with a code rather
      // than quietly recorded.
      // Deliberately the wrong wire type, so it is built as a loose object.
      const numericBody: Record<string, unknown> = {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: 0.1 + 0.2,
        occurredAt: NOW,
      };
      const answer = await write(mushrooms, numericBody);

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("PRECISION_EXCEEDED");
    });

    it("refuses a reason that forges the undo prefix", async () => {
      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "1",
        occurredAt: NOW,
        reason: "undo:11111111-1111-4111-8111-111111111111",
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("INVALID_FIELD");
    });

    /**
     * A body that tries to name a household, a user, a lot or a system flag is
     * refused outright: the schema declares no such property and, since review
     * F1, an undeclared property is a 400 rather than something the validator
     * quietly deletes. The write is not merely unaffected, it does not happen.
     */
    it.each([
      ["a household", { householdId: "f1c70000-0000-4000-8000-000000000002" }],
      ["an actor", { actorUserId: "f1c70001-0000-4000-8000-000000000003" }],
      ["a lot", { lotId: "f1c70001-0000-4000-8000-000000000003" }],
      ["a system flag", { systemFlag: "OVER_CONSUMPTION" }],
    ])("refuses a body field naming %s", async (_case, extra) => {
      const before = await storedMicros(mushrooms);
      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "1",
        occurredAt: NOW,
        ...extra,
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.code).toBe("BAD_REQUEST");
      expect(await storedMicros(mushrooms)).toBe(before);
      const lots = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions
          WHERE item_id = $1 AND lot_id = $2`,
        [mushrooms, "f1c70001-0000-4000-8000-000000000003"],
      );
      expect(lots.rows[0]?.count).toBe("0");
    });

    it("refuses a negative targetAmount rather than planning a decrease that clamps", async () => {
      // Review F2: this used to become a decrease of (balance + 5), which
      // drained every lot and left the ledger minting an OVER_CONSUMPTION
      // clamp for a malformed request, inflating the correction-rate metric.
      const clampsBefore = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions
          WHERE item_id = $1 AND system_flag_kind IS NOT NULL`,
        [mushrooms],
      );
      const before = await storedMicros(mushrooms);

      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        targetAmount: "-5",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(400);
      expect(answer.error?.ledgerCode).toBe("QUANTITY_OUT_OF_RANGE");
      expect(await storedMicros(mushrooms)).toBe(before);
      const clampsAfter = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_transactions
          WHERE item_id = $1 AND system_flag_kind IS NOT NULL`,
        [mushrooms],
      );
      expect(clampsAfter.rows[0]?.count).toBe(clampsBefore.rows[0]?.count);
    });

    it("still accepts a negative deltaAmount, which is what deltaAmount is for", async () => {
      const answer = await write(mushrooms, {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: "-1",
        occurredAt: NOW,
      });

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions[0]?.deltaMicros).toBe("-1000000");
    });
  });

  describe("the three tokens, for every write endpoint", () => {
    it("lets the other member of the household write to the same items", async () => {
      const itemId = seedItemId("rice");
      const answer = await write(
        itemId,
        { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
        { token: MAYA },
      );

      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions[0]?.actor).toEqual({
        kind: "user",
        displayInitials: "MC",
      });
    });

    it.each([
      ["a member", MAYA],
      ["the owner", DEAN],
    ])("shows %s the same detail payload", async (_case, token) => {
      const mine = await detail(seedItemId("rice"), token);
      expect(mine.statusCode).toBe(200);
      expect(mine.body.summary.itemId).toBe(seedItemId("rice"));
    });

    it("answers 404 to the other household's token on GET, POST and undo", async () => {
      const itemId = seedItemId("chicken");
      const rows = await db.pool.query<{ id: string }>(
        `SELECT id FROM inventory_transactions WHERE item_id = $1 ORDER BY sequence LIMIT 1`,
        [itemId],
      );
      const transactionId = rows.rows[0]?.id ?? "";

      const read = await detail(itemId, OKAFOR);
      const written = await write(
        itemId,
        { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
        { token: OKAFOR },
      );
      const undone = await undo(
        itemId,
        transactionId,
        { idempotencyKey: key(), occurredAt: NOW },
        OKAFOR,
      );

      expect(read.statusCode).toBe(404);
      expect(written.statusCode).toBe(404);
      expect(undone.statusCode).toBe(404);
    });

    it("answers a foreign item exactly as it answers an item that does not exist", async () => {
      const foreign = await write(
        okaforItemId,
        { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
        { token: DEAN },
      );
      const absent = await write(
        randomUUID(),
        { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
        { token: DEAN },
      );

      expect(foreign.statusCode).toBe(404);
      expect(absent.statusCode).toBe(404);
      expect(foreign.error?.code).toBe(absent.error?.code);
      expect(foreign.error?.message).toBe(absent.error?.message);
    });

    it("writes nothing to the other household's item while refusing", async () => {
      const before = await rowCount(okaforItemId);
      await write(
        okaforItemId,
        { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
        { token: DEAN },
      );
      expect(await rowCount(okaforItemId)).toBe(before);
    });

    it("answers 401 for a missing or unknown token, before any database work", async () => {
      const response = await app.inject({
        method: "POST",
        url: inventoryItemTransactionsPath(seedItemId("rice")),
        headers: { "content-type": "application/json" },
        payload: { idempotencyKey: key(), type: "CONSUME", amount: "1", occurredAt: NOW },
      });
      expect(response.statusCode).toBe(401);
    });

    it("ignores a header naming another household and writes to the caller's own item", async () => {
      const itemId = seedItemId("olive-oil");
      const response = await app.inject({
        method: "POST",
        url: inventoryItemTransactionsPath(itemId),
        headers: {
          authorization: `Bearer ${DEAN}`,
          "content-type": "application/json",
          "x-household-id": okaforHousehold,
        },
        payload: {
          idempotencyKey: key(),
          type: "ADJUSTMENT",
          deltaAmount: "1",
          occurredAt: NOW,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.json())).not.toContain(okaforHousehold);
    });
  });

  describe("row-level security is what refuses the write, not the application layer", () => {
    /**
     * The mutation. The tenant-session runner is replaced with one that opens
     * the transaction with **no** household context: same handler, same SQL,
     * same session, only `set_config('app.household_id', …)` removed.
     *
     * If the write still landed, the isolation proved above would rest on the
     * application's own `WHERE household_id = $1` alone. It does not land:
     * `app_current_household()` is NULL, every policy denies, the item's
     * `SELECT … FOR UPDATE` finds nothing, and the handler answers the same
     * 404 it answers for another household's item (migration 0006,
     * fail-closed).
     */
    it("refuses a write that would otherwise succeed, and appends nothing", async () => {
      const itemId = seedItemId("rice");
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = buildWith(contextless);

      try {
        const before = await rowCount(itemId);
        const body = {
          idempotencyKey: key(),
          type: "CONSUME" as const,
          amount: "1",
          occurredAt: NOW,
        };
        const control = await write(itemId, body);
        const mutated = await write(
          itemId,
          { ...body, idempotencyKey: key() },
          { instance: sabotaged },
        );

        expect(control.statusCode).toBe(200);
        expect(mutated.statusCode).toBe(404);
        // One row from the control, none from the mutation.
        expect(await rowCount(itemId)).toBe(before + 1);
      } finally {
        await sabotaged.close();
      }
    });
  });

  describe("a lost race is retried, and the write still lands once", () => {
    it("re-runs the whole transaction after a 40001 and appends exactly one set of rows", async () => {
      const itemId = seedItemId("olive-oil");
      const real = createTenantSessionRunner(db.pool);
      let attempts = 0;
      const flaky: TenantSessionRunner = {
        read: real.read.bind(real),
        write: <T>(session: never, fn: (client: PoolClient) => Promise<T>) =>
          real.write(session, async (client) => {
            attempts += 1;
            if (attempts === 1) {
              // A real statement first, so the injected failure aborts a
              // transaction that had already done work, exactly as a lost
              // race does.
              await client.query("SELECT 1");
              const error: Error & { code?: string } = new Error(
                "could not serialize access due to concurrent update",
              );
              error.code = "40001";
              throw error;
            }
            return fn(client);
          }),
      };
      const retrying = buildWith(flaky);

      try {
        const before = await storedMicros(itemId);
        const answer = await write(
          itemId,
          {
            idempotencyKey: key(),
            type: "ADJUSTMENT",
            deltaAmount: "1",
            occurredAt: NOW,
          },
          { instance: retrying },
        );

        expect(attempts).toBe(2);
        expect(answer.statusCode).toBe(200);
        expect(answer.body.transactions).toHaveLength(1);
        expect(BigInt(await storedMicros(itemId))).toBe(BigInt(before) + 1_000_000n);
      } finally {
        await retrying.close();
      }
    });

    it("does not retry an idempotency conflict, which no re-run could change", async () => {
      const itemId = seedItemId("olive-oil");
      const conflictKey = key();
      const first = await write(itemId, {
        idempotencyKey: conflictKey,
        type: "ADJUSTMENT",
        deltaAmount: "1",
        occurredAt: NOW,
      });
      const before = Date.now();
      const second = await write(itemId, {
        idempotencyKey: conflictKey,
        type: "ADJUSTMENT",
        deltaAmount: "2",
        occurredAt: NOW,
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(409);
      // Three attempts with the default backoff would take at least 75ms; a
      // terminal conflict answers immediately.
      expect(Date.now() - before).toBeLessThan(75);
    });
  });

  describe("what the logs say about a write", () => {
    it("records the write with a correlation id and nothing a person typed", async () => {
      const itemId = seedItemId("rice");
      const before = logLines.length;
      const answer = await write(itemId, {
        idempotencyKey: key(),
        type: "CONSUME",
        amount: "1",
        occurredAt: NOW,
        reason: "Used it all",
      });
      const written = logLines.slice(before);

      expect(answer.statusCode).toBe(200);
      expect(written.join("\n")).toContain("inventory.write.applied");
      expect(
        written.some(
          (line) => (JSON.parse(line) as { reqId?: string }).reqId === answer.correlationId,
        ),
      ).toBe(true);
      // The reason is a person's words: it is recorded in the ledger, never in
      // a log line.
      expect(written.join("\n")).not.toContain("Used it all");
    });

    it("records a refusal by code, without the domain's message", async () => {
      const before = logLines.length;
      await write(seedItemId("mushrooms"), {
        idempotencyKey: key(),
        type: "ADJUSTMENT",
        deltaAmount: "0",
        occurredAt: NOW,
      });
      const written = logLines.slice(before).join("\n");

      expect(written).toContain("inventory.write.refused");
      expect(written).toContain("ZERO_DELTA");
      expect(written).not.toContain("a transaction must change the quantity");
    });

    it.each(["Dean Chen", "Maya Chen", "dean.chen@fixture.invalid", "fixture.dean.chen"])(
      "never writes %s to the log",
      (needle) => {
        expect(logLines.filter((line) => line.includes(needle))).toEqual([]);
      },
    );
  });

  describe("the ledger's own rules still hold underneath", () => {
    it("has no UPDATE or DELETE path: every balance change is an appended row", async () => {
      const rows = await db.pool.query<{ item_id: string; derived: string; snapshot: string }>(
        `SELECT i.id AS item_id,
                coalesce(sum(t.qty_delta_micros), 0)::text AS derived,
                i.current_qty_micros::text                 AS snapshot
           FROM inventory_items AS i
           LEFT JOIN inventory_transactions AS t ON t.item_id = i.id
          WHERE i.household_id = $1
          GROUP BY i.id, i.current_qty_micros`,
        [chenHousehold],
      );

      expect(rows.rows.length).toBeGreaterThan(0);
      for (const row of rows.rows) expect(row.derived).toBe(row.snapshot);
    });

    it("reports no reconciliation drift for any item the suite touched", async () => {
      const bad = await db.pool.query<{ item_id: string }>(
        `SELECT item_id FROM inventory_reconciliation WHERE NOT ok`,
      );
      expect(bad.rows).toEqual([]);
    });

    it("gives the runtime role no way to change a recorded row", async () => {
      // One connection for all three statements (review F7). `SET ROLE` is
      // session state, so issuing it through the pool and then issuing the
      // UPDATE through the pool again can hand out two different connections:
      // the UPDATE would run as the owner, succeed, and the test would report
      // "allowed" while proving nothing about `sk_app`. Worse, a pooled
      // connection could be left with the role still set for the next borrower.
      const client = await db.pool.connect();
      let denied: string | undefined;
      try {
        await client.query(`SET ROLE ${APP_ROLE}`);
        try {
          await client.query(`UPDATE inventory_transactions SET qty_delta_micros = 0 WHERE true`);
          denied = "allowed";
        } catch (error) {
          denied = (error as { code?: string }).code;
        }
        await client.query("RESET ROLE");
      } finally {
        client.release();
      }

      // 42501 is insufficient_privilege: the grant was never made (0006).
      expect(denied).toBe("42501");
    });

    it("gives it no way to delete one either", async () => {
      const client = await db.pool.connect();
      let denied: string | undefined;
      try {
        await client.query(`SET ROLE ${APP_ROLE}`);
        try {
          await client.query(`DELETE FROM inventory_transactions WHERE true`);
          denied = "allowed";
        } catch (error) {
          denied = (error as { code?: string }).code;
        }
        await client.query("RESET ROLE");
      } finally {
        client.release();
      }

      expect(denied).toBe("42501");
    });
  });
});
