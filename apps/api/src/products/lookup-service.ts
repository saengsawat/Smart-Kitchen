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
 * The path segment, validated.
 *
 * - 4 or 5 digits: a PLU, refused (`PLU_NOT_SUPPORTED`), never sent anywhere.
 * - 8, 12 or 13 digits with a valid check digit: EAN-8, UPC-A, EAN-13.
 * - 14 digits with a valid check digit and a leading `0`: a GTIN-14 whose
 *   packaging indicator is 0 is the GTIN-13 in its last 13 digits (OFF's own
 *   barcode-normalization note), looked up as that EAN-13. A GTIN-14 with
 *   any other indicator names a case or a pallet, not something a household
 *   scans, and is refused as invalid. The adapter has no GTIN-14 code type
 *   (see the M2-T4a worker report, escalations).
 * - anything else, including a bad check digit: invalid.
 */
export function parseLookupCode(raw: string): ParsedLookupCode {
  if (!/^\d+$/.test(raw)) return { kind: "invalid" };
  if (raw.length === 4 || raw.length === 5) return { kind: "plu" };
  if (![8, 12, 13, 14].includes(raw.length) || !checkDigitHolds(raw)) return { kind: "invalid" };
  switch (raw.length) {
    case 8:
      return { kind: "barcode", code: { codeType: "EAN8", code: raw } };
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
