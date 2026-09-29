/**
 * The pieces of the authorization layer that are pure (M2-T1).
 *
 * The pipeline behaviour is asserted over real requests in `app.test.ts` and
 * `tenancy.db.test.ts`; header parsing is tested here because the interesting
 * inputs are the malformed ones, and enumerating them at the HTTP level would
 * say nothing extra.
 */

import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createFixtureIdentityPort, parseFixtureIdentityData } from "../identity/index.js";
import {
  bearerToken,
  householdRoute,
  NoSessionOnRequestError,
  ownerRoute,
  publicRoute,
  registerAuthorization,
  requireCaller,
  requireSession,
  userRoute,
} from "./authorization.js";

describe("bearerToken", () => {
  it("reads the credential out of a well-formed header", () => {
    expect(bearerToken("Bearer fixture.dean.chen")).toBe("fixture.dean.chen");
  });

  it("returns undefined when there is no header at all", () => {
    expect(bearerToken(undefined)).toBeUndefined();
  });

  it.each([
    ["an empty header", ""],
    ["another scheme", "Basic ZGVhbjpo"],
    ["the scheme alone", "Bearer"],
    ["the scheme with nothing after it", "Bearer "],
    ["a lowercase scheme", "bearer fixture.dean.chen"],
    ["two credentials", "Bearer a b"],
    ["a trailing space", "Bearer fixture.dean.chen "],
    ["a tab separator", "Bearer\tfixture.dean.chen"],
    ["a leading space", " Bearer fixture.dean.chen"],
  ])("returns null for %s", (_case, header) => {
    expect(bearerToken(header)).toBeNull();
  });

  it("does not trim the credential, so a padded token is a different token", () => {
    expect(bearerToken("Bearer  fixture.dean.chen")).toBeNull();
  });
});

describe("declarations", () => {
  it("defaults a household route to both roles", () => {
    expect(householdRoute()).toEqual({ kind: "household", roles: ["owner", "member"] });
  });

  it("carries the narrowed role list when one is given", () => {
    expect(householdRoute(["owner"])).toEqual({ kind: "household", roles: ["owner"] });
  });

  it("makes a public route state its reason", () => {
    expect(publicRoute("liveness probe")).toEqual({ kind: "public", reason: "liveness probe" });
  });
});

describe("requireSession", () => {
  it("returns the session the hook attached", () => {
    const session = { userId: "u", householdId: "h", role: "owner" as const };
    expect(requireSession({ session } as FastifyRequest)).toBe(session);
  });

  it("throws rather than returning undefined when a handler asks without one", () => {
    expect(() => requireSession({} as FastifyRequest)).toThrow(NoSessionOnRequestError);
  });
});

describe("M2-T3: user routes, owner routes and the household-less caller", () => {
  const CHEN = "f1c70000-0000-4000-8000-000000000001";
  const data = parseFixtureIdentityData({
    households: [{ householdId: CHEN, name: "Chen household" }],
    sessions: [
      {
        token: "fixture.dean.chen",
        userId: "f1c70001-0000-4000-8000-000000000001",
        householdId: CHEN,
        role: "owner",
        displayName: "Dean Chen",
        displayInitials: "DC",
        email: "dean.chen@fixture.invalid",
      },
      {
        token: "fixture.maya.chen",
        userId: "f1c70001-0000-4000-8000-000000000002",
        householdId: CHEN,
        role: "member",
        displayName: "Maya Chen",
        displayInitials: "MC",
        email: "maya.chen@fixture.invalid",
      },
      {
        token: "fixture.new.user",
        userId: "f1c70001-0000-4000-8000-000000000004",
        displayName: "Noor Haddad",
        displayInitials: "NH",
        email: "noor.haddad@fixture.invalid",
      },
    ],
  });

  async function pipeline(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    registerAuthorization(app, { identity: createFixtureIdentityPort(data) });
    app.get("/user", { config: { authorization: userRoute("test") } }, (request) => ({
      userId: requireCaller(request).userId,
      household: request.session?.householdId ?? null,
    }));
    app.get("/household", { config: { authorization: householdRoute() } }, () => ({ ok: true }));
    app.get("/owner", { config: { authorization: ownerRoute() } }, () => ({ ok: true }));
    await app.ready();
    return app;
  }

  function get(app: FastifyInstance, url: string, token?: string) {
    return app.inject({
      method: "GET",
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  }

  it("declarations state their kind and reason", () => {
    expect(userRoute("why")).toEqual({ kind: "user", reason: "why" });
    expect(ownerRoute()).toEqual({
      kind: "household",
      roles: ["owner"],
      roleDeniedCode: "NOT_OWNER",
    });
  });

  it("a user route admits a household-less caller and still refuses an unknown token", async () => {
    const app = await pipeline();
    try {
      const fresh = await get(app, "/user", "fixture.new.user");
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json()).toEqual({
        userId: "f1c70001-0000-4000-8000-000000000004",
        household: null,
      });
      const dean = await get(app, "/user", "fixture.dean.chen");
      expect(dean.json()).toMatchObject({ household: CHEN });
      expect((await get(app, "/user", "fixture.nobody")).statusCode).toBe(401);
      expect((await get(app, "/user")).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("a household route refuses a household-less caller with 403, not 401 and not access", async () => {
    const app = await pipeline();
    try {
      const fresh = await get(app, "/household", "fixture.new.user");
      expect(fresh.statusCode).toBe(403);
      expect(fresh.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    } finally {
      await app.close();
    }
  });

  it("an owner route answers a member with 403 NOT_OWNER and admits the owner", async () => {
    const app = await pipeline();
    try {
      const maya = await get(app, "/owner", "fixture.maya.chen");
      expect(maya.statusCode).toBe(403);
      expect(maya.json()).toMatchObject({
        error: { code: "NOT_OWNER", message: "Only the household owner can do that." },
      });
      expect((await get(app, "/owner", "fixture.dean.chen")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("requireCaller throws rather than returning undefined", () => {
    expect(() => requireCaller({} as FastifyRequest)).toThrow(NoSessionOnRequestError);
  });
});
