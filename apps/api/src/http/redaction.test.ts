/**
 * The log redaction denylist (M2-T1, ARCHITECTURE.md §7.15).
 *
 * Tested directly rather than only through log output, so a regression names
 * the key it stopped redacting instead of showing up as "a string appeared in a
 * log line somewhere".
 */

import { describe, expect, it } from "vitest";
import {
  isDeniedKey,
  isSerializedError,
  normalizeKey,
  REDACTED,
  REDACTED_EMAIL,
  REDACTED_TOKEN,
  redactError,
  redactLogObject,
  redactLogRecord,
  redactString,
} from "./redaction.js";

describe("normalizeKey", () => {
  it.each([
    ["displayName", "displayname"],
    ["display_name", "displayname"],
    ["DISPLAY-NAME", "displayname"],
    ["x-household-id", "xhouseholdid"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeKey(input)).toBe(expected);
  });
});

describe("isDeniedKey", () => {
  it.each([
    "name",
    "displayName",
    "display_name",
    "firstName",
    "lastName",
    "fullName",
    "username",
    "displayInitials",
    "email",
    "emailAddress",
    "user_email",
    "token",
    "accessToken",
    "refresh_token",
    "bearerToken",
    "authorization",
    "password",
    "apiKey",
    "secret",
    "allergies",
    "allergyRestrictions",
    "allergens",
    "dateOfBirth",
    "weight",
    "height",
    "sex",
    "profile",
    "memberProfile",
    "headers",
    "body",
    "query",
    "cookies",
  ])("denies %s", (key) => {
    expect(isDeniedKey(key)).toBe(true);
  });

  it.each([
    "userId",
    "householdId",
    "itemId",
    "correlationId",
    "reqId",
    "statusCode",
    "method",
    "routePath",
    "durationMs",
    "role",
    "reason",
    "msg",
    "level",
  ])("allows the operational field %s", (key) => {
    expect(isDeniedKey(key)).toBe(false);
  });
});

describe("redactString", () => {
  it("removes an email address wherever it appears", () => {
    expect(redactString("duplicate key (email)=(dean.chen@fixture.invalid) already exists")).toBe(
      `duplicate key (email)=(${REDACTED_EMAIL}) already exists`,
    );
  });

  it("removes every email in a string, not just the first", () => {
    const out = redactString("a@b.test and c@d.test");
    expect(out).not.toContain("@b.test");
    expect(out).not.toContain("@d.test");
  });

  it("removes a bearer credential", () => {
    expect(redactString("Authorization: Bearer fixture.dean.chen")).toBe(
      `Authorization: ${REDACTED_TOKEN}`,
    );
  });

  it("removes a bearer credential whatever its case", () => {
    expect(redactString("bearer fixture.dean.chen")).toBe(REDACTED_TOKEN);
  });

  it("leaves an ordinary message alone", () => {
    expect(redactString("request.completed")).toBe("request.completed");
  });

  it("does not mistake a pnpm store path for an email address", () => {
    const frame =
      "at handler (/repo/node_modules/.pnpm/fastify@5.12.1/node_modules/fastify/lib/handleRequest.js:105:7)";
    expect(redactString(frame)).toBe(frame);
  });

  it("does not mistake a scoped package specifier for an email address", () => {
    expect(redactString("import from @smart-kitchen/contracts/dist/index.js")).toBe(
      "import from @smart-kitchen/contracts/dist/index.js",
    );
  });

  it("still catches an address sitting next to a path", () => {
    expect(redactString("/repo/x.js: dean.chen@fixture.invalid")).toBe(
      `/repo/x.js: ${REDACTED_EMAIL}`,
    );
  });
});

describe("redactError", () => {
  it("reduces an Error to three scrubbed strings", () => {
    const out = redactError(new Error("key (email)=(a@b.test)"));
    expect(out.type).toBe("Error");
    expect(out.message).toBe(`key (email)=(${REDACTED_EMAIL})`);
    expect(out.stack).toContain("Error:");
  });

  it("names a subclass by its own name", () => {
    class LedgerError extends Error {
      constructor() {
        super("boom");
        this.name = "LedgerError";
      }
    }
    expect(redactError(new LedgerError()).type).toBe("LedgerError");
  });

  it("is idempotent, so a second pass through a serializer cannot mangle it", () => {
    const once = redactError(new Error("a@b.test"));
    expect(redactError(once)).toBe(once);
    expect(redactError(redactError(once)).type).toBe("Error");
  });

  it("handles a thrown non-Error without pretending it is one", () => {
    expect(redactError("just a string")).toEqual({
      type: "NonError",
      message: "just a string",
      stack: "",
    });
  });
});

describe("isSerializedError", () => {
  it.each([
    ["a real Error", new Error("x")],
    ["a plain object", { type: "Error" }],
    ["null", null],
    ["a string", "Error"],
  ])("rejects %s", (_case, value) => {
    expect(isSerializedError(value)).toBe(false);
  });

  it("accepts its own output", () => {
    expect(isSerializedError(redactError(new Error("x")))).toBe(true);
  });
});

describe("redactLogRecord", () => {
  it("replaces a denied key's value whatever its type", () => {
    expect(
      redactLogRecord({ displayName: "Dean Chen", allergies: ["peanut"], weight: 74 }),
    ).toEqual({ displayName: REDACTED, allergies: REDACTED, weight: REDACTED });
  });

  it("keeps the identifiers a denial audit needs", () => {
    const record = {
      correlationId: "0199-7",
      userId: "f1c70001-0000-4000-8000-000000000001",
      householdId: "f1c70000-0000-4000-8000-000000000001",
      role: "owner",
    };
    expect(redactLogRecord(record)).toEqual(record);
  });

  it("recurses into nested objects and arrays", () => {
    expect(
      redactLogRecord({ members: [{ id: "u1", email: "a@b.test", profile: { weight: 70 } }] }),
    ).toEqual({ members: [{ id: "u1", email: REDACTED, profile: REDACTED }] });
  });

  it("scrubs a personal-data shape hiding in an allowed key's value", () => {
    expect(redactLogRecord({ msg: "rejected dean.chen@fixture.invalid" })).toEqual({
      msg: `rejected ${REDACTED_EMAIL}`,
    });
  });

  it("reshapes an Error into type, message and stack, all scrubbed", () => {
    const error = new Error("no user for dean.chen@fixture.invalid");
    const out = redactLogRecord({ err: error }) as { err: Record<string, unknown> };

    expect(out.err["type"]).toBe("Error");
    expect(out.err["message"]).toBe(`no user for ${REDACTED_EMAIL}`);
    expect(String(out.err["stack"])).not.toContain("@fixture.invalid");
  });

  it("survives a cycle rather than throwing inside the logger", () => {
    const cyclic: Record<string, unknown> = { id: "x" };
    cyclic["self"] = cyclic;
    expect(redactLogRecord(cyclic)).toEqual({ id: "x", self: "[circular]" });
  });

  it("truncates rather than walking an unbounded structure", () => {
    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let i = 0; i < 20; i += 1) deep = { next: deep };
    expect(JSON.stringify(redactLogRecord(deep))).toContain("[truncated]");
  });

  it("leaves primitives and null alone", () => {
    expect(redactLogRecord({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });
});

describe("redactLogObject", () => {
  it("always hands pino an object back", () => {
    expect(redactLogObject({ userId: "u1" })).toEqual({ userId: "u1" });
  });
});
