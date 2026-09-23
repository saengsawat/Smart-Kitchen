#!/usr/bin/env node
/**
 * M3-T4b review-fix root cause (F1/F2/F3): S8's fixture allergen verdicts
 * were originally derived by *hand*, reasoning about each corpus record's
 * labels rather than running the real engine. The reviewer ran the real
 * `screenSubject` over the corpus records this app actually uses and found
 * every hand-derived verdict wrong (dairy-003 hand-derived as `ALLOWED` is
 * really `ALLOWED_WITH_UNKNOWNS`; the tahini's evidence list was incomplete;
 * the eggs record's unknown ordering was invented, not observed).
 *
 * RULING: fixture screening results are never hand-written again. This
 * script is the only thing allowed to produce them: it loads the exact
 * corpus records `apps/mobile/src/scan/fixtures/*.json` ship, builds the
 * Chen household from the **one** shared source of truth
 * (`apps/mobile/src/household/fixture-restrictions.json`, review F8), runs
 * the real `packages/domain` `screenSubject` engine — imported from
 * `@smart-kitchen/domain`'s built `dist/` output, the same way any other
 * consumer of this workspace package resolves it, so this script needs
 * `packages/domain` (and `packages/contracts`) built first (`pnpm
 * typecheck`/`pnpm --filter domain typecheck` emits it; `tsc -b` is not
 * `--noEmit`) — and writes one committed JSON file per product plus a
 * manifest mapping barcode -> product id (including the miss code, mapped
 * to `null`).
 *
 * `apps/mobile`'s fixture product-lookup module
 * (`src/scan/fixture-products.ts`) imports these JSON files directly; it
 * computes nothing about allergens itself (M3-T4b's own invariant, restated
 * by this ticket's review: "no allergen verdict ... is computed, inferred,
 * softened or reordered in the client"). `packages/adapters/src/
 * contracts-consistency/screening-fixtures-consistency.test.ts` calls
 * {@link generateScreeningFixtures} again, in memory, under vitest (which
 * resolves `@smart-kitchen/domain` to source via the root `vitest.config.ts`
 * alias, so no build step is needed for the test) and asserts deep equality
 * against the committed files — any drift between the committed JSON and
 * what the engine produces today fails the build.
 *
 * No corpus record carries an `AllergenDeclaration`: D-017 gate b ("who may
 * mint a KNOWN_FACT allergen declaration") is still OPEN, so nothing in this
 * corpus can license a `NO_KNOWN_MATCH` conclusion and no product screens
 * `ALLOWED` today. The ticket's original "a dairy hit that is ALLOWED" fixture
 * requirement is amended by the architect: `ALLOWED`'s exact copy-deck.md
 * §3.3 string is exercised only by a synthetic `ScreeningResultDto` in
 * `src/scan/allergen-copy.test.ts`, clearly labelled synthetic, not by this
 * generator (there is nothing real to generate it from yet).
 *
 * Run manually: `node packages/adapters/scripts/gen-screening-fixtures.mjs`
 * (after `pnpm typecheck` has built `packages/domain`/`packages/contracts`).
 * Idempotent: re-running with no corpus/household change produces
 * byte-identical output (no `git diff`), proved by the worker report's
 * verification run and re-checked here any time the corpus or household
 * changes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { majorRestriction, screenSubject } from "@smart-kitchen/domain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const RESTRICTIONS_PATH = path.join(
  REPO_ROOT,
  "apps",
  "mobile",
  "src",
  "household",
  "fixture-restrictions.json",
);
const PRODUCTS_DIR = path.join(REPO_ROOT, "tests", "fixtures", "products");
const OUTPUT_DIR = path.join(REPO_ROOT, "apps", "mobile", "src", "scan", "fixtures");

/**
 * The corpus products S8's fixture ships, and the barcode each resolves
 * from (matching `tests/fixtures/barcodes/manifest.json`'s own codes for
 * these ids). `MISS_CODE` is the prototype's own miss example — no product,
 * carried here only so the manifest records it as a deliberate miss rather
 * than an absent entry that could be confused with "not generated yet".
 */
export const FIXTURE_PRODUCTS = [
  { productId: "condiment-102", code: "060000100810" }, // tahini: sesame CONTAINS -> BLOCKED for Maya
  { productId: "dairy-008", code: "060000100070" }, // eggs: egg CONTAINS only, no ingredient statement -> ALLOWED_WITH_UNKNOWNS
  { productId: "meat-026", code: "060000100100" }, // chicken breast: no allergens at all, fractional 1.5 lb package -> ALLOWED_WITH_UNKNOWNS
];
export const MISS_CODE = "040000519073";

function loadHouseholdMembers() {
  const raw = JSON.parse(readFileSync(RESTRICTIONS_PATH, "utf8"));
  return raw.members.map((member) => ({
    memberId: member.memberId,
    restrictions: member.restrictions.map((r) => {
      const built = majorRestriction(r.restrictionId, r.code, r.severity);
      if (!built.ok) {
        throw new Error(
          `gen-screening-fixtures: invalid restriction ${JSON.stringify(r)}: ${built.error.message}`,
        );
      }
      return built.value;
    }),
  }));
}

function loadProductRecord(productId) {
  const file = path.join(PRODUCTS_DIR, `${productId}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Builds the domain's `ProductSubjectInput` from a corpus record. Never adds a `declaration` — see module doc comment. */
function toProductSubject(record) {
  const subject = {
    kind: "PRODUCT",
    subjectId: record.id,
    name: record.name.value,
  };
  if (Array.isArray(record.allergens) && record.allergens.length > 0) {
    subject.allergens = record.allergens.map((tag) => ({
      allergenCode: tag.allergenCode,
      assertion: tag.assertion,
      provenance: fieldProvenanceFromAdapter(tag.provenance),
    }));
  }
  if (record.ingredientsText) {
    subject.ingredientsText = record.ingredientsText.value;
  }
  return subject;
}

/** adapters' `FieldProvenance` ({tier, source, observedAt, confidence?}) passed straight through as the domain's `AssertionProvenance` — same field names except `observedAt`, which the domain's `AssertionProvenance` also uses verbatim (only the wire DTO renames it `recordedAt`, see {@link fieldProvenanceDto}). */
function fieldProvenanceFromAdapter(p) {
  return {
    tier: p.tier,
    source: p.source,
    observedAt: p.observedAt,
    ...(p.confidence === undefined ? {} : { confidence: p.confidence }),
  };
}

/** adapters' `FieldProvenance` -> contracts' `FieldProvenanceDto` (renames `observedAt` -> `recordedAt`, adds `confidence: null` when absent — the wire shape's own rule 2/3). */
function fieldProvenanceDto(p) {
  return {
    tier: p.tier,
    source: p.source,
    confidence: p.confidence === undefined ? null : p.confidence,
    recordedAt: p.observedAt,
  };
}

function provenancedDto(p) {
  return { value: p.value, provenance: fieldProvenanceDto(p.provenance) };
}

/**
 * The corpus's `packageSize.value.qty` is a plain JSON number (e.g. `16`,
 * `1.5`); `PackageSizeDto.qty` is exact decimal text (contracts' own rule:
 * quantities that feed micros math never travel as a JSON number).
 * `String(qty)` is exact for this corpus's values (whole numbers and simple
 * halves/quarters, all exactly binary-representable) — this is a one-time
 * transcription of already-known-good literals, not runtime arithmetic on
 * user input, so `String()` here is not the "never touch Number" quantity
 * math rule this repo enforces elsewhere; it never rounds or infers.
 */
function packageSizeDto(p) {
  return {
    value: { qty: String(p.value.qty), unit: p.value.unit },
    provenance: fieldProvenanceDto(p.provenance),
  };
}

/** Domain `ScreeningResult` -> contracts `ScreeningResultDto`, dropping the machine-facing `message` fields (copy-deck.md §2: never rendered). */
function toScreeningResultDto(result) {
  return {
    subjectKind: "PRODUCT",
    subjectId: result.subjectId,
    verdict: result.verdict,
    members: result.members.map((m) => ({ memberId: m.memberId, verdict: m.verdict })),
    evidence: result.evidence.map((e) => ({
      memberId: e.memberId,
      restrictionId: e.restrictionId,
      restrictionLabel: e.restrictionLabel,
      severity: e.severity,
      kind: e.kind,
      locus: e.locus,
      matchedTerm: e.matchedTerm,
      ...(e.matchedText === undefined ? {} : { matchedText: e.matchedText }),
      ...(e.assertionSource === undefined ? {} : { assertionSource: e.assertionSource }),
      ...(e.assertionTier === undefined ? {} : { assertionTier: e.assertionTier }),
    })),
    unknowns: result.unknowns.map((u) => ({
      memberId: u.memberId,
      restrictionId: u.restrictionId,
      restrictionLabel: u.restrictionLabel,
      severity: u.severity,
      reason: u.reason,
      locus: u.locus,
      detail: u.detail,
    })),
    warnings: result.warnings.map((w) => ({
      code: w.code,
      severity: w.severity,
      ...(w.memberId === undefined ? {} : { memberId: w.memberId }),
      ...(w.restrictionId === undefined ? {} : { restrictionId: w.restrictionId }),
      ...(w.restrictionLabel === undefined ? {} : { restrictionLabel: w.restrictionLabel }),
    })),
  };
}

/**
 * Pure generation (no file I/O beyond reading the corpus/household inputs):
 * returns `{ [productId]: ScannedProductDto }`. Exported so both this
 * script's CLI entry point and the consistency test call the exact same
 * logic — the whole point being that there is only one implementation to
 * drift from the committed JSON, not two.
 */
export function generateScreeningFixtures(products = FIXTURE_PRODUCTS) {
  const members = loadHouseholdMembers();
  const out = {};
  for (const { productId } of products) {
    const record = loadProductRecord(productId);
    const subject = toProductSubject(record);
    const screened = screenSubject({ subject, members });
    if (!screened.ok) {
      throw new Error(
        `gen-screening-fixtures: screenSubject failed for ${productId}: ${screened.error.message}`,
      );
    }
    out[productId] = {
      productId: record.id,
      codes: record.codes.map((c) => ({ codeType: c.codeType, code: c.code })),
      name: provenancedDto(record.name),
      ...(record.brand ? { brand: provenancedDto(record.brand) } : {}),
      packageSize: packageSizeDto(record.packageSize),
      nutrition: (record.nutrition ?? []).map((n) => ({
        basis: n.basis,
        values: n.values,
        provenance: fieldProvenanceDto(n.provenance),
      })),
      ...(record.ingredientsText
        ? { ingredientsText: provenancedDto(record.ingredientsText) }
        : {}),
      screening: toScreeningResultDto(screened.value),
    };
  }
  return out;
}

/** `{ [code]: productId | null }`, the barcode -> product map `src/scan/fixture-products.ts` reads. */
export function generateManifest(products = FIXTURE_PRODUCTS) {
  const manifest = {};
  for (const { productId, code } of products) {
    manifest[code] = productId;
  }
  manifest[MISS_CODE] = null;
  return manifest;
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const fixtures = generateScreeningFixtures();
  for (const [productId, product] of Object.entries(fixtures)) {
    writeJson(path.join(OUTPUT_DIR, `${productId}.json`), product);
    console.log(`wrote apps/mobile/src/scan/fixtures/${productId}.json`);
  }
  writeJson(path.join(OUTPUT_DIR, "manifest.json"), generateManifest());
  console.log("wrote apps/mobile/src/scan/fixtures/manifest.json");
}

// CLI entry point only when run directly (`node .../gen-screening-fixtures.mjs`),
// never on import (the consistency test imports this module's exports
// without running `main()`). `process.argv[1]` is whatever path the shell
// invoked (often relative); resolving both sides to an absolute path before
// comparing is what makes this robust to that, on Windows and POSIX alike.
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
