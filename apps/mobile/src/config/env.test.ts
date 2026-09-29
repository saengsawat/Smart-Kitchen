import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl, getIdentityToken } from "./env";

/**
 * `getApiBaseUrl` reads `process.env` directly, and `src/config/env.ts` is
 * the one file in this app allowed to do that (eslint.config.js's
 * single-file exemption). This test file is not exempted, so it drives the
 * variable through `vi.stubEnv`/`vi.unstubAllEnvs` (a normal vitest API
 * call, not a reference to the `process` identifier or `globalThis.process`)
 * rather than reaching into `process.env` itself.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getApiBaseUrl", () => {
  it("returns null when EXPO_PUBLIC_API_URL is unset", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", undefined);
    expect(getApiBaseUrl()).toBeNull();
  });

  it("returns null when EXPO_PUBLIC_API_URL is whitespace-only", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "   ");
    expect(getApiBaseUrl()).toBeNull();
  });

  it("returns the trimmed URL when set", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "  http://localhost:4000  ");
    expect(getApiBaseUrl()).toBe("http://localhost:4000");
  });
});

describe("getIdentityToken (M3-T4d Objective (e))", () => {
  it("returns the fixture.dean.chen default when EXPO_PUBLIC_IDENTITY_TOKEN is unset", () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", undefined);
    expect(getIdentityToken()).toBe("fixture.dean.chen");
  });

  it("returns the same default when the variable is whitespace-only", () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "   ");
    expect(getIdentityToken()).toBe("fixture.dean.chen");
  });

  it("returns the trimmed configured token when set, e.g. the fresh-user fixture identity", () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "  fixture.new.user  ");
    expect(getIdentityToken()).toBe("fixture.new.user");
  });

  it("returns any other configured token as-is (e.g. Maya's), trimmed", () => {
    vi.stubEnv("EXPO_PUBLIC_IDENTITY_TOKEN", "fixture.maya.chen");
    expect(getIdentityToken()).toBe("fixture.maya.chen");
  });
});
