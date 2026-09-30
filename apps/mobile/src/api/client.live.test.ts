import { afterEach, describe, expect, it, vi } from "vitest";
import { getLiveApiTestBaseUrl, isLiveApiTestEnabled } from "../config/env";
import { HttpApiClient, JOIN_CODE_ERROR_MESSAGE, NOT_OWNER_MESSAGE } from "./client";

/**
 * M3-T4d live verification: exercises `HttpApiClient` against a *real*
 * running API and a real (throwaway) database, never mocked `fetch`. Skipped
 * by default and in CI (CLAUDE.md rule 18: "live provider calls are opt-in,
 * metered, and never required for the test suite to pass") — set
 * `SK_LIVE_API_TEST=1` and point `SK_LIVE_API_BASE_URL` (default
 * `http://localhost:3000`) at an API started with `SK_IDENTITY=fixture`
 * against a database that has run `pnpm --filter api db:seed:fixture`
 * (`CONTRIBUTING.md`'s "Seeding a development database" section has the
 * exact recipe, including the throwaway-cluster instructions this worker
 * used to write and run this file once, by hand, per its report).
 *
 * `HttpApiClient` reads its identity token from `EXPO_PUBLIC_IDENTITY_TOKEN`
 * (`src/config/env.ts`); each `it` below stubs it to the fixture persona the
 * step needs and restores it in `afterEach`, so no persona leaks into the
 * next step.
 */
const LIVE = isLiveApiTestEnabled();
const BASE_URL = getLiveApiTestBaseUrl();

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.runIf(LIVE)("HttpApiClient against a real running API (M3-T4d)", () => {
  it("fixture.new.user creates a household and gets a one-time join code, readable back via getOnboardingState", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.new.user");
    const client = new HttpApiClient(BASE_URL);

    // No "getOnboardingState() is null beforehand" assertion here: unlike
    // the fake-fetch suite in client.test.ts (which proves that in a fully
    // controlled, repeatable way), this file runs against a real, persisted
    // database — a second run of this file against the same seed sees
    // fixture.new.user already owning a household from the first run. The
    // route itself does not refuse a second `POST /v1/households` for an
    // already-affiliated caller (confirmed live below), so this only
    // verifies the create/read round trip, not the fresh-user starting
    // state.
    const name = `Live test household ${String(Date.now())}`;
    const created = await client.createHousehold(name);
    expect(created.name).toBe(name);
    expect(created.members).toHaveLength(1);
    expect(created.members[0]?.role).toBe("owner");
    expect(typeof created.joinCode).toBe("string");
    expect(created.joinCode).toMatch(/^[A-Z0-9]{4}-[0-9]{3}$/);

    const after = await client.getOnboardingState();
    expect(after.household?.householdId).toBe(created.householdId);
  });

  it("fixture.maya.chen joins the seeded Chen household with CHEN-482, idempotently on a second try", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.maya.chen");
    const client = new HttpApiClient(BASE_URL);

    const first = await client.joinHousehold("CHEN-482");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.household.name).toBe("Chen household");
    }

    const second = await client.joinHousehold("CHEN-482");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadyMember).toBe(true);
    }
  });

  it("a wrong code renders the exact S1 string, never the server message", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.maya.chen");
    const client = new HttpApiClient(BASE_URL);

    const result = await client.joinHousehold("WRONG-000");
    expect(result).toEqual({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });
  });

  it("the eleventh join attempt in the window renders the §8 rate-limit string (fixture.owner.other, never used for a join elsewhere in this file)", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.owner.other");
    const client = new HttpApiClient(BASE_URL);

    let last: Awaited<ReturnType<typeof client.joinHousehold>> | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await client.joinHousehold("WRONG-000");
    }
    expect(last).toEqual({
      ok: false,
      message: "Too many tries. Wait a few minutes and try again.",
    });
  });

  it("fixture.dean.chen creates an item, readable back through getInventoryItems and getInventoryItem", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.dean.chen");
    const client = new HttpApiClient(BASE_URL);

    const displayName = `Live test item ${String(Date.now())}`;
    const summary = await client.createItem({
      idempotencyKey: `live-test-${String(Date.now())}`,
      source: "MANUAL",
      displayName,
      storageLocation: "PANTRY",
      // "each", not "count": CREATE_ITEM_UNITS_DTO's count unit
      // (packages/contracts/src/units.ts) — found live, see the worker
      // report (the fake-fetch unit tests in client.test.ts use "count"
      // deliberately, since a mocked response never validates it; this file
      // hits the real server-side unit registry, so it must send a unit the
      // server actually accepts).
      unit: "each",
      amount: "3",
      quantityProvenance: {
        tier: "KNOWN_FACT",
        source: "manual entry",
        confidence: null,
        recordedAt: null,
      },
    });
    expect(summary.displayName).toBe(displayName);
    expect(summary.quantity.amount).toBe("3");

    const list = await client.getInventoryItems();
    expect(list.some((item) => item.itemId === summary.itemId)).toBe(true);

    const detail = await client.getInventoryItem(summary.itemId);
    expect(detail?.summary.itemId).toBe(summary.itemId);
    expect(detail?.history).toHaveLength(1);
    expect(detail?.history[0]?.type).toBe("INITIAL_STOCK");
  });

  /**
   * M3-T6 live verification, revised at review rounds 1 (F5) and 2 (F11).
   * Rotating the seeded Chen household's own `CHEN-482` would revoke it for
   * good (a reseed cannot restore it), so this test creates its own
   * throwaway household under `fixture.new.user` and rotates that one.
   *
   * Both joins are made by `fixture.new.user` itself, the owner of that
   * household: the old code must answer `JOIN_CODE_INVALID`, the new code
   * must answer ok with `alreadyMember: true`, which proves the code
   * resolves to the right household without moving anyone. Do not use a
   * seeded persona for the successful join: the session runs as the most
   * recently joined household, so joining would move that persona off Chen
   * for every later run, and reseeding does not undo it (found at round 2).
   * The only rows this test adds are new households owned by
   * `fixture.new.user`, which the file's first test already does each run.
   */
  it("fixture.new.user creates a household, rotates its own code, and the old code stops working while the new one resolves", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.new.user");
    const client = new HttpApiClient(BASE_URL);

    const created = await client.createHousehold(
      `Live rotate test household ${String(Date.now())}`,
    );
    expect(typeof created.joinCode).toBe("string");
    const originalCode = created.joinCode as string;

    const rotated = await client.rotateJoinCode();
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) {
      return;
    }
    expect(rotated.code).toMatch(/^[A-Z0-9]{4}-[0-9]{3}$/);
    expect(rotated.code).not.toBe(originalCode);

    const oldCodeAttempt = await client.joinHousehold(originalCode);
    expect(oldCodeAttempt).toEqual({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });

    const newCodeAttempt = await client.joinHousehold(rotated.code);
    expect(newCodeAttempt.ok).toBe(true);
    if (newCodeAttempt.ok) {
      expect(newCodeAttempt.alreadyMember).toBe(true);
    }
  });

  it("fixture.maya.chen (a member, not the owner, of the seeded Chen household) is refused NOT_OWNER on rotate", async () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.maya.chen");
    const client = new HttpApiClient(BASE_URL);

    const result = await client.rotateJoinCode();
    expect(result).toEqual({ ok: false, message: NOT_OWNER_MESSAGE });
  });
});
