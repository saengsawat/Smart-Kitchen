/**
 * INV-TENANT-1 at the HTTP boundary (M2-T1).
 *
 * `apps/api/src/db/inventory/tenancy.test.ts` proved the database half: with the
 * policies in place and the runtime role assumed, one household's session sees
 * nothing of another's. This file is the half the ticket adds: the same
 * invariant reached through the real request pipeline, with the real fixture
 * identity port, over a real throwaway database.
 *
 * Every negative assertion is paired with a positive control, following the
 * same rule as the database suite: "household A sees no rows" is worthless as a
 * result if the reason is a typo in a query.
 *
 * The suite skips when `DATABASE_URL` is unset, loudly, and fails the build if
 * it ever skips in CI (`test-support/harness.ts`).
 */

import { randomUUID } from "node:crypto";
import {
  CORRELATION_ID_HEADER,
  INVENTORY_ITEMS_PATH,
  type InventoryItemSummaryDto,
  type InventoryItemsResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { microsToDecimalText } from "../db/inventory/repository.js";
import { withHouseholdTransaction } from "../db/session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { insertRawTransaction } from "../db/test-support/inventory-fixtures.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./tenant-session.js";

const SUITE = "M2-T1: INV-TENANT-1 over HTTP (identity port + RLS)";

// A *running* test, so the notice reaches the default reporter: console output
// from a file whose every test is skipped is dropped.
it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN_TOKEN = "fixture.dean.chen";
const MAYA_TOKEN = "fixture.maya.chen";
const OTHER_TOKEN = "fixture.owner.other";

interface SeededItem {
  readonly itemId: string;
  readonly lotId: string;
  readonly displayName: string;
}

/** An item with one dated lot and one ledger statement, written as the owner role. */
async function seedItemWithHistory(
  pool: Pool,
  householdId: string,
  userId: string,
  spec: {
    readonly displayName: string;
    readonly unit: string;
    readonly qtyMicros: string;
    readonly expiresAt: string | null;
    readonly expiryTier: string | null;
    readonly provenanceTier: string;
    readonly provenanceSource: string;
  },
): Promise<SeededItem> {
  const itemId = randomUUID();
  const lotId = randomUUID();

  await pool.query(
    `INSERT INTO inventory_items (id, household_id, unit, display_name, storage_location)
     VALUES ($1, $2, $3, $4, 'FRIDGE')`,
    [itemId, householdId, spec.unit, spec.displayName],
  );
  await pool.query(
    `INSERT INTO inventory_lots (id, household_id, item_id, expires_at, expiry_tier, label)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [lotId, householdId, itemId, spec.expiresAt, spec.expiryTier, `${spec.displayName} lot`],
  );
  await insertRawTransaction(
    pool,
    { householdId, itemId, lotId, userId, unit: spec.unit },
    {
      type: "PURCHASE",
      qty_delta_micros: spec.qtyMicros,
      qty_delta: microsToDecimalText(BigInt(spec.qtyMicros)),
      provenance_tier: spec.provenanceTier,
      provenance_source: spec.provenanceSource,
    },
  );

  return { itemId, lotId, displayName: spec.displayName };
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let app: FastifyInstance;
  let logLines: string[];
  let chenHousehold: string;
  let okaforHousehold: string;
  let chenMilk: SeededItem;
  let chenRice: SeededItem;
  let okaforBeans: SeededItem;

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

  async function list(
    instance: FastifyInstance,
    token: string | undefined,
    extra: Record<string, string> = {},
  ): Promise<{ statusCode: number; items: InventoryItemSummaryDto[]; correlationId: string }> {
    const response = await instance.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...extra,
      },
    });
    const correlationId = String(response.headers[CORRELATION_ID_HEADER]);
    if (response.statusCode !== 200)
      return { statusCode: response.statusCode, items: [], correlationId };
    return {
      statusCode: response.statusCode,
      items: [...response.json<InventoryItemsResponseDto>().items],
      correlationId,
    };
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m2t1-tenancy");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);

    const dean = fixture.sessions.find((s) => s.token === DEAN_TOKEN);
    const other = fixture.sessions.find((s) => s.token === OTHER_TOKEN);
    if (dean === undefined || other === undefined) throw new Error("fixture map lost a session");
    chenHousehold = dean.householdId;
    okaforHousehold = other.householdId;

    chenMilk = await seedItemWithHistory(db.pool, chenHousehold, dean.userId, {
      displayName: "Whole milk",
      unit: "gal",
      qtyMicros: "2000000",
      expiresAt: "2026-10-01T00:00:00.000Z",
      expiryTier: "KNOWN_FACT",
      provenanceTier: "KNOWN_FACT",
      provenanceSource: "manual-entry",
    });
    chenRice = await seedItemWithHistory(db.pool, chenHousehold, dean.userId, {
      displayName: "Jasmine rice",
      unit: "lb",
      qtyMicros: "5500000",
      expiresAt: null,
      expiryTier: null,
      provenanceTier: "ESTIMATED",
      provenanceSource: "receipt:ocr-v2",
    });
    okaforBeans = await seedItemWithHistory(db.pool, okaforHousehold, other.userId, {
      displayName: "Black beans",
      unit: "can",
      qtyMicros: "4000000",
      expiresAt: "2027-01-01T00:00:00.000Z",
      expiryTier: "ESTIMATED",
      provenanceTier: "AI_INTERPRETATION",
      provenanceSource: "assistant:pantry-guess",
    });

    app = buildWith(createTenantSessionRunner(db.pool));
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("positive controls", () => {
    it("the owner role sees both households' items, so the negatives below mean something", async () => {
      const rows = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM inventory_items`,
      );
      expect(rows.rows[0]?.count).toBe("3");
    });

    it("both fixture households and all three users exist as rows", async () => {
      const households = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM households`,
      );
      const users = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users`,
      );
      const memberships = await db.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM household_memberships`,
      );
      expect(households.rows[0]?.count).toBe("2");
      expect(users.rows[0]?.count).toBe("3");
      expect(memberships.rows[0]?.count).toBe("3");
    });
  });

  describe("the three tokens against the endpoint", () => {
    it("the owner of the Chen household lists its inventory", async () => {
      const { statusCode, items } = await list(app, DEAN_TOKEN);

      expect(statusCode).toBe(200);
      expect(items.map((item) => item.itemId).sort()).toEqual(
        [chenMilk.itemId, chenRice.itemId].sort(),
      );
    });

    it("the member of the same household lists exactly the same rows", async () => {
      const dean = await list(app, DEAN_TOKEN);
      const maya = await list(app, MAYA_TOKEN);

      expect(maya.statusCode).toBe(200);
      expect(maya.items).toEqual(dean.items);
    });

    it("the second household's owner lists only its own rows", async () => {
      const { statusCode, items } = await list(app, OTHER_TOKEN);

      expect(statusCode).toBe(200);
      expect(items.map((item) => item.itemId)).toEqual([okaforBeans.itemId]);
    });

    it("no household's response contains any trace of the other's item", async () => {
      const chen = await list(app, DEAN_TOKEN);
      const okafor = await list(app, OTHER_TOKEN);

      expect(JSON.stringify(chen.items)).not.toContain(okaforBeans.itemId);
      expect(JSON.stringify(chen.items)).not.toContain("Black beans");
      expect(JSON.stringify(okafor.items)).not.toContain(chenMilk.itemId);
      expect(JSON.stringify(okafor.items)).not.toContain("Whole milk");
    });
  });

  describe("the snapshot payload", () => {
    it("carries the exact quantity as micros and decimal text, never a float", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      const rice = items.find((item) => item.itemId === chenRice.itemId);

      // `amount` is the canonical exact decimal of the micros (six fractional
      // digits when there is a fraction at all), not a rounded display string:
      // rounding for presentation is the client's job, and the API's job is to
      // hand it a value nothing has already lost precision from.
      expect(rice?.quantity).toEqual({ unit: "lb", micros: "5500000", amount: "5.500000" });
    });

    it("renders a whole quantity without a fractional part", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      const milk = items.find((item) => item.itemId === chenMilk.itemId);

      expect(milk?.quantity).toEqual({ unit: "gal", micros: "2000000", amount: "2" });
    });

    it("carries the provenance tier of the most recent ledger statement per item", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      const milk = items.find((item) => item.itemId === chenMilk.itemId);
      const rice = items.find((item) => item.itemId === chenRice.itemId);

      expect(milk?.provenance.quantity).toMatchObject({
        tier: "KNOWN_FACT",
        source: "manual-entry",
      });
      expect(rice?.provenance.quantity).toMatchObject({
        tier: "ESTIMATED",
        source: "receipt:ocr-v2",
      });
    });

    it("carries the expiry tier from the lot, and null where no expiry is recorded", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      const milk = items.find((item) => item.itemId === chenMilk.itemId);
      const rice = items.find((item) => item.itemId === chenRice.itemId);

      expect(milk?.earliestExpiresAt).toBe("2026-10-01T00:00:00.000Z");
      expect(milk?.provenance.earliestExpiresAt?.tier).toBe("KNOWN_FACT");
      expect(rice?.earliestExpiresAt).toBeNull();
      expect(rice?.provenance.earliestExpiresAt).toBeNull();
    });

    it("carries the item's lots with their own expiry provenance", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      const milk = items.find((item) => item.itemId === chenMilk.itemId);

      expect(milk?.lots).toHaveLength(1);
      expect(milk?.lots[0]?.lotId).toBe(chenMilk.lotId);
      expect(milk?.lots[0]?.quantity.micros).toBe("2000000");
      expect(milk?.lots[0]?.expiresAtProvenance).toEqual({
        tier: "KNOWN_FACT",
        source: null,
        confidence: null,
        recordedAt: null,
      });
    });

    it("never names a household on the wire", async () => {
      const { items } = await list(app, DEAN_TOKEN);
      expect(JSON.stringify(items)).not.toContain(chenHousehold);
    });

    it("reports an AI_INTERPRETATION tier as itself, without softening it", async () => {
      const { items } = await list(app, OTHER_TOKEN);
      expect(items[0]?.provenance.quantity?.tier).toBe("AI_INTERPRETATION");
    });
  });

  describe("denial paths reach no database session at all", () => {
    it.each([
      ["no token", undefined],
      ["a made-up token", "fixture.nobody"],
      ["another household's token spelled wrong", "fixture.owner.otherr"],
    ])("answers 401 for %s", async (_case, token) => {
      const { statusCode, items } = await list(app, token);
      expect(statusCode).toBe(401);
      expect(items).toEqual([]);
    });

    it("answers 401 for a bearer-shaped header with no credential", async () => {
      const response = await app.inject({
        method: "GET",
        url: INVENTORY_ITEMS_PATH,
        headers: { authorization: "Bearer" },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("a forged household cannot be reached through any request field", () => {
    it("ignores an x-household-id header naming the other household", async () => {
      const { statusCode, items } = await list(app, DEAN_TOKEN, {
        "x-household-id": okaforHousehold,
      });

      expect(statusCode).toBe(200);
      expect(items.map((item) => item.itemId).sort()).toEqual(
        [chenMilk.itemId, chenRice.itemId].sort(),
      );
      expect(JSON.stringify(items)).not.toContain(okaforBeans.itemId);
    });

    it("ignores a householdId query parameter naming the other household", async () => {
      const response = await app.inject({
        method: "GET",
        url: `${INVENTORY_ITEMS_PATH}?householdId=${okaforHousehold}`,
        headers: { authorization: `Bearer ${DEAN_TOKEN}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.json())).not.toContain(okaforBeans.itemId);
    });

    it("ignores a household named in a JSON body", async () => {
      const response = await app.inject({
        method: "GET",
        url: INVENTORY_ITEMS_PATH,
        headers: {
          authorization: `Bearer ${DEAN_TOKEN}`,
          "content-type": "application/json",
        },
        payload: { householdId: okaforHousehold, role: "owner" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.json())).not.toContain(okaforBeans.itemId);
    });

    it("gives a forged header no effect even when it names the caller's own household", async () => {
      const withHeader = await list(app, OTHER_TOKEN, { "x-household-id": okaforHousehold });
      const without = await list(app, OTHER_TOKEN);
      expect(withHeader.items).toEqual(without.items);
    });
  });

  describe("row-level security is what holds, not the application layer", () => {
    /**
     * The mutation. The tenant-session runner is replaced with one that opens
     * the transaction with **no** household context: the SQL is unchanged, the
     * session is unchanged, only `set_config('app.household_id', …)` is gone.
     *
     * If the endpoint still returned rows, the isolation demonstrated above
     * would be the application's `WHERE household_id = $1` alone, and a single
     * forgotten predicate anywhere else in M2 would be a cross-household read.
     * It returns nothing, because `app_current_household()` is NULL and every
     * policy therefore denies (migration 0006, fail-closed).
     */
    it("returns nothing when the tenant context is removed, for a session that otherwise sees rows", async () => {
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = buildWith(contextless);

      try {
        const control = await list(app, DEAN_TOKEN);
        const mutated = await list(sabotaged, DEAN_TOKEN);

        expect(control.items).toHaveLength(2);
        expect(mutated.statusCode).toBe(200);
        expect(mutated.items).toEqual([]);
      } finally {
        await sabotaged.close();
      }
    });

    it("and the application-layer household predicate holds independently, with the policies bypassed", async () => {
      // No `assumeRole`: the pool is connected as the database owner, which the
      // policies do not bind (migration 0006). The only thing left filtering is
      // `WHERE household_id = $1`, and it is filtering correctly.
      const unpinned: TenantSessionRunner = {
        read: <T>(session: { householdId: string }, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, session.householdId, fn),
        write: <T>(session: { householdId: string }, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, session.householdId, fn),
      };
      const bypassed = buildWith(unpinned);

      try {
        const { items } = await list(bypassed, DEAN_TOKEN);
        expect(items.map((item) => item.itemId).sort()).toEqual(
          [chenMilk.itemId, chenRice.itemId].sort(),
        );
        expect(JSON.stringify(items)).not.toContain(okaforBeans.itemId);
      } finally {
        await bypassed.close();
      }
    });
  });

  describe("logging over the real request path", () => {
    it.each([
      "fixture.dean.chen",
      "fixture.maya.chen",
      "fixture.owner.other",
      "Dean Chen",
      "Maya Chen",
      "Ada Okafor",
      "dean.chen@fixture.invalid",
      "maya.chen@fixture.invalid",
      "ada.okafor@fixture.invalid",
    ])("no log line written by this suite contains %s", (needle) => {
      expect(logLines.filter((line) => line.includes(needle))).toEqual([]);
    });

    it("every line is JSON carrying the correlation id", () => {
      expect(logLines.length).toBeGreaterThan(0);
      for (const line of logLines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        expect(typeof parsed["reqId"], line).toBe("string");
      }
    });

    it("the correlation id on the response is the one in the log", async () => {
      const before = logLines.length;
      const { correlationId } = await list(app, DEAN_TOKEN);
      const written = logLines.slice(before).map((line) => JSON.parse(line) as { reqId?: unknown });

      expect(written.some((entry) => entry.reqId === correlationId)).toBe(true);
    });

    it("records a denial with the reason and the route, for the audit trail", async () => {
      const before = logLines.length;
      await list(app, "fixture.nobody");
      const written = logLines.slice(before).join("\n");

      expect(written).toContain("authorization.denied");
      expect(written).toContain("unknown-token");
      expect(written).toContain(INVENTORY_ITEMS_PATH);
    });
  });
});
