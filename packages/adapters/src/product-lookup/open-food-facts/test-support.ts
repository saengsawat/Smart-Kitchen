/**
 * Test helpers for the OFF adapter (M2-T4a). Reads the recorded responses in
 * `tests/fixtures/off/` and replays them; nothing here opens a connection.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAJOR_ALLERGEN_CODES,
  majorRestriction,
  type ProductSubjectInput,
  type ScreenedMember,
} from "@smart-kitchen/domain";
import { OFF_FIXTURES_DIR } from "../fixture-paths.js";
import type { ProductCatalogItem } from "../types.js";
import type { OffHttpAnswer } from "./mapping.js";

export interface RecordedOffResponse {
  readonly capture: {
    readonly capturedAt: string;
    readonly host: string;
    readonly request: string;
    readonly userAgent: string;
    readonly httpStatus: number;
    readonly contentType: string | null;
    readonly note: string;
  };
  readonly body: unknown;
}

export const RECORDED_OFF_FILES = [
  "full-peanut-butter.json",
  "traces-only-granola.json",
  "unmapped-tags-bread.json",
  "unparseable-quantity-ripple.json",
  "liquid-per-100ml-ripple.json",
  "no-allergen-fields-almond-breeze.json",
  "sparse-sandwich.json",
  "not-found.json",
] as const;

export type RecordedOffFile = (typeof RECORDED_OFF_FILES)[number];

export function loadRecorded(file: RecordedOffFile): RecordedOffResponse {
  return JSON.parse(readFileSync(path.join(OFF_FIXTURES_DIR, file), "utf8")) as RecordedOffResponse;
}

/** The recorded answer as the port would have seen it on the wire. */
export function recordedAnswer(file: RecordedOffFile): OffHttpAnswer {
  const recorded = loadRecorded(file);
  return { httpStatus: recorded.capture.httpStatus, bodyText: JSON.stringify(recorded.body) };
}

/** The barcode each recording was requested with (the path segment of its request). */
export function recordedCode(file: RecordedOffFile): string {
  const match = /\/api\/v2\/product\/(\d+)\.json/.exec(loadRecorded(file).capture.request);
  if (!match?.[1]) throw new Error(`no code in ${file}`);
  return match[1];
}

/** The engine's product input built from a mapped item, the same way M2-T4 will (never a declaration). */
export function toEngineSubject(item: ProductCatalogItem): ProductSubjectInput {
  return {
    kind: "PRODUCT",
    subjectId: item.id,
    name: item.name.value,
    allergens: item.allergens.map((tag) => ({
      allergenCode: tag.allergenCode,
      assertion: tag.assertion,
      provenance: {
        tier: tag.provenance.tier,
        source: tag.provenance.source,
        observedAt: tag.provenance.observedAt,
      },
    })),
    ...(item.ingredientsText === undefined ? {} : { ingredientsText: item.ingredientsText.value }),
  };
}

/** One member allergic to every major allergen at `severity`: the widest household the engine can screen. */
export function everyAllergenMember(severity: "severe" | "standard"): ScreenedMember {
  return {
    memberId: `member-all-${severity}`,
    restrictions: MAJOR_ALLERGEN_CODES.map((code) => {
      const built = majorRestriction(`r-${code}-${severity}`, code, severity);
      if (!built.ok) throw new Error(built.error.message);
      return built.value;
    }),
  };
}

/** Every `tier` value anywhere inside `value`, however deeply nested. */
export function collectTiers(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectTiers(entry, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "tier" && typeof entry === "string") into.push(entry);
      else collectTiers(entry, into);
    }
  }
  return into;
}
