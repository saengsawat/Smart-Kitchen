/**
 * The pieces of the authorization layer that are pure (M2-T1).
 *
 * The pipeline behaviour is asserted over real requests in `app.test.ts` and
 * `tenancy.db.test.ts`; header parsing is tested here because the interesting
 * inputs are the malformed ones, and enumerating them at the HTTP level would
 * say nothing extra.
 */

import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  bearerToken,
  householdRoute,
  NoSessionOnRequestError,
  publicRoute,
  requireSession,
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
