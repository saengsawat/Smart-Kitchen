/**
 * Confirming an AI proposal over HTTP (M2-T5, D-028; INV-TENANT-1 matrix row
 * for `POST /v1/inventory/items/{itemId}/confirm`).
 *
 * Everything goes through `app.inject` against a real throwaway database with
 * the real fixture identity port and the real tenant session, over the
 * development seed, so the acceptance criteria read in the ticket's own words:
 * Dean confirms the seeded Strawberries receipt read, Maya (a member) confirms
 * the Mushrooms, the other household's token gets 404, a Known Fact item gets
 * 409.
 *
 * Every seeding statement runs in `beforeAll`, so the ledger image taken there
 * is the one every confirm in this file must leave byte-identical.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build in CI.
 */

import { randomUUID } from "node:crypto";
import {
  INVENTORY_ITEMS_PATH,
  inventoryItemConfirmPath,
  inventoryItemPath,
  type ApiErrorBodyDto,
  type ConfirmAiProposalResponseDto,
  type InventoryItemDetailDto,
  type InventoryItemsResponseDto,
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
import { insertRawTransaction, seedItem } from "../db/test-support/inventory-fixtures.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { seedChenInventory, seedItemId } from "../seed/fixture-inventory.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./tenant-session.js";

const SUITE = "M2-T5: confirm an AI proposal over HTTP (D-028, tenancy, idempotency)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const OKAFOR = "fixture.owner.other";

const STRAWBERRIES = seedItemId("strawberries");
const MUSHROOMS = seedItemId("mushrooms");
const CHICKEN = seedItemId("chicken");

interface Answer {
  readonly statusCode: number;
  readonly raw: string;
  readonly body: ConfirmAiProposalResponseDto;
  readonly error: ApiErrorBodyDto["error"] | undefined;
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
  /** Okafor's own AI item: the positive control for the other token. */
  let okaforAiItem: string;
  /** Chen AI items reserved for the RLS mutations, so nothing else confirms them first. */
  let chenRlsItem: string;
  let ledgerBefore: readonly string[];

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

  async function confirm(
    itemId: string,
    body: Record<string, unknown> = { idempotencyKey: randomUUID() },
    options: { readonly token?: string | null; readonly instance?: FastifyInstance } = {},
  ): Promise<Answer> {
    const token = options.token === undefined ? DEAN : options.token;
    const response = await (options.instance ?? app).inject({
      method: "POST",
      url: inventoryItemConfirmPath(itemId),
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
      body: parsed as ConfirmAiProposalResponseDto,
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

  async function confirmations(
    itemId: string,
  ): Promise<readonly { confirmed_by: string; client_key: string; model_ref: string | null }[]> {
    const rows = await db.pool.query<{
      confirmed_by: string;
      client_key: string;
      model_ref: string | null;
    }>(
      `SELECT confirmed_by, client_key, model_ref FROM inventory_confirmations
        WHERE item_id = $1 ORDER BY confirmed_at, id`,
      [itemId],
    );
    return rows.rows;
  }

  async function ledgerImage(): Promise<string[]> {
    const rows = await db.pool.query<{ json: string }>(
      `SELECT row_to_json(t)::text AS json FROM inventory_transactions AS t ORDER BY id`,
    );
    return rows.rows.map((row) => row.json);
  }

  /** An item in `householdId` whose single ledger row is AI-interpreted, written raw as the owner. */
  async function seedAiItem(householdId: string, userId: string, source: string): Promise<string> {
    const item = await seedItem(db.pool, householdId, "each");
    await insertRawTransaction(
      db.pool,
      { householdId, itemId: item.itemId, lotId: item.lotId, userId, unit: "each" },
      { provenance_tier: "AI_INTERPRETATION", provenance_source: source },
    );
    return item.itemId;
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m2t5-confirm-http");
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
    okaforAiItem = await seedAiItem(okaforHousehold, okafor.userId, "receipt read “BLK BEANS”");
    chenRlsItem = await seedAiItem(chenHousehold, dean.userId, "receipt read “LEMONS 3CT”");

    ledgerBefore = await ledgerImage();
    app = buildWith(createTenantSessionRunner(db.pool));
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("the acceptance criteria", () => {
    let first: Answer;

    it("starts from the seeded receipt read: Strawberries is an AI proposal", async () => {
      const before = await detail(STRAWBERRIES);
      expect(before.summary.provenance.quantity).toMatchObject({
        tier: "AI_INTERPRETATION",
        source: "receipt read “ORG STRWB 1LB”",
      });
    });

    it("Dean confirms Strawberries: 200, KNOWN_FACT with the confirmed-by source", async () => {
      first = await confirm(STRAWBERRIES, { idempotencyKey: "dean-strawberries-1" });

      expect(first.statusCode).toBe(200);
      expect(first.body.item.summary.itemId).toBe(STRAWBERRIES);
      expect(first.body.item.summary.provenance.quantity).toMatchObject({
        tier: "KNOWN_FACT",
        source: "receipt read “ORG STRWB 1LB” · confirmed by DC",
      });
      expect(first.body.item.history.map((row) => row.provenance.tier)).toEqual(["KNOWN_FACT"]);
    });

    it("the list endpoint shows Strawberries as KNOWN_FACT with the same source", async () => {
      const { items } = await list();
      const strawberries = items.find((item) => item.itemId === STRAWBERRIES);
      expect(strawberries?.provenance.quantity).toEqual(
        first.body.item.summary.provenance.quantity,
      );
      expect(strawberries).toEqual(first.body.item.summary);
    });

    it("records the confirming user (Dean) and the key, and never edits the quantity", async () => {
      expect(await confirmations(STRAWBERRIES)).toEqual([
        { confirmed_by: deanUserId, client_key: "dean-strawberries-1", model_ref: null },
      ]);
      expect(first.body.item.summary.quantity).toEqual(
        (await detail(STRAWBERRIES)).summary.quantity,
      );
    });

    it("a second confirm with the same key returns the same body and records nothing", async () => {
      const again = await confirm(STRAWBERRIES, { idempotencyKey: "dean-strawberries-1" });
      expect(again.statusCode).toBe(200);
      expect(again.raw).toBe(first.raw);
      expect(await confirmations(STRAWBERRIES)).toHaveLength(1);
    });

    it("a second confirm with a different key returns the same body and records nothing", async () => {
      const again = await confirm(STRAWBERRIES, { idempotencyKey: "dean-strawberries-2" });
      expect(again.statusCode).toBe(200);
      expect(again.raw).toBe(first.raw);
      expect(await confirmations(STRAWBERRIES)).toHaveLength(1);
    });

    it("Maya (member) confirming the already-confirmed Strawberries gets the same body: still Dean's confirmation", async () => {
      const maya = await confirm(
        STRAWBERRIES,
        { idempotencyKey: "maya-strawberries" },
        { token: MAYA },
      );
      expect(maya.statusCode).toBe(200);
      expect(maya.raw).toBe(first.raw);
      expect(await confirmations(STRAWBERRIES)).toHaveLength(1);
    });

    it("Maya (member) can confirm a Dean-household item: Mushrooms, confirmed by MC", async () => {
      const maya = await confirm(MUSHROOMS, { idempotencyKey: "maya-mushrooms" }, { token: MAYA });

      expect(maya.statusCode).toBe(200);
      expect(maya.body.item.summary.provenance.quantity).toMatchObject({
        tier: "KNOWN_FACT",
        source: "receipt read “CREMINI MUSHRM 8OZ” · confirmed by MC",
      });
      expect(await confirmations(MUSHROOMS)).toEqual([
        { confirmed_by: mayaUserId, client_key: "maya-mushrooms", model_ref: null },
      ]);
      // Dean reads the same thing Maya was answered.
      expect((await detail(MUSHROOMS)).summary).toEqual(maya.body.item.summary);
    });

    it("the other household's token gets 404 on a Chen AI item, identical to an item that does not exist", async () => {
      const foreign = await confirm(chenRlsItem, undefined, { token: OKAFOR });
      const missing = await confirm(randomUUID(), undefined, { token: OKAFOR });

      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(foreign.error?.code).toBe("NOT_FOUND");
      expect({ ...foreign.error, correlationId: "x" }).toEqual({
        ...missing.error,
        correlationId: "x",
      });
      expect(await confirmations(chenRlsItem)).toEqual([]);
    });

    it("and that same token confirms its own household's AI item (positive control)", async () => {
      const own = await confirm(okaforAiItem, undefined, { token: OKAFOR });
      expect(own.statusCode).toBe(200);
      expect(own.body.item.summary.provenance.quantity).toMatchObject({
        tier: "KNOWN_FACT",
        source: "receipt read “BLK BEANS” · confirmed by AO",
      });
    });

    it("Dean gets 404 on the other household's AI item, already confirmed or not, and learns nothing", async () => {
      const foreign = await confirm(okaforAiItem);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.raw).not.toContain("BLK BEANS");
      expect(await confirmations(okaforAiItem)).toHaveLength(1);
    });

    it("a confirm on a Known Fact item gets 409 NOT_A_PROPOSAL and records nothing", async () => {
      const refused = await confirm(CHICKEN);
      expect(refused.statusCode).toBe(409);
      expect(refused.error?.code).toBe("NOT_A_PROPOSAL");
      expect(refused.error?.ledgerCode).toBeUndefined();
      expect(await confirmations(CHICKEN)).toEqual([]);
    });
  });

  describe("refusals by shape", () => {
    it.each([
      ["a key with the ledger's reserved separator", { idempotencyKey: "a::b" }],
      ["a key with a slash", { idempotencyKey: "a/lot/0" }],
      ["a key with a space", { idempotencyKey: "has space" }],
    ])("answers 400 INVALID_IDEMPOTENCY_KEY for %s, writing nothing", async (_case, body) => {
      const refused = await confirm(chenRlsItem, body);
      expect(refused.statusCode).toBe(400);
      expect(refused.error?.ledgerCode).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(await confirmations(chenRlsItem)).toEqual([]);
    });

    it.each([
      ["no body field at all", {}],
      // The field was `clientKey` before the rename to match every other write body.
      ["the old field name clientKey", { clientKey: "ok" }],
      ["an empty key", { idempotencyKey: "" }],
      ["a key over 128 characters", { idempotencyKey: "k".repeat(129) }],
      // A literal: `it.each` rows are built at collection time, before
      // `beforeAll` has read the fixture households.
      ["a household named in the body", { idempotencyKey: "ok", householdId: randomUUID() }],
      ["a user named in the body", { idempotencyKey: "ok", confirmedBy: "someone" }],
    ])("answers 400 for %s, writing nothing", async (_case, body) => {
      const refused = await confirm(chenRlsItem, body);
      expect(refused.statusCode).toBe(400);
      expect(await confirmations(chenRlsItem)).toEqual([]);
    });

    it("answers 404 for an item id that is not a uuid", async () => {
      const refused = await confirm("not-a-uuid");
      expect(refused.statusCode).toBe(404);
    });

    it.each([
      ["no token", null],
      ["an unknown token", "fixture.nobody"],
    ])("answers 401 for %s, writing nothing", async (_case, token) => {
      const refused = await confirm(chenRlsItem, undefined, { token });
      expect(refused.statusCode).toBe(401);
      expect(await confirmations(chenRlsItem)).toEqual([]);
    });
  });

  describe("row-level security is what refuses, not only the application layer", () => {
    it("with the tenant context removed, a confirm that would otherwise succeed answers 404 and records nothing", async () => {
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = buildWith(contextless);
      try {
        const refused = await confirm(chenRlsItem, undefined, { instance: sabotaged });
        expect(refused.statusCode).toBe(404);
        expect(await confirmations(chenRlsItem)).toEqual([]);
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
        const foreign = await confirm(chenRlsItem, undefined, {
          token: OKAFOR,
          instance: bypassed,
        });
        expect(foreign.statusCode).toBe(404);
        expect(await confirmations(chenRlsItem)).toEqual([]);

        // Positive control on the same instance: the caller's own item confirms.
        const own = await confirm(
          chenRlsItem,
          { idempotencyKey: "bypassed-own" },
          { instance: bypassed },
        );
        expect(own.statusCode).toBe(200);
        expect(await confirmations(chenRlsItem)).toHaveLength(1);
      } finally {
        await bypassed.close();
      }
    });
  });

  describe("what the suite left behind", () => {
    it("the ledger is byte-identical after every confirm in this file (INV-LEDGER-2)", async () => {
      const after = await ledgerImage();
      expect(after).toHaveLength(ledgerBefore.length);
      expect(after).toEqual(ledgerBefore);
    });

    it("logs each confirm by route and row count, never a name, a token or a source text", () => {
      const lines = logLines.filter((line) => line.includes("inventory.confirm."));
      expect(lines.length).toBeGreaterThan(0);
      for (const needle of [
        "Dean Chen",
        "Maya Chen",
        "Ada Okafor",
        DEAN,
        MAYA,
        OKAFOR,
        "STRWB",
        "MUSHRM",
        "dean-strawberries-1",
      ]) {
        expect(logLines.filter((line) => line.includes(needle))).toEqual([]);
      }
      const applied = lines
        .map((line) => JSON.parse(line) as { msg?: string; rows?: number; replayed?: boolean })
        .filter((entry) => entry.msg === "inventory.confirm.applied");
      expect(applied.some((entry) => entry.rows === 1 && entry.replayed === false)).toBe(true);
      expect(applied.some((entry) => entry.rows === 0 && entry.replayed === true)).toBe(true);
    });
  });
});
