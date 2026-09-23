/**
 * Barcode-scan fixture data (M3-T4b).
 *
 * **Screening verdicts are never hand-written here** (review round F1/F2/
 * F3 ruling, root cause of the review's FAIL: an earlier version of this
 * file derived them by hand, and the real engine disagreed with every one
 * of them). The three `ScannedProductDto` JSON files this module imports
 * (`./fixtures/{condiment-102,dairy-008,meat-026}.json`) are generated —
 * never edited by hand — by `packages/adapters/scripts/
 * gen-screening-fixtures.mjs`, which loads the real corpus records, builds
 * the Chen household from the one shared source of truth
 * (`src/household/fixture-restrictions.json`, review F8), and runs the
 * real `packages/domain` `screenSubject` engine.
 * `packages/adapters/src/contracts-consistency/
 * screening-fixtures-consistency.test.ts` regenerates them in memory on
 * every test run and fails the build if the committed files have drifted
 * (a hand-edit, a stale corpus/household/engine change never re-run).
 *
 * `apps/mobile` still imports neither `@smart-kitchen/domain` nor
 * `@smart-kitchen/adapters` (M3-T1/M3-T3 invariants) — this module only
 * imports plain JSON data the generator already computed, at build time.
 *
 * **No corpus record can screen `ALLOWED` today**: none carries an
 * `AllergenDeclaration` (D-017 gate b — who may mint a `KNOWN_FACT`
 * allergen declaration — is still open), so every generated fixture is
 * `BLOCKED` or `ALLOWED_WITH_UNKNOWNS`. The architect's amendment to this
 * ticket's original "a dairy hit that is ALLOWED" requirement: `ALLOWED`'s
 * exact copy-deck.md §3.3 string is exercised only by a synthetic
 * `ScreeningResultDto` in `allergen-copy.test.ts`, clearly labelled
 * synthetic — there is nothing real to generate it from yet.
 *
 * `bestBy` is the one field the generator does not compute (the underlying
 * corpus records carry no expiry data at all, and M8's expiry engine is out
 * of scope — CLAUDE.md rule 3 forbids inventing a fact from nothing): this
 * module adds a hand-authored, clearly `ESTIMATED`-tiered shelf-life guess
 * on top of the generated product, the same fixture-authoring convention
 * `src/inventory/fixture-household.ts` already uses for its own lots.
 */

import type {
  FieldProvenanceDto,
  ProductLookupResultDto,
  ProvenancedDto,
  ScannedProductDto,
} from "@smart-kitchen/contracts";
import condiment102Json from "./fixtures/condiment-102.json";
import dairy008Json from "./fixtures/dairy-008.json";
import meat026Json from "./fixtures/meat-026.json";
import manifestJson from "./fixtures/manifest.json";

/** The generated product JSON's own shape, minus `bestBy` (which the generator never writes — see module doc comment). */
type GeneratedProduct = Omit<ScannedProductDto, "bestBy">;

/** Fixed "now" for this module's fixture-authored best-by estimates, matching `fixture-household.ts`'s `FIXTURE_NOW`. */
const FIXTURE_NOW = "2026-09-22T12:00:00.000Z";

function daysFromNow(days: number): string {
  return new Date(new Date(FIXTURE_NOW).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function fixtureBestBy(days: number): ProvenancedDto<string> {
  const provenance: FieldProvenanceDto = {
    tier: "ESTIMATED",
    source: "fixture-shelf-life-estimate",
    confidence: null,
    recordedAt: FIXTURE_NOW,
  };
  return { value: daysFromNow(days), provenance };
}

/** Every generated product, keyed by its `productId` (matches `manifest.json`'s values). */
const GENERATED_PRODUCTS: Readonly<Record<string, GeneratedProduct>> = {
  "condiment-102": condiment102Json as GeneratedProduct,
  "dairy-008": dairy008Json as GeneratedProduct,
  "meat-026": meat026Json as GeneratedProduct,
};

/** Hand-authored, `ESTIMATED`-tier shelf-life guess per product — see module doc comment. Days from `FIXTURE_NOW`. */
const BEST_BY_DAYS: Readonly<Record<string, number>> = {
  "condiment-102": 180, // a shelf-stable condiment
  "dairy-008": 14, // eggs
  "meat-026": 4, // fresh poultry
};

/** `manifest.json`: barcode -> product id, or `null` for a deliberate miss (the prototype's own miss code). */
const MANIFEST: Readonly<Record<string, string | null>> = manifestJson;

/** The prototype's own miss code, `#scr-scan`'s `miss-panel`: "0 40000 51907 3". */
export const MISS_CODE = "040000519073";

/**
 * `ApiClient.lookupProduct`'s fixture body. Any code the manifest does not
 * name — including {@link MISS_CODE}, which the manifest maps to `null` on
 * purpose (a *recognised* miss, not merely an absent entry) — resolves
 * `not-found`, matching the real port's `ResolveResult` shape
 * (`packages/adapters/src/product-lookup/ports.ts`): a miss is a typed
 * result, not an exception.
 */
export function fixtureLookupProduct(code: string): ProductLookupResultDto {
  const productId = MANIFEST[code];
  if (productId === undefined || productId === null) {
    return { status: "not-found", code };
  }
  const generated = GENERATED_PRODUCTS[productId];
  if (!generated) {
    return { status: "not-found", code };
  }
  const days = BEST_BY_DAYS[productId];
  const product: ScannedProductDto = {
    ...generated,
    bestBy: days === undefined ? null : fixtureBestBy(days),
  };
  return { status: "hit", code, product };
}

/** Groups a 12-digit UPC-A into the prototype's human-readable spacing (e.g. "0 40000 51907 3"). */
export function formatScannedCodeDisplay(code: string): string {
  if (/^\d{12}$/.test(code)) {
    return `${code.slice(0, 1)} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code.slice(11)}`;
  }
  return code;
}
