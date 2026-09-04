import { describe, expect, it } from "vitest";
import { DOMAIN_PACKAGE_NAME } from "./index.js";

describe("packages/domain placeholder", () => {
  it("proves the test harness runs for this package", () => {
    expect(DOMAIN_PACKAGE_NAME).toBe("@smart-kitchen/domain");
  });
});
