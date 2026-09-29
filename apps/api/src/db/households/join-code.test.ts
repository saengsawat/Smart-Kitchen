/** Join code format, generation, hashing and pepper resolution (M2-T3 (f)). Pure; no database. */

import { describe, expect, it } from "vitest";
import {
  CHEN_FIXTURE_JOIN_CODE,
  createJoinCodeHasher,
  DEVELOPMENT_JOIN_CODE_PEPPER,
  generateJoinCode,
  JOIN_CODE_DIGITS,
  JOIN_CODE_LETTERS,
  JOIN_CODE_PATTERN,
  JOIN_CODE_PEPPER_ENV_VAR,
  JoinCodeConfigurationError,
  MIN_JOIN_CODE_PEPPER_LENGTH,
  normalizeJoinCode,
  resolveJoinCodePepper,
} from "./join-code.js";

describe("alphabet", () => {
  it("has no look-alike characters", () => {
    for (const ambiguous of ["I", "O"]) expect(JOIN_CODE_LETTERS).not.toContain(ambiguous);
    for (const ambiguous of ["0", "1"]) expect(JOIN_CODE_DIGITS).not.toContain(ambiguous);
    expect(JOIN_CODE_LETTERS).toHaveLength(24);
    expect(JOIN_CODE_DIGITS).toHaveLength(8);
  });

  it("accepts the mobile fixture's code as a well-formed code", () => {
    expect(JOIN_CODE_PATTERN.test(CHEN_FIXTURE_JOIN_CODE)).toBe(true);
  });
});

describe("generateJoinCode", () => {
  it("produces XXXX-NNN from the unambiguous alphabet", () => {
    for (let run = 0; run < 500; run += 1) {
      expect(generateJoinCode()).toMatch(JOIN_CODE_PATTERN);
    }
  });

  it("draws every position from the injected source (lowest and highest index)", () => {
    expect(generateJoinCode(() => 0)).toBe("AAAA-222");
    expect(generateJoinCode((max) => max - 1)).toBe("ZZZZ-999");
  });

  it("is not constant", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateJoinCode()));
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe("normalizeJoinCode", () => {
  it("trims and upper-cases", () => {
    expect(normalizeJoinCode("  chen-482 \n")).toBe("CHEN-482");
  });

  it.each([
    ["empty", ""],
    ["no hyphen", "CHEN482"],
    ["an ambiguous letter", "CHIN-482"],
    ["an ambiguous digit", "CHEN-481"],
    ["too long", "CHENS-482"],
    ["too short", "CHE-482"],
    ["inner space", "CHEN -482"],
    ["a unicode look-alike", "CHЕN-482"],
  ])("refuses %s", (_case, input) => {
    expect(normalizeJoinCode(input)).toBeUndefined();
  });
});

describe("createJoinCodeHasher", () => {
  it("is deterministic under one pepper and differs across peppers", () => {
    const a = createJoinCodeHasher("a".repeat(40));
    const b = createJoinCodeHasher("b".repeat(40));
    expect(a.hash("CHEN-482")).toBe(a.hash("CHEN-482"));
    expect(a.hash("CHEN-482")).not.toBe(b.hash("CHEN-482"));
    expect(a.hash("CHEN-482")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the plaintext or a plain SHA-256 of it", async () => {
    const { createHash } = await import("node:crypto");
    const hashed = createJoinCodeHasher(DEVELOPMENT_JOIN_CODE_PEPPER).hash("CHEN-482");
    expect(hashed).not.toContain("CHEN");
    expect(hashed).not.toBe(createHash("sha256").update("CHEN-482").digest("hex"));
  });

  it("refuses an empty pepper", () => {
    expect(() => createJoinCodeHasher("")).toThrow(JoinCodeConfigurationError);
  });
});

describe("resolveJoinCodePepper", () => {
  const strong = "x".repeat(MIN_JOIN_CODE_PEPPER_LENGTH);

  it("uses the configured pepper when it is long enough", () => {
    expect(
      resolveJoinCodePepper({ [JOIN_CODE_PEPPER_ENV_VAR]: strong, NODE_ENV: "production" }),
    ).toBe(strong);
  });

  it("refuses a short pepper, naming the variable and not the value", () => {
    const short = "short-pepper-value";
    try {
      resolveJoinCodePepper({ [JOIN_CODE_PEPPER_ENV_VAR]: short });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JoinCodeConfigurationError);
      expect(String(error)).toContain(JOIN_CODE_PEPPER_ENV_VAR);
      expect(String(error)).not.toContain(short);
    }
  });

  it.each([[undefined], ["development"], ["test"]])(
    "falls back to the public development pepper with NODE_ENV=%s",
    (nodeEnv) => {
      const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      expect(resolveJoinCodePepper(env)).toBe(DEVELOPMENT_JOIN_CODE_PEPPER);
    },
  );

  it.each([["production"], ["staging"], ["Production "]])(
    "refuses to fall back with NODE_ENV=%s",
    (nodeEnv) => {
      expect(() => resolveJoinCodePepper({ NODE_ENV: nodeEnv })).toThrow(
        JoinCodeConfigurationError,
      );
    },
  );
});
