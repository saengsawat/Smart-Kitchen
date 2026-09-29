/**
 * M2-T3 over HTTP: household create / join / me / mine / rotate, and item
 * creation over the ledger, through the real pipeline (fixture identity port
 * with database-backed memberships, the authorization hook, row-level
 * security) on a throwaway database.
 *
 * The file runs top to bottom as one story, because the acceptance criteria
 * are one story: a new person creates a household, Maya re-joins Chen
 * idempotently, a stranger guesses and is throttled, Dean rotates the code
 * and the old one dies, the new person joins Chen with the new code and now
 * runs as Chen (the most recently joined household), and Dean scans a
 * yogurt. Every negative has a positive control near it.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import {
  HOUSEHOLD_JOIN_CODE_PATH,
  HOUSEHOLD_JOIN_PATH,
  HOUSEHOLD_ME_PATH,
  HOUSEHOLD_MINE_PATH,
  HOUSEHOLDS_PATH,
  INVENTORY_ITEMS_PATH,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  type ApiErrorBodyDto,
  type CreateHouseholdResponseDto,
  type CreateItemRequestDto,
  type HouseholdMembershipsResponseDto,
  type HouseholdSummaryDto,
  type InventoryItemDetailDto,
  type InventoryItemsResponseDto,
  type InventoryItemSummaryDto,
  type JoinHouseholdResponseDto,
  type RotateJoinCodeResponseDto,
} from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  CHEN_FIXTURE_JOIN_CODE,
  createJoinCodeHasher,
  DEVELOPMENT_JOIN_CODE_PEPPER,
  JOIN_CODE_PATTERN,
} from "../db/households/join-code.js";
import { withHouseholdTransaction } from "../db/session.js";
import {
  APP_ROLE,
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../db/test-support/harness.js";
import {
  createFixtureIdentityPort,
  loadFixtureIdentityData,
  type FixtureIdentityData,
} from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { seedChenJoinCode } from "../seed/fixture-join-code.js";
import {
  JOIN_CODE_INVALID_MESSAGE,
  RATE_LIMITED_MESSAGE,
  validHouseholdName,
} from "./household-routes.js";
import {
  createMembershipSessionRunner,
  createPostgresMembershipDirectory,
} from "./membership-session.js";
import { createJoinAttemptLimiter, JOIN_ATTEMPT_WINDOW_MS } from "./rate-limit.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./tenant-session.js";

const SUITE = "M2-T3: household endpoints and item creation over HTTP";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const ADA = "fixture.owner.other";
const NEW = "fixture.new.user";
const TOKENS = [DEAN, MAYA, ADA, NEW] as const;

const hasher = createJoinCodeHasher(DEVELOPMENT_JOIN_CODE_PEPPER);

/** `expect.any(String)`, typed so it can sit inside a typed literal. */
const ANY_STRING: unknown = expect.any(String);

interface Answer<T> {
  readonly statusCode: number;
  readonly body: T;
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let fixture: FixtureIdentityData;
  let app: FastifyInstance;
  let logLines: string[];
  let chenId: string;
  let okaforId: string;
  let deanUserId: string;
  let adaUserId: string;
  let newUserId: string;
  let haddadId: string;
  let currentChenCode = CHEN_FIXTURE_JOIN_CODE;
  const issuedCodes: string[] = [];

  function build(
    options: {
      tenantSession?: TenantSessionRunner;
      now?: () => number;
    } = {},
  ): FastifyInstance {
    return buildApp({
      identity: createFixtureIdentityPort(fixture, {
        memberships: createPostgresMembershipDirectory(db.pool),
      }),
      tenantSession: options.tenantSession ?? createTenantSessionRunner(db.pool),
      households: {
        memberships: createMembershipSessionRunner(db.pool),
        joinCodes: hasher,
        joinLimiter: createJoinAttemptLimiter(options.now),
      },
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
    instance: FastifyInstance,
    method: "GET" | "POST",
    url: string,
    token: string | undefined,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Answer<T>> {
    const response = await instance.inject({
      method,
      url,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return { statusCode: response.statusCode, body: response.json<T>() };
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const result = await db.pool.query<{ count: string }>(sql, params);
    return Number(result.rows[0]?.count ?? "0");
  }

  function membershipsOf(userId: string): Promise<number> {
    return count("SELECT count(*)::text AS count FROM household_memberships WHERE user_id = $1", [
      userId,
    ]);
  }

  function remember(code: string): string {
    issuedCodes.push(code);
    return code;
  }

  beforeAll(async () => {
    logLines = [];
    db = await createTestDatabase("m2t3-http");
    fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);
    const dean = fixture.sessions.find((s) => s.token === DEAN);
    const ada = fixture.sessions.find((s) => s.token === ADA);
    const newcomer = fixture.unaffiliated.find((u) => u.token === NEW);
    if (dean === undefined || ada === undefined || newcomer === undefined) {
      throw new Error("fixture map lost a session");
    }
    chenId = dean.householdId;
    okaforId = ada.householdId;
    deanUserId = dean.userId;
    adaUserId = ada.userId;
    newUserId = newcomer.userId;
    await seedChenJoinCode(db.pool, chenId, deanUserId, hasher);
    issuedCodes.push(CHEN_FIXTURE_JOIN_CODE);
    app = build();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe("authentication and the household-less caller", () => {
    it.each([
      ["POST", HOUSEHOLDS_PATH, { name: "x" }],
      ["POST", HOUSEHOLD_JOIN_PATH, { code: CHEN_FIXTURE_JOIN_CODE }],
      ["GET", HOUSEHOLD_ME_PATH, undefined],
      ["GET", HOUSEHOLD_MINE_PATH, undefined],
      ["POST", HOUSEHOLD_JOIN_CODE_PATH, undefined],
      ["POST", INVENTORY_ITEMS_PATH, { idempotencyKey: "k" }],
    ] as const)(
      "%s %s answers 401 without a token and with an unknown one",
      async (method, url, body) => {
        const none = await call<ApiErrorBodyDto>(app, method, url, undefined, body);
        const unknown = await call<ApiErrorBodyDto>(app, method, url, "fixture.nobody", body);
        expect(none.statusCode).toBe(401);
        expect(unknown.statusCode).toBe(401);
        expect(none.body.error.code).toBe("UNAUTHENTICATED");
      },
    );

    it("the new user is signed in, belongs to nothing, and lists no households", async () => {
      const mine = await call<HouseholdMembershipsResponseDto>(
        app,
        "GET",
        HOUSEHOLD_MINE_PATH,
        NEW,
      );
      expect(mine).toEqual({ statusCode: 200, body: { households: [] } });
    });

    it.each([
      ["GET", HOUSEHOLD_ME_PATH],
      ["GET", INVENTORY_ITEMS_PATH],
      ["POST", HOUSEHOLD_JOIN_CODE_PATH],
    ] as const)("the new user gets 403 on household route %s %s", async (method, url) => {
      const answer = await call<ApiErrorBodyDto>(app, method, url, NEW);
      expect(answer.statusCode).toBe(403);
      expect(answer.body.error.code).toBe("FORBIDDEN");
    });

    it("the new user cannot create an item before having a household", async () => {
      const answer = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, NEW, {
        idempotencyKey: "no-household",
        source: "MANUAL",
        displayName: "Rice",
        storageLocation: "PANTRY",
        unit: "g",
        amount: "500",
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: null,
          confidence: null,
          recordedAt: null,
        },
      });
      expect(answer.statusCode).toBe(403);
      expect(await count("SELECT count(*)::text AS count FROM inventory_items")).toBe(0);
    });
  });

  describe("POST /v1/households", () => {
    it.each([[""], ["   "], ["x".repeat(61)], ["bad\u0007name"]])(
      "refuses the name %j with 400 and creates nothing",
      async (name) => {
        const answer = await call<ApiErrorBodyDto>(app, "POST", HOUSEHOLDS_PATH, NEW, { name });
        expect(answer.statusCode).toBe(400);
        expect(answer.body.error.code).toBe("BAD_REQUEST");
        expect(await membershipsOf(newUserId)).toBe(0);
      },
    );

    it("accepts 60 characters after trimming, and not 61 (unit check of the same rule)", () => {
      expect(validHouseholdName(`  ${"x".repeat(60)}  `)).toBe("x".repeat(60));
      expect(validHouseholdName("x".repeat(61))).toBeUndefined();
      expect(validHouseholdName("é".repeat(60))).toBe("é".repeat(60));
    });

    it("refuses a body that tries to name a household or a user", async () => {
      for (const extra of [{ householdId: chenId }, { userId: deanUserId }, { role: "owner" }]) {
        const answer = await call<ApiErrorBodyDto>(app, "POST", HOUSEHOLDS_PATH, NEW, {
          name: "Sneaky",
          ...extra,
        });
        expect(answer.statusCode).toBe(400);
      }
      expect(await membershipsOf(newUserId)).toBe(0);
    });

    it("the new user creates a household, becomes its owner and gets a fresh code once", async () => {
      const answer = await call<CreateHouseholdResponseDto>(app, "POST", HOUSEHOLDS_PATH, NEW, {
        name: "  Haddad home  ",
      });
      expect(answer.statusCode).toBe(201);
      const { household, joinCode } = answer.body;
      haddadId = household.householdId;
      expect(household.name).toBe("Haddad home");
      expect(household.members).toEqual([
        { memberId: ANY_STRING, displayInitials: "NH", role: "owner", isCaller: true },
      ]);
      expect(joinCode.code).toMatch(JOIN_CODE_PATTERN);
      expect(joinCode.code).not.toBe(CHEN_FIXTURE_JOIN_CODE);
      remember(joinCode.code);
      expect(JSON.stringify(answer.body)).not.toContain("@");

      expect(await membershipsOf(newUserId)).toBe(1);
      const stored = await db.pool.query<{ code_hash: string }>(
        "SELECT code_hash FROM household_join_codes WHERE household_id = $1",
        [haddadId],
      );
      expect(stored.rows.map((row) => row.code_hash)).toEqual([hasher.hash(joinCode.code)]);
    });

    it("the new user's next request runs as the new household", async () => {
      const me = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, NEW);
      expect(me.statusCode).toBe(200);
      expect(me.body.householdId).toBe(haddadId);
      const mine = await call<HouseholdMembershipsResponseDto>(
        app,
        "GET",
        HOUSEHOLD_MINE_PATH,
        NEW,
      );
      expect(mine.body.households).toEqual([
        {
          householdId: haddadId,
          name: "Haddad home",
          role: "owner",
          joinedAt: ANY_STRING,
          current: true,
        },
      ]);
    });

    it("audit-logs the creation with actor and household ids, and no name or code", () => {
      const audit = logLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line["msg"] === "household.membership.changed");
      expect(audit).toContainEqual(
        expect.objectContaining({
          audit: "membership",
          change: "household-created",
          actorUserId: newUserId,
          householdId: haddadId,
          role: "owner",
        }),
      );
      const text = audit.map((line) => JSON.stringify(line)).join("\n");
      expect(text).not.toContain("Haddad");
      expect(text).not.toContain("Noor");
    });
  });

  describe("POST /v1/households/join", () => {
    it("Maya re-joins Chen with CHEN-482: 200, already a member, no second membership", async () => {
      const mayaUser = fixture.sessions.find((s) => s.token === MAYA)?.userId ?? "";
      for (const code of [CHEN_FIXTURE_JOIN_CODE, "  chen-482 "]) {
        const answer = await call<JoinHouseholdResponseDto>(
          app,
          "POST",
          HOUSEHOLD_JOIN_PATH,
          MAYA,
          {
            code,
          },
        );
        expect(answer.statusCode).toBe(200);
        expect(answer.body.alreadyMember).toBe(true);
        expect(answer.body.household.householdId).toBe(chenId);
        expect(answer.body.household.members.map((m) => [m.displayInitials, m.role])).toEqual([
          ["DC", "owner"],
          ["MC", "member"],
        ]);
      }
      expect(await membershipsOf(mayaUser)).toBe(1);
    });

    it("refuses a body with anything besides the code", async () => {
      const answer = await call<ApiErrorBodyDto>(app, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
        code: CHEN_FIXTURE_JOIN_CODE,
        householdId: chenId,
      });
      expect(answer.statusCode).toBe(400);
      expect(
        await count(
          "SELECT count(*)::text AS count FROM household_memberships WHERE household_id = $1 AND user_id = $2",
          [chenId, adaUserId],
        ),
      ).toBe(0);
    });

    it("answers every bad code with one identical 404 body shape and message", async () => {
      const limited = build();
      try {
        const bodies: ApiErrorBodyDto[] = [];
        for (const code of ["", "nope", "ABCD-234", "CHEN-4820", "CHIN-482"]) {
          const answer = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
            code,
          });
          expect(answer.statusCode, code).toBe(404);
          bodies.push(answer.body);
        }
        for (const body of bodies) {
          expect(Object.keys(body.error).sort()).toEqual(["code", "correlationId", "message"]);
          expect(body.error.code).toBe("JOIN_CODE_INVALID");
          expect(body.error.message).toBe(JOIN_CODE_INVALID_MESSAGE);
        }
      } finally {
        await limited.close();
      }
    });

    it("the eleventh attempt in ten minutes is 429, even with the right code, and nothing joins", async () => {
      let now = 5_000_000;
      const limited = build({ now: () => now });
      try {
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const answer = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
            code: `WXYZ-${String(200 + attempt)
              .replaceAll("0", "2")
              .replaceAll("1", "3")}`,
          });
          expect(answer.statusCode, `attempt ${String(attempt)}`).toBe(404);
          now += 30_000;
        }
        const eleventh = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
          code: CHEN_FIXTURE_JOIN_CODE,
        });
        expect(eleventh.statusCode).toBe(429);
        expect(eleventh.body.error).toMatchObject({
          code: "RATE_LIMITED",
          message: RATE_LIMITED_MESSAGE,
        });
        expect(
          await count(
            "SELECT count(*)::text AS count FROM household_memberships WHERE household_id = $1 AND user_id = $2",
            [chenId, adaUserId],
          ),
        ).toBe(0);

        // Another user is unaffected by Ada's budget.
        const maya = await call<JoinHouseholdResponseDto>(
          limited,
          "POST",
          HOUSEHOLD_JOIN_PATH,
          MAYA,
          {
            code: CHEN_FIXTURE_JOIN_CODE,
          },
        );
        expect(maya.statusCode).toBe(200);

        // Once the window has passed, Ada is answered on the merits again.
        now += JOIN_ATTEMPT_WINDOW_MS;
        const later = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
          code: "WXYZ-999",
        });
        expect(later.statusCode).toBe(404);
      } finally {
        await limited.close();
      }
    });

    it("a concurrent burst cannot outrun the limit: exactly ten are checked", async () => {
      const limited = build();
      try {
        const answers = await Promise.all(
          Array.from({ length: 25 }, () =>
            call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, { code: "WXYZ-222" }),
          ),
        );
        const statuses = answers.map((answer) => answer.statusCode);
        expect(statuses.filter((status) => status === 404)).toHaveLength(10);
        expect(statuses.filter((status) => status === 429)).toHaveLength(15);
      } finally {
        await limited.close();
      }
    });
  });

  describe("GET /v1/households/me and /mine across the four tokens", () => {
    it("each token sees its own household and nobody else's members", async () => {
      const expected: Record<string, { householdId: string; initials: string[] }> = {
        [DEAN]: { householdId: chenId, initials: ["DC", "MC"] },
        [MAYA]: { householdId: chenId, initials: ["DC", "MC"] },
        [ADA]: { householdId: okaforId, initials: ["AO"] },
        [NEW]: { householdId: haddadId, initials: ["NH"] },
      };
      for (const token of TOKENS) {
        const me = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, token);
        expect(me.statusCode, token).toBe(200);
        expect(me.body.householdId, token).toBe(expected[token]?.householdId);
        expect(
          me.body.members.map((m) => m.displayInitials),
          token,
        ).toEqual(expected[token]?.initials);
        expect(
          me.body.members.filter((m) => m.isCaller),
          token,
        ).toHaveLength(1);
        const text = JSON.stringify(me.body);
        expect(text).not.toContain("@");
        expect(text).not.toContain("restrictions");
        expect(text).not.toContain("noneConfirmed");
      }
    });

    it("the Okafor owner cannot reach Chen's members, whatever the request says", async () => {
      const chenMembers = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, DEAN);
      const chenMemberIds = chenMembers.body.members.map((m) => m.memberId);
      const attempts: { url: string; headers: Record<string, string> }[] = [
        { url: HOUSEHOLD_ME_PATH, headers: { "x-household-id": chenId } },
        { url: `${HOUSEHOLD_ME_PATH}?householdId=${chenId}`, headers: {} },
        { url: HOUSEHOLD_MINE_PATH, headers: { "x-household-id": chenId } },
      ];
      for (const attempt of attempts) {
        const answer = await call<unknown>(
          app,
          "GET",
          attempt.url,
          ADA,
          undefined,
          attempt.headers,
        );
        expect(answer.statusCode).toBe(200);
        const text = JSON.stringify(answer.body);
        expect(text).not.toContain(chenId);
        for (const memberId of chenMemberIds) expect(text).not.toContain(memberId);
      }
    });

    it("/mine lists exactly the caller's memberships", async () => {
      const ada = await call<HouseholdMembershipsResponseDto>(app, "GET", HOUSEHOLD_MINE_PATH, ADA);
      expect(ada.body.households.map((h) => [h.householdId, h.role, h.current])).toEqual([
        [okaforId, "owner", true],
      ]);
      const maya = await call<HouseholdMembershipsResponseDto>(
        app,
        "GET",
        HOUSEHOLD_MINE_PATH,
        MAYA,
      );
      expect(maya.body.households.map((h) => [h.name, h.role])).toEqual([
        ["Chen household", "member"],
      ]);
    });
  });

  describe("POST /v1/households/me/join-code (owner only)", () => {
    it("Maya (a member) is refused with 403 NOT_OWNER and the code keeps working", async () => {
      const answer = await call<ApiErrorBodyDto>(app, "POST", HOUSEHOLD_JOIN_CODE_PATH, MAYA);
      expect(answer.statusCode).toBe(403);
      expect(answer.body.error.code).toBe("NOT_OWNER");
      const still = await call<JoinHouseholdResponseDto>(app, "POST", HOUSEHOLD_JOIN_PATH, MAYA, {
        code: CHEN_FIXTURE_JOIN_CODE,
      });
      expect(still.statusCode).toBe(200);
    });

    it("Dean rotates: the new code is returned once and the old one stops working", async () => {
      const rotated = await call<RotateJoinCodeResponseDto>(
        app,
        "POST",
        HOUSEHOLD_JOIN_CODE_PATH,
        DEAN,
      );
      expect(rotated.statusCode).toBe(200);
      currentChenCode = remember(rotated.body.joinCode.code);
      expect(currentChenCode).toMatch(JOIN_CODE_PATTERN);
      expect(currentChenCode).not.toBe(CHEN_FIXTURE_JOIN_CODE);

      const limited = build();
      try {
        const old = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
          code: CHEN_FIXTURE_JOIN_CODE,
        });
        const never = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
          code: "QQQQ-222",
        });
        expect(old.statusCode).toBe(404);
        expect(never.statusCode).toBe(404);
        // Identical apart from the per-request correlation id.
        expect({ ...old.body.error, correlationId: "" }).toEqual({
          ...never.body.error,
          correlationId: "",
        });
      } finally {
        await limited.close();
      }
      expect(
        await count(
          "SELECT count(*)::text AS count FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
          [chenId],
        ),
      ).toBe(1);
    });

    it("re-running the seed does not bring the rotated code back", async () => {
      const again = await seedChenJoinCode(db.pool, chenId, deanUserId, hasher);
      expect(again.issued).toBe(false);
      const limited = build();
      try {
        const old = await call<ApiErrorBodyDto>(limited, "POST", HOUSEHOLD_JOIN_PATH, ADA, {
          code: CHEN_FIXTURE_JOIN_CODE,
        });
        expect(old.statusCode).toBe(404);
      } finally {
        await limited.close();
      }
    });

    it("audit-logs the rotation with ids only", () => {
      const rotations = logLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line["change"] === "join-code-rotated");
      expect(rotations).toContainEqual(
        expect.objectContaining({ actorUserId: deanUserId, householdId: chenId }),
      );
    });
  });

  describe("several households: the most recently joined wins (g)", () => {
    it("the new user joins Chen with the rotated code and now runs as Chen", async () => {
      const joined = await call<JoinHouseholdResponseDto>(app, "POST", HOUSEHOLD_JOIN_PATH, NEW, {
        code: currentChenCode,
      });
      expect(joined.statusCode).toBe(200);
      expect(joined.body.alreadyMember).toBe(false);
      expect(
        joined.body.household.members.map((m) => [m.displayInitials, m.role, m.isCaller]),
      ).toEqual([
        ["DC", "owner", false],
        ["MC", "member", false],
        ["NH", "member", true],
      ]);
      expect(await membershipsOf(newUserId)).toBe(2);

      const me = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, NEW);
      expect(me.body.householdId).toBe(chenId);
      const mine = await call<HouseholdMembershipsResponseDto>(
        app,
        "GET",
        HOUSEHOLD_MINE_PATH,
        NEW,
      );
      expect(mine.body.households.map((h) => [h.householdId, h.role, h.current])).toEqual([
        [chenId, "member", true],
        [haddadId, "owner", false],
      ]);
      // As a member of Chen now, the new user may not rotate Chen's code,
      // even though they own Haddad home.
      const rotate = await call<ApiErrorBodyDto>(app, "POST", HOUSEHOLD_JOIN_CODE_PATH, NEW);
      expect(rotate.statusCode).toBe(403);
      expect(rotate.body.error.code).toBe("NOT_OWNER");
    });

    it("joining again is idempotent and logs no second membership change", async () => {
      const before = logLines.filter((line) => line.includes('"joined-by-code"')).length;
      const again = await call<JoinHouseholdResponseDto>(app, "POST", HOUSEHOLD_JOIN_PATH, NEW, {
        code: currentChenCode,
      });
      expect(again.body.alreadyMember).toBe(true);
      expect(await membershipsOf(newUserId)).toBe(2);
      expect(logLines.filter((line) => line.includes('"joined-by-code"')).length).toBe(before);
    });
  });

  describe("POST /v1/inventory/items", () => {
    const yogurt: CreateItemRequestDto = {
      idempotencyKey: "scan-yogurt-1",
      source: "BARCODE",
      displayName: "Greek yogurt",
      storageLocation: "FRIDGE",
      unit: "g",
      amount: "907",
      quantityProvenance: {
        tier: "KNOWN_FACT",
        source: "scanned barcode",
        confidence: null,
        recordedAt: null,
      },
      productRef: "dairy-011",
      bestByDate: "2026-10-12T00:00:00.000Z",
      bestByProvenance: {
        tier: "ESTIMATED",
        source: "fixture-shelf-life-estimate",
        confidence: null,
        recordedAt: "2026-09-20T00:00:00.000Z",
      },
    };
    let yogurtId: string;

    it("Dean scans a yogurt: 201, a PURCHASE row, listed and shown with history", async () => {
      const created = await call<InventoryItemSummaryDto>(
        app,
        "POST",
        INVENTORY_ITEMS_PATH,
        DEAN,
        yogurt,
      );
      expect(created.statusCode).toBe(201);
      yogurtId = created.body.itemId;
      expect(created.body).toMatchObject({
        displayName: "Greek yogurt",
        productRef: "dairy-011",
        storageLocation: "FRIDGE",
        quantity: { unit: "g", micros: "907000000", amount: "907" },
        earliestExpiresAt: "2026-10-12T00:00:00.000Z",
      });
      expect(created.body.lots).toHaveLength(1);
      expect(created.body.lots[0]?.expiresAtProvenance?.tier).toBe("ESTIMATED");

      const list = await call<InventoryItemsResponseDto>(app, "GET", INVENTORY_ITEMS_PATH, DEAN);
      expect(list.body.items.map((item) => item.itemId)).toContain(yogurtId);

      const detail = await call<InventoryItemDetailDto>(
        app,
        "GET",
        inventoryItemPath(yogurtId),
        DEAN,
      );
      expect(detail.statusCode).toBe(200);
      expect(detail.body.history).toHaveLength(1);
      expect(detail.body.history[0]).toMatchObject({
        type: "PURCHASE",
        deltaMicros: "907000000",
        actor: { kind: "user", displayInitials: "DC" },
        provenance: { tier: "KNOWN_FACT", source: "barcode-scan" },
      });
    });

    it("replay returns the same item and appends nothing", async () => {
      const again = await call<InventoryItemSummaryDto>(
        app,
        "POST",
        INVENTORY_ITEMS_PATH,
        DEAN,
        yogurt,
      );
      expect(again.statusCode).toBe(200);
      expect(again.body.itemId).toBe(yogurtId);
      expect(
        await count(
          "SELECT count(*)::text AS count FROM inventory_transactions WHERE item_id = $1",
          [yogurtId],
        ),
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*)::text AS count FROM inventory_items WHERE display_name = 'Greek yogurt'",
        ),
      ).toBe(1);
    });

    it.each([
      ["a different amount", { amount: "500" }],
      ["a different name", { displayName: "Skyr" }],
      ["a different location", { storageLocation: "FREEZER" }],
      ["a different best-by", { bestByDate: "2026-10-13T00:00:00.000Z" }],
      [
        "a different best-by tier",
        { bestByProvenance: { ...yogurt.bestByProvenance!, tier: "KNOWN_FACT" } },
      ],
      [
        "a different quantity tier",
        { quantityProvenance: { ...yogurt.quantityProvenance, tier: "ESTIMATED" } },
      ],
      ["a different source", { source: "MANUAL", productRef: undefined }],
    ] as const)("the same key with %s is 409 and writes nothing", async (_case, override) => {
      const body = JSON.parse(JSON.stringify({ ...yogurt, ...override })) as CreateItemRequestDto;
      const answer = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, body);
      expect(answer.statusCode).toBe(409);
      expect(answer.body.error).toMatchObject({
        code: "CONFLICT",
        ledgerCode: "IDEMPOTENCY_KEY_CONFLICT",
      });
      expect(await count("SELECT count(*)::text AS count FROM inventory_items")).toBe(1);
    });

    it("the same key and body from another member is a conflict, not Maya's replay of Dean's row", async () => {
      const answer = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, MAYA, yogurt);
      expect(answer.statusCode).toBe(409);
    });

    it("keys are household-scoped: Ada may use the same key, and Chen never sees her item", async () => {
      const ada = await call<InventoryItemSummaryDto>(
        app,
        "POST",
        INVENTORY_ITEMS_PATH,
        ADA,
        yogurt,
      );
      expect(ada.statusCode).toBe(201);
      expect(ada.body.itemId).not.toBe(yogurtId);
      const chen = await call<InventoryItemsResponseDto>(app, "GET", INVENTORY_ITEMS_PATH, DEAN);
      expect(chen.body.items.map((item) => item.itemId)).not.toContain(ada.body.itemId);
      const peek = await call<ApiErrorBodyDto>(
        app,
        "GET",
        inventoryItemPath(ada.body.itemId),
        DEAN,
      );
      expect(peek.statusCode).toBe(404);
    });

    it("a manual item writes INITIAL_STOCK with the manual-entry source", async () => {
      const created = await call<InventoryItemSummaryDto>(app, "POST", INVENTORY_ITEMS_PATH, MAYA, {
        idempotencyKey: "manual-rice-1",
        source: "MANUAL",
        displayName: "Jasmine rice",
        storageLocation: "PANTRY",
        unit: "lb",
        amount: "2.5",
        quantityProvenance: {
          tier: "ESTIMATED",
          source: "manual entry",
          confidence: null,
          recordedAt: null,
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.body.quantity).toEqual({ unit: "lb", micros: "2500000", amount: "2.500000" });
      expect(created.body.earliestExpiresAt).toBeNull();
      expect(created.body.lots[0]?.expiresAtProvenance).toBeNull();
      const detail = await call<InventoryItemDetailDto>(
        app,
        "GET",
        inventoryItemPath(created.body.itemId),
        MAYA,
      );
      expect(detail.body.history[0]).toMatchObject({
        type: "INITIAL_STOCK",
        actor: { kind: "user", displayInitials: "MC" },
        provenance: { tier: "ESTIMATED", source: "manual-entry" },
      });
    });

    it("passes an AI-tier best-by through to the lot unchanged (tier from the request, never invented)", async () => {
      const created = await call<InventoryItemSummaryDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, {
        ...yogurt,
        idempotencyKey: "scan-yogurt-ai-bestby",
        bestByProvenance: {
          tier: "AI_INTERPRETATION",
          source: null,
          confidence: null,
          recordedAt: null,
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.body.lots[0]?.expiresAtProvenance?.tier).toBe("AI_INTERPRETATION");
    });

    it.each([
      ["an unknown unit", { unit: "handful" }, 400, "INVALID_FIELD"],
      ["fl oz", { unit: "fl oz" }, 400, "INVALID_FIELD"],
      ["a registry unit no screen offers", { unit: "gal" }, 400, "INVALID_FIELD"],
      ["a zero amount", { amount: "0" }, 400, "ZERO_DELTA"],
      ["a JSON-number-looking amount", { amount: "1e3" }, 400, "INVALID_FIELD"],
      [
        "an AI quantity tier",
        {
          quantityProvenance: {
            tier: "AI_INTERPRETATION",
            source: null,
            confidence: null,
            recordedAt: null,
          },
        },
        400,
        "INVALID_FIELD",
      ],
      ["a best-by with no provenance", { bestByProvenance: null }, 400, "INVALID_FIELD"],
      ["an unparseable best-by", { bestByDate: "soon" }, 400, "INVALID_TIMESTAMP"],
    ] as const)(
      "refuses %s with %i %s and writes nothing",
      async (_case, override, status, ledgerCode) => {
        const before = await count("SELECT count(*)::text AS count FROM inventory_items");
        const answer = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, {
          ...yogurt,
          idempotencyKey: `refused-${String(Math.random()).slice(2, 10)}`,
          ...override,
        });
        expect(answer.statusCode).toBe(status);
        expect(answer.body.error.ledgerCode).toBe(ledgerCode);
        expect(await count("SELECT count(*)::text AS count FROM inventory_items")).toBe(before);
      },
    );

    it.each([
      ["an unknown storage location", { storageLocation: "GARAGE" }],
      ["a household id in the body", { householdId: "f1c70000-0000-4000-8000-000000000002" }],
      ["a lot id in the body", { lotId: "f1c70000-0000-4000-8000-000000000009" }],
      ["an item id in the body", { itemId: "f1c70000-0000-4000-8000-000000000009" }],
      ["an actor in the body", { actorUserId: "f1c70001-0000-4000-8000-000000000003" }],
    ] as const)("refuses %s at the schema (400) and writes nothing", async (_case, override) => {
      const before = await count("SELECT count(*)::text AS count FROM inventory_items");
      const answer = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, {
        ...yogurt,
        idempotencyKey: `schema-${String(Math.random()).slice(2, 10)}`,
        ...override,
      });
      expect(answer.statusCode).toBe(400);
      expect(answer.body.error.code).toBe("BAD_REQUEST");
      expect(await count("SELECT count(*)::text AS count FROM inventory_items")).toBe(before);
    });

    it("a JSON-number amount is coerced to its exact text, as on the write path (M2-T2 ruling)", async () => {
      // coerceTypes stays on (app.ts), so 907 arrives as "907" and the exact
      // decimal parser takes it as exactly 907. A fractional JSON number would
      // already have been a double before it reached us; the client contract
      // says text, and this records what happens when a client ignores it.
      const answer = await call<InventoryItemSummaryDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, {
        ...yogurt,
        idempotencyKey: "numeric-amount",
        amount: 907,
      });
      expect(answer.statusCode).toBe(201);
      expect(answer.body.quantity.micros).toBe("907000000");
    });

    it("a key already used by an M2-T2 write on another item is a conflict", async () => {
      const write = await call<unknown>(
        app,
        "POST",
        inventoryItemTransactionsPath(yogurtId),
        DEAN,
        {
          idempotencyKey: "eat-some-yogurt",
          type: "CONSUME",
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
          amount: "100",
        },
      );
      expect(write.statusCode).toBe(200);
      const reuse = await call<ApiErrorBodyDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, {
        ...yogurt,
        idempotencyKey: "eat-some-yogurt",
      });
      expect(reuse.statusCode).toBe(409);
    });

    it("five concurrent creates under one key make one item: one 201 and four replays", async () => {
      const body = {
        ...yogurt,
        idempotencyKey: "concurrent-yogurt",
        displayName: "Concurrent yogurt",
      };
      const answers = await Promise.all(
        Array.from({ length: 5 }, () =>
          call<InventoryItemSummaryDto>(app, "POST", INVENTORY_ITEMS_PATH, DEAN, body),
        ),
      );
      const statuses = answers.map((answer) => answer.statusCode).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(answers.map((answer) => answer.body.itemId)).size).toBe(1);
      expect(
        await count(
          "SELECT count(*)::text AS count FROM inventory_items WHERE display_name = 'Concurrent yogurt'",
        ),
      ).toBe(1);
    });

    it("no item exists without a ledger row, and no row without its item (whole database)", async () => {
      expect(
        await count(
          `SELECT count(*)::text AS count FROM inventory_items AS i
          WHERE NOT EXISTS (SELECT 1 FROM inventory_transactions AS t WHERE t.item_id = i.id)`,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::text AS count FROM inventory_lots AS l
          WHERE NOT EXISTS (SELECT 1 FROM inventory_items AS i WHERE i.id = l.item_id)`,
        ),
      ).toBe(0);
    });
  });

  describe("row-level security is what holds (mutation)", () => {
    it("with the tenant context removed, /me finds nothing and rotation writes nothing", async () => {
      const contextless: TenantSessionRunner = {
        read: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
        write: <T>(_session: unknown, fn: (client: PoolClient) => Promise<T>) =>
          withHouseholdTransaction(db.pool, null, fn, { assumeRole: APP_ROLE }),
      };
      const sabotaged = build({ tenantSession: contextless });
      try {
        const control = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, DEAN);
        expect(control.statusCode).toBe(200);

        const me = await call<ApiErrorBodyDto>(sabotaged, "GET", HOUSEHOLD_ME_PATH, DEAN);
        expect(me.statusCode).toBe(404);

        const codesBefore = await count("SELECT count(*)::text AS count FROM household_join_codes");
        const rotate = await call<ApiErrorBodyDto>(
          sabotaged,
          "POST",
          HOUSEHOLD_JOIN_CODE_PATH,
          DEAN,
        );
        expect(rotate.statusCode).toBe(500);
        expect(await count("SELECT count(*)::text AS count FROM household_join_codes")).toBe(
          codesBefore,
        );
        expect(
          await count(
            "SELECT count(*)::text AS count FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
            [chenId],
          ),
        ).toBe(1);

        const create = await call<ApiErrorBodyDto>(sabotaged, "POST", INVENTORY_ITEMS_PATH, DEAN, {
          ...plainYogurt(),
          idempotencyKey: "contextless-create",
        });
        expect(create.statusCode).toBe(500);
        expect(
          await count(
            "SELECT count(*)::text AS count FROM inventory_transactions WHERE idempotency_key = 'contextless-create/lot/0'",
          ),
        ).toBe(0);
      } finally {
        await sabotaged.close();
      }
    });
  });

  describe("the remaining cells of the matrix (run last: they move sessions)", () => {
    it("rotation across the four tokens: owners of their current household only", async () => {
      const chenLiveBefore = await db.pool.query<{ code_hash: string }>(
        "SELECT code_hash FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
        [chenId],
      );
      const ada = await call<RotateJoinCodeResponseDto>(app, "POST", HOUSEHOLD_JOIN_CODE_PATH, ADA);
      expect(ada.statusCode).toBe(200);
      remember(ada.body.joinCode.code);
      // Ada's rotation issued Okafor's code and left Chen's live code alone.
      expect(
        await count(
          "SELECT count(*)::text AS count FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
          [okaforId],
        ),
      ).toBe(1);
      const chenLiveAfter = await db.pool.query<{ code_hash: string }>(
        "SELECT code_hash FROM household_join_codes WHERE household_id = $1 AND revoked_at IS NULL",
        [chenId],
      );
      expect(chenLiveAfter.rows).toEqual(chenLiveBefore.rows);

      expect((await call<unknown>(app, "POST", HOUSEHOLD_JOIN_CODE_PATH, MAYA)).statusCode).toBe(
        403,
      );
      expect((await call<unknown>(app, "POST", HOUSEHOLD_JOIN_CODE_PATH, NEW)).statusCode).toBe(
        403,
      );
      const dean = await call<RotateJoinCodeResponseDto>(
        app,
        "POST",
        HOUSEHOLD_JOIN_CODE_PATH,
        DEAN,
      );
      expect(dean.statusCode).toBe(200);
      currentChenCode = remember(dean.body.joinCode.code);
    });

    it("an owner who creates a second household runs as it next, and still lists both", async () => {
      const created = await call<CreateHouseholdResponseDto>(app, "POST", HOUSEHOLDS_PATH, ADA, {
        name: "Okafor cabin",
      });
      expect(created.statusCode).toBe(201);
      remember(created.body.joinCode.code);
      const cabinId = created.body.household.householdId;

      const me = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, ADA);
      expect(me.body.householdId).toBe(cabinId);
      const mine = await call<HouseholdMembershipsResponseDto>(
        app,
        "GET",
        HOUSEHOLD_MINE_PATH,
        ADA,
      );
      expect(mine.body.households.map((h) => [h.householdId, h.role, h.current])).toEqual([
        [cabinId, "owner", true],
        [okaforId, "owner", false],
      ]);
      // The cabin is empty: the Okafor household's item stays in the Okafor household.
      const items = await call<InventoryItemsResponseDto>(app, "GET", INVENTORY_ITEMS_PATH, ADA);
      expect(items.body.items).toEqual([]);
    });

    it("Dean and Maya are unaffected by everyone else's moves", async () => {
      for (const token of [DEAN, MAYA]) {
        const me = await call<HouseholdSummaryDto>(app, "GET", HOUSEHOLD_ME_PATH, token);
        expect(me.body.householdId, token).toBe(chenId);
      }
    });
  });

  describe("no code in any log line", () => {
    it("never logs a plaintext code or a code hash", () => {
      expect(issuedCodes.length).toBeGreaterThanOrEqual(3);
      const everything = logLines.join("\n");
      for (const code of issuedCodes) {
        expect(everything).not.toContain(code);
        expect(everything.toLowerCase()).not.toContain(code.toLowerCase());
        expect(everything).not.toContain(hasher.hash(code));
      }
      expect(everything).not.toContain("WXYZ-");
    });
  });
});

function plainYogurt(): CreateItemRequestDto {
  return {
    idempotencyKey: "unused",
    source: "MANUAL",
    displayName: "Plain yogurt",
    storageLocation: "FRIDGE",
    unit: "g",
    amount: "500",
    quantityProvenance: { tier: "KNOWN_FACT", source: null, confidence: null, recordedAt: null },
  };
}
