#!/usr/bin/env node
/* global fetch, process, console, setTimeout */
// The above declares this file's Node/web globals for ESLint: this repo's
// eslint.config.js only wires `globals.node` into apps/**/packages/** — a
// root-config change out of scope here (M1-T5's file scope is scripts/**).
/**
 * M1-T5 R-1 research spike: measures real-world hit-rate + field completeness
 * of Open Food Facts (OFF) and USDA FoodData Central (FDC) against a
 * realistic ~100-item US grocery basket.
 *
 * NOT part of `pnpm test` / CI — this makes live network calls. Run it
 * manually:
 *
 *   node scripts/food-data-coverage-research.mjs
 *
 * Output: writes `docs/research/food-data-coverage.raw.json` (every
 * per-item result) and prints a summary table to stdout. The narrative
 * writeup lives in `docs/research/food-data-coverage.md`, hand-authored
 * from this script's output — this script does not write the .md file.
 *
 * Rate-politeness: OFF calls are sequential with a ~1.1s gap and a
 * descriptive User-Agent (OFF's stated policy: identify your client, don't
 * hammer). FDC calls use the public `DEMO_KEY` literal from api.data.gov —
 * NOT a personal signup key, rate-limited by api.data.gov to ~30
 * requests/hour, so only a documented ~25-item subset of the basket is sent
 * to FDC (see BASKET's `fdcSubset` flags below) — the rest of the basket is
 * OFF-only. No API key of any kind is stored anywhere else in this repo.
 *
 * Method (see docs/research/food-data-coverage.md for the full writeup):
 * the basket is assembled from general knowledge of common US grocery
 * categories (brief §18A: dairy, produce/PLU, meat, pantry, frozen, snacks,
 * beverages) — NOT by browsing OFF/FDC first, which would bias the sample
 * toward whatever those catalogs already contain. Two lookup methods are
 * used per item, tagged explicitly in BASKET and in the output, and never
 * conflated in the results:
 *   - "plu"  — a real, standardized IFPS PLU code (produce; not a GS1
 *              barcode) sent to OFF's barcode-lookup endpoint. Expected to
 *              miss on a barcode-keyed database; the miss itself is the
 *              finding (confirms ADR-006's "PLU handling" open question).
 *   - "name" — brand + product name text search. Used for every branded
 *              item because this script's author (an LLM with no shopping
 *              trip, no barcode scanner, and no access to OFF/FDC while
 *              constructing the basket) cannot attest a real 12/13-digit
 *              barcode from memory with confidence — fabricating one would
 *              produce a near-universal, meaningless miss (a check-digit-
 *              valid but nonexistent code essentially never resolves),
 *              which would corrupt this research rather than inform it.
 *              Name search instead measures "does this source know this
 *              product/ingredient at all" — a different, narrower question
 *              than true barcode-scan hit-rate, disclosed as a limitation.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

// `process.argv[1]` (not `import.meta.url`) — this repo's eslint.config.js
// resolves an ecmaVersion too old for `import.meta` on files outside
// apps/**/packages/** (scripts/ isn't a linted "project" there), and fixing
// that is a root-config change out of this ticket's file scope. `argv[1]`
// works identically here since this file is always run directly as the
// entry script (`node scripts/food-data-coverage-research.mjs`), never
// imported as a module.
const REPO_ROOT = path.resolve(path.dirname(process.argv[1]), "..");
const OUT_PATH = path.join(REPO_ROOT, "docs", "research", "food-data-coverage.raw.json");

const USER_AGENT =
  "SmartKitchenApp-ResearchSpike/0.1 (M1-T5; contact: research@smartkitchen.local)";
const OFF_DELAY_MS = 1100; // ~1 request/sec, rate-polite per OFF's stated policy
const FDC_DELAY_MS = 1500; // stays well under DEMO_KEY's ~30/hour cap across ~25 calls
const FDC_DEMO_KEY = "DEMO_KEY"; // public api.data.gov literal — NOT a personal signup key

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The basket. `method: "plu"` items carry a real standardized IFPS PLU code
 * in `query`. `method: "name"` items carry a "brand product-name" text
 * query. `fdc: true` marks the ~25-item documented FDC subset (spans every
 * category so the extrapolation in the writeup isn't skewed to one aisle).
 */
const BASKET = [
  // ---- Produce / PLU (real IFPS codes; barcode-lookup arm expected to miss) ----
  { category: "produce", description: "Banana", method: "plu", query: "4011", fdc: true },
  { category: "produce", description: "Gala apple", method: "plu", query: "4134", fdc: true },
  { category: "produce", description: "Navel orange", method: "plu", query: "4012", fdc: false },
  { category: "produce", description: "Lemon", method: "plu", query: "4053", fdc: false },
  { category: "produce", description: "Lime", method: "plu", query: "4048", fdc: false },
  { category: "produce", description: "Hass avocado", method: "plu", query: "4225", fdc: true },
  { category: "produce", description: "Roma tomato", method: "plu", query: "4087", fdc: false },
  { category: "produce", description: "Red bell pepper", method: "plu", query: "4688", fdc: false },
  {
    category: "produce",
    description: "Green bell pepper",
    method: "plu",
    query: "4065",
    fdc: false,
  },
  { category: "produce", description: "Yellow onion", method: "plu", query: "4082", fdc: true },
  { category: "produce", description: "Russet potato", method: "plu", query: "4072", fdc: false },
  { category: "produce", description: "Broccoli crown", method: "plu", query: "4060", fdc: true },
  { category: "produce", description: "Cauliflower", method: "plu", query: "4064", fdc: false },
  { category: "produce", description: "Iceberg lettuce", method: "plu", query: "4061", fdc: false },
  { category: "produce", description: "Cucumber", method: "plu", query: "4062", fdc: false },
  {
    category: "produce",
    description: "Green seedless grapes",
    method: "plu",
    query: "4022",
    fdc: false,
  },
  { category: "produce", description: "Garlic bulb", method: "plu", query: "4608", fdc: false },
  { category: "produce", description: "Celery", method: "plu", query: "4070", fdc: false },
  { category: "produce", description: "Zucchini squash", method: "plu", query: "4067", fdc: false },
  { category: "produce", description: "Cantaloupe", method: "plu", query: "4319", fdc: false },

  // ---- Dairy ----
  {
    category: "dairy",
    description: "Kirkland Signature whole milk, 1 gal",
    method: "name",
    query: "Kirkland Signature whole milk",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Chobani plain Greek yogurt",
    method: "name",
    query: "Chobani plain Greek yogurt",
    fdc: true,
  },
  {
    category: "dairy",
    description: "Fage Total 0% Greek yogurt",
    method: "name",
    query: "Fage Total 0% yogurt",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Kraft sharp cheddar cheese block",
    method: "name",
    query: "Kraft sharp cheddar cheese",
    fdc: true,
  },
  {
    category: "dairy",
    description: "Land O'Lakes salted butter",
    method: "name",
    query: "Land O'Lakes salted butter",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Philadelphia cream cheese",
    method: "name",
    query: "Philadelphia cream cheese",
    fdc: true,
  },
  {
    category: "dairy",
    description: "Grade A large eggs, dozen",
    method: "name",
    query: "large eggs grade A dozen",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Silk unsweetened almond milk",
    method: "name",
    query: "Silk unsweetened almondmilk",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Danone/Dannon plain yogurt",
    method: "name",
    query: "Dannon plain yogurt",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Sargento shredded mozzarella",
    method: "name",
    query: "Sargento shredded mozzarella",
    fdc: false,
  },

  // ---- Meat / seafood ----
  {
    category: "meat",
    description: "Tyson boneless skinless chicken breast",
    method: "name",
    query: "Tyson boneless skinless chicken breast",
    fdc: true,
  },
  {
    category: "meat",
    description: "Perdue ground chicken",
    method: "name",
    query: "Perdue ground chicken",
    fdc: false,
  },
  {
    category: "meat",
    description: "80/20 ground beef, 1 lb",
    method: "name",
    query: "80/20 ground beef",
    fdc: true,
  },
  {
    category: "meat",
    description: "Oscar Mayer bacon",
    method: "name",
    query: "Oscar Mayer bacon",
    fdc: false,
  },
  {
    category: "meat",
    description: "Oscar Mayer beef franks",
    method: "name",
    query: "Oscar Mayer beef franks hot dogs",
    fdc: false,
  },
  {
    category: "meat",
    description: "Hillshire Farm smoked sausage",
    method: "name",
    query: "Hillshire Farm smoked sausage",
    fdc: false,
  },
  {
    category: "meat",
    description: "Atlantic salmon fillet",
    method: "name",
    query: "Atlantic salmon fillet fresh",
    fdc: false,
  },
  {
    category: "meat",
    description: "Butterball ground turkey",
    method: "name",
    query: "Butterball ground turkey",
    fdc: true,
  },

  // ---- Pantry staples ----
  {
    category: "pantry",
    description: "Barilla spaghetti",
    method: "name",
    query: "Barilla spaghetti",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Ronzoni elbow macaroni",
    method: "name",
    query: "Ronzoni elbow macaroni",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Gold Medal all-purpose flour",
    method: "name",
    query: "Gold Medal all purpose flour",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Domino granulated sugar",
    method: "name",
    query: "Domino granulated sugar",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Bush's Best black beans",
    method: "name",
    query: "Bush's Best black beans",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Hunt's diced tomatoes",
    method: "name",
    query: "Hunt's diced tomatoes canned",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Bertolli extra virgin olive oil",
    method: "name",
    query: "Bertolli extra virgin olive oil",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Jif creamy peanut butter",
    method: "name",
    query: "Jif creamy peanut butter",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Skippy peanut butter",
    method: "name",
    query: "Skippy creamy peanut butter",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Cheerios cereal",
    method: "name",
    query: "Cheerios cereal General Mills",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Quaker old fashioned oats",
    method: "name",
    query: "Quaker Old Fashioned Oats",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Wonder Bread white sandwich bread",
    method: "name",
    query: "Wonder Bread white sandwich bread",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Nabisco Ritz crackers",
    method: "name",
    query: "Ritz crackers Nabisco",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Kikkoman soy sauce",
    method: "name",
    query: "Kikkoman soy sauce",
    fdc: true,
  },
  {
    category: "pantry",
    description: "French's yellow mustard",
    method: "name",
    query: "French's classic yellow mustard",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Heinz tomato ketchup",
    method: "name",
    query: "Heinz tomato ketchup",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Hellmann's real mayonnaise",
    method: "name",
    query: "Hellmann's real mayonnaise",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Pace chunky salsa medium",
    method: "name",
    query: "Pace chunky salsa medium",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Rice, long grain white, 5lb bag",
    method: "name",
    query: "long grain white rice",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Prego traditional pasta sauce",
    method: "name",
    query: "Prego traditional Italian pasta sauce",
    fdc: false,
  },

  // ---- Frozen ----
  {
    category: "frozen",
    description: "Birds Eye frozen mixed vegetables",
    method: "name",
    query: "Birds Eye frozen mixed vegetables",
    fdc: true,
  },
  {
    category: "frozen",
    description: "DiGiorno rising crust pepperoni pizza",
    method: "name",
    query: "DiGiorno rising crust pepperoni pizza",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Breyers vanilla ice cream",
    method: "name",
    query: "Breyers natural vanilla ice cream",
    fdc: true,
  },
  {
    category: "frozen",
    description: "Eggo homestyle waffles",
    method: "name",
    query: "Eggo homestyle waffles",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Tyson frozen chicken nuggets",
    method: "name",
    query: "Tyson frozen chicken nuggets",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Stouffer's lasagna with meat sauce",
    method: "name",
    query: "Stouffer's lasagna with meat sauce",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Ore-Ida frozen French fries",
    method: "name",
    query: "Ore-Ida golden crinkles french fries",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Dole frozen mixed fruit / berries",
    method: "name",
    query: "Dole frozen mixed berries",
    fdc: false,
  },

  // ---- Snacks / beverages ----
  {
    category: "snacks",
    description: "Lay's classic potato chips",
    method: "name",
    query: "Lay's Classic potato chips",
    fdc: true,
  },
  {
    category: "snacks",
    description: "Chips Ahoy! chocolate chip cookies",
    method: "name",
    query: "Chips Ahoy chocolate chip cookies",
    fdc: false,
  },
  {
    category: "beverages",
    description: "Coca-Cola, 12-pack cans",
    method: "name",
    query: "Coca-Cola classic 12 pack cans",
    fdc: true,
  },
  {
    category: "beverages",
    description: "Tropicana 100% orange juice",
    method: "name",
    query: "Tropicana pure premium orange juice",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Nature Valley oats & honey granola bars",
    method: "name",
    query: "Nature Valley oats and honey granola bars",
    fdc: true,
  },
  {
    category: "snacks",
    description: "Blue Diamond roasted salted almonds",
    method: "name",
    query: "Blue Diamond almonds roasted salted",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Tostitos tortilla chips",
    method: "name",
    query: "Tostitos scoops tortilla chips",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Cheez-It original crackers",
    method: "name",
    query: "Cheez-It original baked snack crackers",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Wrigley's/Trident chewing gum",
    method: "name",
    query: "Trident spearmint sugar free gum",
    fdc: false,
  },
  {
    category: "beverages",
    description: "LaCroix sparkling water, lime",
    method: "name",
    query: "LaCroix sparkling water lime",
    fdc: false,
  },
  {
    category: "beverages",
    description: "Folgers classic roast ground coffee",
    method: "name",
    query: "Folgers classic roast ground coffee",
    fdc: true,
  },
  {
    category: "beverages",
    description: "Lipton black tea bags",
    method: "name",
    query: "Lipton black tea bags",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Hershey's milk chocolate bar",
    method: "name",
    query: "Hershey's milk chocolate bar",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Reese's peanut butter cups",
    method: "name",
    query: "Reese's peanut butter cups",
    fdc: false,
  },
  {
    category: "snacks",
    description: "M&M's milk chocolate candies",
    method: "name",
    query: "M&M's milk chocolate candies",
    fdc: false,
  },

  // ---- Baking / condiments (rounds out §18A category spread) ----
  {
    category: "baking",
    description: "Nestle Toll House semi-sweet chocolate chips",
    method: "name",
    query: "Nestle Toll House semi sweet chocolate morsels",
    fdc: true,
  },
  {
    category: "baking",
    description: "McCormick pure vanilla extract",
    method: "name",
    query: "McCormick pure vanilla extract",
    fdc: false,
  },
  {
    category: "baking",
    description: "Arm & Hammer baking soda",
    method: "name",
    query: "Arm and Hammer baking soda",
    fdc: false,
  },
  {
    category: "condiments",
    description: "Frank's RedHot original hot sauce",
    method: "name",
    query: "Frank's RedHot original cayenne pepper sauce",
    fdc: false,
  },
  {
    category: "condiments",
    description: "Sweet Baby Ray's barbecue sauce",
    method: "name",
    query: "Sweet Baby Ray's original barbecue sauce",
    fdc: false,
  },
  {
    category: "condiments",
    description: "Hidden Valley ranch dressing",
    method: "name",
    query: "Hidden Valley Original Ranch dressing",
    fdc: true,
  },
  {
    category: "condiments",
    description: "Newman's Own Italian dressing",
    method: "name",
    query: "Newman's Own Italian dressing",
    fdc: false,
  },
  {
    category: "condiments",
    description: "Rao's marinara sauce",
    method: "name",
    query: "Rao's Homemade marinara sauce",
    fdc: false,
  },

  // ---- More produce / PLU to round out the category (per brief §18A weighting) ----
  {
    category: "produce",
    description: "Strawberries, 1 lb clamshell",
    method: "name",
    query: "fresh strawberries 1 lb clamshell",
    fdc: false,
  },
  {
    category: "produce",
    description: "Blueberries, 1 pint",
    method: "name",
    query: "fresh blueberries pint",
    fdc: false,
  },
  {
    category: "produce",
    description: "Baby carrots, 1 lb bag",
    method: "name",
    query: "baby carrots 1 lb bag",
    fdc: false,
  },
  {
    category: "produce",
    description: "Baby spinach, 5 oz bag",
    method: "name",
    query: "baby spinach 5 oz bag",
    fdc: false,
  },
  { category: "produce", description: "Sweet potato", method: "plu", query: "4797", fdc: false },
  {
    category: "produce",
    description: "Cilantro bunch",
    method: "name",
    query: "fresh cilantro bunch",
    fdc: false,
  },
  { category: "produce", description: "Yellow squash", method: "plu", query: "4784", fdc: false },
  {
    category: "produce",
    description: "Red seedless grapes",
    method: "plu",
    query: "4023",
    fdc: false,
  },

  // ---- Remaining dairy/pantry/meat/frozen to reach ~100 ----
  {
    category: "dairy",
    description: "Half & half, 1 pint",
    method: "name",
    query: "half and half cream 1 pint",
    fdc: false,
  },
  {
    category: "dairy",
    description: "Yoplait original strawberry yogurt",
    method: "name",
    query: "Yoplait Original strawberry yogurt",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Progresso chicken noodle soup",
    method: "name",
    query: "Progresso chicken noodle soup",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Campbell's condensed tomato soup",
    method: "name",
    query: "Campbell's condensed tomato soup",
    fdc: true,
  },
  {
    category: "pantry",
    description: "Welch's grape jelly",
    method: "name",
    query: "Welch's grape jelly",
    fdc: false,
  },
  {
    category: "pantry",
    description: "Smucker's strawberry preserves",
    method: "name",
    query: "Smucker's strawberry preserves",
    fdc: false,
  },
  {
    category: "meat",
    description: "Oscar Mayer deli sliced ham",
    method: "name",
    query: "Oscar Mayer deli sliced ham",
    fdc: false,
  },
  {
    category: "meat",
    description: "Jimmy Dean pork sausage roll",
    method: "name",
    query: "Jimmy Dean pork sausage roll",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Green Giant frozen broccoli florets",
    method: "name",
    query: "Green Giant frozen broccoli florets",
    fdc: false,
  },
  {
    category: "frozen",
    description: "Ben & Jerry's Chocolate Chip Cookie Dough ice cream",
    method: "name",
    query: "Ben and Jerry's Chocolate Chip Cookie Dough ice cream",
    fdc: false,
  },
  {
    category: "snacks",
    description: "Doritos nacho cheese tortilla chips",
    method: "name",
    query: "Doritos Nacho Cheese tortilla chips",
    fdc: true,
  },
  {
    category: "snacks",
    description: "Oreo original sandwich cookies",
    method: "name",
    query: "Oreo original chocolate sandwich cookies",
    fdc: false,
  },
  {
    category: "beverages",
    description: "Gatorade lemon-lime sports drink",
    method: "name",
    query: "Gatorade Thirst Quencher lemon lime",
    fdc: false,
  },
];

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const status = response.status;
  let body = null;
  try {
    body = await response.json();
  } catch (parseError) {
    // Optional-catch-binding (`catch {}`) is ES2019+; this file stays
    // ES2018-safe for the same reason noted above `orElse`/`prop`. The
    // parse failure itself isn't actionable here (body just stays null).
    void parseError;
    body = null;
  }
  return { status, body };
}

function offFieldCompleteness(product) {
  if (!product) return null;
  // `brands` is a comma-joined string on the full product endpoint but an
  // array of brand names on the search-a-licious hit projection — accept both.
  const brandsText = Array.isArray(product.brands) ? product.brands.join(", ") : product.brands;
  return {
    name: Boolean(product.product_name && String(product.product_name).trim().length > 0),
    brand: Boolean(brandsText && String(brandsText).trim().length > 0),
    nutrition: Boolean(
      product.nutriments &&
      (isFiniteNum(product.nutriments["energy-kcal_100g"]) ||
        isFiniteNum(product.nutriments["energy-kcal_serving"])),
    ),
    ingredients: Boolean(
      product.ingredients_text && String(product.ingredients_text).trim().length > 0,
    ),
    allergens: Boolean(product.allergens_tags && product.allergens_tags.length > 0),
    image: Boolean(product.image_front_url || product.image_url),
  };
}

function isFiniteNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Small "not null/undefined" fallback and safe-property helpers — used
 * instead of `??`/`?.` throughout this file. This repo's eslint.config.js
 * only configures a modern parser (ecmaVersion) for `apps/**` and
 * `packages/**` TypeScript sources; files elsewhere (like this script) fall
 * back to an older default that predates optional chaining/nullish
 * coalescing (ES2020). Fixing that is a root-config change out of this
 * ticket's file scope (M1-T5), so this script is written in plain,
 * ES2018-safe JS instead. Node itself runs modern syntax fine either way —
 * this is purely to keep `pnpm lint` (which lints the whole repo) green.
 */
function orElse(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}
function prop(obj, key) {
  return obj && typeof obj === "object" ? obj[key] : undefined;
}

function fdcFieldCompleteness(food) {
  if (!food) return null;
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const hasCalories = nutrients.some(
    (n) => /energy/i.test(orElse(n.nutrientName, "")) && isFiniteNum(n.value),
  );
  return {
    name: Boolean(food.description && String(food.description).trim().length > 0),
    brand: Boolean(food.brandOwner || food.brandName),
    nutrition: hasCalories || nutrients.length > 0,
    ingredients: Boolean(food.ingredients && String(food.ingredients).trim().length > 0),
    allergens: false, // FDC has no allergen field at all — a finding in itself, always false
    image: false, // FDC never returns product images — always false
  };
}

async function lookupOff(item) {
  const headers = { "User-Agent": USER_AGENT };
  if (item.method === "plu") {
    // Barcode-style lookup by the PLU digits (expected to miss — PLU isn't a GS1 barcode).
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(item.query)}.json`;
    const { status, body } = await fetchJson(url, headers);
    const found = status === 200 && body && body.status === 1 && body.product;
    return {
      source: "open-food-facts",
      lookupMethod: "barcode(plu)",
      hit: Boolean(found),
      matchedName: found ? orElse(body.product.product_name, null) : null,
      fields: found ? offFieldCompleteness(body.product) : null,
      httpStatus: status,
    };
  }
  // Name/brand text search via OFF's current search-a-licious API — the
  // legacy `cgi/search.pl` endpoint used in this script's first draft turned
  // out to be decommissioned (returns an HTML "temporarily unavailable"
  // page, not JSON — silently scored as 100% misses until caught mid-run
  // and fixed; see docs/research/food-data-coverage.md's method notes).
  const searchUrl = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(item.query)}&page_size=5`;
  const { status: searchStatus, body: searchBody } = await fetchJson(searchUrl, headers);
  const hits = Array.isArray(prop(searchBody, "hits")) ? searchBody.hits : [];
  const topHit = orElse(hits[0], null);
  if (!topHit) {
    return {
      source: "open-food-facts",
      lookupMethod: "name-search",
      hit: false,
      matchedName: null,
      resultCount: hits.length,
      fields: null,
      httpStatus: searchStatus,
    };
  }
  // Realistic two-step lookup: search finds a candidate code, then the app
  // fetches that code's full record (search-hit projections omit
  // `ingredients_text`) — matching how ProductLookupPort.resolve() would
  // actually be implemented against a name-matched candidate.
  await sleep(OFF_DELAY_MS);
  const detailUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(orElse(topHit.code, ""))}.json`;
  const { status: detailStatus, body: detailBody } = await fetchJson(detailUrl, headers);
  const fullProduct =
    detailStatus === 200 && prop(detailBody, "status") === 1 ? detailBody.product : topHit;
  return {
    source: "open-food-facts",
    lookupMethod: "name-search",
    hit: true,
    matchedName: orElse(fullProduct.product_name, orElse(topHit.product_name, null)),
    matchedCode: orElse(topHit.code, null),
    resultCount: hits.length,
    fields: offFieldCompleteness(fullProduct),
    httpStatus: searchStatus,
  };
}

async function lookupFdc(item) {
  const headers = { "User-Agent": USER_AGENT };
  const query = item.method === "plu" ? item.description : item.query; // PLU digits are meaningless to FDC's text search
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(
    query,
  )}&pageSize=5&api_key=${FDC_DEMO_KEY}`;
  const { status, body } = await fetchJson(url, headers);
  const foods = Array.isArray(prop(body, "foods")) ? body.foods : [];
  const top = orElse(foods[0], null);
  return {
    source: "usda-fdc",
    lookupMethod: "name-search",
    hit: Boolean(top),
    matchedName: top ? orElse(top.description, null) : null,
    resultCount: foods.length,
    totalHits: orElse(prop(body, "totalHits"), null),
    fields: top ? fdcFieldCompleteness(top) : null,
    httpStatus: status,
  };
}

async function main() {
  console.log(`Basket size: ${BASKET.length} items`);
  const fdcSubset = BASKET.filter((item) => item.fdc);
  console.log(`FDC documented subset: ${fdcSubset.length} items`);

  const results = [];
  for (let i = 0; i < BASKET.length; i++) {
    const item = BASKET[i];
    process.stdout.write(`[${i + 1}/${BASKET.length}] OFF: ${item.description} ... `);
    let off;
    try {
      off = await lookupOff(item);
    } catch (error) {
      off = { source: "open-food-facts", error: String(error) };
    }
    console.log(off.hit ? "HIT" : off.error ? `ERROR (${off.error})` : "miss");
    results.push({ ...item, off });
    await sleep(OFF_DELAY_MS);
  }

  for (let i = 0; i < fdcSubset.length; i++) {
    const item = fdcSubset[i];
    process.stdout.write(`[FDC ${i + 1}/${fdcSubset.length}] ${item.description} ... `);
    let fdc;
    try {
      fdc = await lookupFdc(item);
    } catch (error) {
      fdc = { source: "usda-fdc", error: String(error) };
    }
    console.log(fdc.hit ? "HIT" : fdc.error ? `ERROR (${fdc.error})` : "miss");
    const target = results.find(
      (r) => r.description === item.description && r.query === item.query,
    );
    if (target) target.fdc = fdc;
    await sleep(FDC_DELAY_MS);
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), basketSize: BASKET.length, results },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`\nRaw results written to ${OUT_PATH}`);

  // ---- summary ----
  const offHits = results.filter((r) => r.off.hit).length;
  const pluItems = results.filter((r) => r.method === "plu");
  const pluHits = pluItems.filter((r) => r.off.hit).length;
  const nameItems = results.filter((r) => r.method === "name");
  const nameHits = nameItems.filter((r) => r.off.hit).length;
  const fdcResults = results.filter((r) => r.fdc);
  const fdcHits = fdcResults.filter((r) => r.fdc.hit).length;

  console.log("\n===== SUMMARY =====");
  console.log(
    `OFF overall: ${offHits}/${results.length} (${((offHits / results.length) * 100).toFixed(1)}%)`,
  );
  console.log(`OFF barcode(PLU) arm: ${pluHits}/${pluItems.length}`);
  console.log(`OFF name-search arm: ${nameHits}/${nameItems.length}`);
  console.log(`FDC name-search subset: ${fdcHits}/${fdcResults.length}`);
}

main().catch((error) => {
  console.error("Research script failed:", error);
  process.exitCode = 1;
});
