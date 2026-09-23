/**
 * The development seed against a real database (M2-T2).
 *
 * Three claims are worth a suite: the inventory it writes is the prototype's,
 * the chicken breast's clamp row is the *ledger's* and not data, and running it
 * twice changes nothing. The third is the one that would rot silently, because
 * a seed that quietly doubles a household's inventory on a second run still
 * looks fine on the first.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import {
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  seedHousehold,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { insertRawTransaction, seedItem } from "../db/test-support/inventory-fixtures.js";
import { loadFixtureIdentityData, type FixtureIdentityData } from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { CHEN_SEED_ITEMS, seedChenInventory, seedItemId } from "./fixture-inventory.js";

const SUITE = "M2-T2: development seed (fixture identities + Chen inventory)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

interface LedgerSnapshot {
  readonly transactions: number;
  readonly items: number;
  readonly lots: number;
  readonly digest: string;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let chenHousehold: string;
  let deanUserId: string;

  /** Everything about the ledger that a second run must not change. */
  async function snapshot(): Promise<LedgerSnapshot> {
    const rows = await db.pool.query<{
      count: string;
      items: string;
      lots: string;
      digest: string;
    }>(
      `SELECT (SELECT count(*)::text FROM inventory_transactions)             AS count,
              (SELECT count(*)::text FROM inventory_items)                   AS items,
              (SELECT count(*)::text FROM inventory_lots)                    AS lots,
              (SELECT coalesce(md5(string_agg(line, '|' ORDER BY line)), '') FROM (
                 SELECT t.item_id::text || ':' || t.sequence::text || ':' ||
                        t.qty_delta_micros::text || ':' || t.idempotency_key AS line
                   FROM inventory_transactions AS t) AS lines)               AS digest`,
    );
    const row = rows.rows[0];
    return {
      transactions: Number(row?.count ?? "0"),
      items: Number(row?.items ?? "0"),
      lots: Number(row?.lots ?? "0"),
      digest: row?.digest ?? "",
    };
  }

  beforeAll(async () => {
    db = await createTestDatabase("m2t2-seed");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);
    const dean = fixture.sessions.find((session) => session.token === "fixture.dean.chen");
    if (dean === undefined) throw new Error("fixture map lost Dean");
    chenHousehold = dean.householdId;
    deanUserId = dean.userId;
  }, 90_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("writes the prototype's nine items on the first run", async () => {
    const summary = await seedChenInventory(db.pool, chenHousehold, deanUserId);

    expect(summary.itemsCreated).toBe(CHEN_SEED_ITEMS.length);
    expect(summary.itemsAlreadyPresent).toBe(0);
    const items = await db.pool.query<{ display_name: string; current_qty: string; unit: string }>(
      `SELECT display_name, current_qty::text AS current_qty, unit
         FROM inventory_items WHERE household_id = $1 ORDER BY created_at, id`,
      [chenHousehold],
    );
    expect(items.rows.map((row) => `${row.display_name} ${row.current_qty} ${row.unit}`)).toEqual([
      "Strawberries 1.000000 lb",
      "Chicken breast 1.250000 lb",
      "Spinach 5.000000 oz",
      "Mushrooms 8.000000 oz",
      "Greek yogurt 48.000000 oz",
      "Eggs 8.000000 count",
      "Salmon fillets 12.000000 oz",
      "Basmati rice 4.000000 cup",
      "Olive oil 1.000000 bottle",
    ]);
  });

  it("lands the chicken breast on 1.25 lb only because the ledger clamped the stir-fry", async () => {
    const rows = await db.pool.query<{
      sequence: number;
      type: string;
      qty_delta: string;
      actor_kind: string;
      actor_component: string | null;
      system_flag_kind: string | null;
      idempotency_key: string;
    }>(
      `SELECT sequence, type, qty_delta::text AS qty_delta, actor_kind, actor_component,
              system_flag_kind, idempotency_key
         FROM inventory_transactions WHERE item_id = $1 ORDER BY sequence`,
      [seedItemId("chicken")],
    );

    expect(
      rows.rows.map((row) => `${row.type} ${row.qty_delta} ${row.system_flag_kind ?? "-"}`),
    ).toEqual([
      "PURCHASE 2.000000 -",
      "USE_IN_MEAL -2.250000 -",
      "ADJUSTMENT 0.250000 OVER_CONSUMPTION",
      "PURCHASE 1.250000 -",
    ]);
    // The correction is the ledger's own: system actor, the ledger component,
    // and a key in the reserved `::` namespace no caller can write.
    const clamp = rows.rows[2];
    expect(clamp?.actor_kind).toBe("system");
    expect(clamp?.actor_component).toBe("inventory-ledger");
    expect(clamp?.idempotency_key).toContain("::over-consumption-clamp");
  });

  it("gives each of the yogurt's three lots its own 16 oz", async () => {
    const lots = await db.pool.query<{ current_qty: string }>(
      `SELECT current_qty::text AS current_qty FROM inventory_lots
        WHERE item_id = $1 ORDER BY created_at, id`,
      [seedItemId("yogurt")],
    );
    expect(lots.rows.map((row) => row.current_qty)).toEqual([
      "16.000000",
      "16.000000",
      "16.000000",
    ]);
  });

  it("attributes the chicken rows to Dean and the opening rows to the seed component", async () => {
    const actors = await db.pool.query<{ actor_kind: string; component: string | null }>(
      `SELECT actor_kind, actor_component AS component FROM inventory_transactions
        WHERE household_id = $1 AND system_flag_kind IS NULL
        GROUP BY actor_kind, actor_component ORDER BY actor_kind`,
      [chenHousehold],
    );
    expect(actors.rows).toEqual([
      { actor_kind: "system", component: "fixture-seed" },
      { actor_kind: "user", component: null },
    ]);
  });

  it("changes nothing at all on a second run", async () => {
    const before = await snapshot();
    const summary = await seedChenInventory(db.pool, chenHousehold, deanUserId);
    const after = await snapshot();

    expect(summary.itemsCreated).toBe(0);
    expect(summary.itemsAlreadyPresent).toBe(CHEN_SEED_ITEMS.length);
    expect(summary.rowsAppended).toBe(0);
    expect(after).toEqual(before);
  });

  it("is still a no-op on a third run, so idempotency is not a one-shot property", async () => {
    const before = await snapshot();
    await seedChenInventory(db.pool, chenHousehold, deanUserId);
    expect(await snapshot()).toEqual(before);
  });

  it("never touches another household's rows", async () => {
    const other = await seedHousehold(db.pool, `bystander-${randomUUID().slice(0, 8)}`);
    const item = await seedItem(db.pool, other.householdId, "lb");
    await insertRawTransaction(db.pool, {
      householdId: other.householdId,
      itemId: item.itemId,
      lotId: item.lotId,
      userId: other.userId,
    });
    const before = await db.pool.query<{ current_qty: string }>(
      `SELECT current_qty::text AS current_qty FROM inventory_items WHERE id = $1`,
      [item.itemId],
    );

    await seedChenInventory(db.pool, chenHousehold, deanUserId);

    const after = await db.pool.query<{ current_qty: string; count: string }>(
      `SELECT i.current_qty::text AS current_qty,
              (SELECT count(*)::text FROM inventory_transactions WHERE item_id = i.id) AS count
         FROM inventory_items AS i WHERE i.id = $1`,
      [item.itemId],
    );
    expect(after.rows[0]?.current_qty).toBe(before.rows[0]?.current_qty);
    expect(after.rows[0]?.count).toBe("1");
  });

  it("seeds only the Chen household, leaving the second fixture household empty", async () => {
    const okafor = fixture.households.find((entry) => entry.name !== "Chen household");
    const rows = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory_items WHERE household_id = $1`,
      [okafor?.householdId ?? ""],
    );
    expect(rows.rows[0]?.count).toBe("0");
  });
});
