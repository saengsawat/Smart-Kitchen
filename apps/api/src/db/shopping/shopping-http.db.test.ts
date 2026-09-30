/**
 * M7-T1 over HTTP: the shopping list read, check-off, add-to-inventory once
 * per row and remove, through the real pipeline (fixture identity port, the
 * authorization hook, row-level security) on a throwaway database seeded
 * with the development seed's Chen household.
 *
 * What is attacked, in the order the ticket's review brief lists it: adding a
 * row's purchase twice (replay, a new key, five at once, two connections
 * held open), reaching another household's rows, a gap the domain would not
 * produce, a have-quantity lying about its tier, and a changed payload under
 * a used key. Every negative has a positive control near it.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import {
  SHOPPING_PATH,
  inventoryItemPath,
  shoppingRowAddToInventoryPath,
  shoppingRowCheckPath,
  shoppingRowRemovePath,
  type ApiErrorBodyDto,
  type InventoryItemDetailDto,
  type InventoryWriteResponseDto,
  type ShoppingListDto,
  type ShoppingRowDto,
} from "@smart-kitchen/contracts";
import { neededQuantity } from "@smart-kitchen/domain";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "../../http/tenant-session.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../../identity/index.js";
import { seedFixtureIdentities } from "../../identity/test-support/seed-fixture-identities.js";
import { seedChenInventory, seedItemId, seedLotId } from "../../seed/fixture-inventory.js";
import { seedChenShopping, seedShoppingRowId } from "../../seed/fixture-shopping.js";
import { appendTransactionToDb } from "../inventory/repository.js";
import { migrateDown, migrateUp } from "../migrate.js";
import { withHouseholdTransaction } from "../session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../test-support/harness.js";
import {
  addShoppingRowToInventory,
  SHOPPING_CHECK_OFF_SOURCE,
  shoppingPurchaseKey,
} from "./service.js";

const SUITE = "M7-T1: shopping list endpoints over HTTP";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const ADA = "fixture.owner.other";
const NEW = "fixture.new.user";

const CHICKEN_ROW = seedShoppingRowId("chicken");
const TOWELS_ROW = seedShoppingRowId("paper-towels");
const OLIVE_ROW = seedShoppingRowId("olive-oil");
const CHICKEN_ITEM = seedItemId("chicken");

interface Answer<T> {
  readonly statusCode: number;
  readonly body: T;
}

let keyCounter = 0;
/** A fresh client key, in the M2-T2 shape. */
function key(): string {
  keyCounter += 1;
  return `m7t1-${String(keyCounter)}-${randomUUID()}`;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let app: FastifyInstance;
  let logLines: string[];
  let chenId: string;
  let okaforId: string;
  let deanUserId: string;
  let deanMemberId: string;
  let mayaMemberId: string;
  const usedKeys: string[] = [];

  function build(tenantSession: TenantSessionRunner = createTenantSessionRunner(db.pool)) {
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

  async function call<T>(
    method: "GET" | "POST",
    url: string,
    token: string | undefined,
    body?: unknown,
    instance: FastifyInstance = app,
  ): Promise<Answer<T>> {
    const response = await instance.inject({
      method,
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return {
      statusCode: response.statusCode,
      body: (response.body === "" ? undefined : response.json()) as T,
    };
  }

  function list(token: string, instance?: FastifyInstance): Promise<Answer<ShoppingListDto>> {
    return call<ShoppingListDto>("GET", SHOPPING_PATH, token, undefined, instance);
  }

  function check<T = ShoppingRowDto>(
    token: string | undefined,
    rowId: string,
    checked: boolean,
    idempotencyKey: string,
    instance?: FastifyInstance,
  ): Promise<Answer<T>> {
    usedKeys.push(idempotencyKey);
    return call<T>(
      "POST",
      shoppingRowCheckPath(rowId),
      token,
      { checked, idempotencyKey },
      instance,
    );
  }

  function add<T = InventoryWriteResponseDto>(
    token: string | undefined,
    rowId: string,
    idempotencyKey: string,
    instance?: FastifyInstance,
  ): Promise<Answer<T>> {
    usedKeys.push(idempotencyKey);
    return call<T>(
      "POST",
      shoppingRowAddToInventoryPath(rowId),
      token,
      { idempotencyKey },
      instance,
    );
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const result = await db.pool.query<{ count: string }>(sql, params);
    return Number(result.rows[0]?.count ?? "0");
  }

  function ledgerRows(itemId: string): Promise<number> {
    return count("SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1", [
      itemId,
    ]);
  }

  function writesFor(rowId: string): Promise<number> {
    return count("SELECT count(*)::text AS count FROM shopping_row_writes WHERE row_id = $1", [
      rowId,
    ]);
  }

  async function storedRow(rowId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.pool.query<Record<string, unknown>>(
      "SELECT * FROM shopping_rows WHERE id = $1",
      [rowId],
    );
    return result.rows[0];
  }

  async function memberIdOf(householdId: string, userId: string): Promise<string> {
    const result = await db.pool.query<{ id: string }>(
      "SELECT id FROM household_memberships WHERE household_id = $1 AND user_id = $2",
      [householdId, userId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("fixture membership missing");
    return id;
  }

  /** A row written as the owner role, the way a later ticket's add-row endpoint would. */
  async function insertRow(options: {
    readonly name: string;
    readonly needMicros: bigint;
    readonly unit: string;
    readonly itemId: string | null;
    readonly done?: boolean;
    readonly householdId?: string;
    readonly memberId?: string;
    readonly createdBy?: string;
  }): Promise<string> {
    const id = randomUUID();
    const member = options.memberId ?? deanMemberId;
    await db.pool.query(
      `INSERT INTO shopping_rows
         (id, household_id, name, group_label, origin_kind, origin_member_id, need_micros, unit,
          item_id, default_location, status, checked_off_by, checked_off_at, created_by)
       VALUES ($1, $2, $3, 'Test', 'member', $4, $5, $6, $7, 'PANTRY', $8, $9, $10, $11)`,
      [
        id,
        options.householdId ?? chenId,
        options.name,
        member,
        options.needMicros.toString(),
        options.unit,
        options.itemId,
        options.done === true ? "done" : "open",
        options.done === true ? member : null,
        options.done === true ? new Date().toISOString() : null,
        options.createdBy ?? deanUserId,
      ],
    );
    return id;
  }

  function rowOf(body: ShoppingListDto, rowId: string): ShoppingRowDto {
    const row = body.rows.find((candidate) => candidate.rowId === rowId);
    if (row === undefined) throw new Error(`row ${rowId} is not on the list`);
    return row;
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m7t1-shopping");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);
    const dean = fixture.sessions.find((s) => s.token === DEAN);
    const maya = fixture.sessions.find((s) => s.token === MAYA);
    const ada = fixture.sessions.find((s) => s.token === ADA);
    if (dean === undefined || maya === undefined || ada === undefined) {
      throw new Error("fixture map lost a session");
    }
    chenId = dean.householdId;
    okaforId = ada.householdId;
    deanUserId = dean.userId;
    await seedChenInventory(db.pool, chenId, dean.userId);
    await seedChenShopping(db.pool, chenId, { deanUserId: dean.userId, mayaUserId: maya.userId });
    deanMemberId = await memberIdOf(chenId, dean.userId);
    mayaMemberId = await memberIdOf(chenId, maya.userId);
    app = build();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("GET /v1/shopping", () => {
    it("lists the seeded Chen rows for Dean with the chicken gap computed from the real snapshot (0.75 lb)", async () => {
      const answer = await list(DEAN);
      expect(answer.statusCode).toBe(200);
      expect(answer.body.rows.map((row) => row.rowId)).toEqual([
        CHICKEN_ROW,
        TOWELS_ROW,
        OLIVE_ROW,
      ]);

      const chicken = rowOf(answer.body, CHICKEN_ROW);
      expect(chicken).toEqual({
        rowId: CHICKEN_ROW,
        name: "Chicken breast",
        group: "Meat & seafood",
        origin: {
          kind: "member",
          memberId: deanMemberId,
          initials: "DC",
          displayName: "Dean Chen",
        },
        needMicros: "2000000",
        haveMicros: "1250000",
        haveTier: "KNOWN_FACT",
        buyMicros: "750000",
        unit: "lb",
        itemId: CHICKEN_ITEM,
        status: "open",
        checkedOffBy: null,
        defaultLocation: "FRIDGE",
      });

      // The snapshot the gap was computed from is the one S4 shows.
      const item = await call<InventoryItemDetailDto>("GET", inventoryItemPath(CHICKEN_ITEM), DEAN);
      expect(item.body.summary.quantity.micros).toBe(chicken.haveMicros);
      expect(item.body.summary.provenance.quantity?.tier).toBe(chicken.haveTier);

      const towels = rowOf(answer.body, TOWELS_ROW);
      expect(towels.origin).toEqual({
        kind: "member",
        memberId: mayaMemberId,
        initials: "MC",
        displayName: "Maya Chen",
      });
      expect(towels).toMatchObject({
        haveMicros: "0",
        haveTier: null,
        buyMicros: "1000000",
        unit: "each",
        itemId: null,
        status: "open",
        defaultLocation: "PANTRY",
      });

      const olive = rowOf(answer.body, OLIVE_ROW);
      expect(olive).toMatchObject({ status: "done", checkedOffBy: "DC", itemId: null });

      expect(answer.body.members).toEqual([
        { memberId: deanMemberId, initials: "DC", displayName: "Dean Chen" },
        { memberId: mayaMemberId, initials: "MC", displayName: "Maya Chen" },
      ]);
      expect(Number.isNaN(Date.parse(answer.body.syncedAt))).toBe(false);
      expect(answer.body.syncedAt.endsWith("Z")).toBe(true);
    });

    it("never hands back a buy the domain's neededQuantity would not produce", async () => {
      const answer = await list(DEAN);
      for (const row of answer.body.rows) {
        const recomputed = neededQuantity(
          BigInt(row.needMicros),
          row.unit,
          BigInt(row.haveMicros),
          row.unit,
        );
        expect(recomputed.ok).toBe(true);
        if (recomputed.ok) expect(BigInt(row.buyMicros)).toBe(recomputed.value.micros);
      }
    });

    it("answers the same list to Maya, a plain member", async () => {
      const [dean, maya] = await Promise.all([list(DEAN), list(MAYA)]);
      expect(maya.statusCode).toBe(200);
      expect(maya.body.rows).toEqual(dean.body.rows);
    });

    it("gives the Okafor owner their own (empty) list and nothing of Chen's", async () => {
      const answer = await list(ADA);
      expect(answer.statusCode).toBe(200);
      expect(answer.body.rows).toEqual([]);
      const text = JSON.stringify(answer.body);
      for (const id of [CHICKEN_ROW, TOWELS_ROW, OLIVE_ROW, chenId, deanMemberId, mayaMemberId]) {
        expect(text).not.toContain(id);
      }
    });

    it("refuses a signed-in user with no household (403) and no session at all (401)", async () => {
      expect((await list(NEW)).statusCode).toBe(403);
      const anonymous = await call<ApiErrorBodyDto>("GET", SHOPPING_PATH, undefined);
      expect(anonymous.statusCode).toBe(401);
    });

    it("answers a unit mismatch with nothing on hand and no tier, never a conversion", async () => {
      // Spinach is held in oz (5 oz); a 1 lb row over it must not become 1 lb - 5 oz.
      const rowId = await insertRow({
        name: "Spinach by the pound",
        needMicros: 1_000_000n,
        unit: "lb",
        itemId: seedItemId("spinach"),
      });
      const row = rowOf((await list(DEAN)).body, rowId);
      expect(row).toMatchObject({
        haveMicros: "0",
        haveTier: null,
        buyMicros: "1000000",
        status: "open",
      });
    });

    it("answers a row the item already covers as skipped, with the real amount and the snapshot's tier", async () => {
      // Yogurt: three 16 oz lots, all Known Fact.
      const rowId = await insertRow({
        name: "Yogurt for the week",
        needMicros: 3_000_000n,
        unit: "oz",
        itemId: seedItemId("yogurt"),
      });
      const row = rowOf((await list(DEAN)).body, rowId);
      expect(row).toMatchObject({
        haveMicros: "48000000",
        haveTier: "KNOWN_FACT",
        buyMicros: "0",
        status: "skipped",
      });
    });

    it("reports an estimated snapshot as estimated, never upgraded", async () => {
      // Mushrooms were recorded from a receipt read: an AI interpretation.
      const rowId = await insertRow({
        name: "Mushrooms",
        needMicros: 10_000_000n,
        unit: "oz",
        itemId: seedItemId("mushrooms"),
      });
      const row = rowOf((await list(DEAN)).body, rowId);
      expect(row).toMatchObject({
        haveMicros: "8000000",
        haveTier: "AI_INTERPRETATION",
        buyMicros: "2000000",
      });
    });
  });

  describe("POST /v1/shopping/rows/{rowId}/check", () => {
    it("refuses Ada (404, row unchanged), the household-less user (403) and no session (401)", async () => {
      const before = await storedRow(CHICKEN_ROW);
      const ada = await check<ApiErrorBodyDto>(ADA, CHICKEN_ROW, true, key());
      expect(ada.statusCode).toBe(404);
      expect(ada.body.error.code).toBe("NOT_FOUND");
      expect((await check(NEW, CHICKEN_ROW, true, key())).statusCode).toBe(403);
      expect((await check(undefined, CHICKEN_ROW, true, key())).statusCode).toBe(401);
      expect(await storedRow(CHICKEN_ROW)).toEqual(before);
      expect(await writesFor(CHICKEN_ROW)).toBe(0);
    });

    it("answers a row id that is not a uuid, and one that does not exist, with the same 404", async () => {
      const junk = await check<ApiErrorBodyDto>(DEAN, "not-a-row", true, key());
      const missing = await check<ApiErrorBodyDto>(DEAN, randomUUID(), true, key());
      expect(junk.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(missing.body.error.message).toBe(junk.body.error.message);
    });

    it("refuses a body naming a household or a member, and a body missing its state", async () => {
      const forged = await call<ApiErrorBodyDto>("POST", shoppingRowCheckPath(CHICKEN_ROW), DEAN, {
        checked: true,
        idempotencyKey: key(),
        householdId: okaforId,
      });
      expect(forged.statusCode).toBe(400);
      const actor = await call<ApiErrorBodyDto>("POST", shoppingRowCheckPath(CHICKEN_ROW), DEAN, {
        checked: true,
        idempotencyKey: key(),
        checkedOffBy: mayaMemberId,
      });
      expect(actor.statusCode).toBe(400);
      const stateless = await call<ApiErrorBodyDto>(
        "POST",
        shoppingRowCheckPath(CHICKEN_ROW),
        DEAN,
        { idempotencyKey: key() },
      );
      expect(stateless.statusCode).toBe(400);
      const stringy = await call<ApiErrorBodyDto>("POST", shoppingRowCheckPath(CHICKEN_ROW), DEAN, {
        checked: "true",
        idempotencyKey: key(),
      });
      expect(stringy.statusCode).toBe(400);
      // AJV's instance-wide coercion would read these as false; the route refuses them.
      for (const checked of [null, 0, "", "false"]) {
        const coerced = await call<ApiErrorBodyDto>(
          "POST",
          shoppingRowCheckPath(CHICKEN_ROW),
          DEAN,
          { checked, idempotencyKey: key() },
        );
        expect(coerced.statusCode).toBe(400);
      }
      expect(await writesFor(CHICKEN_ROW)).toBe(0);
    });

    it("refuses a key outside the M2-T2 shape with the ledger's own code", async () => {
      const answer = await check<ApiErrorBodyDto>(DEAN, CHICKEN_ROW, true, "has space");
      expect(answer.statusCode).toBe(400);
      expect(answer.body.error.ledgerCode).toBe("INVALID_IDEMPOTENCY_KEY");
      const slashed = await check<ApiErrorBodyDto>(DEAN, CHICKEN_ROW, true, "a/lot/0");
      expect(slashed.statusCode).toBe(400);
    });

    it("Maya checks chicken off, replays the same key (200, nothing new), and a changed payload is 409", async () => {
      const k1 = key();
      const first = await check(MAYA, CHICKEN_ROW, true, k1);
      expect(first.statusCode).toBe(200);
      expect(first.body).toMatchObject({ rowId: CHICKEN_ROW, status: "done", checkedOffBy: "MC" });
      const stored = await storedRow(CHICKEN_ROW);
      expect(stored?.["checked_off_by"]).toBe(mayaMemberId);
      expect(stored?.["checked_off_at"]).toBeInstanceOf(Date);

      const replay = await check(MAYA, CHICKEN_ROW, true, k1);
      expect(replay.statusCode).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(await writesFor(CHICKEN_ROW)).toBe(1);
      expect(await storedRow(CHICKEN_ROW)).toEqual(stored);

      const changed = await check<ApiErrorBodyDto>(MAYA, CHICKEN_ROW, false, k1);
      expect(changed.statusCode).toBe(409);
      expect(changed.body.error.code).toBe("CONFLICT");
      expect(changed.body.error.ledgerCode).toBe("IDEMPOTENCY_KEY_CONFLICT");

      // The same key from someone else, or aimed at another row, is not a replay either.
      const otherActor = await check<ApiErrorBodyDto>(DEAN, CHICKEN_ROW, true, k1);
      expect(otherActor.statusCode).toBe(409);
      const otherRow = await check<ApiErrorBodyDto>(MAYA, TOWELS_ROW, true, k1);
      expect(otherRow.statusCode).toBe(409);

      expect(await writesFor(CHICKEN_ROW)).toBe(1);
      expect(await writesFor(TOWELS_ROW)).toBe(0);
      expect(await storedRow(CHICKEN_ROW)).toEqual(stored);
    });

    it("checking a row that is already done is a no-op 200 that keeps who checked it and when", async () => {
      const before = await storedRow(CHICKEN_ROW);
      const again = await check(DEAN, CHICKEN_ROW, true, key());
      expect(again.statusCode).toBe(200);
      expect(again.body).toMatchObject({ status: "done", checkedOffBy: "MC" });
      expect(await storedRow(CHICKEN_ROW)).toEqual(before);
    });

    it("never writes a ledger row", async () => {
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(4);
    });
  });

  describe("POST /v1/shopping/rows/{rowId}/add-to-inventory", () => {
    let purchaseId: string;

    it("refuses Ada (404) and the household-less user (403), appending nothing", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const ada = await add<ApiErrorBodyDto>(ADA, CHICKEN_ROW, key());
      expect(ada.statusCode).toBe(404);
      expect((await add(NEW, CHICKEN_ROW, key())).statusCode).toBe(403);
      expect((await add(undefined, CHICKEN_ROW, key())).statusCode).toBe(401);
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);
      expect((await storedRow(CHICKEN_ROW))?.["added_transaction_id"]).toBeNull();
    });

    it("refuses a body that names anything but a key", async () => {
      const answer = await call<ApiErrorBodyDto>(
        "POST",
        shoppingRowAddToInventoryPath(CHICKEN_ROW),
        DEAN,
        { idempotencyKey: key(), amount: "5" },
      );
      expect(answer.statusCode).toBe(400);
    });

    it("Dean adds chicken once: one PURCHASE of 0.75 lb, Known Fact, source shopping-check-off, actor Dean", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const k = key();
      const answer = await add(DEAN, CHICKEN_ROW, k);
      expect(answer.statusCode).toBe(201);
      expect(answer.body.replayed).toBe(false);
      expect(answer.body.transactions).toHaveLength(1);
      const purchase = answer.body.transactions[0];
      expect(purchase).toMatchObject({
        type: "PURCHASE",
        deltaMicros: "750000",
        amount: "0.750000",
        actor: { kind: "user", displayInitials: "DC" },
        provenance: { tier: "KNOWN_FACT", source: SHOPPING_CHECK_OFF_SOURCE },
      });
      purchaseId = purchase?.transactionId ?? "";
      expect(answer.body.item.summary.quantity.micros).toBe("2000000");
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before + 1);

      const stored = await storedRow(CHICKEN_ROW);
      expect(stored?.["added_transaction_id"]).toBe(purchaseId);

      // Exactly one row under the row's derived ledger key, correlated to the row.
      const ledger = await db.pool.query<{
        idempotency_key: string;
        correlation_kind: string;
        correlation_id: string;
        actor_user_id: string;
        unit: string;
      }>(
        `SELECT idempotency_key, correlation_kind, correlation_id, actor_user_id, unit
           FROM inventory_transactions WHERE id = $1`,
        [purchaseId],
      );
      expect(ledger.rows[0]).toEqual({
        idempotency_key: shoppingPurchaseKey(CHICKEN_ROW, 1),
        correlation_kind: "shopping-item",
        correlation_id: CHICKEN_ROW,
        actor_user_id: deanUserId,
        unit: "lb",
      });

      // S5 shows it: exactly one shopping PURCHASE in the item's history.
      const detail = await call<InventoryItemDetailDto>(
        "GET",
        inventoryItemPath(CHICKEN_ITEM),
        DEAN,
      );
      const fromShopping = detail.body.history.filter(
        (row) => row.provenance.source === SHOPPING_CHECK_OFF_SOURCE,
      );
      expect(fromShopping).toHaveLength(1);
      expect(fromShopping[0]?.transactionId).toBe(purchaseId);
      expect(fromShopping[0]?.deltaMicros).toBe("750000");
    });

    it("a second add with a new key appends nothing and returns the same transaction (200)", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const answer = await add(DEAN, CHICKEN_ROW, key());
      expect(answer.statusCode).toBe(200);
      expect(answer.body.replayed).toBe(true);
      expect(answer.body.transactions.map((row) => row.transactionId)).toEqual([purchaseId]);
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);
    });

    it("the same from Maya: any member's second add is the same PURCHASE", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const answer = await add(MAYA, CHICKEN_ROW, key());
      expect(answer.statusCode).toBe(200);
      expect(answer.body.transactions[0]?.transactionId).toBe(purchaseId);
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);
    });

    it("replaying the first key is a replay; the same key from another member or on another row is 409", async () => {
      const k = key();
      const first = await add(DEAN, CHICKEN_ROW, k);
      expect(first.statusCode).toBe(200);
      const replay = await add(DEAN, CHICKEN_ROW, k);
      expect(replay.statusCode).toBe(200);
      expect(replay.body.transactions[0]?.transactionId).toBe(purchaseId);
      const otherActor = await add<ApiErrorBodyDto>(MAYA, CHICKEN_ROW, k);
      expect(otherActor.statusCode).toBe(409);
      expect(otherActor.body.error.ledgerCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
      // A check-off key reused for an add is a different change too.
      const checkKey = key();
      expect((await check(DEAN, CHICKEN_ROW, true, checkKey)).statusCode).toBe(200);
      const crossKind = await add<ApiErrorBodyDto>(DEAN, CHICKEN_ROW, checkKey);
      expect(crossKind.statusCode).toBe(409);
    });

    it("unchecking after the add does not reverse the PURCHASE, and a re-add is still the same one", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const unchecked = await check(DEAN, CHICKEN_ROW, false, key());
      expect(unchecked.statusCode).toBe(200);
      // 2 lb now held against a 2 lb need: the domain says nothing to buy.
      expect(unchecked.body).toMatchObject({
        buyMicros: "0",
        checkedOffBy: null,
        status: "skipped",
      });
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);
      expect((await storedRow(CHICKEN_ROW))?.["added_transaction_id"]).toBe(purchaseId);

      expect((await check(DEAN, CHICKEN_ROW, true, key())).statusCode).toBe(200);
      const again = await add(DEAN, CHICKEN_ROW, key());
      expect(again.statusCode).toBe(200);
      expect(again.body.transactions[0]?.transactionId).toBe(purchaseId);
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);

      const item = await call<InventoryItemDetailDto>("GET", inventoryItemPath(CHICKEN_ITEM), DEAN);
      expect(item.body.summary.quantity.micros).toBe("2000000");
    });

    it("answers a row without an item with ROW_HAS_NO_ITEM (409), open or done", async () => {
      const open = await add<ApiErrorBodyDto>(DEAN, TOWELS_ROW, key());
      expect(open.statusCode).toBe(409);
      expect(open.body.error.code).toBe("ROW_HAS_NO_ITEM");
      expect(open.body.error.ledgerCode).toBeUndefined();
      const done = await add<ApiErrorBodyDto>(DEAN, OLIVE_ROW, key());
      expect(done.statusCode).toBe(409);
      expect(done.body.error.code).toBe("ROW_HAS_NO_ITEM");
      expect(await writesFor(OLIVE_ROW)).toBe(0);
    });

    it("refuses an add on a row that is not checked off (409), appending nothing", async () => {
      const rowId = await insertRow({
        name: "Strawberries",
        needMicros: 2_000_000n,
        unit: "lb",
        itemId: seedItemId("strawberries"),
      });
      const before = await ledgerRows(seedItemId("strawberries"));
      const answer = await add<ApiErrorBodyDto>(DEAN, rowId, key());
      expect(answer.statusCode).toBe(409);
      expect(answer.body.error.code).toBe("CONFLICT");
      expect(await ledgerRows(seedItemId("strawberries"))).toBe(before);
    });

    it("lets the ledger refuse a unit mismatch (MIXED_UNITS): nothing appended, nothing recorded on the row", async () => {
      const rowId = await insertRow({
        name: "Spinach, mismatched",
        needMicros: 1_000_000n,
        unit: "lb",
        itemId: seedItemId("spinach"),
        done: true,
      });
      const before = await ledgerRows(seedItemId("spinach"));
      const answer = await add<ApiErrorBodyDto>(DEAN, rowId, key());
      expect(answer.statusCode).toBe(400);
      expect(answer.body.error.ledgerCode).toBe("MIXED_UNITS");
      expect(await ledgerRows(seedItemId("spinach"))).toBe(before);
      expect((await storedRow(rowId))?.["added_transaction_id"]).toBeNull();
      expect(await writesFor(rowId)).toBe(0);
    });

    it("lets the ledger refuse a zero gap (ZERO_DELTA) rather than recording an empty purchase", async () => {
      const rowId = await insertRow({
        name: "Yogurt, covered",
        needMicros: 1_000_000n,
        unit: "oz",
        itemId: seedItemId("yogurt"),
        done: true,
      });
      const answer = await add<ApiErrorBodyDto>(DEAN, rowId, key());
      expect(answer.statusCode).toBe(400);
      expect(answer.body.error.ledgerCode).toBe("ZERO_DELTA");
    });

    it("five concurrent adds with five keys append exactly one PURCHASE and all name it", async () => {
      const itemId = seedItemId("salmon");
      const rowId = await insertRow({
        name: "Salmon",
        needMicros: 40_000_000n,
        unit: "oz",
        itemId,
        done: true,
      });
      const before = await ledgerRows(itemId);
      const answers = await Promise.all(
        Array.from({ length: 5 }, (_, index) => add(index % 2 === 0 ? DEAN : MAYA, rowId, key())),
      );
      const statuses = answers.map((answer) => answer.statusCode).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      const ids = new Set(answers.map((answer) => answer.body.transactions[0]?.transactionId));
      expect(ids.size).toBe(1);
      expect(await ledgerRows(itemId)).toBe(before + 1);
      expect(await writesFor(rowId)).toBe(5);
    });

    it("five concurrent adds under one key append exactly one PURCHASE", async () => {
      const itemId = seedItemId("rice");
      const rowId = await insertRow({
        name: "Rice",
        needMicros: 9_000_000n,
        unit: "cup",
        itemId,
        done: true,
      });
      const before = await ledgerRows(itemId);
      const k = key();
      const answers = await Promise.all(Array.from({ length: 5 }, () => add(DEAN, rowId, k)));
      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(answers.map((a) => a.body.transactions[0]?.transactionId)).size).toBe(1);
      expect(await ledgerRows(itemId)).toBe(before + 1);
      expect(await writesFor(rowId)).toBe(1);
    });

    it("two connections: the second add waits on the row lock and then answers with the first one's PURCHASE", async () => {
      const itemId = seedItemId("strawberries");
      const rowId = await insertRow({
        name: "Strawberries, two phones",
        needMicros: 3_000_000n,
        unit: "lb",
        itemId,
        done: true,
      });
      const before = await ledgerRows(itemId);

      let releaseFirst: () => void = () => undefined;
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstAppended: () => void = () => undefined;
      const firstInside = new Promise<void>((resolve) => {
        firstAppended = resolve;
      });

      const first = withHouseholdTransaction(
        db.pool,
        chenId,
        async (client) => {
          const result = await addShoppingRowToInventory(client, chenId, rowId, {
            idempotencyKey: key(),
            actorUserId: deanUserId,
          });
          firstAppended();
          await firstHeld;
          return result;
        },
        { assumeRole: APP_ROLE },
      );
      await firstInside;

      let secondSettled = false;
      const second = withHouseholdTransaction(
        db.pool,
        chenId,
        (client) =>
          addShoppingRowToInventory(client, chenId, rowId, {
            idempotencyKey: key(),
            actorUserId: deanUserId,
          }),
        { assumeRole: APP_ROLE },
      ).finally(() => {
        secondSettled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(secondSettled).toBe(false);

      releaseFirst();
      const [a, b] = await Promise.all([first, second]);
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.transactionId).toBe(a.transactionId);
      expect(await ledgerRows(itemId)).toBe(before + 1);
    });

    it("a second row for the same item is a new gap and gets its own PURCHASE (a reopened gap is never a reuse)", async () => {
      const itemId = seedItemId("mushrooms");
      const first = await insertRow({
        name: "Mushrooms, trip 1",
        needMicros: 10_000_000n,
        unit: "oz",
        itemId,
        done: true,
      });
      const a = await add(DEAN, first, key());
      expect(a.statusCode).toBe(201);
      // 8 + 2 = 10 oz held; the next trip needs 14.
      const second = await insertRow({
        name: "Mushrooms, trip 2",
        needMicros: 14_000_000n,
        unit: "oz",
        itemId,
        done: true,
      });
      const b = await add(DEAN, second, key());
      expect(b.statusCode).toBe(201);
      expect(b.body.transactions[0]?.deltaMicros).toBe("4000000");
      expect(b.body.transactions[0]?.transactionId).not.toBe(a.body.transactions[0]?.transactionId);
    });

    it("the ledger key is the backstop: a row under the row's derived key is never doubled, and the add fails loudly", async () => {
      const itemId = seedItemId("strawberries");
      const rowId = await insertRow({
        name: "Strawberries, backstop",
        needMicros: 50_000_000n,
        unit: "lb",
        itemId,
        done: true,
      });
      // Written straight through the repository under the row's derived key,
      // as if a path that skipped the row's bookkeeping had got there first.
      await withHouseholdTransaction(
        db.pool,
        chenId,
        async (client) => {
          const outcome = await appendTransactionToDb(client, chenId, itemId, {
            lotId: seedLotId("strawberries", "lot-1"),
            type: "PURCHASE",
            qtyDelta: 1,
            unit: "lb",
            actor: { kind: "user", userId: deanUserId },
            occurredAt: "2026-09-29T10:00:00.000Z",
            recordedAt: "2026-09-29T10:00:00.000Z",
            provenance: { tier: "KNOWN_FACT", source: SHOPPING_CHECK_OFF_SOURCE },
            idempotencyKey: shoppingPurchaseKey(rowId, 1),
          });
          expect(outcome.ok && outcome.value.status).toBe("appended");
        },
        { assumeRole: APP_ROLE },
      );
      const before = await ledgerRows(itemId);
      const answer = await add<ApiErrorBodyDto>(DEAN, rowId, key());
      // Not the caller's fault, so not a 4xx: the ledger refused a second row
      // under the key, and the service reports an integrity failure.
      expect(answer.statusCode).toBe(500);
      expect(await ledgerRows(itemId)).toBe(before);
      expect((await storedRow(rowId))?.["added_transaction_id"]).toBeNull();
      expect(await writesFor(rowId)).toBe(0);
    });
  });

  describe("POST /v1/shopping/rows/{rowId}/remove", () => {
    it("refuses Ada (404, row intact), the household-less user (403) and a body naming anything", async () => {
      const before = await storedRow(TOWELS_ROW);
      const ada = await call<ApiErrorBodyDto>("POST", shoppingRowRemovePath(TOWELS_ROW), ADA);
      expect(ada.statusCode).toBe(404);
      expect((await call("POST", shoppingRowRemovePath(TOWELS_ROW), NEW)).statusCode).toBe(403);
      expect((await call("POST", shoppingRowRemovePath(TOWELS_ROW), undefined)).statusCode).toBe(
        401,
      );
      const forged = await call<ApiErrorBodyDto>("POST", shoppingRowRemovePath(TOWELS_ROW), DEAN, {
        householdId: chenId,
      });
      expect(forged.statusCode).toBe(400);
      expect(await storedRow(TOWELS_ROW)).toEqual(before);
    });

    it("Dean removes Maya's paper towels: 204, off the list, recorded as skipped with who and when, never deleted", async () => {
      const answer = await call("POST", shoppingRowRemovePath(TOWELS_ROW), DEAN, {});
      expect(answer.statusCode).toBe(204);
      const listed = await list(MAYA);
      expect(listed.body.rows.map((row) => row.rowId)).not.toContain(TOWELS_ROW);
      const stored = await storedRow(TOWELS_ROW);
      expect(stored?.["status"]).toBe("skipped");
      expect(stored?.["removed_by"]).toBe(deanMemberId);
      expect(stored?.["removed_at"]).toBeInstanceOf(Date);

      // Idempotent: a repeat answers the same and changes nothing.
      const repeat = await call("POST", shoppingRowRemovePath(TOWELS_ROW), MAYA);
      expect(repeat.statusCode).toBe(204);
      expect(await storedRow(TOWELS_ROW)).toEqual(stored);

      // A removed row is not a row any more.
      expect((await check(DEAN, TOWELS_ROW, true, key())).statusCode).toBe(404);
      expect((await add(DEAN, TOWELS_ROW, key())).statusCode).toBe(404);
    });

    it("a row whose PURCHASE landed can be removed, and the PURCHASE stays", async () => {
      const before = await ledgerRows(CHICKEN_ITEM);
      const answer = await call("POST", shoppingRowRemovePath(CHICKEN_ROW), MAYA);
      expect(answer.statusCode).toBe(204);
      expect(await ledgerRows(CHICKEN_ITEM)).toBe(before);
      expect((await storedRow(CHICKEN_ROW))?.["added_transaction_id"]).not.toBeNull();
    });
  });

  describe("row-level security is what refuses, not the application layer", () => {
    /**
     * The mutation: a runner that opens the transaction with no household
     * context. Same handlers, same SQL; only `set_config` is gone. Every
     * policy then denies (migration 0006 fails closed), so the list is empty
     * and every write is the same 404 another household's row gets.
     */
    it("reads nothing and writes nothing without a household context", async () => {
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = build(contextless);
      try {
        const itemId = seedItemId("spinach");
        const rowId = await insertRow({
          name: "Spinach, RLS",
          needMicros: 9_000_000n,
          unit: "oz",
          itemId,
          done: true,
        });

        const control = await list(DEAN);
        expect(control.body.rows.length).toBeGreaterThan(0);
        const mutated = await list(DEAN, sabotaged);
        expect(mutated.statusCode).toBe(200);
        expect(mutated.body.rows).toEqual([]);
        expect(mutated.body.members).toEqual([]);

        const before = await ledgerRows(itemId);
        expect((await check(DEAN, rowId, false, key(), sabotaged)).statusCode).toBe(404);
        expect((await add(DEAN, rowId, key(), sabotaged)).statusCode).toBe(404);
        expect(
          (await call("POST", shoppingRowRemovePath(rowId), DEAN, {}, sabotaged)).statusCode,
        ).toBe(404);
        expect(await ledgerRows(itemId)).toBe(before);
        expect((await storedRow(rowId))?.["status"]).toBe("done");
        expect(await writesFor(rowId)).toBe(0);

        // The control does land, so the 404s above are the policies.
        expect((await add(DEAN, rowId, key())).statusCode).toBe(201);
      } finally {
        await sabotaged.close();
      }
    });

    it("as sk_app in Okafor's context: Chen's rows and writes are invisible, and a row cannot be planted in Chen", async () => {
      await withHouseholdTransaction(
        db.pool,
        okaforId,
        async (client) => {
          const rows = await client.query("SELECT id FROM shopping_rows");
          expect(rows.rowCount).toBe(0);
          const writes = await client.query("SELECT 1 FROM shopping_row_writes");
          expect(writes.rowCount).toBe(0);
          const updated = await client.query(
            "UPDATE shopping_rows SET updated_at = clock_timestamp() WHERE id = $1",
            [OLIVE_ROW],
          );
          expect(updated.rowCount).toBe(0);
        },
        { assumeRole: APP_ROLE },
      );
      await expect(
        withHouseholdTransaction(
          db.pool,
          okaforId,
          (client) =>
            client.query(
              `INSERT INTO shopping_rows (id, household_id, name, group_label, origin_kind,
                 origin_member_id, need_micros, unit, default_location, created_by)
               VALUES ($1, $2, 'Planted', 'Test', 'member', $3, 1000000, 'each', 'PANTRY', $4)`,
              [randomUUID(), chenId, deanMemberId, deanUserId],
            ),
          { assumeRole: APP_ROLE },
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("grants and the row guard (migration 0009)", () => {
    async function asApp(sql: string, params: unknown[] = []): Promise<void> {
      await withHouseholdTransaction(db.pool, chenId, (client) => client.query(sql, params), {
        assumeRole: APP_ROLE,
      });
    }

    it("sk_app may not DELETE a shopping row or a recorded write", async () => {
      await expect(
        asApp("DELETE FROM shopping_rows WHERE id = $1", [OLIVE_ROW]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(asApp("DELETE FROM shopping_row_writes")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        asApp("UPDATE shopping_row_writes SET checked = NOT checked"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("sk_app may not UPDATE a row's immutable columns", async () => {
      for (const column of [
        "name",
        "need_micros",
        "unit",
        "item_id",
        "generation",
        "origin_member_id",
      ]) {
        await expect(
          asApp(`UPDATE shopping_rows SET ${column} = ${column} WHERE id = $1`, [OLIVE_ROW]),
        ).rejects.toMatchObject({ code: "42501" });
      }
    });

    it("sk_app has no UPDATE or DELETE on the ledger tables", async () => {
      await expect(
        asApp("UPDATE inventory_transactions SET reason = 'x' WHERE item_id = $1", [CHICKEN_ITEM]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        asApp("DELETE FROM inventory_transactions WHERE item_id = $1", [CHICKEN_ITEM]),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("the guard keeps added_transaction_id write-once, even for the owner role", async () => {
      await expect(
        db.pool.query("UPDATE shopping_rows SET added_transaction_id = NULL WHERE id = $1", [
          CHICKEN_ROW,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.pool.query("UPDATE shopping_rows SET added_transaction_id = $2 WHERE id = $1", [
          CHICKEN_ROW,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("the guard refuses a purchase that is not this row's own PURCHASE on its own item", async () => {
      const rowId = await insertRow({
        name: "Guarded",
        needMicros: 1_000_000n,
        unit: "lb",
        itemId: CHICKEN_ITEM,
        done: true,
      });
      // A real PURCHASE, but correlated to another row.
      const other = await db.pool.query<{ added_transaction_id: string }>(
        "SELECT added_transaction_id FROM shopping_rows WHERE id = $1",
        [CHICKEN_ROW],
      );
      await expect(
        db.pool.query("UPDATE shopping_rows SET added_transaction_id = $2 WHERE id = $1", [
          rowId,
          other.rows[0]?.added_transaction_id,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("the guard refuses an insert that claims a purchase, and keeps a removed row removed", async () => {
      await expect(
        db.pool.query(
          `INSERT INTO shopping_rows (id, household_id, name, group_label, origin_kind,
             origin_member_id, need_micros, unit, item_id, default_location, created_by,
             added_transaction_id)
           VALUES ($1, $2, 'Claimed', 'Test', 'member', $3, 1000000, 'lb', $4, 'FRIDGE', $5, $6)`,
          [randomUUID(), chenId, deanMemberId, CHICKEN_ITEM, deanUserId, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.pool.query(
          `UPDATE shopping_rows SET status = 'open', removed_at = NULL, removed_by = NULL
            WHERE id = $1`,
          [TOWELS_ROW],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("refuses a unit outside the contract list and an origin kind that does not exist yet", async () => {
      await expect(
        insertRow({ name: "Bottle", needMicros: 1_000_000n, unit: "bottle", itemId: null }),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.pool.query(
          `INSERT INTO shopping_rows (id, household_id, name, group_label, origin_kind,
             origin_member_id, need_micros, unit, default_location, created_by)
           VALUES ($1, $2, 'AI garlic', 'Produce', 'ai', NULL, 1000000, 'each', 'PANTRY', $3)`,
          [randomUUID(), chenId, deanUserId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("refuses a row that names another household's member or item", async () => {
      const adaMember = await memberIdOf(
        okaforId,
        fixture.sessions.find((s) => s.token === ADA)?.userId ?? "",
      );
      await expect(
        insertRow({
          name: "Cross member",
          needMicros: 1_000_000n,
          unit: "each",
          itemId: null,
          memberId: adaMember,
        }),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        insertRow({
          name: "Cross item",
          needMicros: 1_000_000n,
          unit: "lb",
          itemId: CHICKEN_ITEM,
          householdId: okaforId,
          memberId: adaMember,
        }),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("never logs an idempotency key", () => {
    expect(usedKeys.length).toBeGreaterThan(10);
    const logged = logLines.join("\n");
    for (const used of usedKeys) expect(logged).not.toContain(used);
    expect(logged).toContain("shopping.row.checked");
    expect(logged).toContain("shopping.row.added-to-inventory");
  });

  describe("migration 0009 round trip", () => {
    it("down removes both tables, the guard and the membership constraint; up restores them", async () => {
      const scratch = await createTestDatabase("m7t1-migration");
      try {
        const objects = async (): Promise<{
          tables: number;
          guard: number;
          constraint: number;
        }> => {
          const result = await scratch.pool.query<{
            tables: string;
            guard: string;
            constraint: string;
          }>(
            `SELECT (SELECT count(*)::text FROM pg_class
                      WHERE relname IN ('shopping_rows', 'shopping_row_writes')) AS tables,
                    (SELECT count(*)::text FROM pg_proc WHERE proname = 'shopping_rows_guard') AS guard,
                    (SELECT count(*)::text FROM pg_constraint
                      WHERE conname = 'household_memberships_household_id_key') AS constraint`,
          );
          return {
            tables: Number(result.rows[0]?.tables ?? "0"),
            guard: Number(result.rows[0]?.guard ?? "0"),
            constraint: Number(result.rows[0]?.constraint ?? "0"),
          };
        };
        expect(await objects()).toEqual({ tables: 2, guard: 1, constraint: 1 });
        expect(await migrateDown(scratch.url, 1)).toEqual(["0009_shopping_rows"]);
        expect(await objects()).toEqual({ tables: 0, guard: 0, constraint: 0 });
        expect(await migrateUp(scratch.url)).toEqual(["0009_shopping_rows"]);
        expect(await objects()).toEqual({ tables: 2, guard: 1, constraint: 1 });
      } finally {
        await scratch.drop();
      }
    }, 60_000);
  });
});
