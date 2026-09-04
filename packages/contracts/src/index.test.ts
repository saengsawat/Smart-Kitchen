import { describe, expect, it } from "vitest";
import { CONTRACTS_PACKAGE_NAME } from "./index.js";

describe("packages/contracts placeholder", () => {
  it("proves the test harness runs for this package", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@smart-kitchen/contracts");
  });
});
