#!/usr/bin/env node
/**
 * R-6 research spike: measures how much of our 102-product fixture corpus
 * (`tests/fixtures/products/**`) and the nine Chen household seed items
 * (`apps/api/src/seed/fixture-inventory.ts`) can be matched, by category and
 * name, against the USDA FoodKeeper dataset (FSIS; public domain, CC0 1.0).
 *
 * NOT part of `pnpm test` / CI — this is an offline research script, run
 * manually:
 *
 *   node scripts/shelf-life-coverage-research.mjs
 *
 * It makes NO network calls. It reads two things from disk:
 *   1. `tests/fixtures/products/*.json` (always present in this repo).
 *   2. `tests/fixtures/shelf-life/raw/foodkeeper.json` (the committed,
 *      unmodified FoodKeeper download — see
 *      `tests/fixtures/shelf-life/README.md` for the source, licence and,
 *      as of this ticket's first pass, why that file is NOT yet present).
 *
 * **Current status (R-6, 2026-09-30): the raw FoodKeeper file could not be
 * downloaded this session** (network-level block on the source host — full
 * detail in the README above, not repeated here). Without it, this script
 * cannot compute a single real hit/ambiguous/miss number against FoodKeeper —
 * doing so would mean inventing the comparison, which CLAUDE.md rule 4
 * forbids. What it CAN do without that file, and does, is the honest half of
 * the job: read and count the real local corpus (products by category, the
 * nine Chen items and their storage locations) so those numbers are at least
 * reproducible right now, and clearly report the FoodKeeper-matching phase as
 * skipped rather than silently produce zeroes that look like measured misses.
 *
 * Once `tests/fixtures/shelf-life/raw/foodkeeper.json` exists, re-running
 * this script performs the actual match — see `matchAgainstFoodKeeper()`
 * below. Because the real file's exact field names were never seen this
 * session (the download was blocked before any content came back), that
 * function does not assume a specific schema. It introspects whatever JSON
 * shape it finds (see `sniffRecords()` / `classifyFields()`) and reports
 * which field names it decided were "name-like" and "category-like" before
 * using them, so a reviewer can see and correct that guess rather than trust
 * it blindly. **This matching logic is therefore unverified against real
 * data as of this commit** (ENGINEERING INFERENCE, not measured) — flagged
 * again in docs/research/shelf-life.md and the worker report. Do not treat
 * its output as fact until it has actually been run against the real file
 * and that output has been read by a human.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(process.argv[1]), "..");
const PRODUCTS_DIR = path.join(REPO_ROOT, "tests", "fixtures", "products");
const RAW_FILE_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "shelf-life",
  "raw",
  "foodkeeper.json",
);
const OUT_PATH = path.join(REPO_ROOT, "docs", "research", "shelf-life.raw.json");

/**
 * The Chen household's nine seed items, copied by hand from
 * `apps/api/src/seed/fixture-inventory.ts`'s `CHEN_SEED_ITEMS` (key,
 * displayName, storageLocation, unit) — same rationale as R-1's hand-copied
 * basket: this script must not import that file (it is TypeScript, compiled
 * as part of `apps/api`, and this script runs standalone), so the values are
 * copied rather than imported and must be kept in sync by hand if that file
 * changes. `mappingCategory` is this script's OWN addition, not present in
 * the source file: it assigns each item to one of the same nine category
 * buckets used by `tests/fixtures/products/**` (produce, dairy, meat,
 * pantry, frozen, snacks, condiments, baking, beverages) purely so the same
 * category-mapping table can be applied to both corpora. Two of these nine
 * assignments are judgment calls, not sourced from either file, and are
 * marked as such:
 *   - "eggs": no fixture category bucket is literally "eggs"; bucketed under
 *     "dairy" for mapping purposes only (ENGINEERING INFERENCE).
 *   - "salmon": bucketed under "meat" (our fixture corpus does not split
 *     seafood out from meat either — `tests/fixtures/products/meat-*.json`
 *     has no dedicated seafood items to check this against).
 */
const CHEN_SEED_ITEMS = [
  {
    key: "strawberries",
    displayName: "Strawberries",
    storageLocation: "FRIDGE",
    mappingCategory: "produce",
  },
  {
    key: "chicken",
    displayName: "Chicken breast",
    storageLocation: "FRIDGE",
    mappingCategory: "meat",
  },
  { key: "spinach", displayName: "Spinach", storageLocation: "FRIDGE", mappingCategory: "produce" },
  {
    key: "mushrooms",
    displayName: "Mushrooms",
    storageLocation: "FRIDGE",
    mappingCategory: "produce",
  },
  {
    key: "yogurt",
    displayName: "Greek yogurt",
    storageLocation: "FRIDGE",
    mappingCategory: "dairy",
  },
  { key: "eggs", displayName: "Eggs", storageLocation: "FRIDGE", mappingCategory: "dairy" },
  {
    key: "salmon",
    displayName: "Salmon fillets",
    storageLocation: "FREEZER",
    mappingCategory: "meat",
  },
  {
    key: "rice",
    displayName: "Basmati rice",
    storageLocation: "PANTRY",
    mappingCategory: "pantry",
  },
  {
    key: "olive-oil",
    displayName: "Olive oil",
    storageLocation: "PANTRY",
    mappingCategory: "pantry",
  },
];

/**
 * Our fixture category (from `tests/fixtures/products/*.json`'s
 * `category.value`, and `CHEN_SEED_ITEMS.mappingCategory` above) mapped to a
 * short list of English keywords a FoodKeeper category/subcategory field
 * would plausibly contain, IF one existed with those words in it. This is
 * PROPOSED, written from general knowledge of how FoodKeeper groups food
 * (general knowledge, not verified against this session's actual download,
 * since none was obtained) — treat every entry as a guess to be corrected
 * once real category strings are visible, not as a settled mapping.
 */
const CATEGORY_KEYWORD_MAP = {
  produce: ["fruit", "vegetable", "produce"],
  dairy: ["dairy", "egg", "cheese", "yogurt", "milk"],
  meat: ["meat", "poultry", "seafood", "fish", "beef", "pork", "chicken"],
  pantry: ["pantry", "grain", "bean", "pasta", "rice", "bread", "oil", "canned"],
  frozen: ["frozen"],
  snacks: ["snack", "baked good", "cookie", "cracker", "chip"],
  condiments: ["condiment", "sauce", "dressing", "spread", "dip"],
  baking: ["baking", "flour", "sugar", "extract"],
  beverages: ["beverage", "drink", "juice", "soda", "water", "coffee", "tea"],
};

function readProductFixtures() {
  const files = readdirSync(PRODUCTS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(path.join(PRODUCTS_DIR, file), "utf8"));
    return {
      file,
      id: raw.id,
      name: raw.name && raw.name.value,
      category: raw.category && raw.category.value,
    };
  });
}

/**
 * Best-effort discovery of "the array of food records" inside whatever JSON
 * shape the raw file turns out to have, without assuming a specific
 * top-level key name. Tries, in order: the whole file if it is already an
 * array; the first top-level property whose value is a non-empty array;
 * otherwise gives up and returns null (reported as an unrecognized schema,
 * never silently treated as zero records).
 */
function sniffRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const value of Object.values(raw)) {
      if (Array.isArray(value) && value.length > 0) return value;
    }
  }
  return null;
}

/**
 * Looks at the keys of the first record and guesses which ones are
 * "name-like" and "category-like" by a loose regex over the key name only
 * (never over the file's actual field semantics, which are unverified this
 * session). Reports every candidate key it finds rather than silently
 * picking the first one, so a human reviews the guess before it is trusted.
 */
function classifyFields(sampleRecord) {
  const keys = Object.keys(sampleRecord || {});
  const nameLike = keys.filter((k) => /name/i.test(k));
  const categoryLike = keys.filter((k) => /categor/i.test(k));
  return { keys, nameLike, categoryLike };
}

/**
 * Classifies one of our items (a fixture product or a Chen seed item)
 * against the FoodKeeper records sniffed above, using ONLY the field(s)
 * `classifyFields` decided were category-like, matched against
 * `CATEGORY_KEYWORD_MAP`. Returns "hit" (exactly one FoodKeeper record's
 * category-like field contains one of our mapped keywords), "ambiguous"
 * (more than one such record), or "miss" (none). This is deliberately
 * simple — the ticket asks for "a simple, documented mapping", not a fuzzy
 * name-similarity search — and deliberately does not use the name-like
 * field for matching (a name match without a plausible category match is
 * exactly the kind of wrong-but-found result R-1 §4.1 found for PLU codes;
 * this script does not repeat that mistake).
 */
function classifyAgainstFoodKeeper(item, records, categoryLikeKeys) {
  const keywords = CATEGORY_KEYWORD_MAP[item.category ?? item.mappingCategory] ?? [];
  if (keywords.length === 0 || categoryLikeKeys.length === 0) {
    return {
      verdict: "ambiguous",
      reason: "no keyword list or no category-like field found",
      matches: 0,
    };
  }
  let matches = 0;
  for (const record of records) {
    const categoryText = categoryLikeKeys
      .map((k) => String(record[k] ?? ""))
      .join(" ")
      .toLowerCase();
    if (keywords.some((kw) => categoryText.includes(kw))) matches += 1;
  }
  if (matches === 0) return { verdict: "miss", matches };
  if (matches === 1) return { verdict: "hit", matches };
  return { verdict: "ambiguous", matches };
}

function main() {
  const products = readProductFixtures();
  const categoryCounts = new Map();
  for (const p of products) {
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  }

  console.log(`Local product fixtures: ${products.length} files in ${PRODUCTS_DIR}`);
  console.log("By category:");
  for (const [cat, n] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${n}`);
  }
  console.log(`Chen seed items: ${CHEN_SEED_ITEMS.length}`);

  const rawFileExists = existsSync(RAW_FILE_PATH);
  let foodKeeperPhase;

  if (!rawFileExists) {
    console.log(`\nFoodKeeper raw file not found at ${RAW_FILE_PATH} — matching phase SKIPPED.`);
    console.log("See tests/fixtures/shelf-life/README.md for why, and the retry steps.");
    foodKeeperPhase = { status: "blocked", reason: "raw file not present", results: [] };
  } else {
    const raw = JSON.parse(readFileSync(RAW_FILE_PATH, "utf8"));
    const records = sniffRecords(raw);
    if (!records) {
      console.log(
        "\nFoodKeeper raw file exists but its shape was not recognized (no array found).",
      );
      foodKeeperPhase = { status: "unrecognized-schema", results: [] };
    } else {
      const { keys, nameLike, categoryLike } = classifyFields(records[0]);
      console.log(`\nFoodKeeper raw file: ${records.length} records.`);
      console.log(`  Sample record keys: ${keys.join(", ")}`);
      console.log(`  Guessed name-like fields: ${nameLike.join(", ") || "(none found)"}`);
      console.log(`  Guessed category-like fields: ${categoryLike.join(", ") || "(none found)"}`);

      const results = [];
      for (const p of products) {
        const outcome = classifyAgainstFoodKeeper(p, records, categoryLike);
        results.push({ kind: "product", id: p.id, name: p.name, category: p.category, ...outcome });
      }
      for (const item of CHEN_SEED_ITEMS) {
        const outcome = classifyAgainstFoodKeeper(item, records, categoryLike);
        results.push({
          kind: "chen-item",
          id: item.key,
          name: item.displayName,
          category: item.mappingCategory,
          ...outcome,
        });
      }

      const hits = results.filter((r) => r.verdict === "hit").length;
      const ambiguous = results.filter((r) => r.verdict === "ambiguous").length;
      const misses = results.filter((r) => r.verdict === "miss").length;
      console.log(
        `\nHit: ${hits}  Ambiguous: ${ambiguous}  Miss: ${misses}  (of ${results.length})`,
      );

      foodKeeperPhase = {
        status: "measured",
        recordCount: records.length,
        guessedNameFields: nameLike,
        guessedCategoryFields: categoryLike,
        results,
      };
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    localCorpus: {
      productFixtureCount: products.length,
      productsByCategory: Object.fromEntries(categoryCounts),
      chenItemCount: CHEN_SEED_ITEMS.length,
      chenItems: CHEN_SEED_ITEMS.map((i) => ({
        key: i.key,
        displayName: i.displayName,
        storageLocation: i.storageLocation,
        mappingCategory: i.mappingCategory,
      })),
    },
    foodKeeper: foodKeeperPhase,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nRaw results written to ${OUT_PATH}`);
}

main();
