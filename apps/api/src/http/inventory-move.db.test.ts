/**
 * Moving an item between locations over HTTP (M2-T6, D-024 row 1; INV-TENANT-1
 * matrix row for `POST /v1/inventory/items/{itemId}/move`).
 *
 * Everything goes through `app.inject` against a real throwaway database with
 * the real fixture identity port and the real tenant session, over the
 * development seed, so the acceptance criteria read in the ticket's own words:
 * Dean moves a Fridge item to Pantry, the same key again answers the same body
 * and inserts nothing, the same location is a 409 `SAME_LOCATION`, the other
 * household's token gets 404, and the list shows the item under its new
 * location.
 *
 * Every seeding statement runs in `beforeAll`, so the ledger image taken there
 * is the one every move in this file must leave byte-identical (INV-LEDGER-2,
 * ADR-008): a move writes one `inventory_item_moves` row and one column of one
 * `inventory_items` row.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build in CI.
 */

import { randomUUID } from "node:crypto";
import {
  INVENTORY_ITEMS_PATH,
  inventoryItemMovePath,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  type ApiErrorBodyDto,
  type InventoryItemDetailDto,
  type InventoryItemsResponseDto,
  type InventoryMoveEntryDto,
  type MoveItemResponseDto,
  type StorageLocationDto,
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
import { ledgerRows } from "../db/test-support/history.js";
import { seedItem } from "../db/test-support/inventory-fixtures.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { seedChenInventory, seedItemId } from "../seed/fixture-inventory.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./tenant-session.js";

const SUITE = "M2-T6: move an item between locations over HTTP (D-024 row 1, tenancy, idempotency)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const OKAFOR = "fixture.owner.other";

const CHICKEN = seedItemId("chicken");
const MUSHROOMS = seedItemId("mushrooms");
const RICE = seedItemId("rice");
/** The one item the suite also writes through the ledger, to pin the merge order. */
const EGGS = seedItemId("eggs");

interface Answer {
  readonly statusCode: number;
  readonly raw: string;
  readonly body: MoveItemResponseDto;
  readonly error: ApiErrorBodyDto["error"] | undefined;
}

interface MoveRowImage {
  readonly from_location: string | null;
  readonly to_location: string;
  readonly moved_by: string;
  readonly client_key: string;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let app: FastifyInstance;
  let logLines: string[];
  let chenHousehold: string;
  let okaforHousehold: string;
  let mayaUserId: string;
  let deanUserId: string;
  /** Reserved items, so no test moves another test's item first. */
  let okaforItem: string;
  let chenRlsItem: string;
  let chenUnassignedItem: string;
  let chenShapeItem: string;
  let ledgerBefore: readonly string[];
  let lotsBefore: readonly string[];
  let itemsBefore: readonly string[];

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

  async function move(
    itemId: string,
    body: Record<string, unknown> = { toLocation: "PANTRY", idempotencyKey: randomUUID() },
    options: { readonly token?: string | null; readonly instance?: FastifyInstance } = {},
  ): Promise<Answer> {
    const token = options.token === undefined ? DEAN : options.token;
    const response = await (options.instance ?? app).inject({
      method: "POST",
      url: inventoryItemMovePath(itemId),
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
      },
      payload: body,
    });
    const parsed: unknown = response.json();
    return {
      statusCode: response.statusCode,
      raw: response.body,
      body: parsed as MoveItemResponseDto,
      error: (parsed as ApiErrorBodyDto).error,
    };
  }

  async function detail(itemId: string, token = DEAN): Promise<InventoryItemDetailDto> {
    const response = await app.inject({
      method: "GET",
      url: inventoryItemPath(itemId),
      headers: { authorization: `Bearer ${token}` },
    });
    return response.json<InventoryItemDetailDto>();
  }

  async function list(token = DEAN): Promise<InventoryItemsResponseDto> {
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    return response.json<InventoryItemsResponseDto>();
  }

  async function moveRows(itemId: string): Promise<readonly MoveRowImage[]> {
    const rows = await db.pool.query<MoveRowImage>(
      `SELECT from_location, to_location, moved_by, client_key FROM inventory_item_moves
        WHERE item_id = $1 ORDER BY occurred_at, id`,
      [itemId],
    );
    return rows.rows;
  }

  async function image(table: string, extra = ""): Promise<string[]> {
    const rows = await db.pool.query<{ json: string }>(
      `SELECT (to_jsonb(t)${extra})::text AS json FROM ${table} AS t ORDER BY id`,
    );
    return rows.rows.map((row) => row.json);
  }

  function movedEntries(item: InventoryItemDetailDto): InventoryMoveEntryDto[] {
    return item.history.filter((entry): entry is InventoryMoveEntryDto => entry.type === "MOVED");
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m2t6-move-http");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);

    const dean = fixture.sessions.find((session) => session.token === DEAN);
    const maya = fixture.sessions.find((session) => session.token === MAYA);
    const okafor = fixture.sessions.find((session) => session.token === OKAFOR);
    if (dean === undefined || maya === undefined || okafor === undefined) {
      throw new Error("fixture map lost a session");
    }
    chenHousehold = dean.householdId;
    okaforHousehold = okafor.householdId;
    deanUserId = dean.userId;
    mayaUserId = maya.userId;

    await seedChenInventory(db.pool, chenHousehold, dean.userId);
    okaforItem = (await seedItem(db.pool, okaforHousehold, "each", "FRIDGE")).itemId;
    chenRlsItem = (await seedItem(db.pool, chenHousehold, "each", "FRIDGE")).itemId;
    chenShapeItem = (await seedItem(db.pool, chenHousehold, "each", "FRIDGE")).itemId;
    chenUnassignedItem = (await seedItem(db.pool, chenHousehold, "each", null)).itemId;

    ledgerBefore = await image("inventory_transactions");
    lotsBefore = await image("inventory_lots");
    // Items compared without the one column a move may change.
    itemsBefore = await image("inventory_items", " - 'storage_location'");
    app = buildWith(createTenantSessionRunner(db.pool));
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("the acceptance criteria", () => {
    let first: Answer;
    let chickenBefore: InventoryItemDetailDto;

    it("starts with the Chicken in the Fridge and no move in its history", async () => {
      chickenBefore = await detail(CHICKEN);
      expect(chickenBefore.summary.storageLocation).toBe("FRIDGE");
      expect(movedEntries(chickenBefore)).toEqual([]);
    });

    it("Dean moves the Chicken to PANTRY: 200 with the updated detail", async () => {
      first = await move(CHICKEN, { toLocation: "PANTRY", idempotencyKey: "dean-chicken-1" });

      expect(first.statusCode).toBe(200);
      expect(first.body.item.summary.itemId).toBe(CHICKEN);
      expect(first.body.item.summary.storageLocation).toBe("PANTRY");
    });

    it("the history gains a MOVED entry after every earlier ledger row, with initials and no amount", () => {
      const history = first.body.item.history;
      const moved = movedEntries(first.body.item);
      expect(moved).toHaveLength(1);
      expect(history.at(-1)).toBe(history.find((entry) => entry.type === "MOVED"));
      expect(moved[0]).toMatchObject({
        type: "MOVED",
        fromLocation: "FRIDGE",
        toLocation: "PANTRY",
        actor: { kind: "user", displayInitials: "DC" },
      });
      expect(Object.keys(moved[0]!).sort()).toEqual(
        ["actor", "fromLocation", "moveId", "recordedAt", "toLocation", "type"].sort(),
      );
      // The ledger rows are the same ones, in the same order, as before the move.
      expect(ledgerRows(first.body.item.history)).toEqual(ledgerRows(chickenBefore.history));
      expect(JSON.stringify(first.body)).not.toContain("Dean Chen");
    });

    it("no quantity changed: the quantity, lots and provenance read as before", () => {
      expect(first.body.item.summary.quantity).toEqual(chickenBefore.summary.quantity);
      expect(first.body.item.summary.lots).toEqual(chickenBefore.summary.lots);
      expect(first.body.item.summary.provenance).toEqual(chickenBefore.summary.provenance);
    });

    it("records the moving user (Dean), the key, and the source and destination", async () => {
      expect(await moveRows(CHICKEN)).toEqual([
        {
          from_location: "FRIDGE",
          to_location: "PANTRY",
          moved_by: deanUserId,
          client_key: "dean-chicken-1",
        },
      ]);
    });

    it("the list endpoint shows the Chicken under PANTRY", async () => {
      const { items } = await list();
      const chicken = items.find((item) => item.itemId === CHICKEN);
      expect(chicken?.storageLocation).toBe("PANTRY");
      expect(chicken).toEqual(first.body.item.summary);
    });

    it("the same key again returns the same body and inserts nothing", async () => {
      const again = await move(CHICKEN, { toLocation: "PANTRY", idempotencyKey: "dean-chicken-1" });
      expect(again.statusCode).toBe(200);
      expect(again.raw).toBe(first.raw);
      expect(await moveRows(CHICKEN)).toHaveLength(1);
    });

    it("the same key for a different destination is a 409 CONFLICT, nothing recorded", async () => {
      const refused = await move(CHICKEN, {
        toLocation: "FREEZER",
        idempotencyKey: "dean-chicken-1",
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.error?.code).toBe("CONFLICT");
      expect(refused.error?.ledgerCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect(await moveRows(CHICKEN)).toHaveLength(1);
      expect((await detail(CHICKEN)).summary.storageLocation).toBe("PANTRY");
    });

    it("a different key to the location it is already at is a 409 SAME_LOCATION, nothing recorded", async () => {
      const refused = await move(CHICKEN, {
        toLocation: "PANTRY",
        idempotencyKey: "dean-chicken-2",
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.error?.code).toBe("SAME_LOCATION");
      expect(refused.error?.ledgerCode).toBeUndefined();
      expect(await moveRows(CHICKEN)).toHaveLength(1);
    });

    it("a different key to a different location is a new move: both stay in the history, in order", async () => {
      const second = await move(CHICKEN, {
        toLocation: "FREEZER",
        idempotencyKey: "dean-chicken-3",
      });
      expect(second.statusCode).toBe(200);
      expect(second.body.item.summary.storageLocation).toBe("FREEZER");
      expect(movedEntries(second.body.item).map((m) => [m.fromLocation, m.toLocation])).toEqual([
        ["FRIDGE", "PANTRY"],
        ["PANTRY", "FREEZER"],
      ]);
      expect(await moveRows(CHICKEN)).toHaveLength(2);
    });

    it("a ledger write after a move lands after it in the history (merge order)", async () => {
      const moved = await move(EGGS, { toLocation: "PANTRY", idempotencyKey: "dean-eggs-1" });
      expect(moved.statusCode).toBe(200);
      const response = await app.inject({
        method: "POST",
        url: inventoryItemTransactionsPath(EGGS),
        headers: { authorization: `Bearer ${DEAN}`, "content-type": "application/json" },
        payload: {
          idempotencyKey: "dean-eggs-adjust",
          type: "ADJUSTMENT",
          occurredAt: new Date().toISOString(),
          targetAmount: "10",
        },
      });
      expect(response.statusCode).toBe(200);
      const after = await detail(EGGS);
      expect(after.history.map((entry) => entry.type).slice(-2)).toEqual(["MOVED", "ADJUSTMENT"]);
      // Moving never touched the ledger's own order: sequence order is intact.
      expect(ledgerRows(after.history).at(-1)?.type).toBe("ADJUSTMENT");
    });

    it("Maya (member) can move a Dean-household item, and the history credits her", async () => {
      const maya = await move(
        MUSHROOMS,
        { toLocation: "FREEZER", idempotencyKey: "maya-mushrooms" },
        { token: MAYA },
      );
      expect(maya.statusCode).toBe(200);
      expect(movedEntries(maya.body.item)[0]?.actor).toEqual({
        kind: "user",
        displayInitials: "MC",
      });
      expect(await moveRows(MUSHROOMS)).toEqual([
        {
          from_location: "FRIDGE",
          to_location: "FREEZER",
          moved_by: mayaUserId,
          client_key: "maya-mushrooms",
        },
      ]);
      // Dean reads the same thing Maya was answered.
      expect((await detail(MUSHROOMS)).summary).toEqual(maya.body.item.summary);
    });

    it("an item with no location can be moved: the source is recorded as null", async () => {
      const answer = await move(chenUnassignedItem, {
        toLocation: "OTHER",
        idempotencyKey: "unassigned-1",
      });
      expect(answer.statusCode).toBe(200);
      expect(answer.body.item.summary.storageLocation).toBe("OTHER");
      expect(movedEntries(answer.body.item)[0]).toMatchObject({
        fromLocation: null,
        toLocation: "OTHER",
      });
    });

    it("the other household's token gets 404 on a Chen item, identical to an item that does not exist", async () => {
      const foreign = await move(chenRlsItem, undefined, { token: OKAFOR });
      const missing = await move(randomUUID(), undefined, { token: OKAFOR });

      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(foreign.error?.code).toBe("NOT_FOUND");
      expect({ ...foreign.error, correlationId: "x" }).toEqual({
        ...missing.error,
        correlationId: "x",
      });
      expect(await moveRows(chenRlsItem)).toEqual([]);
      expect((await detail(chenRlsItem)).summary.storageLocation).toBe("FRIDGE");
    });

    it("and that same token moves its own household's item (positive control)", async () => {
      const own = await move(okaforItem, undefined, { token: OKAFOR });
      expect(own.statusCode).toBe(200);
      expect(own.body.item.summary.storageLocation).toBe("PANTRY");
      expect(movedEntries(own.body.item)[0]?.actor.displayInitials).toBe("AO");
    });

    it("Dean gets 404 on the other household's item, moved or not, and learns nothing", async () => {
      const foreign = await move(okaforItem, { toLocation: "FREEZER", idempotencyKey: "probe" });
      expect(foreign.statusCode).toBe(404);
      expect((await detail(okaforItem, OKAFOR)).summary.storageLocation).toBe("PANTRY");
      expect(await moveRows(okaforItem)).toHaveLength(1);
    });
  });

  describe("refusals by shape", () => {
    it.each([
      [
        "a key with the ledger's reserved separator",
        { toLocation: "PANTRY", idempotencyKey: "a::b" },
      ],
      ["a key with a slash", { toLocation: "PANTRY", idempotencyKey: "a/lot/0" }],
      ["a key with a space", { toLocation: "PANTRY", idempotencyKey: "has space" }],
    ])("answers 400 INVALID_IDEMPOTENCY_KEY for %s, writing nothing", async (_case, body) => {
      const refused = await move(chenShapeItem, body);
      expect(refused.statusCode).toBe(400);
      expect(refused.error?.ledgerCode).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(await moveRows(chenShapeItem)).toEqual([]);
    });

    it.each([
      ["no body field at all", {}],
      ["no destination", { idempotencyKey: "ok" }],
      ["no key", { toLocation: "PANTRY" }],
      ["a destination outside the enum", { toLocation: "GARAGE", idempotencyKey: "ok" }],
      ["a lower-case destination", { toLocation: "pantry", idempotencyKey: "ok" }],
      ["a null destination", { toLocation: null, idempotencyKey: "ok" }],
      ["an empty key", { toLocation: "PANTRY", idempotencyKey: "" }],
      ["a key over 128 characters", { toLocation: "PANTRY", idempotencyKey: "k".repeat(129) }],
      // The ticket text called the field clientKey; every write body says idempotencyKey.
      ["the old field name clientKey", { toLocation: "PANTRY", clientKey: "ok" }],
      [
        "a household named in the body",
        { toLocation: "PANTRY", idempotencyKey: "ok", householdId: randomUUID() },
      ],
      ["a user named in the body", { toLocation: "PANTRY", idempotencyKey: "ok", movedBy: "x" }],
      [
        "a from-location named in the body",
        { toLocation: "PANTRY", idempotencyKey: "ok", fromLocation: "FRIDGE" },
      ],
    ])("answers 400 for %s, writing nothing", async (_case, body) => {
      const refused = await move(chenShapeItem, body);
      expect(refused.statusCode).toBe(400);
      expect(await moveRows(chenShapeItem)).toEqual([]);
    });

    it("answers 404 for an item id that is not a uuid", async () => {
      const refused = await move("not-a-uuid");
      expect(refused.statusCode).toBe(404);
    });

    it.each([
      ["no token", null],
      ["an unknown token", "fixture.nobody"],
    ])("answers 401 for %s, writing nothing", async (_case, token) => {
      const refused = await move(chenShapeItem, undefined, { token });
      expect(refused.statusCode).toBe(401);
      expect(await moveRows(chenShapeItem)).toEqual([]);
    });

    it.each<StorageLocationDto>(["FRIDGE", "FREEZER", "PANTRY", "OTHER"])(
      "accepts %s as a destination (the whole enum is reachable)",
      async (location) => {
        // Rice starts in the Pantry; walk it through each location it is not in.
        const current = (await detail(RICE)).summary.storageLocation;
        if (current === location) return;
        const answer = await move(RICE, { toLocation: location, idempotencyKey: randomUUID() });
        expect(answer.statusCode).toBe(200);
        expect(answer.body.item.summary.storageLocation).toBe(location);
      },
    );
  });

  describe("row-level security is what refuses, not only the application layer", () => {
    it("with the tenant context removed, a move that would otherwise succeed answers 404 and records nothing", async () => {
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = buildWith(contextless);
      try {
        const refused = await move(chenRlsItem, undefined, { instance: sabotaged });
        expect(refused.statusCode).toBe(404);
        expect(await moveRows(chenRlsItem)).toEqual([]);
      } finally {
        await sabotaged.close();
      }
    });

    it("with the policies bypassed (owner role), the household predicate alone still refuses a foreign item", async () => {
      const unpinned: TenantSessionRunner = {
        read: <T>(session: { householdId: string }, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, session.householdId, fn),
        write: <T>(session: { householdId: string }, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, session.householdId, fn),
      };
      const bypassed = buildWith(unpinned);
      try {
        const foreign = await move(chenRlsItem, undefined, { token: OKAFOR, instance: bypassed });
        expect(foreign.statusCode).toBe(404);
        expect(await moveRows(chenRlsItem)).toEqual([]);

        // Positive control on the same instance: the caller's own item moves.
        const own = await move(
          chenRlsItem,
          { toLocation: "OTHER", idempotencyKey: "bypassed-own" },
          { instance: bypassed },
        );
        expect(own.statusCode).toBe(200);
        expect(await moveRows(chenRlsItem)).toHaveLength(1);
      } finally {
        await bypassed.close();
      }
    });
  });

  describe("what the suite left behind", () => {
    it("the ledger is byte-identical after every move in this file (INV-LEDGER-2); the only new rows are the suite's own write to the Eggs", async () => {
      const after = await image("inventory_transactions");
      const eggsRows = after.filter((row) => row.includes(EGGS));
      const others = after.filter((row) => !row.includes(EGGS));
      expect(others).toEqual(ledgerBefore.filter((row) => !row.includes(EGGS)));
      // The Eggs kept every row it had and gained exactly the ADJUSTMENT.
      for (const row of ledgerBefore.filter((row) => row.includes(EGGS))) {
        expect(eggsRows).toContain(row);
      }
      expect(eggsRows).toHaveLength(ledgerBefore.filter((row) => row.includes(EGGS)).length + 1);
    });

    it("every lot and every item column except storage_location is untouched by a move", async () => {
      // The Eggs' own ledger write moves its snapshot columns; everything else must match.
      const lotsNow = await db.pool.query<{ json: string }>(
        `SELECT to_jsonb(t)::text AS json FROM inventory_lots AS t
          WHERE t.item_id <> $1 ORDER BY id`,
        [EGGS],
      );
      expect(lotsNow.rows.map((row) => row.json)).toEqual(
        lotsBefore.filter((row) => !row.includes(EGGS)),
      );

      const itemsNow = await db.pool.query<{ json: string }>(
        `SELECT (to_jsonb(t) - 'storage_location')::text AS json FROM inventory_items AS t
          WHERE t.id <> $1 ORDER BY id`,
        [EGGS],
      );
      expect(itemsNow.rows.map((row) => row.json)).toEqual(
        itemsBefore.filter((row) => !row.includes(EGGS)),
      );
    });

    it("logs each move by route and replay flag, never a name, a token, a key or a location", () => {
      const lines = logLines.filter((line) => line.includes("inventory.move."));
      expect(lines.length).toBeGreaterThan(0);
      for (const needle of [
        "Dean Chen",
        "Maya Chen",
        "Ada Okafor",
        DEAN,
        MAYA,
        OKAFOR,
        "dean-chicken-1",
        "PANTRY",
      ]) {
        expect(logLines.filter((line) => line.includes(needle))).toEqual([]);
      }
      const applied = lines
        .map((line) => JSON.parse(line) as { msg?: string; replayed?: boolean })
        .filter((entry) => entry.msg === "inventory.move.applied");
      expect(applied.some((entry) => entry.replayed === false)).toBe(true);
      expect(applied.some((entry) => entry.replayed === true)).toBe(true);
    });
  });
});
