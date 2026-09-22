/**
 * Default-deny authorization (M2-T1, ARCHITECTURE.md §7.2, INV-TENANT-1).
 *
 * Every route states its own authorization rule, in its own registration:
 *
 * ```ts
 * app.get(path, { config: { authorization: householdRoute() } }, handler);
 * ```
 *
 * Two independent guards enforce that, because each covers the other's failure
 * mode:
 *
 * 1. **Registration time.** An `onRoute` hook throws the moment a route without
 *    a declaration is registered, so the app cannot boot with an unguarded
 *    route. A missing declaration is a coding mistake, and a coding mistake
 *    that fails at boot is found by whoever made it rather than by whoever is
 *    attacked.
 * 2. **Request time.** The `onRequest` hook answers 403 for a matched route
 *    with no declaration. Unreachable if guard 1 is installed, which is the
 *    point: if a future refactor registers routes on an instance that missed
 *    the `onRoute` hook, the fallback is denial, not access.
 *
 * Identity is read from the bearer token and nowhere else. `x-household-id`, a
 * `householdId` query parameter and a body field naming a household are all
 * simply not consulted; the session's household is the only one any handler can
 * see (INV-TENANT-1, D-022).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CORRELATION_ID_HEADER,
  type ApiErrorBodyDto,
  type ApiErrorCode,
} from "@smart-kitchen/contracts";
import {
  HOUSEHOLD_ROLES,
  type HouseholdRole,
  type IdentityPort,
  type Session,
} from "../identity/index.js";
import { logAuthorizationDenied, type DenialReason } from "./logging.js";

/**
 * What a route requires of its caller.
 *
 * `public` carries a mandatory `reason` so that opening a route to the world is
 * a sentence somebody wrote, not a default somebody forgot.
 */
export type AuthorizationDeclaration =
  | { readonly kind: "public"; readonly reason: string }
  | { readonly kind: "household"; readonly roles: readonly HouseholdRole[] };

/** Any member of the caller's household may use this route. */
export function householdRoute(
  roles: readonly HouseholdRole[] = HOUSEHOLD_ROLES,
): AuthorizationDeclaration {
  return { kind: "household", roles };
}

/** This route is deliberately open; say why. */
export function publicRoute(reason: string): AuthorizationDeclaration {
  return { kind: "public", reason };
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** Mandatory on every route; see {@link AuthorizationDeclaration}. */
    authorization?: AuthorizationDeclaration;
  }

  interface FastifyRequest {
    /** Set by the authorization hook once a bearer token has resolved. */
    session?: Session;
  }
}

/** Thrown at registration time by a route that did not declare its authorization. */
export class MissingAuthorizationDeclarationError extends Error {
  constructor(method: string, url: string) {
    super(
      `route ${method} ${url} was registered without config.authorization. Every route must ` +
        `declare its authorization explicitly (ARCHITECTURE.md §7.2, default-deny): pass ` +
        `{ config: { authorization: householdRoute() } } or, for a deliberately open route, ` +
        `{ config: { authorization: publicRoute("<why>") } }.`,
    );
    this.name = "MissingAuthorizationDeclarationError";
  }
}

/** Thrown when a handler asks for the session on a route that never required one. */
export class NoSessionOnRequestError extends Error {
  constructor() {
    super(
      "requireSession() was called on a request with no resolved session. Only a route declared " +
        "with householdRoute() has one; a publicRoute() handler must not ask for it.",
    );
    this.name = "NoSessionOnRequestError";
  }
}

/** The caller, for a handler on a household-scoped route. */
export function requireSession(request: FastifyRequest): Session {
  const session = request.session;
  if (session === undefined) throw new NoSessionOnRequestError();
  return session;
}

function errorBody(code: ApiErrorCode, message: string, correlationId: string): ApiErrorBodyDto {
  return { error: { code, message, correlationId } };
}

/**
 * Deny a request.
 *
 * 401 and 403 bodies are the same shape and carry no detail about *why*: the
 * difference between "that token is unknown" and "that household is not yours"
 * is itself information, and the reason is recorded in the log instead, where
 * only we can read it.
 */
async function deny(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: 401 | 403,
  reason: DenialReason,
): Promise<void> {
  logAuthorizationDenied(request, statusCode, reason);
  const code: ApiErrorCode = statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
  const message = statusCode === 401 ? "Sign in to continue." : "You do not have access to that.";
  await reply.code(statusCode).send(errorBody(code, message, request.id));
}

/**
 * Extracts the credential from an `Authorization: Bearer <token>` header.
 *
 * Returns `undefined` for a missing header, and `null` for a header that is
 * present but not a well-formed bearer credential. The two are logged
 * differently and answered identically.
 */
export function bearerToken(headerValue: string | undefined): string | undefined | null {
  if (headerValue === undefined) return undefined;
  const match = /^Bearer[ ]([^\s]+)$/.exec(headerValue);
  return match?.[1] ?? null;
}

export interface AuthorizationDeps {
  readonly identity: IdentityPort;
}

/**
 * The request-time half. Exported on its own so the "undeclared route is
 * denied" behaviour can be tested without the registration guard refusing to
 * let such a route exist.
 */
export function createAuthorizationHook(
  deps: AuthorizationDeps,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function authorizationOnRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    reply.header(CORRELATION_ID_HEADER, request.id);

    // No route matched: Fastify's not-found handler answers. Denying here
    // instead would turn every 404 into a 403 and tell a caller nothing useful.
    if (request.routeOptions.url === undefined) return;

    const declaration = request.routeOptions.config.authorization;
    if (declaration === undefined) {
      await deny(request, reply, 403, "no-authorization-declaration");
      return;
    }

    if (declaration.kind === "public") return;

    const token = bearerToken(request.headers.authorization);
    if (token === undefined) {
      await deny(request, reply, 401, "missing-authorization-header");
      return;
    }
    if (token === null) {
      await deny(request, reply, 401, "malformed-authorization-header");
      return;
    }

    const session = await deps.identity.resolveSession(token);
    if (session === null) {
      await deny(request, reply, 401, "unknown-token");
      return;
    }

    if (!declaration.roles.includes(session.role)) {
      // Attached first so the denial log names the actor (ARCHITECTURE.md §7.10).
      request.session = session;
      await deny(request, reply, 403, "role-not-permitted");
      return;
    }

    request.session = session;
  };
}

/**
 * Installs both guards on `app`.
 *
 * Call this on the instance the routes are registered on, before registering
 * them: `onRoute` only sees routes added after it, and only in its own
 * encapsulation context.
 */
export function registerAuthorization(app: FastifyInstance, deps: AuthorizationDeps): void {
  app.addHook("onRoute", (route) => {
    // Fastify mirrors every GET as a HEAD route with the same config, so the
    // declaration is inherited and nothing extra is needed for it here.
    if (route.config?.authorization === undefined) {
      throw new MissingAuthorizationDeclarationError(
        Array.isArray(route.method) ? route.method.join("/") : route.method,
        route.url,
      );
    }
  });

  app.addHook("onRequest", createAuthorizationHook(deps));
}
