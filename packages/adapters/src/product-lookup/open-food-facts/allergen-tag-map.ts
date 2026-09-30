/**
 * Open Food Facts allergen tags -> this app's allergen codes (M2-T4a).
 *
 * The one committed map (BACKLOG.md M2-T4a (b)). Keys are OFF tag ids from
 * the `en:` allergen taxonomy (`taxonomies/allergens.txt` in
 * openfoodfacts-server, read 2026-09-29: an entry's first `en:` name, lower
 * cased and hyphenated, is its tag id). Values are the nine codes in
 * `packages/domain/src/allergens/taxonomy.ts`; the consistency test in
 * `packages/adapters/src/contracts-consistency/` proves every value is one.
 *
 * **Everything not in this map passes through raw**, exactly as OFF sent it
 * (`en:celery`, `en:Soy Milk`, `en:3520367101`, `fr:lait`, `en:none`). The
 * engine does not recognize those strings, so it records an
 * `UNRECOGNIZED_ASSERTION_CODE` unknown and an `UNRECOGNIZED_ALLERGEN_DATA`
 * warning for them (the M1-T6 fail-closed path): an unreadable tag can only
 * add caution, never remove it. Mapping a tag here is therefore the only
 * change that can *narrow* what the engine is told, which is why each entry
 * below is either an exact taxonomy match or a policy the decision log
 * already made.
 *
 * `en:gluten` -> `wheat` (D-026, built as proposed in M2-T4b): OFF folds
 * wheat, barley, rye, spelt, kamut and oats into one `gluten` entry, so a
 * gluten tag is not exactly the same claim as wheat — but leaving it raw
 * reached a wheat-allergic member as an unrecognized-data warning, never a
 * block, which under-warns the one real signal OFF gives for wheat. Mapping
 * it over-blocks barley, rye, spelt, kamut and oat products for a
 * wheat-allergic member; that is the D-017 safe direction (worst wins, a
 * warning can be added but never cleared), and it is the only entry in this
 * table that maps a *broader* OFF concept onto a *narrower* engine code
 * rather than an exact taxonomy match.
 *
 * Deliberately **not** mapped:
 *
 * - `en:none` ("allergens-free, without allergens" in OFF's taxonomy). It is
 *   a claim of absence, and OFF data never licenses absence (D-025, D-017).
 *   Passed through raw, it can only ever read as unrecognized data.
 * - `en:celery`, `en:mustard`, `en:lupin`, `en:sulphur-dioxide-and-sulphites`
 *   and OFF's Japanese-list entries: not FDA majors, no code to map to yet.
 */

import type { MajorAllergenCode } from "@smart-kitchen/domain";

export const OFF_ALLERGEN_TAG_MAP: Readonly<Record<string, MajorAllergenCode>> = Object.freeze({
  "en:peanuts": "peanut",
  /** D-026: over-blocks barley/rye/spelt/kamut/oats for a wheat allergy, the safe direction. */
  "en:gluten": "wheat",
  /** OFF's `nuts` entry is tree nuts (almonds, hazelnuts, walnuts, cashews, pecans, Brazil nuts, pistachios, macadamias); peanuts are their own entry. */
  "en:nuts": "tree_nut",
  "en:milk": "milk",
  "en:eggs": "egg",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  /** D-017 P2: molluscs stay inside `shellfish` (over-inclusion blocks; under-inclusion exposes). */
  "en:molluscs": "shellfish",
  "en:soybeans": "soy",
  "en:sesame-seeds": "sesame",
  /**
   * Not an OFF taxonomy entry: it appears as an un-normalized contributor
   * tag (seen in a real US record's `traces_tags`). D-017 P3 keeps coconut
   * inside `tree_nut` for MVP, so this can only add a block, never clear one.
   */
  "en:coconut": "tree_nut",
});

/**
 * One OFF tag in, one engine allergen code out: the mapped code when the tag
 * is in {@link OFF_ALLERGEN_TAG_MAP}, otherwise the tag unchanged. A tag that
 * is not a string (OFF's schema allows objects in `traces_tags`) is passed
 * through as its JSON text, so the engine still sees, and flags, something
 * it cannot read rather than nothing at all.
 */
export function mapOffAllergenTag(tag: unknown): string {
  if (typeof tag !== "string") {
    return JSON.stringify(tag) ?? String(tag);
  }
  return Object.hasOwn(OFF_ALLERGEN_TAG_MAP, tag) ? (OFF_ALLERGEN_TAG_MAP[tag] ?? tag) : tag;
}
