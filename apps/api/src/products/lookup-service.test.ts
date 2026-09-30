/**
 * Code parsing for the product lookup route (M2-T4b): UPC-E expansion,
 * GTIN-14, PLU and the refusals. Pure, no network.
 */

import { describe, expect, it } from "vitest";
import { expandUpcEToUpcA, parseLookupCode } from "./lookup-service.js";

/** GS1 check digit of an 11 or 12 digit body, independent of the code under test. */
function gs1(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

describe("expandUpcEToUpcA: the GS1 zero-suppression table, one row per d6 class", () => {
  const rows: readonly (readonly [string, string, string])[] = [
    // [UPC-E 7 digit body N d1..d6, UPC-A 11 digit body, label]
    ["0123450", "01200000345", "d6=0"],
    ["0123451", "01210000345", "d6=1"],
    ["0123452", "01220000345", "d6=2"],
    ["0123453", "01230000045", "d6=3"],
    ["0123454", "01234000005", "d6=4"],
    ["0123455", "01234500005", "d6=5"],
    ["0123459", "01234500009", "d6=9"],
    ["1123450", "11200000345", "number system 1, d6=0"],
  ];

  it.each(rows)("%s expands to %s (%s) when the check digit holds", (eBody, aBody) => {
    const check = gs1(aBody);
    expect(expandUpcEToUpcA(`${eBody}${String(check)}`)).toBe(`${aBody}${String(check)}`);
  });

  it.each(rows)("%s with a wrong check digit is refused (%s)", (eBody, aBody) => {
    const wrong = (gs1(aBody) + 1) % 10;
    expect(expandUpcEToUpcA(`${eBody}${String(wrong)}`)).toBeUndefined();
  });

  it("the recorded pair: 04446307 is 044000004637", () => {
    expect(expandUpcEToUpcA("04446307")).toBe("044000004637");
  });

  it.each([
    "",
    "0444630",
    "044463071",
    "2444630 7",
    "24446307",
    "9444630a",
    "0444630x",
    "０４４４６３０７",
  ])("%j is refused (wrong length, non-numeric, or number system not 0 or 1)", (raw) => {
    expect(expandUpcEToUpcA(raw)).toBeUndefined();
  });
});

describe("parseLookupCode", () => {
  it("EAN-8 wins when its own check digit holds", () => {
    expect(parseLookupCode("96385074")).toEqual({
      kind: "barcode",
      code: { codeType: "EAN8", code: "96385074" },
    });
  });

  it("known limitation: a UPC-E whose check digit also satisfies the EAN-8 test reads as EAN-8", () => {
    // 04016007 is the UPC-E of 040000001607 and also a valid EAN-8. The phone
    // sends digits only, so the two cannot be told apart; EAN-8 wins.
    expect(expandUpcEToUpcA("04016007")).toBe("040000001607");
    expect(parseLookupCode("04016007")).toEqual({
      kind: "barcode",
      code: { codeType: "EAN8", code: "04016007" },
    });
  });

  it("a UPC-E that is not a valid EAN-8 is looked up as its UPC-A", () => {
    expect(parseLookupCode("04446307")).toEqual({
      kind: "barcode",
      code: { codeType: "UPC_A", code: "044000004637" },
    });
  });

  it("an 8-digit code valid as neither is invalid", () => {
    expect(parseLookupCode("04446308")).toEqual({ kind: "invalid" });
    expect(parseLookupCode("24446307")).toEqual({ kind: "invalid" });
  });

  it("GTIN-14: indicator 0 looks up as the EAN-13, any other indicator is invalid", () => {
    expect(parseLookupCode("00096619555505")).toEqual({
      kind: "barcode",
      code: { codeType: "EAN13", code: "0096619555505" },
    });
    expect(parseLookupCode("10096619555502")).toEqual({ kind: "invalid" });
  });

  it("a 14-digit code with indicator 0 and a bad check digit is invalid", () => {
    expect(parseLookupCode("00096619555504")).toEqual({ kind: "invalid" });
  });

  it("PLUs, letters and odd lengths keep their old answers", () => {
    expect(parseLookupCode("4011")).toEqual({ kind: "plu" });
    expect(parseLookupCode("94011")).toEqual({ kind: "plu" });
    expect(parseLookupCode("abc")).toEqual({ kind: "invalid" });
    expect(parseLookupCode("123456789")).toEqual({ kind: "invalid" });
    expect(parseLookupCode("096619555505")).toEqual({
      kind: "barcode",
      code: { codeType: "UPC_A", code: "096619555505" },
    });
  });
});
