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
  sessionFor,
  type Caller,
  type HouseholdRole,
  type IdentityPort,
  type Session,
} from "../identity/index.js";
import { logAuthorizationDenied, type DenialReason } from "./logging.js";

/**
 * What a route requires of its caller.
 *
 * `public` carries a mandatory `reason` so that opening a route to the world is
 * a sentence somebody wrote, not a default somebody forgot. So does `user`
 * (M2-T3): a route a signed-in person may reach before they belong to any
 * household is narrower than `public` but wider than `household`, and the
 * sentence says why it has to be.
 */
export type AuthorizationDeclaration =
  | { readonly kind: "public"; readonly reason: string }
  | {
      readonly kind: "household";
      readonly roles: readonly HouseholdRole[];
      /**
       * The code a role refusal answers with. `FORBIDDEN` unless the route
       * names a more specific one (M2-T3: `NOT_OWNER` on owner-only actions,
       * so a member's screen can say why rather than "no access").
       */
      readonly roleDeniedCode?: RoleDeniedCode;
    }
  | { readonly kind: "user"; readonly reason: string };

/** Codes a role refusal may answer with. Both are 403. */
export type RoleDeniedCode = Extract<ApiErrorCode, "FORBIDDEN" | "NOT_OWNER">;

/** Any member of the caller's household may use this route. */
export function householdRoute(
  roles: readonly HouseholdRole[] = HOUSEHOLD_ROLES,
): AuthorizationDeclaration {
  return { kind: "household", roles };
}

/** Only the household's owner may use this route; a member is refused with `NOT_OWNER`. */
export function ownerRoute(): AuthorizationDeclaration {
  return { kind: "household", roles: ["owner"], roleDeniedCode: "NOT_OWNER" };
}

/**
 * Any signed-in caller, with or without a household (M2-T3). The handler gets
 * the {@link Caller}, and the session too when the caller has a household.
 * Say why the route cannot require a household.
 */
export function userRoute(reason: string): AuthorizationDeclaration {
  return { kind: "user", reason };
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
    /** Set by the authorization hook once a bearer token has resolved to a household. */
    session?: Session;
    /** Set by the authorization hook once a bearer token has resolved (M2-T3). */
    caller?: Caller;
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

/** The signed-in caller, for a handler on a `userRoute()` or `householdRoute()`. */
export function requireCaller(request: FastifyRequest): Caller {
  const caller = request.caller;
  if (caller === undefined) throw new NoSessionOnRequestError();
  return caller;
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
  roleDeniedCode: RoleDeniedCode = "FORBIDDEN",
): Promise<void> {
  logAuthorizationDenied(request, statusCode, reason);
  const code: ApiErrorCode = statusCode === 401 ? "UNAUTHENTICATED" : roleDeniedCode;
  const message =
    statusCode === 401
      ? "Sign in to continue."
      : code === "NOT_OWNER"
        ? "Only the household owner can do that."
        : "You do not have access to that.";
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

    const caller = await deps.identity.resolveCaller(token);
    if (caller === null) {
      await deny(request, reply, 401, "unknown-token");
      return;
    }
    request.caller = caller;
    // The household the request runs as is chosen from the port's own set
    // (OQ-E1) and from nothing the request carries.
    const session = sessionFor(caller);

    if (declaration.kind === "user") {
      if (session !== null) request.session = session;
      return;
    }

    if (session === null) {
      await deny(request, reply, 403, "no-household");
      return;
    }

    if (!declaration.roles.includes(session.role)) {
      // Attached first so the denial log names the actor (ARCHITECTURE.md §7.10).
      request.session = session;
      await deny(request, reply, 403, "role-not-permitted", declaration.roleDeniedCode);
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
