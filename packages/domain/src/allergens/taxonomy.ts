/**
 * Allergen taxonomy and curated term data (M1-T4).
 *
 * ## Codes
 *
 * The nine FDA major food allergens (Food Allergen Labeling and Consumer
 * Protection Act, plus sesame added by the FASTER Act, effective 2023). Codes
 * are **deliberately identical to the strings already used by the M1-T5
 * product fixtures** (`tests/fixtures/products/**`, typed as
 * `AllergenTag.allergenCode` in `packages/adapters/src/product-lookup/types.ts`)
 * so adapter data screens without a translation layer. Eight of the nine —
 * `milk`, `wheat`, `soy`, `tree_nut`, `egg`, `peanut`, `fish`, `shellfish` —
 * appear in that corpus today and match exactly; `sesame` does not appear yet
 * (a corpus gap, not a naming divergence). {@link ALLERGEN_CODE_ALIASES} maps
 * the spellings other sources are likely to use onto these codes.
 *
 * `shellfish` means **crustacean** shellfish, the FDA major-allergen scope, and
 * is named to match the fixture code rather than spelled out. Its curated term
 * list additionally covers molluscs (clam, mussel, oyster, scallop, squid,
 * octopus), which are *not* FDA majors: colloquial "shellfish allergy" usually
 * includes them, and over-inclusion blocks where under-inclusion would expose.
 * Flagged as a PROPOSED policy for architect ratification (see the handoff
 * report) — it is data on one line, trivially reversible.
 *
 * ## Term data
 *
 * `ALLERGEN_TERMS` is a curated synonym list per code and `ALLERGEN_EXCLUSIONS`
 * a curated list of phrases that must *not* be read as that allergen. Both are
 * **data, not heuristics**: the matcher in `text.ts` applies one fixed
 * algorithm to them and invents nothing at runtime.
 *
 * These lists are **incomplete by construction** and always will be — food
 * naming is unbounded. That is safe only because of how `screen.ts` uses them:
 * a term match is evidence of *presence* (and blocks), while the absence of a
 * match is never evidence of absence and never on its own produces `ALLOWED`.
 * Growing this list can therefore only ever make the engine block more, never
 * less — which is why new entries are a low-risk, fixture-first change.
 */

import { compileTerms, normalizeText, type CompiledTerm } from "./text.js";

/** The nine FDA major food allergens, as stable codes. Order is documentation only. */
export const MAJOR_ALLERGEN_CODES = [
  "peanut",
  "tree_nut",
  "milk",
  "egg",
  "fish",
  "shellfish",
  "wheat",
  "soy",
  "sesame",
] as const;

export type MajorAllergenCode = (typeof MAJOR_ALLERGEN_CODES)[number];

const MAJOR_ALLERGEN_CODE_SET: ReadonlySet<string> = new Set<string>(MAJOR_ALLERGEN_CODES);

/** Human-readable label per code — for logs and as a fallback UI label, not final copy. */
export const MAJOR_ALLERGEN_LABELS: Readonly<Record<MajorAllergenCode, string>> = Object.freeze({
  peanut: "peanut",
  tree_nut: "tree nut",
  milk: "milk",
  egg: "egg",
  fish: "fish",
  shellfish: "crustacean shellfish",
  wheat: "wheat",
  soy: "soy",
  sesame: "sesame",
});

/**
 * Spellings from other sources mapped onto our codes. Applied after
 * {@link normalizeAllergenCode}'s punctuation folding, so `Tree Nuts`,
 * `tree-nuts` and `tree_nuts` all arrive here as `tree_nuts`.
 *
 * Deliberately **not** aliased: `gluten` → `wheat`. Gluten is also found in
 * barley and rye, so the two are not the same claim; an unmapped `gluten` tag
 * becomes an *unrecognized code* (an unknown + warning), which is the
 * conservative outcome, rather than a silently wrong equivalence.
 */
export const ALLERGEN_CODE_ALIASES: Readonly<Record<string, MajorAllergenCode>> = Object.freeze({
  peanuts: "peanut",
  ground_nut: "peanut",
  groundnut: "peanut",
  groundnuts: "peanut",
  tree_nuts: "tree_nut",
  treenut: "tree_nut",
  treenuts: "tree_nut",
  nuts_tree: "tree_nut",
  dairy: "milk",
  milks: "milk",
  eggs: "egg",
  fishes: "fish",
  crustacean: "shellfish",
  crustaceans: "shellfish",
  crustacean_shellfish: "shellfish",
  shell_fish: "shellfish",
  wheats: "wheat",
  soya: "soy",
  soybean: "soy",
  soybeans: "soy",
  soja: "soy",
  sesame_seed: "sesame",
  sesame_seeds: "sesame",
  sesamum: "sesame",
});

/** True when `value` is exactly one of our nine codes. */
export function isMajorAllergenCode(value: unknown): value is MajorAllergenCode {
  return typeof value === "string" && MAJOR_ALLERGEN_CODE_SET.has(value);
}

/**
 * Folds a free-form allergen code from an external source onto our taxonomy.
 * Returns `undefined` when the code is not recognized — callers must treat
 * that as *unknown data*, never as "no allergen" (SR-2).
 *
 * The alias lookup goes through {@link Object.hasOwn} rather than a bare index
 * read. A plain object inherits from `Object.prototype`, so `aliases["constructor"]`
 * resolves to the `Object` constructor function and a `constructor`-coded
 * assertion would be treated as *recognized* — silently clearing the
 * unrecognized-data warnings and, under a completeness declaration, upgrading
 * the verdict to `ALLOWED`. Own-property-only lookup closes that (review
 * finding F1).
 */
export function normalizeAllergenCode(raw: string): MajorAllergenCode | undefined {
  const folded = normalizeText(raw).replace(/ /g, "_");
  if (folded === "") return undefined;
  if (isMajorAllergenCode(folded)) return folded;
  if (!Object.hasOwn(ALLERGEN_CODE_ALIASES, folded)) return undefined;
  return ALLERGEN_CODE_ALIASES[folded];
}

/**
 * Curated synonyms per allergen. Entries are matched as whole token sequences
 * with the `+s`/`+es` inflection rule from `text.ts`; irregular plurals
 * (`anchovies`, `molluscs`) are therefore listed explicitly.
 */
const RAW_ALLERGEN_TERMS: Readonly<Record<MajorAllergenCode, readonly string[]>> = Object.freeze({
  peanut: [
    "peanut",
    "peanut butter",
    "peanut oil",
    "peanut flour",
    "groundnut",
    "ground nut",
    "monkey nut",
    "beer nut",
    "goober pea",
    "arachis",
    "arachis oil",
    "arachis hypogaea",
    "mandelona",
    "valencia nut",
  ],
  tree_nut: [
    "tree nut",
    "mixed nut",
    "nut butter",
    "nut paste",
    "nut meal",
    "almond",
    "almond butter",
    "almond flour",
    "almond paste",
    "marzipan",
    "brazil nut",
    "cashew",
    "chestnut",
    "filbert",
    "hazelnut",
    "gianduja",
    "macadamia",
    "pecan",
    "praline",
    "pine nut",
    "pignoli",
    "pinon",
    "pistachio",
    "walnut",
    "butternut",
    "hickory nut",
    "shea nut",
    "nangai nut",
    "nougat",
    // FDA classifies coconut as a tree nut for labeling purposes, so it is
    // screened as one here. Many tree-nut-allergic people tolerate coconut —
    // splitting it into its own code is a PROPOSED question for the architect.
    "coconut",
  ],
  milk: [
    "milk",
    "milk powder",
    "milk solid",
    "milk fat",
    "milkfat",
    "dairy",
    "butter",
    "buttermilk",
    "butterfat",
    "butter oil",
    "casein",
    "caseinate",
    "sodium caseinate",
    "calcium caseinate",
    "cheese",
    "cream",
    "creme",
    "creme fraiche",
    "custard",
    "curd",
    "ghee",
    "half and half",
    "kefir",
    "lactalbumin",
    "lactoglobulin",
    "lactose",
    "lactulose",
    "mascarpone",
    "paneer",
    "quark",
    "ricotta",
    "rennet casein",
    "whey",
    "yogurt",
    "yoghurt",
  ],
  egg: [
    "egg",
    "egg white",
    "egg yolk",
    "egg powder",
    "eggnog",
    "egg nog",
    "albumen",
    "albumin",
    "ovalbumin",
    "ovomucin",
    "ovomucoid",
    "ovovitellin",
    "livetin",
    "lysozyme",
    "meringue",
    "mayonnaise",
    "mayo",
  ],
  fish: [
    "fish",
    "fish sauce",
    "fish oil",
    "fish stock",
    "anchovy",
    "anchovies",
    "bass",
    "bonito",
    "catfish",
    "cod",
    "flounder",
    "grouper",
    "haddock",
    "hake",
    "halibut",
    "herring",
    "katsuobushi",
    "mahi mahi",
    "nam pla",
    "perch",
    "pike",
    "pollock",
    "pollack",
    "salmon",
    "sardine",
    "snapper",
    "sole",
    "swordfish",
    "tilapia",
    "trout",
    "tuna",
    "caviar",
    "roe",
    "surimi",
    "worcestershire",
    "worcestershire sauce",
  ],
  shellfish: [
    "shellfish",
    "crustacean",
    "barnacle",
    "crab",
    "crab meat",
    "crawfish",
    "crayfish",
    "crawdad",
    "krill",
    "langostino",
    "langoustine",
    "lobster",
    "prawn",
    "scampi",
    "shrimp",
    "shrimp paste",
    // Molluscs — outside FDA's crustacean-only major-allergen scope, included
    // deliberately (see module docblock); PROPOSED for ratification.
    "mollusc",
    "molluscs",
    "mollusk",
    "abalone",
    "clam",
    "cockle",
    "cuttlefish",
    "escargot",
    "limpet",
    "mussel",
    "octopus",
    "oyster",
    "periwinkle",
    "scallop",
    "snail",
    "squid",
    "calamari",
    "whelk",
  ],
  wheat: [
    "wheat",
    "wheat flour",
    "wheat germ",
    "wheat bran",
    "wheat starch",
    "wheat protein",
    "whole wheat",
    // Bare "flour" means wheat flour in a US ingredient statement unless
    // qualified; the qualified forms are handled by ALLERGEN_EXCLUSIONS.
    "flour",
    "bulgur",
    "couscous",
    "durum",
    "einkorn",
    "emmer",
    "farina",
    "farro",
    "graham",
    "graham flour",
    "kamut",
    "matzo",
    "matzoh",
    "matzah",
    "seitan",
    "semolina",
    "spelt",
    "triticale",
    "vital gluten",
    "wheat gluten",
  ],
  soy: [
    "soy",
    "soya",
    "soy sauce",
    "soy lecithin",
    "soy protein",
    "soy flour",
    "soybean",
    "soybean oil",
    "soja",
    "edamame",
    "miso",
    "natto",
    "okara",
    "shoyu",
    "tamari",
    "tempeh",
    "tofu",
    "textured vegetable protein",
    "tvp",
    "yuba",
  ],
  sesame: [
    "sesame",
    "sesame seed",
    "sesame oil",
    "sesame paste",
    "benne",
    "benne seed",
    "gingelly",
    "gingelly oil",
    "halva",
    "halvah",
    "sesamol",
    "sesamum",
    "simsim",
    "tahini",
    "tahina",
    "til",
  ],
});

/**
 * Phrases masked out before the corresponding allergen's terms are scanned.
 *
 * Every entry exists because a term above is a legitimate token of an
 * unrelated food (`butter` in `peanut butter`) or because the phrase is an
 * explicit absence claim (`dairy free`). Exclusions apply **only to free-text
 * scanning** — they can never suppress an explicit `CONTAINS` assertion, which
 * is what keeps them from becoming a way to clear an allergen (rule 9).
 */
const RAW_ALLERGEN_EXCLUSIONS: Readonly<Record<MajorAllergenCode, readonly string[]>> =
  Object.freeze({
    peanut: ["peanut free"],
    tree_nut: ["tree nut free", "nut free", "water chestnut", "water chestnuts", "coconut free"],
    milk: [
      "milk free",
      "dairy free",
      "non dairy",
      "peanut butter",
      "almond butter",
      "cashew butter",
      "nut butter",
      "seed butter",
      "sunflower butter",
      "sunflower seed butter",
      "soy butter",
      "coconut butter",
      "cocoa butter",
      "shea butter",
      "apple butter",
      "cream of tartar",
      // "curd" is a milk term; bean curd is tofu (review finding F9).
      "bean curd",
      "coconut milk",
      "coconut cream",
      "almond milk",
      "cashew milk",
      "oat milk",
      "rice milk",
      "soy milk",
      "nut milk",
      "hemp milk",
      "milk thistle",
    ],
    egg: ["egg free", "egg replacer", "egg substitute", "flax egg", "chia egg"],
    fish: ["fish free"],
    shellfish: ["shellfish free"],
    wheat: [
      "wheat free",
      "gluten free",
      "almond flour",
      "buckwheat flour",
      "cassava flour",
      "chickpea flour",
      "coconut flour",
      "corn flour",
      "garbanzo flour",
      "gluten free flour",
      "millet flour",
      "nut flour",
      "oat flour",
      "potato flour",
      "quinoa flour",
      "rice flour",
      "sorghum flour",
      "soy flour",
      "tapioca flour",
      "teff flour",
    ],
    soy: ["soy free"],
    sesame: ["sesame free"],
  });

function compileByCode(
  raw: Readonly<Record<MajorAllergenCode, readonly string[]>>,
): Readonly<Record<MajorAllergenCode, readonly CompiledTerm[]>> {
  const compiled: Partial<Record<MajorAllergenCode, readonly CompiledTerm[]>> = {};
  for (const code of MAJOR_ALLERGEN_CODES) {
    compiled[code] = Object.freeze(compileTerms(raw[code]));
  }
  return Object.freeze(compiled as Record<MajorAllergenCode, readonly CompiledTerm[]>);
}

/** Curated synonyms per allergen, pre-compiled to normalized token sequences. */
export const ALLERGEN_TERMS: Readonly<Record<MajorAllergenCode, readonly CompiledTerm[]>> =
  compileByCode(RAW_ALLERGEN_TERMS);

/** Curated exclusion phrases per allergen, pre-compiled to normalized token sequences. */
export const ALLERGEN_EXCLUSIONS: Readonly<Record<MajorAllergenCode, readonly CompiledTerm[]>> =
  compileByCode(RAW_ALLERGEN_EXCLUSIONS);

/** The raw (uncompiled) synonym phrases, exposed for documentation and audit tests. */
export const ALLERGEN_TERM_PHRASES = RAW_ALLERGEN_TERMS;

/** The raw (uncompiled) exclusion phrases, exposed for documentation and audit tests. */
export const ALLERGEN_EXCLUSION_PHRASES = RAW_ALLERGEN_EXCLUSIONS;
