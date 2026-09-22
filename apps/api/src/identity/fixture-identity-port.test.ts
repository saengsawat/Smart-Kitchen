/**
 * Fixture identity adapter (M2-T1).
 *
 * The checked-in fixture map is exercised as-is, because the three token
 * strings are a contract shared with the M3 client: renaming one silently would
 * break the client's stubbed sign-in, so the names are asserted here.
 */

import { describe, expect, it } from "vitest";
import {
  createFixtureIdentityPort,
  FixtureIdentityError,
  loadFixtureIdentityData,
  parseFixtureIdentityData,
  type FixtureIdentityData,
} from "./fixture-identity-port.js";

const CHEN = "f1c70000-0000-4000-8000-000000000001";
const OKAFOR = "f1c70000-0000-4000-8000-000000000002";

function wellFormed(): Record<string, unknown> {
  return {
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
    ],
  };
}

describe("the checked-in identity fixture map", () => {
  it("declares exactly the three tokens the API and the M3 client share", async () => {
    const data = await loadFixtureIdentityData();
    expect(data.sessions.map((session) => session.token)).toEqual([
      "fixture.dean.chen",
      "fixture.maya.chen",
      "fixture.owner.other",
    ]);
  });

  it("puts Dean and Maya in one household with owner/member roles, and the third owner elsewhere", async () => {
    const data = await loadFixtureIdentityData();
    const [dean, maya, other] = data.sessions;

    expect(dean?.householdId).toBe(CHEN);
    expect(dean?.role).toBe("owner");
    expect(dean?.displayInitials).toBe("DC");

    expect(maya?.householdId).toBe(CHEN);
    expect(maya?.role).toBe("member");
    expect(maya?.displayInitials).toBe("MC");

    expect(other?.householdId).toBe(OKAFOR);
    expect(other?.role).toBe("owner");
    expect(other?.householdId).not.toBe(dean?.householdId);
  });

  it("declares both households", async () => {
    const data = await loadFixtureIdentityData();
    expect(data.households.map((household) => household.householdId)).toEqual([CHEN, OKAFOR]);
  });
});

describe("fixture map validation", () => {
  it("accepts a well-formed map", () => {
    expect(parseFixtureIdentityData(wellFormed()).sessions).toHaveLength(1);
  });

  it.each([
    ["the root is not an object", [] as unknown],
    ["households is missing", { sessions: wellFormed()["sessions"] }],
    ["sessions is empty", { households: wellFormed()["households"], sessions: [] }],
  ])("refuses a map where %s", (_case, raw) => {
    expect(() => parseFixtureIdentityData(raw)).toThrow(FixtureIdentityError);
  });

  it("refuses a session pointing at an undeclared household", () => {
    const raw = wellFormed();
    (raw["sessions"] as Record<string, unknown>[])[0]!["householdId"] = OKAFOR;
    expect(() => parseFixtureIdentityData(raw)).toThrow(/is not a declared household/);
  });

  it("refuses a duplicated token", () => {
    const raw = wellFormed();
    const sessions = raw["sessions"] as Record<string, unknown>[];
    sessions.push({ ...sessions[0], userId: "f1c70001-0000-4000-8000-00000000000a" });
    expect(() => parseFixtureIdentityData(raw)).toThrow(/is declared twice/);
  });

  it("refuses a duplicated user id", () => {
    const raw = wellFormed();
    const sessions = raw["sessions"] as Record<string, unknown>[];
    sessions.push({ ...sessions[0], token: "fixture.other" });
    expect(() => parseFixtureIdentityData(raw)).toThrow(/userId .* is declared twice/);
  });

  it("refuses a non-UUID identifier", () => {
    const raw = wellFormed();
    (raw["sessions"] as Record<string, unknown>[])[0]!["userId"] = "dean";
    expect(() => parseFixtureIdentityData(raw)).toThrow(/must be a UUID/);
  });

  it("refuses a role outside owner/member", () => {
    const raw = wellFormed();
    (raw["sessions"] as Record<string, unknown>[])[0]!["role"] = "admin";
    expect(() => parseFixtureIdentityData(raw)).toThrow(/must be "owner" or "member"/);
  });

  it("refuses a missing display field rather than shipping a half-built identity", () => {
    const raw = wellFormed();
    delete (raw["sessions"] as Record<string, unknown>[])[0]!["email"];
    expect(() => parseFixtureIdentityData(raw)).toThrow(/email must be a non-empty string/);
  });
});

describe("resolveSession", () => {
  it("returns only the three opaque identifiers, never a name or an email", async () => {
    const data: FixtureIdentityData = await loadFixtureIdentityData();
    const port = createFixtureIdentityPort(data);
    const session = await port.resolveSession("fixture.dean.chen");

    expect(session).toEqual({
      userId: "f1c70001-0000-4000-8000-000000000001",
      householdId: CHEN,
      role: "owner",
    });
    expect(Object.keys(session ?? {}).sort()).toEqual(["householdId", "role", "userId"]);
  });

  it.each([
    ["an unknown token", "fixture.nobody"],
    ["the empty string", ""],
    ["a near miss on case", "Fixture.Dean.Chen"],
    ["a near miss on whitespace", " fixture.dean.chen"],
    ["a prefix of a real token", "fixture.dean"],
    ["a real token with a suffix", "fixture.dean.chen.extra"],
  ])("returns null for %s", async (_case, token) => {
    const port = createFixtureIdentityPort(await loadFixtureIdentityData());
    await expect(port.resolveSession(token)).resolves.toBeNull();
  });
});
