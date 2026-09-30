/**
 * The Chen shopping rows in the development seed (M7-T1 (f)), through the
 * real `runFixtureSeed` entry point: written once, idempotent across runs,
 * never touching a row a person has since changed, only the Chen household,
 * and refused in production before anything connects.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { CHEN_SEED_SHOPPING_ROWS, seedShoppingRowId } from "./fixture-shopping.js";
import { seedItemId } from "./fixture-inventory.js";
import { runFixtureSeed, type SeedIo } from "./seed-fixture.js";

const SUITE = "M7-T1: development seed (Chen shopping rows)";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const CHEN = "f1c70000-0000-4000-8000-000000000001";
const OKAFOR = "f1c70000-0000-4000-8000-000000000002";

interface StoredRow {
  readonly id: string;
  readonly name: string;
  readonly group_label: string;
  readonly need_micros: string;
  readonly unit: string;
  readonly item_id: string | null;
  readonly status: string;
  readonly origin_name: string;
  readonly checked_name: string | null;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  const out: string[] = [];
  const io: SeedIo = {
    out: (line) => out.push(line),
    error: (line) => out.push(`ERR ${line}`),
  };

  async function rows(): Promise<StoredRow[]> {
    const result = await db.pool.query<StoredRow>(
      `SELECT r.id, r.name, r.group_label, r.need_micros::text AS need_micros, r.unit, r.item_id,
              r.status, ou.display_name AS origin_name, cu.display_name AS checked_name
         FROM shopping_rows AS r
         JOIN household_memberships AS om ON om.id = r.origin_member_id
         JOIN users AS ou ON ou.id = om.user_id
         LEFT JOIN household_memberships AS cm ON cm.id = r.checked_off_by
         LEFT JOIN users AS cu ON cu.id = cm.user_id
        WHERE r.household_id = $1
        ORDER BY r.created_at, r.id`,
      [CHEN],
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = await createTestDatabase("m7t1-seed");
  }, 90_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("writes the prototype's three member rows on the first run, in list order", async () => {
    expect(await runFixtureSeed({ DATABASE_URL: db.url, NODE_ENV: "test" }, io)).toBe(0);
    expect(out[out.length - 1]).toContain("shopping rows created 3, already present 0");
    expect(await rows()).toEqual([
      {
        id: seedShoppingRowId("chicken"),
        name: "Chicken breast",
        group_label: "Meat & seafood",
        need_micros: "2000000",
        unit: "lb",
        item_id: seedItemId("chicken"),
        status: "open",
        origin_name: "Dean Chen",
        checked_name: null,
      },
      {
        id: seedShoppingRowId("paper-towels"),
        name: "Paper towels",
        group_label: "Pantry",
        need_micros: "1000000",
        unit: "each",
        item_id: null,
        status: "open",
        origin_name: "Maya Chen",
        checked_name: null,
      },
      {
        id: seedShoppingRowId("olive-oil"),
        name: "Olive oil",
        group_label: "Pantry",
        need_micros: "1000000",
        unit: "each",
        item_id: null,
        status: "done",
        origin_name: "Dean Chen",
        checked_name: "Dean Chen",
      },
    ]);
    expect(CHEN_SEED_SHOPPING_ROWS).toHaveLength(3);
  });

  it("stores the need only; the 1.25 lb the gap is computed against is the ledger's", async () => {
    const item = await db.pool.query<{ current_qty_micros: string }>(
      "SELECT current_qty_micros::text AS current_qty_micros FROM inventory_items WHERE id = $1",
      [seedItemId("chicken")],
    );
    expect(item.rows[0]?.current_qty_micros).toBe("1250000");
    const columns = await db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'shopping_rows'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain("buy_micros");
    expect(names).not.toContain("have_micros");
  });

  it("changes nothing on a second and a third run, and leaves a row a person changed alone", async () => {
    await db.pool.query(
      `UPDATE shopping_rows SET status = 'skipped', removed_at = clock_timestamp(),
              removed_by = origin_member_id, updated_at = clock_timestamp()
        WHERE id = $1`,
      [seedShoppingRowId("paper-towels")],
    );
    const before = await rows();
    for (let run = 0; run < 2; run += 1) {
      expect(await runFixtureSeed({ DATABASE_URL: db.url, NODE_ENV: "test" }, io)).toBe(0);
      expect(out[out.length - 1]).toContain("shopping rows created 0, already present 3");
      expect(await rows()).toEqual(before);
    }
    const count = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM shopping_rows",
    );
    expect(count.rows[0]?.count).toBe("3");
  });

  it("seeds only the Chen household", async () => {
    const other = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM shopping_rows WHERE household_id = $1",
      [OKAFOR],
    );
    expect(other.rows[0]?.count).toBe("0");
  });

  it("refuses in production before touching the database", async () => {
    const lines: string[] = [];
    const code = await runFixtureSeed(
      { DATABASE_URL: db.url, NODE_ENV: "production" },
      { out: (line) => lines.push(line), error: (line) => lines.push(line) },
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("refusing to run with NODE_ENV=production");
    const count = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM shopping_rows",
    );
    expect(count.rows[0]?.count).toBe("3");
  });
});
