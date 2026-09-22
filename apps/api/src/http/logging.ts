/**
 * Structured request logging (M2-T1, ARCHITECTURE.md §7.15 and §8).
 *
 * Fastify's built-in logger (pino) does the writing, with no new dependency. This
 * module supplies the policy around it:
 *
 * - **Correlation id.** `genReqId` mints a UUIDv7 per request (the generator
 *   from `src/ids/uuidv7.ts`), which pino attaches to every line as `reqId` and
 *   the response carries back in `x-correlation-id`. Time-ordered ids mean the
 *   log of one request sorts next to the requests either side of it.
 * - **We write the request lines, not Fastify.** `disableRequestLogging` is on
 *   and `logRequestCompleted` emits one line per request with an explicit,
 *   hand-built payload. Fastify's own request logging serialises the whole
 *   `req` (headers included, which is where the bearer token lives), and an
 *   allowlist of fields we chose is a stronger guarantee than a denylist
 *   applied to everything a framework felt like including.
 * - **Denylist on the way out anyway.** `formatters.log` runs
 *   {@link redactLogObject} over every merged object, so a future log call that
 *   passes something careless is still redacted. Belt and braces, in that order.
 *
 * Nothing here logs a request body, a header, a query string, a name, an email
 * or a token. Opaque identifiers (correlation id, user id, household id) *are*
 * logged: they are what makes an authorization denial auditable
 * (ARCHITECTURE.md §7.10) and they carry no personal data by themselves.
 */

import {
  LogController,
  type FastifyBaseLogger,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { uuidv7 } from "../ids/uuidv7.js";
import { redactError, redactLogObject } from "./redaction.js";

/** Somewhere to write JSON lines. Matches pino's destination-stream shape. */
export interface LogDestination {
  write(line: string): void;
}

export interface LoggingOptions {
  /** pino level. Defaults to `info`, or `silent` under vitest so suites stay readable. */
  readonly level?: string;
  /** Destination; defaults to pino's own (stdout). Tests pass a capturing stream. */
  readonly destination?: LogDestination;
}

function defaultLevel(): string {
  if (process.env["SK_LOG_LEVEL"] !== undefined && process.env["SK_LOG_LEVEL"] !== "") {
    return process.env["SK_LOG_LEVEL"];
  }
  return process.env["VITEST"] === undefined ? "info" : "silent";
}

/**
 * Fastify's `logger` option, configured for structured JSON with redaction.
 *
 * **The error path runs in the formatter, not in the serializer** (M2-T1 review
 * finding F2). pino applies `formatters.log` *before* its serializers, so an
 * `err` serializer never sees the thrown value: it sees whatever the formatter
 * already produced. An earlier revision reduced errors only in the serializer,
 * and every 500 logged `{"type":"NonError","message":"[object Object]"}`.
 * `redactLogRecord` now reduces an `Error` in the formatter, where the real
 * object still exists.
 *
 * The `err` serializer below is still needed, and is deliberately idempotent:
 * Fastify installs a default one, which would re-serialize the already-reduced
 * object and report its `type` as `"Object"`. {@link redactError} recognises
 * its own output and returns it untouched, so the value survives whichever
 * order the two run in.
 */
export function buildLoggerOptions(options: LoggingOptions = {}): FastifyServerOptions["logger"] {
  return {
    level: options.level ?? defaultLevel(),
    ...(options.destination === undefined ? {} : { stream: options.destination }),
    formatters: {
      log: redactLogObject,
    },
    serializers: {
      err: redactError,
    },
  };
}

/**
 * Turns off Fastify's own request logging.
 *
 * Fastify serialises the whole `req` on its incoming-request line, headers
 * included, and the bearer token lives in a header. We emit
 * {@link logRequestCompleted} instead, from an explicit allowlist of fields,
 * which is a stronger guarantee than a denylist applied to whatever a framework
 * decided to include. (The top-level `disableRequestLogging` option does the same thing
 * and is deprecated in Fastify 5; this is its replacement.)
 */
export function buildLogController(): LogController {
  return new LogController({ disableRequestLogging: true });
}

/** UUIDv7 correlation id per request. */
export function generateCorrelationId(): string {
  return uuidv7();
}

/**
 * The fields of a request that are safe to log.
 *
 * `routePath` rather than `request.url`: the raw URL carries the query string,
 * and a query string is caller-controlled text. The matched route pattern says
 * what was called without repeating what the caller wrote.
 */
export interface RequestLogFields {
  readonly correlationId: string;
  readonly method: string;
  readonly routePath: string;
  readonly statusCode: number;
}

export function requestLogFields(request: FastifyRequest, statusCode: number): RequestLogFields {
  return {
    correlationId: request.id,
    method: request.method,
    routePath: request.routeOptions.url ?? "(no route)",
    statusCode,
  };
}

/** One line per completed request. */
export function logRequestCompleted(request: FastifyRequest, reply: FastifyReply): void {
  const session = request.session;
  request.log.info(
    {
      ...requestLogFields(request, reply.statusCode),
      durationMs: Math.round(reply.elapsedTime),
      ...(session === undefined
        ? {}
        : { userId: session.userId, householdId: session.householdId, role: session.role }),
    },
    "request.completed",
  );
}

/**
 * One line per authorization denial (ARCHITECTURE.md §7.10: "authz denials …
 * logged with actor").
 *
 * `reason` is a fixed enumerated string chosen by our own code, never anything
 * the caller supplied, because a caller-controlled reason string is how a
 * log-injection bug starts.
 */
export type DenialReason =
  | "no-authorization-declaration"
  | "missing-authorization-header"
  | "malformed-authorization-header"
  | "unknown-token"
  | "role-not-permitted";

export function logAuthorizationDenied(
  request: FastifyRequest,
  statusCode: number,
  reason: DenialReason,
): void {
  const session = request.session;
  request.log.warn(
    {
      ...requestLogFields(request, statusCode),
      reason,
      ...(session === undefined
        ? {}
        : { userId: session.userId, householdId: session.householdId, role: session.role }),
    },
    "authorization.denied",
  );
}

/** Narrow alias so callers do not have to import Fastify's logger type. */
export type Logger = FastifyBaseLogger;
