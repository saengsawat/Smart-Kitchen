import { describe, expect, it } from "vitest";
import {
  gs1CheckDigit,
  validateBarcodeManifestEntry,
  validateCodeFormat,
  validateProductFixture,
} from "./schema.js";

const VALID_PROVENANCE = {
  tier: "KNOWN_FACT",
  source: "manufacturer-label",
  observedAt: "2026-08-15T00:00:00.000Z",
};

function validFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-001",
    kind: "BRANDED",
    codes: [{ codeType: "UPC_A", code: "012345678905" }],
    name: { value: "Test Product", provenance: VALID_PROVENANCE },
    nutrition: [],
    allergens: [],
    ...overrides,
  };
}

describe("gs1CheckDigit", () => {
  it("computes the textbook UPC-A check digit for 012345678905", () => {
    expect(gs1CheckDigit("01234567890")).toBe(5);
  });

  it("computes correctly for an EAN-13 (13-digit) code", () => {
    // 4006381333931 is a commonly-cited valid-checksum EAN-13 test number.
    expect(gs1CheckDigit("400638133393")).toBe(1);
  });
});

describe("validateCodeFormat", () => {
  it("accepts a well-formed UPC-A with a correct check digit", () => {
    expect(validateCodeFormat({ codeType: "UPC_A", code: "012345678905" })).toBeNull();
  });

  it("accepts a well-formed GTIN-13 with a correct check digit", () => {
    expect(validateCodeFormat({ codeType: "GTIN13", code: "4006381333931" })).toBeNull();
  });

  it("accepts a well-formed 4-digit PLU", () => {
    expect(validateCodeFormat({ codeType: "PLU", code: "4011" })).toBeNull();
  });

  it("accepts a well-formed 5-digit PLU", () => {
    expect(validateCodeFormat({ codeType: "PLU", code: "94011" })).toBeNull();
  });

  it("rejects a UPC-A with a wrong check digit", () => {
    const problem = validateCodeFormat({ codeType: "UPC_A", code: "012345678900" });
    expect(problem).not.toBeNull();
    expect(problem?.message).toMatch(/check-digit/);
  });

  it("rejects a code with the wrong length for its type", () => {
    const problem = validateCodeFormat({ codeType: "UPC_A", code: "123" });
    expect(problem).not.toBeNull();
    expect(problem?.message).toMatch(/12 numeric digits/);
  });

  it("rejects a non-numeric code", () => {
    const problem = validateCodeFormat({ codeType: "UPC_A", code: "01234567890X" });
    expect(problem).not.toBeNull();
  });

  it("rejects a PLU that is too short or too long", () => {
    expect(validateCodeFormat({ codeType: "PLU", code: "123" })).not.toBeNull();
    expect(validateCodeFormat({ codeType: "PLU", code: "123456" })).not.toBeNull();
  });

  it("rejects an unknown codeType", () => {
    const problem = validateCodeFormat({ codeType: "QR_CODE" as never, code: "012345678905" });
    expect(problem).not.toBeNull();
  });
});

describe("validateProductFixture — accepts well-formed fixtures", () => {
  it("accepts a minimal valid fixture", () => {
    const result = validateProductFixture(validFixture(), "test.json");
    expect(result.ok).toBe(true);
  });

  it("accepts a fixture with every optional field group present", () => {
    const result = validateProductFixture(
      validFixture({
        brand: { value: "Acme", provenance: VALID_PROVENANCE },
        category: { value: "pantry", provenance: VALID_PROVENANCE },
        packageSize: { value: { qty: 16, unit: "oz" }, provenance: VALID_PROVENANCE },
        servingSize: { value: { qty: 28, unit: "g" }, provenance: VALID_PROVENANCE },
        nutrition: [
          { basis: "PER_SERVING", values: { calories: 100 }, provenance: VALID_PROVENANCE },
        ],
        ingredientsText: { value: "Water, salt.", provenance: VALID_PROVENANCE },
        allergens: [{ allergenCode: "milk", assertion: "CONTAINS", provenance: VALID_PROVENANCE }],
        imageRef: { value: "https://fixtures.local/x.jpg", provenance: VALID_PROVENANCE },
      }),
      "test.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toHaveLength(1);
    expect(result.value.nutrition).toHaveLength(1);
  });

  it("accepts a confidence value on provenance", () => {
    const result = validateProductFixture(
      validFixture({
        name: { value: "Test Product", provenance: { ...VALID_PROVENANCE, confidence: 0.7 } },
      }),
      "test.json",
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateProductFixture — rejects malformed fixtures (negative cases)", () => {
  it("rejects a non-object", () => {
    const result = validateProductFixture("not-an-object", "test.json");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing id", () => {
    const fixture = validFixture();
    delete fixture["id"];
    const result = validateProductFixture(fixture, "test.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("test.json.id");
  });

  it("rejects an unknown kind", () => {
    const result = validateProductFixture(validFixture({ kind: "MYSTERY" }), "test.json");
    expect(result.ok).toBe(false);
  });

  it("rejects empty codes array", () => {
    const result = validateProductFixture(validFixture({ codes: [] }), "test.json");
    expect(result.ok).toBe(false);
  });

  it("rejects a code with a bad check digit", () => {
    const result = validateProductFixture(
      validFixture({ codes: [{ codeType: "UPC_A", code: "012345678901" }] }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a name missing provenance", () => {
    const result = validateProductFixture(validFixture({ name: { value: "Test" } }), "test.json");
    expect(result.ok).toBe(false);
  });

  it("rejects provenance with an unknown tier", () => {
    const result = validateProductFixture(
      validFixture({
        name: { value: "Test", provenance: { ...VALID_PROVENANCE, tier: "GUESSED" } },
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects provenance with confidence out of 0..1 range", () => {
    const result = validateProductFixture(
      validFixture({
        name: { value: "Test", provenance: { ...VALID_PROVENANCE, confidence: 1.5 } },
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects provenance with an unparseable observedAt", () => {
    const result = validateProductFixture(
      validFixture({
        name: { value: "Test", provenance: { ...VALID_PROVENANCE, observedAt: "not-a-date" } },
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a negative nutrition value", () => {
    const result = validateProductFixture(
      validFixture({
        nutrition: [
          { basis: "PER_SERVING", values: { calories: -5 }, provenance: VALID_PROVENANCE },
        ],
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown nutrition basis", () => {
    const result = validateProductFixture(
      validFixture({
        nutrition: [{ basis: "PER_CUP", values: {}, provenance: VALID_PROVENANCE }],
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown allergen assertion kind", () => {
    const result = validateProductFixture(
      validFixture({
        allergens: [{ allergenCode: "milk", assertion: "PROBABLY", provenance: VALID_PROVENANCE }],
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects nutrition that is not an array", () => {
    const fixture = validFixture();
    fixture["nutrition"] = "none";
    const result = validateProductFixture(fixture, "test.json");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive packageSize qty", () => {
    const result = validateProductFixture(
      validFixture({
        packageSize: { value: { qty: 0, unit: "oz" }, provenance: VALID_PROVENANCE },
      }),
      "test.json",
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateBarcodeManifestEntry", () => {
  it("accepts a well-formed hit entry", () => {
    const result = validateBarcodeManifestEntry(
      { code: "012345678905", codeType: "UPC_A", expect: "hit", productId: "test-001" },
      "manifest[0]",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed not-found entry with no productId", () => {
    const result = validateBarcodeManifestEntry(
      { code: "099999999990", codeType: "UPC_A", expect: "not-found" },
      "manifest[0]",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a hit entry with no productId", () => {
    const result = validateBarcodeManifestEntry(
      { code: "012345678905", codeType: "UPC_A", expect: "hit" },
      "manifest[0]",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an entry with a malformed code", () => {
    const result = validateBarcodeManifestEntry(
      { code: "123", codeType: "UPC_A", expect: "not-found" },
      "manifest[0]",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown expect value", () => {
    const result = validateBarcodeManifestEntry(
      { code: "012345678905", codeType: "UPC_A", expect: "maybe" },
      "manifest[0]",
    );
    expect(result.ok).toBe(false);
  });
});
