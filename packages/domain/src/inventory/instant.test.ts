import { describe, expect, it } from "vitest";
import { ISO_INSTANT_RE, parseIsoInstantStrict } from "./instant.js";

describe("parseIsoInstantStrict (M9-T0 a)", () => {
  it("accepts real instants in every offset form", () => {
    expect(parseIsoInstantStrict("2026-09-14T12:00:00Z")).toBe(Date.UTC(2026, 8, 14, 12));
    expect(parseIsoInstantStrict("2026-09-14T12:00:00.123456789Z")).toBe(
      Date.UTC(2026, 8, 14, 12, 0, 0, 123),
    );
    expect(parseIsoInstantStrict("2026-09-14T14:00:00+02:00")).toBe(Date.UTC(2026, 8, 14, 12));
    expect(parseIsoInstantStrict("2028-02-29T00:00:00Z")).toBe(Date.UTC(2028, 1, 29));
  });

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-09-14T24:00:00Z",
    "2026-09-14T12:60:00Z",
    "2026-09-14T12:00:60Z",
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-09-00T00:00:00Z",
    "2026-09-14T12:00:00+24:00",
    "2026-09-14T12:00:00+05:60",
    "2026-09-14",
    "2026-09-14T12:00:00",
    "next tuesday",
    "",
  ])("refuses %s", (text) => {
    expect(parseIsoInstantStrict(text)).toBeUndefined();
  });

  it("refuses non-strings", () => {
    expect(parseIsoInstantStrict(undefined)).toBeUndefined();
    expect(parseIsoInstantStrict(20260914)).toBeUndefined();
    expect(parseIsoInstantStrict(null)).toBeUndefined();
  });

  it("exports the shape expression the parser uses", () => {
    expect(ISO_INSTANT_RE.test("2026-09-14T12:00:00Z")).toBe(true);
    expect(ISO_INSTANT_RE.test("2026-09-14")).toBe(false);
  });
});
