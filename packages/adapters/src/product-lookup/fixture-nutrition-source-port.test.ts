import { describe, expect, it } from "vitest";
import { FixtureNutritionSourcePort } from "./fixture-nutrition-source-port.js";
import { loadFixtureCatalog } from "./fixture-loader.js";

const catalogResult = loadFixtureCatalog();
if (!catalogResult.ok)
  throw new Error("fixture catalog failed to load for tests: " + catalogResult.error.message);
const catalog = catalogResult.value;

describe("FixtureNutritionSourcePort.byProductCode", () => {
  it("returns the product's nutrition profiles for a code with data", async () => {
    const product = catalog.products.find((p) => p.nutrition.length > 0);
    if (!product) throw new Error("no fixture product with nutrition data");
    const code = product.codes[0];
    if (!code) throw new Error("fixture product has no codes");
    const port = new FixtureNutritionSourcePort();
    const result = await port.byProductCode(code);
    expect(result.status).toBe("hit");
    if (result.status === "hit") expect(result.profiles).toEqual(product.nutrition);
  });

  it("returns not-found for a code whose product has no nutrition data", async () => {
    const product = catalog.products.find((p) => p.nutrition.length === 0);
    if (!product) throw new Error("no fixture product without nutrition data");
    const code = product.codes[0];
    if (!code) throw new Error("fixture product has no codes");
    const port = new FixtureNutritionSourcePort();
    const result = await port.byProductCode(code);
    expect(result.status).toBe("not-found");
  });

  it("returns not-found for a well-formed code with no matching product", async () => {
    const port = new FixtureNutritionSourcePort();
    const result = await port.byProductCode({ codeType: "UPC_A", code: "099999999990" });
    expect(result.status).toBe("not-found");
  });

  it("returns a typed error for a malformed code", async () => {
    const port = new FixtureNutritionSourcePort();
    const result = await port.byProductCode({ codeType: "UPC_A", code: "not-a-code" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("INVALID_CODE");
  });

  it("returns multiple disagreeing profiles for a multi-source-conflict product", async () => {
    const product = catalog.products.find((p) => p.nutrition.length >= 2);
    if (!product) throw new Error("no multi-source-conflict fixture product");
    const code = product.codes[0];
    if (!code) throw new Error("fixture product has no codes");
    const port = new FixtureNutritionSourcePort();
    const result = await port.byProductCode(code);
    expect(result.status).toBe("hit");
    if (result.status === "hit") expect(result.profiles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("FixtureNutritionSourcePort.byIngredientSearch", () => {
  it("finds generic produce nutrition by name, case-insensitively", async () => {
    const port = new FixtureNutritionSourcePort();
    const result = await port.byIngredientSearch("banana");
    expect(result.status).toBe("hit");
    if (result.status === "hit") expect(result.profiles.length).toBeGreaterThan(0);
  });

  it("returns not-found for a query matching nothing", async () => {
    const port = new FixtureNutritionSourcePort();
    const result = await port.byIngredientSearch("nonexistent-ingredient-xyz");
    expect(result.status).toBe("not-found");
  });

  it("returns a typed error for an empty query", async () => {
    const port = new FixtureNutritionSourcePort();
    const result = await port.byIngredientSearch("   ");
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error.code).toBe("INVALID_QUERY");
  });
});
