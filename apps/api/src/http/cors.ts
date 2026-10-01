/**
 * Browser origins (BUG-002, D-027 as proposed 2026-09-30).
 *
 * A browser calling the API from another origin needs CORS headers, and every
 * app request carries `Authorization`, so every one of them is preflighted.
 * This module answers that, and nothing more, under one rule: **a browser
 * origin is served only when it is named, exactly, in configuration.**
 *
 * - `SK_CORS_ORIGINS` is a comma-separated list of exact origins (scheme, host
 *   and port, as a browser serialises them). Empty or unset by default.
 * - Unset, the API sends no CORS headers at all and registers no preflight
 *   route, which is what it did before this module existed. That is the
 *   production default.
 * - Development convenience: with `NODE_ENV` unset or `development` and
 *   `SK_CORS_ORIGINS` unset, the two local web origins are implied
 *   ({@link DEVELOPMENT_IMPLIED_ORIGINS}). In `test` and in every other
 *   environment nothing is implied.
 *
 * Once an allowlist exists, every response carries `Vary: Origin`. For a
 * request whose `Origin` matches an entry exactly, the response also carries
 * `Access-Control-Allow-Origin: <that origin>`, and a preflight (`OPTIONS` on
 * any `/v1/` path) answers 204 and adds the allowed methods, the allowed
 * request headers and a max age. A missing or non-matching `Origin` gets no
 * `Access-Control-*` header of any kind, and its preflight is a 204 with only
 * `Vary`, so the browser refuses the real request itself. With no allowlist
 * there is no CORS header and no `Vary` at all.
 *
 * What is deliberately absent:
 *
 * - **`*`.** The allowed origin is echoed back, never a wildcard, and `*` is
 *   refused as a configuration entry. A wildcard tells every page on the web
 *   that it may read the API's answers. The bearer token lives in the app, so
 *   a stranger's page has no token to send today, but that is a property of
 *   the client, not a rule of the server; naming the origin costs nothing.
 * - **`Access-Control-Allow-Credentials`.** The app sends a bearer header, not
 *   a cookie, so there is nothing for the flag to permit.
 * - **Prefix, suffix or case-folded matching.** `http://localhost:80810` is not
 *   `http://localhost:8081`, and a browser always sends the serialised,
 *   lowercase form, so an exact string comparison is both correct and the
 *   only thing that cannot be fooled by a lookalike host.
 *
 * Hand-rolled rather than `@fastify/cors` (rule 11): a dozen lines of headers
 * that stay readable in one file beat a dependency whose defaults would have
 * to be audited and pinned.
 *
 * Registration is in two halves because Fastify runs `onRequest` hooks in the
 * order they were added and `onRoute` only sees routes added after it:
 * {@link registerCorsHeaders} goes **before** the authorization hook, so a 401
 * or 403 still carries `Access-Control-Allow-Origin` and the page can read the
 * status; {@link registerCorsPreflight} goes **after** it, so the default-deny
 * `onRoute` guard sees the preflight route and its `publicRoute` declaration.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { normalizeNodeEnv, type EnvironmentLike } from "../identity/index.js";
import { publicRoute } from "./authorization.js";

/** Environment variable carrying the allowlist. */
export const CORS_ORIGINS_ENV_VAR = "SK_CORS_ORIGINS";

/**
 * The local web origins implied in development when {@link CORS_ORIGINS_ENV_VAR}
 * is unset: Expo's web dev server on its default port (`apps/mobile/README.md`),
 * and 8090, the port the web build was served from when BUG-002 was found.
 */
export const DEVELOPMENT_IMPLIED_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:8081",
  "http://localhost:8090",
]);

/** Methods the API's routes use, plus the preflight itself. */
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";

/**
 * Request headers the app sends: `Authorization` on every call and
 * `Content-Type: application/json` on every POST (`apps/mobile/src/api/
 * client.ts`). Idempotency keys travel in the body, not in a header.
 */
export const CORS_ALLOW_HEADERS = "authorization, content-type";

/** How long a browser may cache a preflight answer, in seconds. */
export const CORS_MAX_AGE_SECONDS = 600;

/** Every API route lives under `/v1/`; `/healthz` is not for browsers. */
export const CORS_PREFLIGHT_PATH = "/v1/*";

/** Where the allowlist came from; logged once at startup when it was implied. */
export type CorsPolicySource = "configured" | "development-implied" | "none";

export interface CorsPolicy {
  /** Exact origins to serve. Empty means no CORS headers and no preflight route. */
  readonly allowedOrigins: readonly string[];
  readonly source: CorsPolicySource;
}

/** No browser origin is served: the default, and the behaviour before BUG-002. */
export const NO_CORS: CorsPolicy = Object.freeze({
  allowedOrigins: Object.freeze([]),
  source: "none",
});

/** Refusal to start on an allowlist entry that could never match a browser's origin. */
export class CorsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorsConfigurationError";
  }
}

/**
 * One allowlist entry, checked to be an origin exactly as a browser would send
 * it: `http` or `https`, a host, an optional non-default port, and nothing
 * else. A trailing slash, a path, upper case or an explicit default port would
 * never match, so they refuse to start rather than silently serve nobody.
 *
 * Refusals name the entry by its position, never by its text (BUG-002 review
 * F2): a mistyped value can carry a password (`https://user:pw@host`) or a
 * token in a query, and the refusal goes to stderr and the logs. Only `*` and
 * `null`, which are exactly those strings, and the parsed origin (which holds
 * no userinfo, path or query) are ever printed.
 */
function validatedOrigin(entry: string, position: number): string {
  const which = `${CORS_ORIGINS_ENV_VAR} entry ${String(position)}`;
  if (entry === "*" || entry.toLowerCase() === "null") {
    throw new CorsConfigurationError(
      `${which} is "${entry === "*" ? "*" : "null"}", which is never served. List exact ` +
        `origins such as https://app.example.com.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(entry);
  } catch {
    throw new CorsConfigurationError(
      `${which} is not an origin. Use scheme, host and port only, for example ` +
        `http://localhost:8081.`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new CorsConfigurationError(
      `${which} contains credentials (user or password before the host). An origin never ` +
        `does; remove them, and treat the value as exposed wherever it was stored.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CorsConfigurationError(`${which} must start with http:// or https://.`);
  }
  if (parsed.origin !== entry) {
    throw new CorsConfigurationError(
      `${which} would never match, because a browser sends "${parsed.origin}". Write it ` +
        `exactly that way (no path, no query, no trailing slash, lower case, no default port).`,
    );
  }
  return entry;
}

/** Parses a non-blank `SK_CORS_ORIGINS` value. Entries are trimmed; blanks are skipped. */
export function parseCorsOrigins(raw: string): readonly string[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return Object.freeze([
    ...new Set(entries.map((entry, index) => validatedOrigin(entry, index + 1))),
  ]);
}

/**
 * Decides which browser origins this process serves.
 *
 * `SK_CORS_ORIGINS`, when set and not blank, is the whole answer. Otherwise the
 * development list is implied only for `NODE_ENV` unset or `development`
 * (trimmed and lowercased, as the identity allowlist reads it); `test`,
 * `production` and anything unrecognised imply nothing.
 */
export function resolveCorsPolicy(env: EnvironmentLike): CorsPolicy {
  const raw = env[CORS_ORIGINS_ENV_VAR];
  if (raw !== undefined && raw.trim() !== "") {
    const allowedOrigins = parseCorsOrigins(raw);
    return { allowedOrigins, source: allowedOrigins.length === 0 ? "none" : "configured" };
  }
  const nodeEnv = normalizeNodeEnv(env);
  if (nodeEnv === undefined || nodeEnv === "development") {
    return { allowedOrigins: DEVELOPMENT_IMPLIED_ORIGINS, source: "development-implied" };
  }
  return NO_CORS;
}

/**
 * The origin to echo back, or `undefined`. Exact string equality only: no
 * case folding, no trimming, no prefix. A header that arrived as a list (two
 * `Origin` lines joined) matches nothing.
 */
export function matchAllowedOrigin(
  origin: string | readonly string[] | undefined,
  allowedOrigins: readonly string[],
): string | undefined {
  if (typeof origin !== "string") return undefined;
  return allowedOrigins.includes(origin) ? origin : undefined;
}

/**
 * Headers for any response while an allowlist exists (BUG-002 review F1,
 * ruling R1). `Vary: Origin` goes on **every** response, matched or not,
 * preflights included, because the answer differs by `Origin` and a cache that
 * stored a stranger's header-less answer must not hand it to the allowed page
 * (or the reverse). `Access-Control-Allow-Origin` is added only for a match.
 */
export function corsResponseHeaders(
  matchedOrigin: string | undefined,
): Readonly<Record<string, string>> {
  return matchedOrigin === undefined
    ? { vary: "Origin" }
    : { "access-control-allow-origin": matchedOrigin, vary: "Origin" };
}

/** Additional headers for a preflight answer to an allowed origin. */
export function corsPreflightHeaders(): Readonly<Record<string, string>> {
  return {
    "access-control-allow-methods": CORS_ALLOW_METHODS,
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
    "access-control-max-age": String(CORS_MAX_AGE_SECONDS),
  };
}

/**
 * First half: the `onRequest` hook that stamps `Vary: Origin` on every
 * response and the allowed origin on a match. Call it **before**
 * `registerAuthorization`. Installs nothing when the allowlist is empty, so
 * with no allowlist there is no CORS header and no `Vary` at all.
 */
export function registerCorsHeaders(app: FastifyInstance, policy: CorsPolicy): void {
  if (policy.allowedOrigins.length === 0) return;
  app.addHook("onRequest", (request: FastifyRequest, reply: FastifyReply, done) => {
    reply.headers(
      corsResponseHeaders(matchAllowedOrigin(request.headers.origin, policy.allowedOrigins)),
    );
    done();
  });
}

/**
 * Second half: the preflight route. Call it **after** `registerAuthorization`
 * so the `onRoute` guard checks its declaration. The handler reads one request
 * header and writes headers; it never reads the token, the caller or the
 * session, and the authorization hook never resolves one for a public route.
 * Registers nothing when the allowlist is empty, so `OPTIONS` stays a 404 as
 * it was before.
 */
export function registerCorsPreflight(app: FastifyInstance, policy: CorsPolicy): void {
  if (policy.allowedOrigins.length === 0) return;
  app.options(
    CORS_PREFLIGHT_PATH,
    {
      config: {
        authorization: publicRoute(
          "CORS preflight: a browser sends it without credentials before every cross-origin " +
            "request, and the answer is headers only, read from the Origin header and nothing else",
        ),
      },
    },
    async (request, reply) => {
      if (matchAllowedOrigin(request.headers.origin, policy.allowedOrigins) !== undefined) {
        reply.headers(corsPreflightHeaders());
      }
      await reply.code(204).send();
    },
  );
}
