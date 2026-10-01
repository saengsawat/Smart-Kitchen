/**
 * Application assembly (M2-T1).
 *
 * `buildApp` takes its dependencies rather than constructing them: the identity
 * port and the tenant-session runner are both things a test needs to substitute
 * (a fixture port; a session runner with the tenant context deliberately
 * removed, to prove row-level security is what is holding and not luck at the
 * application layer). `createAppFromEnvironment` is the composition root that
 * reads the environment and builds the real ones.
 *
 * Order of registration matters and is not incidental:
 *
 * 0. `registerCorsHeaders` (BUG-002), whose `onRequest` hook must run before
 *    the authorization hook so that a 401 or 403 to an allowed browser origin
 *    still carries `Access-Control-Allow-Origin`. It adds no route;
 * 1. `registerAuthorization`, so its `onRoute` guard sees every route that
 *    follows and its `onRequest` hook runs before any handler;
 * 2. the response/error handlers, so a failure inside a handler still answers
 *    the shared error envelope and still carries the correlation id;
 * 3. the routes, the CORS preflight route among them, each declared.
 *
 * No port is bound here. `server.ts` owns the process.
 */

import { OpenFoodFactsProductLookupPort, offConfigFromEnvironment } from "@smart-kitchen/adapters";
import type { ApiErrorBodyDto } from "@smart-kitchen/contracts";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createJoinCodeHasher, resolveJoinCodePepper } from "./db/households/join-code.js";
import {
  chooseIdentityAdapter,
  selectIdentityPort,
  type EnvironmentLike,
  type IdentityPort,
} from "./identity/index.js";
import { registerAuthorization } from "./http/authorization.js";
import {
  NO_CORS,
  registerCorsHeaders,
  registerCorsPreflight,
  resolveCorsPolicy,
  type CorsPolicy,
} from "./http/cors.js";
import {
  buildLogController,
  buildLoggerOptions,
  generateCorrelationId,
  logRequestCompleted,
  type LoggingOptions,
} from "./http/logging.js";
import {
  createMembershipSessionRunner,
  createPostgresMembershipDirectory,
} from "./http/membership-session.js";
import { createJoinAttemptLimiter } from "./http/rate-limit.js";
import { registerRoutes, type RouteDeps } from "./http/routes.js";
import { createTenantSessionRunner, type TenantSessionRunner } from "./http/tenant-session.js";

export interface AppDependencies {
  readonly identity: IdentityPort;
  readonly tenantSession: TenantSessionRunner;
  /** Household endpoints (M2-T3); the composition root always supplies them. */
  readonly households?: RouteDeps["households"];
  /** Product lookup (M2-T4a); the composition root always supplies it. */
  readonly products?: RouteDeps["products"];
  readonly logging?: LoggingOptions;
  /**
   * Browser origins to serve (BUG-002). Defaults to none: no CORS header on
   * any response and no preflight route, as before.
   */
  readonly cors?: CorsPolicy;
  /** Correlation-id generator; defaults to the shared UUIDv7 generator. */
  readonly correlationId?: () => string;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(deps.logging),
    // We emit the request line ourselves (see logging.ts): Fastify's own
    // request logging serialises the whole request, headers included, and the
    // bearer token lives in a header.
    logController: buildLogController(),
    genReqId: deps.correlationId ?? generateCorrelationId,
    // The correlation id is ours, minted per request. Accepting it from a
    // caller-supplied header would let a caller choose what their requests are
    // filed under, and collide with somebody else's on purpose.
    requestIdHeader: false,
    // Fastify's AJV defaults include `removeAdditional: true`, which turns a
    // schema's `additionalProperties: false` from a rule into a shrug: the
    // unknown property is deleted and the request proceeds. That is how
    // `{"type":"DISCARD","amuont":"0.25"}` removed an entire item with a 200
    // (M2-T2 review F1). A misspelled quantity field must be a refusal, not a
    // different, larger write. The other AJV defaults are left alone: in
    // particular `coerceTypes` stays on, and the exact-decimal parser in
    // `db/inventory/quantity-text.ts` is what holds the line on a quantity
    // sent as a JSON number (architect ruling, M2-T2 review F-note).
    ajv: { customOptions: { removeAdditional: false } },
  });

  const cors = deps.cors ?? NO_CORS;
  registerCorsHeaders(app, cors);
  registerAuthorization(app, { identity: deps.identity });

  app.addHook("onResponse", (request, reply, done) => {
    logRequestCompleted(request, reply);
    done();
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBodyDto = {
      error: { code: "NOT_FOUND", message: "Not found.", correlationId: request.id },
    };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request.failed");
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    const body: ApiErrorBodyDto = {
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL",
        // Never the raw message: a driver error can quote a stored row.
        message:
          statusCode === 400
            ? "That request could not be understood."
            : "Something went wrong. Try again, and tell us if it keeps happening.",
        correlationId: request.id,
      },
    };
    return reply.code(statusCode >= 400 ? statusCode : 500).send(body);
  });

  registerCorsPreflight(app, cors);
  registerRoutes(app, {
    tenantSession: deps.tenantSession,
    ...(deps.households === undefined ? {} : { households: deps.households }),
    ...(deps.products === undefined ? {} : { products: deps.products }),
  });

  return app;
}

/** Everything the process owns and must close on shutdown. */
export interface RunningApp {
  readonly app: FastifyInstance;
  readonly pool: Pool;
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

/** What a test may substitute in the composition root; `server.ts` passes nothing. */
export interface CompositionOverrides {
  /** Logger level and destination, so a test can read the startup lines (BUG-002 review F3). */
  readonly logging?: LoggingOptions;
}

/**
 * Composition root: reads the environment, refuses anything it cannot serve
 * safely, and returns the wired app together with the pool it owns.
 */
export async function createAppFromEnvironment(
  env: EnvironmentLike,
  overrides: CompositionOverrides = {},
): Promise<RunningApp> {
  // The identity refusal comes first, before anything else is read, so the
  // production message is never masked by a missing database (M2-T1).
  chooseIdentityAdapter(env);

  const connectionString = env["DATABASE_URL"];
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new DatabaseConfigurationError(
      "DATABASE_URL is not set, so there is no database to serve inventory from. See .env.example.",
    );
  }
  const joinCodes = createJoinCodeHasher(resolveJoinCodePepper(env));
  // M2-T4a: live barcode lookups go to Open Food Facts from here and only
  // from here (D-025: server side only, the phone never calls OFF). A bad
  // SK_OFF_BASE_URL or SK_OFF_USER_AGENT refuses to start, like a bad pepper.
  const offConfig = offConfigFromEnvironment({
    SK_OFF_BASE_URL: env["SK_OFF_BASE_URL"],
    SK_OFF_USER_AGENT: env["SK_OFF_USER_AGENT"],
  });
  // BUG-002 (D-027 as proposed): browser origins come from SK_CORS_ORIGINS
  // only, plus two localhost origins in development when it is unset. A
  // malformed entry refuses to start rather than silently serving nobody.
  const cors = resolveCorsPolicy(env);

  const pool = new Pool({ connectionString });
  // M2-T3: memberships come from the database, so a household created or
  // joined over HTTP takes effect on the caller's next request.
  const identity = await selectIdentityPort(env, {
    memberships: createPostgresMembershipDirectory(pool),
  });
  const app = buildApp({
    identity,
    tenantSession: createTenantSessionRunner(pool),
    households: {
      memberships: createMembershipSessionRunner(pool),
      joinCodes,
      joinLimiter: createJoinAttemptLimiter(),
    },
    products: { lookup: new OpenFoodFactsProductLookupPort(offConfig) },
    cors,
    ...(overrides.logging === undefined ? {} : { logging: overrides.logging }),
  });
  if (cors.source === "development-implied") {
    app.log.info(
      { corsOrigins: cors.allowedOrigins },
      "cors: SK_CORS_ORIGINS is unset in development, so the local web origins are allowed",
    );
  }
  return { app, pool };
}
