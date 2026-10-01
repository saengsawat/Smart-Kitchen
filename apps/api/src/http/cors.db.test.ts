/**
 * BUG-002 over the real pipeline with Postgres: `GET /v1/households/me`
 * across the four fixture tokens (plus no token and an unknown one) answers
 * exactly as it did before, whether or not the request comes from an allowed
 * browser origin; only the CORS headers differ. The app is built the way the
 * composition root builds it (fixture identity with database-backed
 * memberships, row-level security), with a configured allowlist.
 *
 * Skips when `DATABASE_URL` is unset, loudly, and fails the build if it ever
 * skips in CI (`db/test-support/harness.ts`).
 */

import { HOUSEHOLD_ME_PATH } from "@smart-kitchen/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createJoinCodeHasher, DEVELOPMENT_JOIN_CODE_PEPPER } from "../db/households/join-code.js";
import {
  createTestDatabase,
  dbTestsEnabled,
  noteDbSuiteSkipped,
  type TestDatabase,
} from "../db/test-support/harness.js";
import { createFixtureIdentityPort, loadFixtureIdentityData } from "../identity/index.js";
import { seedFixtureIdentities } from "../identity/test-support/seed-fixture-identities.js";
import { NO_CORS, type CorsPolicy } from "./cors.js";
import {
  createMembershipSessionRunner,
  createPostgresMembershipDirectory,
} from "./membership-session.js";
import { createJoinAttemptLimiter } from "./rate-limit.js";
import { createTenantSessionRunner } from "./tenant-session.js";

const SUITE = "BUG-002: CORS on /v1/households/me across the four tokens";

it.runIf(!dbTestsEnabled)(`SKIP NOTICE: ${SUITE} did not run`, () => {
  noteDbSuiteSkipped(SUITE);
  expect(dbTestsEnabled).toBe(false);
});

const ALLOWED = "http://localhost:8090";
const POLICY: CorsPolicy = { allowedOrigins: [ALLOWED], source: "configured" };

/** Label, token, then the status `/v1/households/me` has always answered it with. */
const MATRIX: readonly (readonly [string, string | undefined, number])[] = [
  ["Dean (Chen owner)", "fixture.dean.chen", 200],
  ["Maya (Chen member)", "fixture.maya.chen", 200],
  ["Ada (Okafor owner)", "fixture.owner.other", 200],
  ["the new user (no household)", "fixture.new.user", 403],
  ["an unknown token", "fixture.nobody", 401],
  ["no token", undefined, 401],
];

function corsHeaderNames(response: LightMyRequestResponse): string[] {
  return Object.keys(response.headers).filter(
    (name) => name.startsWith("access-control-") || name === "vary",
  );
}

/**
 * Under the configured allowlist, a missing or non-matching origin gets
 * `Vary: Origin` and nothing else from CORS (review F1, ruling R1).
 */
function expectOnlyVary(response: LightMyRequestResponse): void {
  expect(corsHeaderNames(response)).toEqual(["vary"]);
  expect(response.headers["vary"]).toBe("Origin");
}

/** A body with any `correlationId` blanked, which differs per request by design. */
function withoutCorrelation(body: unknown): unknown {
  return JSON.parse(
    JSON.stringify(body, (key, value: unknown) => (key === "correlationId" ? "" : value)),
  );
}

describe.skipIf(!dbTestsEnabled)(SUITE, () => {
  let db: TestDatabase;
  let withCors: FastifyInstance;
  let withoutCors: FastifyInstance;

  beforeAll(async () => {
    db = await createTestDatabase("bug002-cors");
    const fixture = await loadFixtureIdentityData();
    await seedFixtureIdentities(db.pool, fixture);
    const build = (cors: CorsPolicy): FastifyInstance =>
      buildApp({
        identity: createFixtureIdentityPort(fixture, {
          memberships: createPostgresMembershipDirectory(db.pool),
        }),
        tenantSession: createTenantSessionRunner(db.pool),
        households: {
          memberships: createMembershipSessionRunner(db.pool),
          joinCodes: createJoinCodeHasher(DEVELOPMENT_JOIN_CODE_PEPPER),
          joinLimiter: createJoinAttemptLimiter(),
        },
        logging: { level: "silent" },
        cors,
      });
    withCors = build(POLICY);
    withoutCors = build(NO_CORS);
  }, 90_000);

  afterAll(async () => {
    await withCors?.close();
    await withoutCors?.close();
    await db?.drop();
  });

  function me(
    app: FastifyInstance,
    token: string | undefined,
    origin?: string,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method: "GET",
      url: HOUSEHOLD_ME_PATH,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(origin === undefined ? {} : { origin }),
      },
    });
  }

  it.each(MATRIX.map(([label, token, status]) => ({ label, token, status })))(
    "$label answers $status, identically with and without an allowed origin",
    async ({ token, status }) => {
      const baseline = await me(withoutCors, token, ALLOWED);
      const plain = await me(withCors, token);
      const fromBrowser = await me(withCors, token, ALLOWED);
      const fromStranger = await me(withCors, token, "http://localhost:3001");

      for (const response of [baseline, plain, fromBrowser, fromStranger]) {
        expect(response.statusCode).toBe(status);
        expect(withoutCorrelation(response.json())).toEqual(withoutCorrelation(baseline.json()));
      }
      expect(fromBrowser.headers["access-control-allow-origin"]).toBe(ALLOWED);
      expect(fromBrowser.headers["vary"]).toBe("Origin");
      expect(corsHeaderNames(baseline)).toEqual([]);
      expectOnlyVary(plain);
      expectOnlyVary(fromStranger);
    },
  );

  it("the preflight BUG-002 failed on now answers 204 for the allowed origin only", async () => {
    const preflight = (app: FastifyInstance, origin: string): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "OPTIONS",
        url: HOUSEHOLD_ME_PATH,
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });
    const allowed = await preflight(withCors, ALLOWED);
    const stranger = await preflight(withCors, "http://localhost:3001");
    const before = await preflight(withoutCors, ALLOWED);

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(allowed.headers["access-control-allow-headers"]).toBe("authorization, content-type");
    expect(stranger.statusCode).toBe(204);
    expectOnlyVary(stranger);
    expect(before.statusCode).toBe(404);
    expect(corsHeaderNames(before)).toEqual([]);
  });
});
