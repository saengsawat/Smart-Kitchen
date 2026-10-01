/**
 * Browser origins (BUG-002, D-027 as proposed): the allowlist rules as pure
 * functions, then the same rules through the real HTTP pipeline (`buildApp`
 * with the fixture identity port and a fake tenant session, so no database is
 * needed and these run on every machine). The `/v1/households/me` matrix
 * across the four fixture tokens, which needs Postgres, is in
 * `cors.db.test.ts`.
 */

import { INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, createAppFromEnvironment, type AppDependencies } from "../app.js";
import { createFixtureIdentityPort, loadFixtureIdentityData } from "../identity/index.js";
import type { IdentityPort, Session } from "../identity/index.js";
import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  CORS_MAX_AGE_SECONDS,
  CorsConfigurationError,
  DEVELOPMENT_IMPLIED_ORIGINS,
  NO_CORS,
  corsPreflightHeaders,
  corsResponseHeaders,
  matchAllowedOrigin,
  parseCorsOrigins,
  resolveCorsPolicy,
  type CorsPolicy,
} from "./cors.js";
import type { TenantSessionRunner } from "./tenant-session.js";

const ALLOWED = "http://localhost:8090";
const OTHER_ALLOWED = "https://app.example.test";
const POLICY: CorsPolicy = { allowedOrigins: [ALLOWED, OTHER_ALLOWED], source: "configured" };

const DEAN = "fixture.dean.chen";
const MAYA = "fixture.maya.chen";
const NEW = "fixture.new.user";

/** A string that must not be used as a database: these suites never connect. */
const UNUSED_DB = "postgres://postgres@127.0.0.1:1/unused";

function corsHeaderNames(response: LightMyRequestResponse): string[] {
  return Object.keys(response.headers).filter(
    (name) => name.startsWith("access-control-") || name === "vary",
  );
}

/**
 * Under a configured allowlist, a response to a missing or non-matching origin
 * carries `Vary: Origin` and nothing else from CORS (review F1, ruling R1).
 */
function expectOnlyVary(response: LightMyRequestResponse): void {
  expect(corsHeaderNames(response)).toEqual(["vary"]);
  expect(response.headers["vary"]).toBe("Origin");
}

describe("matchAllowedOrigin", () => {
  const allowed = ["http://localhost:8081", "https://app.example.test"];

  it("echoes an exact match", () => {
    expect(matchAllowedOrigin("http://localhost:8081", allowed)).toBe("http://localhost:8081");
    expect(matchAllowedOrigin("https://app.example.test", allowed)).toBe(
      "https://app.example.test",
    );
  });

  it.each([
    ["upper-case host", "http://LOCALHOST:8081"],
    ["upper-case scheme", "HTTP://localhost:8081"],
    ["trailing slash", "http://localhost:8081/"],
    ["a longer port with the allowed one as prefix", "http://localhost:80810"],
    ["a shorter port", "http://localhost:808"],
    ["another scheme", "https://localhost:8081"],
    ["no port", "http://localhost"],
    ["a lookalike host with the allowed one as prefix", "https://app.example.test.evil.test"],
    ["a subdomain", "https://evil.app.example.test"],
    ["leading space", " http://localhost:8081"],
    ["trailing space", "http://localhost:8081 "],
    ["two Origin lines joined", "http://localhost:8081, https://evil.test"],
    ["the opaque origin", "null"],
    ["a wildcard", "*"],
    ["empty", ""],
  ])("refuses %s", (_case, origin) => {
    expect(matchAllowedOrigin(origin, allowed)).toBeUndefined();
  });

  it("refuses a missing header and an array of values", () => {
    expect(matchAllowedOrigin(undefined, allowed)).toBeUndefined();
    expect(matchAllowedOrigin(["http://localhost:8081"], allowed)).toBeUndefined();
  });

  it("refuses everything when the list is empty", () => {
    expect(matchAllowedOrigin("http://localhost:8081", [])).toBeUndefined();
  });
});

describe("the header set", () => {
  it("echoes the origin, never a wildcard, and varies on Origin", () => {
    expect(corsResponseHeaders(ALLOWED)).toEqual({
      "access-control-allow-origin": ALLOWED,
      vary: "Origin",
    });
  });

  it("varies on Origin with no allow-origin when nothing matched", () => {
    expect(corsResponseHeaders(undefined)).toEqual({ vary: "Origin" });
  });

  it("answers a preflight with methods, the app's two request headers and a max age", () => {
    expect(corsPreflightHeaders()).toEqual({
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "600",
    });
    expect(CORS_ALLOW_METHODS).toBe("GET, POST, OPTIONS");
    expect(CORS_ALLOW_HEADERS).toBe("authorization, content-type");
    expect(CORS_MAX_AGE_SECONDS).toBe(600);
  });

  it("never offers credentials", () => {
    const all = { ...corsResponseHeaders(ALLOWED), ...corsPreflightHeaders() };
    expect(Object.keys(all)).not.toContain("access-control-allow-credentials");
    expect(Object.values(all)).not.toContain("*");
  });
});

describe("parseCorsOrigins", () => {
  it("splits, trims, skips blanks and drops duplicates", () => {
    expect(
      parseCorsOrigins(" http://localhost:8081 ,https://app.example.test,,http://localhost:8081"),
    ).toEqual(["http://localhost:8081", "https://app.example.test"]);
  });

  it.each([
    ["a wildcard", "*"],
    ["the opaque origin", "null"],
    ["a trailing slash", "http://localhost:8081/"],
    ["a path", "https://app.example.test/app"],
    ["upper case", "http://LOCALHOST:8081"],
    ["an explicit default port", "https://app.example.test:443"],
    ["no scheme", "localhost:8081"],
    ["a bare host", "app.example.test"],
    ["another scheme", "ftp://app.example.test"],
    ["a query", "https://app.example.test?x=1"],
    ["credentials", "https://user@app.example.test"],
  ])("refuses to start on %s", (_case, entry) => {
    expect(() => parseCorsOrigins(entry)).toThrow(CorsConfigurationError);
    expect(() => parseCorsOrigins(`http://localhost:8081,${entry}`)).toThrow(
      CorsConfigurationError,
    );
  });

  it.each([
    ["user and password", "https://user:s3cretpw@app.example.test", "s3cretpw"],
    ["a password-like user", "https://s3cretpw@app.example.test", "s3cretpw"],
    ["a query token", "https://app.example.test/?token=s3cretpw", "s3cretpw"],
    ["a path secret", "https://app.example.test/s3cretpw", "s3cretpw"],
    ["unparseable text", "s3cretpw not a url", "s3cretpw"],
    ["another scheme", "ftp://app.example.test/s3cretpw", "s3cretpw"],
  ])("never echoes the entry when refusing %s (review F2)", (_case, entry, secret) => {
    let message = "";
    try {
      parseCorsOrigins(`http://localhost:8081, ${entry}`);
    } catch (error) {
      expect(error).toBeInstanceOf(CorsConfigurationError);
      message = (error as Error).message;
    }
    expect(message).toContain("SK_CORS_ORIGINS entry 2");
    expect(message).not.toContain(secret);
    expect(message).not.toContain(entry);
  });

  it("says an entry with credentials contains credentials", () => {
    expect(() => parseCorsOrigins("https://user:s3cretpw@app.example.test")).toThrow(
      /entry 1 contains credentials/,
    );
  });

  it("names the form a browser would send when an entry would never match", () => {
    expect(() => parseCorsOrigins("http://localhost:8081/")).toThrow(
      /a browser sends "http:\/\/localhost:8081"/,
    );
  });
});

describe("resolveCorsPolicy", () => {
  it.each([
    ["unset", {}],
    ["development", { NODE_ENV: "development" }],
    ["mis-cased and padded development", { NODE_ENV: " Development " }],
    ["blank", { NODE_ENV: "  " }],
  ])("implies the local web origins with NODE_ENV %s and no allowlist", (_case, env) => {
    expect(resolveCorsPolicy(env)).toEqual({
      allowedOrigins: ["http://localhost:8081", "http://localhost:8090"],
      source: "development-implied",
    });
  });

  it("implies them for an empty SK_CORS_ORIGINS too, as for every other variable", () => {
    expect(resolveCorsPolicy({ NODE_ENV: "development", SK_CORS_ORIGINS: " " }).source).toBe(
      "development-implied",
    );
  });

  it("implies exactly the two local web origins", () => {
    expect(DEVELOPMENT_IMPLIED_ORIGINS).toEqual(["http://localhost:8081", "http://localhost:8090"]);
  });

  it.each(["test", "production", "Production", "prod", "staging", "dev", "production "])(
    "implies nothing with NODE_ENV=%s",
    (nodeEnv) => {
      expect(resolveCorsPolicy({ NODE_ENV: nodeEnv })).toEqual(NO_CORS);
      expect(resolveCorsPolicy({ NODE_ENV: nodeEnv, SK_CORS_ORIGINS: "" })).toEqual(NO_CORS);
    },
  );

  it("uses the configured list as the whole answer, in development too", () => {
    expect(
      resolveCorsPolicy({ NODE_ENV: "development", SK_CORS_ORIGINS: "http://example.test" }),
    ).toEqual({ allowedOrigins: ["http://example.test"], source: "configured" });
  });

  it("honours a configured list in production", () => {
    expect(
      resolveCorsPolicy({ NODE_ENV: "production", SK_CORS_ORIGINS: "https://app.example.test" }),
    ).toEqual({ allowedOrigins: ["https://app.example.test"], source: "configured" });
  });

  it("treats a list of nothing but commas as no origins at all", () => {
    expect(resolveCorsPolicy({ NODE_ENV: "development", SK_CORS_ORIGINS: " , ," })).toEqual({
      allowedOrigins: [],
      source: "none",
    });
  });
});

// --- through the HTTP pipeline ---------------------------------------------

const open: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

interface Harness {
  readonly app: FastifyInstance;
  /** Every token the identity port was asked to resolve. */
  readonly resolved: string[];
  /** Every session a route opened a tenant transaction for. */
  readonly scoped: Session[];
}

async function harness(
  cors: CorsPolicy | undefined,
  overrides: Partial<AppDependencies> = {},
): Promise<Harness> {
  const resolved: string[] = [];
  const scoped: Session[] = [];
  const fixture = createFixtureIdentityPort(await loadFixtureIdentityData());
  const identity: IdentityPort = {
    resolveSession: (token) => {
      resolved.push(token);
      return fixture.resolveSession(token);
    },
    resolveCaller: (token) => {
      resolved.push(token);
      return fixture.resolveCaller(token);
    },
  };
  // An empty kitchen: both snapshot statements answer no rows.
  const client = {
    query: (): Promise<{ rows: readonly unknown[] }> => Promise.resolve({ rows: [] }),
  } as unknown as PoolClient;
  const run = <T>(session: Session, fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    scoped.push(session);
    return fn(client);
  };
  const tenantSession: TenantSessionRunner = { read: run, write: run };
  const app = buildApp({
    identity,
    tenantSession,
    logging: { level: "silent" },
    ...(cors === undefined ? {} : { cors }),
    ...overrides,
  });
  open.push(app);
  return { app, resolved, scoped };
}

function preflight(
  app: FastifyInstance,
  origin: string | undefined,
  url = INVENTORY_ITEMS_PATH,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "OPTIONS",
    url,
    headers: {
      ...(origin === undefined ? {} : { origin }),
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
}

function get(
  app: FastifyInstance,
  url: string,
  options: { origin?: string; token?: string } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "GET",
    url,
    headers: {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    },
  });
}

describe("a preflight through the app", () => {
  it("from an allowed origin answers 204 with the full header set and no body", async () => {
    const { app } = await harness(POLICY);
    const response = await preflight(app, ALLOWED);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["vary"]).toBe("Origin");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
    expect(response.headers["access-control-allow-headers"]).toBe("authorization, content-type");
    expect(response.headers["access-control-max-age"]).toBe("600");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers for every /v1/ path, including the one BUG-002 was found on", async () => {
    const { app } = await harness(POLICY);
    for (const url of ["/v1/households/me", "/v1/shopping", "/v1/products/3017620422003"]) {
      const response = await preflight(app, OTHER_ALLOWED, url);
      expect(response.statusCode, url).toBe(204);
      expect(response.headers["access-control-allow-origin"], url).toBe(OTHER_ALLOWED);
    }
  });

  it.each([
    ["a disallowed origin", "http://localhost:3001"],
    ["a prefix lookalike", "http://localhost:80900"],
    ["a trailing slash", `${ALLOWED}/`],
    ["upper case", ALLOWED.toUpperCase()],
  ])("from %s answers 204 with only Vary", async (_case, origin) => {
    const { app } = await harness(POLICY);
    const response = await preflight(app, origin);

    expect(response.statusCode).toBe(204);
    expectOnlyVary(response);
  });

  it("with no Origin answers 204 with only Vary", async () => {
    const { app } = await harness(POLICY);
    const response = await preflight(app, undefined);

    expect(response.statusCode).toBe(204);
    expectOnlyVary(response);
  });

  it("never consults identity or opens a session, even when a token is sent", async () => {
    const { app, resolved, scoped } = await harness(POLICY);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/households/me",
      headers: { origin: ALLOWED, authorization: `Bearer ${DEAN}` },
    });

    expect(response.statusCode).toBe(204);
    expect(resolved).toEqual([]);
    expect(scoped).toEqual([]);
  });

  it("is not offered outside /v1/", async () => {
    const { app } = await harness(POLICY);
    const response = await preflight(app, ALLOWED, "/healthz");

    expect(response.statusCode).toBe(404);
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
  });
});

describe("a real request through the app", () => {
  it("GET from an allowed origin answers 200 with the origin echoed and Vary", async () => {
    const { app } = await harness(POLICY);
    const response = await get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED, token: DEAN });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["vary"]).toBe("Origin");
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("GET with no Origin answers 200 with only Vary", async () => {
    const { app } = await harness(POLICY);
    const response = await get(app, INVENTORY_ITEMS_PATH, { token: DEAN });

    expect(response.statusCode).toBe(200);
    expectOnlyVary(response);
  });

  it("GET from a disallowed origin answers as before, with only Vary", async () => {
    const { app } = await harness(POLICY);
    const response = await get(app, INVENTORY_ITEMS_PATH, {
      origin: "http://localhost:3001",
      token: DEAN,
    });

    expect(response.statusCode).toBe(200);
    expectOnlyVary(response);
  });

  it("a refusal to an allowed origin still carries the origin, so the page can read it", async () => {
    const { app } = await harness(POLICY);
    const unauthenticated = await get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED });
    const forbidden = await get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED, token: NEW });
    const notFound = await get(app, "/v1/no-such-route", { origin: ALLOWED, token: DEAN });

    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
    expect(notFound.statusCode).toBe(404);
    for (const response of [unauthenticated, forbidden, notFound]) {
      expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
      expect(response.headers["vary"]).toBe("Origin");
    }
  });

  it("a 500 to an allowed origin still carries the origin", async () => {
    const failing: TenantSessionRunner = {
      read: () => Promise.reject(new Error("boom")),
      write: () => Promise.reject(new Error("boom")),
    };
    const { app } = await harness(POLICY, { tenantSession: failing });
    const response = await get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED, token: DEAN });

    expect(response.statusCode).toBe(500);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("the token matrix is unchanged by an allowed origin", async () => {
    const { app } = await harness(POLICY);
    const cases: [string | undefined, number][] = [
      [undefined, 401],
      ["fixture.nobody", 401],
      [NEW, 403],
      [DEAN, 200],
      [MAYA, 200],
    ];
    for (const [token, status] of cases) {
      const plain = await get(app, INVENTORY_ITEMS_PATH, token === undefined ? {} : { token });
      const fromBrowser = await get(
        app,
        INVENTORY_ITEMS_PATH,
        token === undefined ? { origin: ALLOWED } : { origin: ALLOWED, token },
      );
      expect(plain.statusCode, String(token)).toBe(status);
      expect(fromBrowser.statusCode, String(token)).toBe(status);
      expect(withoutCorrelation(fromBrowser.json()), String(token)).toEqual(
        withoutCorrelation(plain.json()),
      );
    }
  });
});

/** A body with any `correlationId` blanked, which differs per request by design. */
function withoutCorrelation(body: unknown): unknown {
  return JSON.parse(
    JSON.stringify(body, (key, value: unknown) => (key === "correlationId" ? "" : value)),
  );
}

describe("with no allowlist (the default, test and production)", () => {
  const requests: [string, (app: FastifyInstance) => Promise<LightMyRequestResponse>][] = [
    ["GET /healthz", (app) => get(app, "/healthz", { origin: "http://localhost:8081" })],
    ["GET 200", (app) => get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED, token: DEAN })],
    ["GET 401", (app) => get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED })],
    ["GET 403", (app) => get(app, INVENTORY_ITEMS_PATH, { origin: ALLOWED, token: NEW })],
    ["GET 404", (app) => get(app, "/v1/nothing", { origin: ALLOWED, token: DEAN })],
    ["OPTIONS preflight", (app) => preflight(app, ALLOWED)],
    ["OPTIONS preflight, dev origin", (app) => preflight(app, "http://localhost:8081")],
  ];

  it.each(requests)(
    "%s carries zero CORS headers when buildApp is given none",
    async (_c, send) => {
      const { app } = await harness(undefined);
      expect(corsHeaderNames(await send(app))).toEqual([]);
    },
  );

  it("registers no preflight route, so OPTIONS stays a 404 as before", async () => {
    const { app } = await harness(NO_CORS);
    expect((await preflight(app, ALLOWED)).statusCode).toBe(404);
  });

  // The composition root resolves memberships from Postgres, so only the
  // requests decided before any token is resolved are sent through it here.
  const beforeIdentity: [string, (app: FastifyInstance) => Promise<LightMyRequestResponse>][] = [
    ["GET /healthz", (app) => get(app, "/healthz", { origin: "http://localhost:8081" })],
    ["GET 401", (app) => get(app, INVENTORY_ITEMS_PATH, { origin: "http://localhost:8081" })],
    ["GET 404", (app) => get(app, "/v1/nothing", { origin: "http://localhost:8090" })],
    ["OPTIONS preflight, 8081", (app) => preflight(app, "http://localhost:8081")],
    ["OPTIONS preflight, 8090", (app) => preflight(app, "http://localhost:8090")],
  ];

  it.each(beforeIdentity)(
    "%s carries zero CORS headers from the composition root with NODE_ENV=test",
    async (_case, send) => {
      const running = await createAppFromEnvironment({
        SK_IDENTITY: "fixture",
        NODE_ENV: "test",
        DATABASE_URL: UNUSED_DB,
      });
      open.push(running.app);
      try {
        expect(corsHeaderNames(await send(running.app))).toEqual([]);
      } finally {
        await running.pool.end();
      }
    },
  );
});

describe("the composition root", () => {
  async function fromEnvironment(extra: Record<string, string>): Promise<FastifyInstance> {
    const running = await createAppFromEnvironment({
      SK_IDENTITY: "fixture",
      DATABASE_URL: UNUSED_DB,
      ...extra,
    });
    open.push(running.app);
    await running.pool.end();
    return running.app;
  }

  it("serves the local web origins in development with no allowlist", async () => {
    const app = await fromEnvironment({ NODE_ENV: "development" });
    for (const origin of ["http://localhost:8081", "http://localhost:8090"]) {
      const response = await preflight(app, origin);
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
  });

  it("serves only the configured origins once SK_CORS_ORIGINS is set", async () => {
    const app = await fromEnvironment({
      NODE_ENV: "development",
      SK_CORS_ORIGINS: "http://example.test",
    });
    const local = await preflight(app, "http://localhost:8090");
    const configured = await preflight(app, "http://example.test");

    expectOnlyVary(local);
    expect(configured.headers["access-control-allow-origin"]).toBe("http://example.test");
  });

  describe("the development startup line (review F3)", () => {
    async function startupLines(extra: Record<string, string>): Promise<string[]> {
      const lines: string[] = [];
      const running = await createAppFromEnvironment(
        { SK_IDENTITY: "fixture", DATABASE_URL: UNUSED_DB, ...extra },
        { logging: { level: "info", destination: { write: (line) => void lines.push(line) } } },
      );
      open.push(running.app);
      await running.pool.end();
      return lines.filter((line) => line.includes("corsOrigins"));
    }

    it("logs exactly one line naming the implied origins in development", async () => {
      const lines = await startupLines({ NODE_ENV: "development" });
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0] ?? "{}") as { corsOrigins?: unknown; msg?: unknown };
      expect(record.corsOrigins).toEqual(["http://localhost:8081", "http://localhost:8090"]);
      expect(record.msg).toContain("SK_CORS_ORIGINS is unset in development");
    });

    it("logs it with NODE_ENV unset too", async () => {
      expect(await startupLines({})).toHaveLength(1);
    });

    it.each([
      ["a configured list", { NODE_ENV: "development", SK_CORS_ORIGINS: "http://example.test" }],
      ["NODE_ENV=test", { NODE_ENV: "test" }],
    ])("logs nothing with %s", async (_case, extra) => {
      expect(await startupLines(extra)).toEqual([]);
    });
  });

  it("refuses to start on an allowlist entry that could never match", async () => {
    await expect(
      createAppFromEnvironment({
        SK_IDENTITY: "fixture",
        NODE_ENV: "development",
        DATABASE_URL: UNUSED_DB,
        SK_CORS_ORIGINS: "http://localhost:8081/",
      }),
    ).rejects.toThrow(CorsConfigurationError);
  });

  it("refuses a wildcard", async () => {
    await expect(
      createAppFromEnvironment({
        SK_IDENTITY: "fixture",
        NODE_ENV: "development",
        DATABASE_URL: UNUSED_DB,
        SK_CORS_ORIGINS: "*",
      }),
    ).rejects.toThrow(CorsConfigurationError);
  });
});
