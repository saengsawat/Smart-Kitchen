import { describe, expect, it } from "vitest";
import { CLIENT_KEY } from "./client-key.js";

describe("CLIENT_KEY (M9-T0 c)", () => {
  it.each(["a", "k-1_2.3", "A".repeat(128)])("accepts %s", (key) => {
    expect(CLIENT_KEY.test(key)).toBe(true);
  });

  it.each(["", "A".repeat(129), "a::b", "a/lot/1", "a b", "a\n", "ü"])("refuses %j", (key) => {
    expect(CLIENT_KEY.test(key)).toBe(false);
  });
});
