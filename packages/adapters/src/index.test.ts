import { describe, expect, it } from "vitest";
import { ADAPTERS_PACKAGE_NAME } from "./index.js";

describe("packages/adapters placeholder", () => {
  it("proves the test harness runs for this package", () => {
    expect(ADAPTERS_PACKAGE_NAME).toBe("@smart-kitchen/adapters");
  });
});
