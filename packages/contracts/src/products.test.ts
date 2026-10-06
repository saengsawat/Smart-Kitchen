import { describe, expect, it } from "vitest";
import {
  SCANNABLE_BARCODE_TYPES_DTO,
  asScannableBarcodeType,
  productLookupPath,
} from "./products.js";

describe("productLookupPath (M2-T4c)", () => {
  it("builds the bare path without a symbology", () => {
    expect(productLookupPath("096619555505")).toBe("/v1/products/096619555505");
  });

  it("adds the symbology as the type query parameter", () => {
    expect(productLookupPath("01234565", "upc_e")).toBe("/v1/products/01234565?type=upc_e");
  });

  it("still encodes the code", () => {
    expect(productLookupPath("a/b", "ean8")).toBe("/v1/products/a%2Fb?type=ean8");
  });
});

describe("asScannableBarcodeType (M2-T4c)", () => {
  it("accepts every scannable type", () => {
    for (const type of SCANNABLE_BARCODE_TYPES_DTO) {
      expect(asScannableBarcodeType(type)).toBe(type);
    }
  });

  it("drops anything else", () => {
    for (const value of ["code128", "UPC_A", "", "ean13 ", undefined, null, 8, ["ean8"]]) {
      expect(asScannableBarcodeType(value)).toBeUndefined();
    }
  });
});
