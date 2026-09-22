import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl } from "./env";

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
