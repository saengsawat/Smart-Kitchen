import { describe, expect, it } from "vitest";
import { fixtureLookupProduct, formatScannedCodeDisplay, MISS_CODE } from "./fixture-products";

describe("fixtureLookupProduct", () => {
  it("resolves the tahini hit as BLOCKED for Maya, naming sesame (engine-generated, review F1/F2/F3)", () => {
    const result = fixtureLookupProduct("060000100810");
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.name.value).toBe("Stone-Ground Tahini");
    expect(result.product.screening.verdict).toBe("BLOCKED");
    const maya = result.product.screening.members.find((m) => m.memberId === "member-maya");
    expect(maya?.verdict).toBe("BLOCKED");
    expect(result.product.screening.evidence.some((e) => e.matchedText === "sesame")).toBe(true);
    // The engine also finds Maya's peanut unresolved on the same product —
    // both are real facts about this scan (review F3/F6/F7's point).
    expect(result.product.screening.unknowns).toHaveLength(1);
    expect(result.product.screening.unknowns[0]?.restrictionLabel).toBe("peanut");
    expect(result.product.bestBy).not.toBeNull(); // fixture-authored shelf-life estimate, added on top
  });

  it("resolves the eggs hit (no ingredient statement) as ALLOWED_WITH_UNKNOWNS for Maya's severe peanut and sesame", () => {
    const result = fixtureLookupProduct("060000100070");
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.ingredientsText).toBeUndefined();
    expect(result.product.screening.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.product.screening.evidence).toEqual([]);
    const labels = result.product.screening.unknowns.map((u) => u.restrictionLabel);
    expect(labels).toEqual(["peanut", "sesame"]);
    expect(result.product.screening.unknowns.every((u) => u.severity === "severe")).toBe(true);
  });

  it("resolves the chicken-breast hit (no allergen data at all, fractional 1.5 lb package) as ALLOWED_WITH_UNKNOWNS", () => {
    const result = fixtureLookupProduct("060000100100");
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.product.packageSize.value).toEqual({ qty: "1.5", unit: "lb" });
    expect(result.product.screening.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
  });

  it("no fixture product screens ALLOWED (D-017 gate b is open — no corpus record carries a declaration)", () => {
    for (const code of ["060000100810", "060000100070", "060000100100"]) {
      const result = fixtureLookupProduct(code);
      if (result.status !== "hit") throw new Error("expected a hit");
      expect(result.product.screening.verdict).not.toBe("ALLOWED");
    }
  });

  it("resolves the prototype's miss code as not-found", () => {
    const result = fixtureLookupProduct(MISS_CODE);
    expect(result.status).toBe("not-found");
  });

  it("resolves any other unrecognised code as not-found (a typed result, not an exception)", () => {
    expect(fixtureLookupProduct("000000000000").status).toBe("not-found");
  });
});

describe("formatScannedCodeDisplay", () => {
  it("groups the miss code the way the prototype's miss-panel shows it", () => {
    expect(formatScannedCodeDisplay(MISS_CODE)).toBe("0 40000 51907 3");
  });

  it("leaves a non-12-digit code unchanged", () => {
    expect(formatScannedCodeDisplay("4000")).toBe("4000");
  });
});
