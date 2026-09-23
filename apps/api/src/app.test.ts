/**
 * HTTP pipeline behaviour that does not need a database (M2-T1).
 *
 * The parts of default-deny, identity resolution, correlation ids and log
 * redaction that are decided before any SQL runs are tested here, so they are
 * exercised on every machine rather than only where `DATABASE_URL` is set. The
 * tenancy matrix itself, where the answer depends on row-level security doing
 * its job, lives in `http/tenancy.db.test.ts` and needs a real Postgres.
 */

import { CORRELATION_ID_HEADER, INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppDependencies } from "./app.js";
import {
  createAuthorizationHook,
  MissingAuthorizationDeclarationError,
  publicRoute,
} from "./http/authorization.js";
import type { TenantSessionRunner } from "./http/tenant-session.js";
import { createFixtureIdentityPort, parseFixtureIdentityData } from "./identity/index.js";
import type { Session } from "./identity/index.js";

const CHEN = "f1c70000-0000-4000-8000-000000000001";
const OKAFOR = "f1c70000-0000-4000-8000-000000000002";
const DEAN = "f1c70001-0000-4000-8000-000000000001";
const MAYA = "f1c70001-0000-4000-8000-000000000002";

const FIXTURE_DATA = parseFixtureIdentityData({
  households: [
    { householdId: CHEN, name: "Chen household" },
    { householdId: OKAFOR, name: "Okafor household" },
  ],
  sessions: [
    {
      token: "fixture.dean.chen",
      userId: DEAN,
      householdId: CHEN,
      role: "owner",
      displayName: "Dean Chen",
      displayInitials: "DC",
      email: "dean.chen@fixture.invalid",
    },
    {
      token: "fixture.maya.chen",
      userId: MAYA,
      householdId: CHEN,
      role: "member",
      displayName: "Maya Chen",
      displayInitials: "MC",
      email: "maya.chen@fixture.invalid",
    },
  ],
});

/** A client that answers the two snapshot statements with fixed rows. */
function fakeClient(itemRows: readonly unknown[], lotRows: readonly unknown[]): PoolClient {
  let call = 0;
  return {
    query: (): Promise<{ rows: readonly unknown[] }> => {
      call += 1;
      return Promise.resolve({ rows: call === 1 ? itemRows : lotRows });
    },
  } as unknown as PoolClient;
}

interface Harness {
  readonly app: FastifyInstance;
  /** Every session a route actually opened a tenant transaction for. */
  readonly scoped: Session[];
  /** Every JSON line the logger wrote. */
  readonly logLines: string[];
}

const open: FastifyInstance[] = [];

function harness(overrides: Partial<AppDependencies> = {}): Harness {
  const scoped: Session[] = [];
  const logLines: string[] = [];

  const runTenantSession = <T>(
    session: Session,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    scoped.push(session);
    return fn(fakeClient([], []));
  };
  const tenantSession: TenantSessionRunner = {
    read: runTenantSession,
    write: runTenantSession,
  };

  const app = buildApp({
    identity: createFixtureIdentityPort(FIXTURE_DATA),
    tenantSession,
    logging: {
      level: "info",
      destination: {
        write(line: string): void {
          logLines.push(line);
        },
      },
    },
    ...overrides,
  });
  open.push(app);
  return { app, scoped, logLines };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

describe("public routes", () => {
  it("answers /healthz without a token", async () => {
    const { app } = harness();
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("still carries a correlation id", async () => {
    const { app } = harness();
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("mints a fresh correlation id per request", async () => {
    const { app } = harness();
    const first = await app.inject({ method: "GET", url: "/healthz" });
    const second = await app.inject({ method: "GET", url: "/healthz" });

    expect(first.headers[CORRELATION_ID_HEADER]).not.toBe(second.headers[CORRELATION_ID_HEADER]);
  });

  it("ignores a caller-supplied correlation id rather than filing the request under it", async () => {
    const { app } = harness();
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "request-id": "chosen-by-the-caller", "x-request-id": "chosen-by-the-caller" },
    });

    expect(response.headers[CORRELATION_ID_HEADER]).not.toBe("chosen-by-the-caller");
  });
});

describe("default-deny on the inventory endpoint", () => {
  it.each([
    ["no Authorization header", {}],
    ["an empty Authorization header", { authorization: "" }],
    ["a non-bearer scheme", { authorization: "Basic ZGVhbjpodW50ZXIy" }],
    ["Bearer with no credential", { authorization: "Bearer" }],
    ["Bearer with an empty credential", { authorization: "Bearer " }],
    ["a token the port does not know", { authorization: "Bearer fixture.nobody" }],
    ["a token with trailing whitespace", { authorization: "Bearer fixture.dean.chen " }],
  ])("answers 401 for %s", async (_case, headers) => {
    const { app, scoped } = harness();
    const response = await app.inject({ method: "GET", url: INVENTORY_ITEMS_PATH, headers });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
        correlationId: response.headers[CORRELATION_ID_HEADER],
      },
    });
    expect(scoped, "no database session may be opened for a denied request").toEqual([]);
  });

  it("answers the same body whether the token is absent or merely wrong", async () => {
    const { app } = harness();
    const absent = await app.inject({ method: "GET", url: INVENTORY_ITEMS_PATH });
    const wrong = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.nobody" },
    });

    const strip = (body: unknown): unknown =>
      JSON.parse(JSON.stringify(body).replace(/"correlationId":"[^"]+"/, '"correlationId":"x"'));
    expect(strip(absent.json())).toEqual(strip(wrong.json()));
  });

  it("lets a known token through", async () => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.dean.chen" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expect(scoped).toEqual([{ userId: DEAN, householdId: CHEN, role: "owner" }]);
  });

  it("lets a member through as well as an owner", async () => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.maya.chen" },
    });

    expect(response.statusCode).toBe(200);
    expect(scoped).toEqual([{ userId: MAYA, householdId: CHEN, role: "member" }]);
  });

  it("answers 404 for an unrouted path rather than denying it", async () => {
    const { app } = harness();
    const response = await app.inject({ method: "GET", url: "/v1/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("identity comes only from the port", () => {
  it.each([
    ["an x-household-id header", { "x-household-id": OKAFOR }],
    ["an x-user-id header", { "x-user-id": "f1c70001-0000-4000-8000-000000000003" }],
    ["a household-id header", { "household-id": OKAFOR }],
    ["an x-role header claiming owner", { "x-role": "owner" }],
  ])("ignores %s", async (_case, forged) => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.maya.chen", ...forged },
    });

    expect(response.statusCode).toBe(200);
    expect(scoped).toEqual([{ userId: MAYA, householdId: CHEN, role: "member" }]);
  });

  it("ignores a householdId query parameter", async () => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: `${INVENTORY_ITEMS_PATH}?householdId=${OKAFOR}&household_id=${OKAFOR}`,
      headers: { authorization: "Bearer fixture.dean.chen" },
    });

    expect(response.statusCode).toBe(200);
    expect(scoped).toEqual([{ userId: DEAN, householdId: CHEN, role: "owner" }]);
  });

  it("ignores a household named in a body, even on a GET", async () => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.dean.chen", "content-type": "application/json" },
      payload: { householdId: OKAFOR },
    });

    expect(response.statusCode).toBe(200);
    expect(scoped).toEqual([{ userId: DEAN, householdId: CHEN, role: "owner" }]);
  });

  it("forges nothing by leaving the header off a forged request either", async () => {
    const { app, scoped } = harness();
    const response = await app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { "x-household-id": CHEN },
    });

    expect(response.statusCode).toBe(401);
    expect(scoped).toEqual([]);
  });
});

describe("the 500 path (review fix F2)", () => {
  // Shaped like the real hazard: a driver error that quotes a row. Both an
  // address and a credential are in it, because both have a syntax the
  // value-shape scrubber recognises.
  const THROWN =
    "duplicate key (email)=(dean.chen@fixture.invalid) for Dean Chen, " +
    "sent with Authorization: Bearer fixture.dean.chen";

  function throwingHarness(): Harness {
    const h = harness();
    h.app.get(
      "/v1/boom",
      { config: { authorization: publicRoute("test-only route that throws on purpose") } },
      () => {
        throw new Error(THROWN);
      },
    );
    return h;
  }

  it("answers 500 with the generic sentence and a correlation id, never the raw message", async () => {
    const { app } = throwingHarness();
    const response = await app.inject({ method: "GET", url: "/v1/boom" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Try again, and tell us if it keeps happening.",
        correlationId: response.headers[CORRELATION_ID_HEADER],
      },
    });
    expect(response.body).not.toContain("Dean Chen");
  });

  it("logs the error as a real type and message, not [object Object]", async () => {
    const { app, logLines } = throwingHarness();
    await app.inject({ method: "GET", url: "/v1/boom" });

    const failures = logLines
      .map((line) => JSON.parse(line) as { msg?: unknown; err?: Record<string, unknown> })
      .filter((entry) => entry.msg === "request.failed");

    expect(failures).toHaveLength(1);
    const err = failures[0]?.err;
    expect(err?.["type"]).toBe("Error");
    expect(typeof err?.["message"]).toBe("string");
    expect(err?.["message"]).not.toBe("[object Object]");
    expect(String(err?.["type"])).not.toBe("NonError");
  });

  it("scrubs the address and the credential out of the logged error", async () => {
    const { app, logLines } = throwingHarness();
    await app.inject({ method: "GET", url: "/v1/boom" });
    const joined = logLines.join("\n");

    expect(joined).toContain("[redacted-email]");
    expect(joined).toContain("Bearer [redacted]");
    expect(joined).not.toContain("dean.chen@fixture.invalid");
    expect(joined).not.toContain("fixture.dean.chen");
  });

  it("keeps the stack readable, with the pnpm paths in it intact", async () => {
    const { app, logLines } = throwingHarness();
    await app.inject({ method: "GET", url: "/v1/boom" });

    const failure = logLines
      .map((line) => JSON.parse(line) as { msg?: unknown; err?: Record<string, unknown> })
      .find((entry) => entry.msg === "request.failed");
    const stack = String(failure?.err?.["stack"]);

    expect(stack).toContain("Error: duplicate key");
    // Before the pattern excluded path separators, `.pnpm/fastify@5.12.1/...`
    // matched the email shape and every frame of every stack was replaced.
    expect(stack.split("\n").length).toBeGreaterThan(1);
    expect(stack).not.toContain("[redacted-email]:");
  });

  it("still carries the correlation id on the failed request's log lines", async () => {
    const { app, logLines } = throwingHarness();
    const response = await app.inject({ method: "GET", url: "/v1/boom" });
    const correlationId = response.headers[CORRELATION_ID_HEADER];

    const withId = logLines
      .map((line) => JSON.parse(line) as { reqId?: unknown })
      .filter((entry) => entry.reqId === correlationId);
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the denylist layer of the logger (review fix F4)", () => {
  /**
   * `formatters.log` is the second layer: the request line we emit ourselves is
   * already an allowlist, so nothing in the shipped code exercises the denylist.
   * This route deliberately logs personal data through `request.log`, which is
   * what a careless future log call would look like, and asserts it never
   * reaches the stream.
   */
  function careless(): Harness {
    const h = harness();
    h.app.get(
      "/v1/careless",
      { config: { authorization: publicRoute("test-only route that logs on purpose") } },
      (request) => {
        request.log.info(
          {
            displayName: "Dean Chen",
            email: "dean.chen@fixture.invalid",
            allergies: ["peanut"],
            householdId: CHEN,
          },
          "careless.probe",
        );
        return { ok: true };
      },
    );
    return h;
  }

  it("redacts a name, an email and an allergy list logged through request.log", async () => {
    const { app, logLines } = careless();
    await app.inject({ method: "GET", url: "/v1/careless" });

    const probe = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry["msg"] === "careless.probe");

    expect(probe).toBeDefined();
    expect(probe?.["displayName"]).toBe("[redacted]");
    expect(probe?.["email"]).toBe("[redacted]");
    expect(probe?.["allergies"]).toBe("[redacted]");
  });

  it("leaves the opaque household id alone, so the line is still useful", async () => {
    const { app, logLines } = careless();
    await app.inject({ method: "GET", url: "/v1/careless" });

    const probe = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry["msg"] === "careless.probe");

    expect(probe?.["householdId"]).toBe(CHEN);
  });

  it("no log line from that request contains the name or the address", async () => {
    const { app, logLines } = careless();
    await app.inject({ method: "GET", url: "/v1/careless" });
    const joined = logLines.join("\n");

    expect(joined).not.toContain("Dean Chen");
    expect(joined).not.toContain("dean.chen@fixture.invalid");
    expect(joined).not.toContain("peanut");
  });
});

describe("the registration-time authorization guard", () => {
  it("refuses to register a route with no authorization declaration", () => {
    const { app } = harness();

    expect(() => {
      app.get("/v1/undeclared", () => ({ leaked: true }));
    }).toThrow(MissingAuthorizationDeclarationError);
  });

  it("names the route it refused", () => {
    const { app } = harness();
    let message = "";
    try {
      app.get("/v1/undeclared", () => ({ leaked: true }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("GET /v1/undeclared");
    expect(message).toContain("config.authorization");
  });

  it("refuses a route whose config exists but declares nothing", () => {
    const { app } = harness();

    expect(() => {
      app.get("/v1/half-declared", { config: {} }, () => ({ leaked: true }));
    }).toThrow(MissingAuthorizationDeclarationError);
  });

  it("accepts a route that declares itself public with a reason", () => {
    const { app } = harness();

    expect(() => {
      app.get(
        "/v1/declared",
        { config: { authorization: publicRoute("nothing household-scoped is read") } },
        () => ({ ok: true }),
      );
    }).not.toThrow();
  });
});

describe("the request-time authorization guard, on its own", () => {
  /**
   * The registration guard makes an undeclared route impossible to register, so
   * the runtime fallback is tested against an app that only installs the hook.
   * That fallback is what protects a future refactor that registers routes on an
   * instance the `onRoute` guard never saw.
   */
  it("denies a matched route that carries no declaration", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    app.addHook(
      "onRequest",
      createAuthorizationHook({ identity: createFixtureIdentityPort(FIXTURE_DATA) }),
    );
    app.get("/v1/undeclared", () => ({ leaked: true }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/undeclared",
      headers: { authorization: "Bearer fixture.dean.chen" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    await app.close();
  });
});

describe("role restrictions", () => {
  it("denies a role the route did not list, with 403 and no database session", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify({ logger: false });
    app.addHook(
      "onRequest",
      createAuthorizationHook({ identity: createFixtureIdentityPort(FIXTURE_DATA) }),
    );
    app.get(
      "/v1/owners-only",
      { config: { authorization: { kind: "household", roles: ["owner"] } } },
      () => ({ ok: true }),
    );

    const owner = await app.inject({
      method: "GET",
      url: "/v1/owners-only",
      headers: { authorization: "Bearer fixture.dean.chen" },
    });
    const member = await app.inject({
      method: "GET",
      url: "/v1/owners-only",
      headers: { authorization: "Bearer fixture.maya.chen" },
    });

    expect(owner.statusCode).toBe(200);
    expect(member.statusCode).toBe(403);
    await app.close();
  });
});

describe("log redaction (ARCHITECTURE.md §7.15)", () => {
  const SECRETS_AND_PII = [
    "fixture.dean.chen",
    "fixture.maya.chen",
    "fixture.nobody",
    "Dean Chen",
    "Maya Chen",
    "dean.chen@fixture.invalid",
    "maya.chen@fixture.invalid",
  ];

  async function exerciseEveryPath(): Promise<Harness> {
    const h = harness();
    await h.app.inject({ method: "GET", url: "/healthz" });
    await h.app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.dean.chen", "x-household-id": OKAFOR },
    });
    await h.app.inject({
      method: "GET",
      url: INVENTORY_ITEMS_PATH,
      headers: { authorization: "Bearer fixture.nobody" },
    });
    await h.app.inject({ method: "GET", url: INVENTORY_ITEMS_PATH });
    await h.app.inject({
      method: "GET",
      url: `${INVENTORY_ITEMS_PATH}?email=dean.chen@fixture.invalid`,
      headers: { authorization: "Bearer fixture.maya.chen" },
    });
    await h.app.inject({ method: "GET", url: "/v1/nope" });
    return h;
  }

  it("writes at least one line per request", async () => {
    const { logLines } = await exerciseEveryPath();
    expect(logLines.length).toBeGreaterThanOrEqual(6);
  });

  it("every line is JSON and carries the correlation id", async () => {
    const { logLines } = await exerciseEveryPath();
    for (const line of logLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(typeof parsed["reqId"], line).toBe("string");
    }
  });

  it.each(SECRETS_AND_PII)("no line contains %s", async (needle) => {
    const { logLines } = await exerciseEveryPath();
    const offending = logLines.filter((line) => line.includes(needle));
    expect(offending).toEqual([]);
  });

  it("logs the opaque identifiers that make a denial auditable", async () => {
    const { logLines } = await exerciseEveryPath();
    const joined = logLines.join("\n");

    expect(joined).toContain("authorization.denied");
    expect(joined).toContain("request.completed");
    expect(joined).toContain(CHEN);
    expect(joined).toContain(DEAN);
  });

  it("does not log the query string", async () => {
    const { logLines } = await exerciseEveryPath();
    expect(logLines.join("\n")).not.toContain("?email=");
  });
});
