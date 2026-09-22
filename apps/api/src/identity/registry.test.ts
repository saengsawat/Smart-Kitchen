/**
 * Adapter selection and the production refusal (M2-T1).
 *
 * The refusal is the security-relevant half: the fixture tokens are public
 * strings in this repository, so a production process that accepted them would
 * be an authentication bypass. These tests pin every way in which the selection
 * is allowed to say yes, which is exactly one.
 */

import { describe, expect, it } from "vitest";
import { createFixtureIdentityPort, parseFixtureIdentityData } from "./fixture-identity-port.js";
import {
  chooseIdentityAdapter,
  FIXTURE_IDENTITY_ADAPTER,
  IdentityConfigurationError,
  isFixtureEnvironmentPermitted,
  normalizeNodeEnv,
  selectIdentityPort,
} from "./registry.js";

const FIXTURE_DATA = parseFixtureIdentityData({
  households: [{ householdId: "f1c70000-0000-4000-8000-000000000001", name: "Chen household" }],
  sessions: [
    {
      token: "fixture.dean.chen",
      userId: "f1c70001-0000-4000-8000-000000000001",
      householdId: "f1c70000-0000-4000-8000-000000000001",
      role: "owner",
      displayName: "Dean Chen",
      displayInitials: "DC",
      email: "dean.chen@fixture.invalid",
    },
  ],
});

describe("chooseIdentityAdapter", () => {
  it("registers the fixture adapter in development", () => {
    expect(chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: "development" })).toBe(
      FIXTURE_IDENTITY_ADAPTER,
    );
  });

  it("registers the fixture adapter under test", () => {
    expect(chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: "test" })).toBe(
      FIXTURE_IDENTITY_ADAPTER,
    );
  });

  it("registers the fixture adapter with NODE_ENV unset (a bare local run)", () => {
    expect(chooseIdentityAdapter({ SK_IDENTITY: "fixture" })).toBe(FIXTURE_IDENTITY_ADAPTER);
  });

  it("refuses the fixture adapter in production", () => {
    expect(() => chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: "production" })).toThrow(
      IdentityConfigurationError,
    );
  });

  /**
   * Review finding F3. The refusal used to be an exact-string check against
   * `production`, so every one of these spellings loaded the repository's public
   * tokens. They are refusals now because the permitted environments are an
   * allowlist: an unrecognised NODE_ENV fails closed.
   */
  it.each([
    ["Production", "Production"],
    ["PRODUCTION", "PRODUCTION"],
    ["production with a trailing space", "production "],
    ["prod", "prod"],
    ["staging", "staging"],
    ["prod-eu", "prod-eu"],
    ["live", "live"],
    ["a typo of development", "developement"],
  ])("refuses the fixture adapter with NODE_ENV=%s", (_case, nodeEnv) => {
    expect(() => chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: nodeEnv })).toThrow(
      IdentityConfigurationError,
    );
  });

  it.each([
    ["Development", "Development"],
    ["TEST", "TEST"],
    ["development with surrounding space", "  development  "],
  ])(
    "still accepts %s, since case and padding are normalised before the lookup",
    (_case, nodeEnv) => {
      expect(chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: nodeEnv })).toBe(
        FIXTURE_IDENTITY_ADAPTER,
      );
    },
  );

  it("says why it refused, naming both variables", () => {
    let message = "";
    try {
      chooseIdentityAdapter({ SK_IDENTITY: "fixture", NODE_ENV: "production" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("SK_IDENTITY=fixture");
    expect(message).toContain("NODE_ENV=production");
    expect(message).toContain("refusing to start");
  });

  it.each([
    ["SK_IDENTITY unset", {}],
    ["SK_IDENTITY empty", { SK_IDENTITY: "" }],
    ["SK_IDENTITY whitespace", { SK_IDENTITY: "   " }],
    ["SK_IDENTITY naming an adapter that does not exist", { SK_IDENTITY: "clerk" }],
    ["SK_IDENTITY nearly right", { SK_IDENTITY: "Fixture" }],
  ])("refuses to start with %s, rather than defaulting to anything", (_case, env) => {
    expect(() => chooseIdentityAdapter(env)).toThrow(IdentityConfigurationError);
  });

  it("refuses an unset adapter in production too (no silent anonymous mode)", () => {
    expect(() => chooseIdentityAdapter({ NODE_ENV: "production" })).toThrow(
      IdentityConfigurationError,
    );
  });
});

describe("normalizeNodeEnv", () => {
  it.each([
    ["production", "production"],
    ["Production", "production"],
    ["  TEST  ", "test"],
  ])("normalises %s to %s", (raw, expected) => {
    expect(normalizeNodeEnv({ NODE_ENV: raw })).toBe(expected);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("reports %s as no value at all", (_case, raw) => {
    expect(normalizeNodeEnv(raw === undefined ? {} : { NODE_ENV: raw })).toBeUndefined();
  });
});

describe("isFixtureEnvironmentPermitted", () => {
  it.each([["development"], ["test"], ["Development"], ["  test  "]])(
    "permits NODE_ENV=%s",
    (nodeEnv) => {
      expect(isFixtureEnvironmentPermitted({ NODE_ENV: nodeEnv })).toBe(true);
    },
  );

  it("permits an unset NODE_ENV", () => {
    expect(isFixtureEnvironmentPermitted({})).toBe(true);
  });

  it.each([["production"], ["Production"], ["PRODUCTION"], ["prod"], ["staging"], ["production "]])(
    "refuses NODE_ENV=%s",
    (nodeEnv) => {
      expect(isFixtureEnvironmentPermitted({ NODE_ENV: nodeEnv })).toBe(false);
    },
  );
});

describe("selectIdentityPort", () => {
  it("returns a working fixture port in development", async () => {
    const port = await selectIdentityPort(
      { SK_IDENTITY: "fixture", NODE_ENV: "development" },
      { fixtureData: FIXTURE_DATA },
    );
    await expect(port.resolveSession("fixture.dean.chen")).resolves.toMatchObject({
      role: "owner",
    });
  });

  it("never constructs a port in production, even with the fixture data already in hand", async () => {
    await expect(
      selectIdentityPort(
        { SK_IDENTITY: "fixture", NODE_ENV: "production" },
        { fixtureData: FIXTURE_DATA },
      ),
    ).rejects.toThrow(IdentityConfigurationError);
  });

  it("builds the same port the fixture factory would", async () => {
    const selected = await selectIdentityPort(
      { SK_IDENTITY: "fixture", NODE_ENV: "test" },
      { fixtureData: FIXTURE_DATA },
    );
    const direct = createFixtureIdentityPort(FIXTURE_DATA);
    await expect(selected.resolveSession("fixture.dean.chen")).resolves.toEqual(
      await direct.resolveSession("fixture.dean.chen"),
    );
  });
});
