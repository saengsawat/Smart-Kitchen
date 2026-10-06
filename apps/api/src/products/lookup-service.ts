/**
 * Product lookup for a household (M2-T4a (c)): the join of "what the catalog
 * source says about this code" and "what screening concluded for this
 * household", in the shape S8 renders.
 *
 * Three pieces, kept apart on purpose so M2-T4 can plug the allergen engine
 * in without touching the adapter:
 *
 * 1. {@link parseLookupCode}: the path segment to a `ProductCode`, or a
 *    refusal. A 4 or 5 digit code is a PLU and never reaches a barcode
 *    source (ADR-006).
 * 2. the `ProductLookupPort` (Open Food Facts in production, anything in a
 *    test), which answers `hit`, `not-found` or `error`;
 * 3. a {@link ProductScreeningStep}, which today always answers `NOT_RUN`
 *    because the server stores no restrictions yet ({@link notRunScreening}).
 *    M2-T4 swaps in a step that runs the engine against the household's
 *    restrictions; nothing else here changes.
 */

import type {
  FieldProvenance,
  ProductCatalogItem,
  ProductCode,
  ProductLookupPort,
  Provenanced,
} from "@smart-kitchen/adapters";
import type {
  FieldProvenanceDto,
  ProductLookupResultDto,
  ProvenancedDto,
  ScannedProductDto,
  ScreeningOutcomeDto,
} from "@smart-kitchen/contracts";
import type { Session } from "../identity/index.js";

export type ParsedLookupCode =
  | { readonly kind: "barcode"; readonly code: ProductCode }
  | { readonly kind: "plu" }
  | { readonly kind: "invalid" };

/**
 * GS1 mod-10 check digit, the same algorithm for EAN-8, UPC-A, EAN-13 and
 * GTIN-14 (it reads from the right, so leading zeros never change it).
 */
function checkDigitHolds(digits: string): boolean {
  let sum = 0;
  for (let i = 1; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * UPC-E to UPC-A expansion (M2-T4b (a)).
 *
 * Source: the GS1 UPC-E zero-suppression table (GS1 General Specifications,
 * "UPC-E"; also tabulated on Wikipedia's "Universal Product Code" article).
 * An 8-digit UPC-E is `N d1 d2 d3 d4 d5 d6 C`: number system `N` (0 or 1),
 * six data digits and the check digit `C`. The last data digit `d6` says how
 * the zeros were removed; the 11-digit UPC-A body is `N` + a 5-digit
 * manufacturer code + a 5-digit product code:
 *
 * - d6 in 0, 1, 2: manufacturer `d1 d2 d6 0 0`, product `0 0 d3 d4 d5`
 * - d6 = 3: manufacturer `d1 d2 d3 0 0`, product `0 0 0 d4 d5`
 * - d6 = 4: manufacturer `d1 d2 d3 d4 0`, product `0 0 0 0 d5`
 * - d6 in 5 to 9: manufacturer `d1 d2 d3 d4 d5`, product `0 0 0 0 d6`
 *
 * The printed check digit is not trusted: the GS1 check digit of the
 * expanded 12 digits must hold, otherwise the code is refused, never
 * guessed. A number system other than 0 or 1 is refused.
 */
export function expandUpcEToUpcA(raw: string): string | undefined {
  if (!/^[01]\d{7}$/.test(raw)) return undefined;
  const ns = raw[0] ?? "";
  const d = raw.slice(1, 7);
  const d6 = d[5] ?? "";
  const check = raw[7] ?? "";
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") {
    body = `${ns}${d.slice(0, 2)}${d6}00` + `00${d.slice(2, 5)}`;
  } else if (d6 === "3") {
    body = `${ns}${d.slice(0, 3)}00` + `000${d.slice(3, 5)}`;
  } else if (d6 === "4") {
    body = `${ns}${d.slice(0, 4)}0` + `0000${d.slice(4, 5)}`;
  } else {
    body = `${ns}${d.slice(0, 5)}` + `0000${d6}`;
  }
  const upcA = `${body}${check}`;
  return checkDigitHolds(upcA) ? upcA : undefined;
}

/**
 * Parses `raw` as exactly the symbology the camera read (M2-T4c). The hint
 * only narrows: a code that fails that symbology's length or check digit is
 * invalid (never retried as another symbology), and an unknown `type` is
 * invalid. `upc_e` expands to its UPC-A; `ean8` stays EAN-8.
 */
function parseAsSymbology(raw: string, type: string): ParsedLookupCode {
  const invalid: ParsedLookupCode = { kind: "invalid" };
  switch (type) {
    case "upc_e": {
      const expanded = expandUpcEToUpcA(raw);
      return expanded === undefined
        ? invalid
        : { kind: "barcode", code: { codeType: "UPC_A", code: expanded } };
    }
    case "ean8":
      return raw.length === 8 && checkDigitHolds(raw)
        ? { kind: "barcode", code: { codeType: "EAN8", code: raw } }
        : invalid;
    case "upc_a":
      return raw.length === 12 && checkDigitHolds(raw)
        ? { kind: "barcode", code: { codeType: "UPC_A", code: raw } }
        : invalid;
    case "ean13":
      return raw.length === 13 && checkDigitHolds(raw)
        ? { kind: "barcode", code: { codeType: "EAN13", code: raw } }
        : invalid;
    default:
      return invalid;
  }
}

/**
 * The path segment, validated.
 *
 * - 4 or 5 digits: a PLU, refused (`PLU_NOT_SUPPORTED`), never sent anywhere.
 * - 8 digits: the phone sends only the digits, not the symbology, so an
 *   8-digit string is read by its first digit (M2-T4b review ruling F2). A
 *   leading `0`: a UPC-E first (expanded to its UPC-A by
 *   {@link expandUpcEToUpcA} and looked up as that) when the expansion's check
 *   digit holds, otherwise an EAN-8 when its own check digit holds, otherwise
 *   invalid. GS1-8 prefixes 000 to 099 are Restricted Circulation Numbers,
 *   never global GTIN-8s, so a leading-0 EAN-8 read against Open Food Facts
 *   would be a miss or a wrong store-internal item, while about 58% of valid
 *   UPC-Es also pass the EAN-8 check. A leading `1`: an EAN-8 first, then a
 *   UPC-E. Any other first digit: an EAN-8 only (UPC-E number systems are 0
 *   and 1).
 * - 12 or 13 digits with a valid check digit: UPC-A, EAN-13.
 * - 14 digits with a valid check digit and a leading `0`: a GTIN-14 whose
 *   packaging indicator is 0 is the GTIN-13 in its last 13 digits (OFF's own
 *   barcode-normalization note), looked up as that EAN-13. A GTIN-14 with
 *   any other indicator names a case or a pallet, not something a household
 *   scans, and is refused as invalid. The route always looks the
 *   code up as that EAN-13; a GTIN14 handed straight to a port is normalised
 *   the same way by the port itself (M2-T4c).
 * - anything else, including a bad check digit: invalid.
 *
 * With a `type` hint (M2-T4c) none of the above guessing happens: the code is
 * parsed as that symbology only, see {@link parseAsSymbology}. `11234502`
 * without a hint is the leading-1 UPC-E fallback: it fails the EAN-8 check,
 * so it parses as UPC-A `112000003452` (pinned in a test).
 */
export function parseLookupCode(raw: string, type?: string): ParsedLookupCode {
  if (!/^\d+$/.test(raw)) return { kind: "invalid" };
  if (type !== undefined) return parseAsSymbology(raw, type);
  if (raw.length === 4 || raw.length === 5) return { kind: "plu" };
  if (raw.length === 8) {
    const asEan8: ParsedLookupCode | undefined = checkDigitHolds(raw)
      ? { kind: "barcode", code: { codeType: "EAN8", code: raw } }
      : undefined;
    const expanded = expandUpcEToUpcA(raw);
    const asUpcE: ParsedLookupCode | undefined =
      expanded === undefined
        ? undefined
        : { kind: "barcode", code: { codeType: "UPC_A", code: expanded } };
    const ordered = raw.startsWith("0") ? [asUpcE, asEan8] : [asEan8, asUpcE];
    return ordered.find((c) => c !== undefined) ?? { kind: "invalid" };
  }
  if (![12, 13, 14].includes(raw.length) || !checkDigitHolds(raw)) return { kind: "invalid" };
  switch (raw.length) {
    case 12:
      return { kind: "barcode", code: { codeType: "UPC_A", code: raw } };
    case 13:
      return { kind: "barcode", code: { codeType: "EAN13", code: raw } };
    default:
      return raw.startsWith("0")
        ? { kind: "barcode", code: { codeType: "EAN13", code: raw.slice(1) } }
        : { kind: "invalid" };
  }
}

/** Decides the screening outcome for one looked-up product and one caller's household. */
export interface ProductScreeningStep {
  screen(product: ProductCatalogItem, session: Session): Promise<ScreeningOutcomeDto>;
}

/**
 * Until M2-T4 stores restrictions on the server, screening cannot run, and
 * the response says so explicitly rather than carrying any verdict (D-025).
 */
export const notRunScreening: ProductScreeningStep = {
  screen: () => Promise.resolve({ status: "NOT_RUN", reason: "HOUSEHOLD_RESTRICTIONS_NOT_STORED" }),
};

/** The one sentence an `error` result carries. The source's own detail never leaves the server. */
export const LOOKUP_ERROR_MESSAGE =
  "The product database didn't answer. Try again in a moment, or add the item by hand.";

function provenanceDto(p: FieldProvenance): FieldProvenanceDto {
  return {
    tier: p.tier,
    source: p.source,
    confidence: p.confidence === undefined ? null : String(p.confidence),
    recordedAt: p.observedAt,
  };
}

function provenanced<T>(field: Provenanced<T>): ProvenancedDto<T> {
  return { value: field.value, provenance: provenanceDto(field.provenance) };
}

/**
 * Catalog item -> S8's DTO. Tiers pass through unchanged (the adapter already
 * stamped them), nothing absent is filled in, and `bestBy` is `null`: no
 * source here knows a shelf life (M8). The item's image and category are not
 * forwarded: S8 renders neither, and product photos carry their own licence
 * question (OQ-D8, R-4).
 */
export function toScannedProductDto(
  item: ProductCatalogItem,
  screening: ScreeningOutcomeDto,
): ScannedProductDto {
  return {
    productId: item.id,
    codes: item.codes.map((c) => ({ codeType: c.codeType, code: c.code })),
    name: provenanced(item.name),
    ...(item.brand === undefined ? {} : { brand: provenanced(item.brand) }),
    ...(item.packageSize === undefined
      ? {}
      : {
          packageSize: {
            // Decimal text on the wire (contracts rule 2). The adapter's parser
            // only produces short decimals, which print back exactly.
            value: { qty: String(item.packageSize.value.qty), unit: item.packageSize.value.unit },
            provenance: provenanceDto(item.packageSize.provenance),
          },
        }),
    nutrition: item.nutrition.map((n) => ({
      basis: n.basis,
      values: { ...n.values },
      provenance: provenanceDto(n.provenance),
    })),
    ...(item.ingredientsText === undefined
      ? {}
      : { ingredientsText: provenanced(item.ingredientsText) }),
    bestBy: null,
    screening,
  };
}

export interface LookupOutcome {
  readonly body: ProductLookupResultDto;
  /** For the log line only: the adapter's error code on `error`. */
  readonly errorCode?: string;
}

/** Resolves one parsed barcode for one caller. Never throws for a source failure. */
export async function lookupProductForSession(
  port: ProductLookupPort,
  screening: ProductScreeningStep,
  code: ProductCode,
  requestedCode: string,
  session: Session,
): Promise<LookupOutcome> {
  const result = await port.resolve(code);
  switch (result.status) {
    case "hit": {
      const outcome = await screening.screen(result.product, session);
      return {
        body: {
          status: "hit",
          code: requestedCode,
          product: toScannedProductDto(result.product, outcome),
        },
      };
    }
    case "not-found":
      return { body: { status: "not-found", code: requestedCode } };
    case "error":
      return {
        body: { status: "error", code: requestedCode, message: LOOKUP_ERROR_MESSAGE },
        errorCode: result.error.code,
      };
  }
}
