# PRODUCT.md — Product Requirements Digest

Organized extraction of the authoritative product brief:
[docs/source/product-brief.extracted.md](docs/source/product-brief.extracted.md)
(original DOCX preserved unaltered in [docs/source/](docs/source/)).

**Classification legend** (used throughout this repo):

| Tag | Meaning |
|---|---|
| `DOCUMENTED` | Explicitly stated in the source brief (§ refs point to brief sections) |
| `INFERRED` | Reasonable engineering/product inference; not stated in the brief |
| `UNKNOWN` | Requires a product-owner decision or further input |

The brief is **authoritative for product intent, not for technical architecture or MVP scope.**
Engineering-scoped MVP lives in [docs/prd/MVP_PRD.md](docs/prd/MVP_PRD.md). Architecture lives in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Product vision

- `DOCUMENTED` (§1, §20) Mobile-first, AI-powered kitchen/food management app that maintains a continuously updated digital inventory of pantry, refrigerator, and freezer, minimizing manual data entry via camera, barcode, receipt scanning, and image recognition.
- `DOCUMENTED` (§1) Closed loop: Inventory → Meal Recommendations → Meal Planning → Shopping List → Grocery Purchase → Inventory Update → Nutrition Tracking.
- `DOCUMENTED` (§17, §20) Positioning: "Your AI Kitchen Manager" / "an AI operating system for the household kitchen" — not "another recipe app."
- `DOCUMENTED` (§18F) Retention thesis: the user must feel "this app saves me work," not "another food database to maintain."

## 2. Target users

- `DOCUMENTED` (§3, §12) Households (multi-member, shared inventory, per-member profiles with dietary preferences, allergies, and nutrition goals). The brief's example household is two adults sharing one inventory across phones.
- `INFERRED` Primary early adopter: a household member who already does most meal planning/grocery shopping and is motivated by saving time, reducing waste, or hitting nutrition goals.
- `UNKNOWN` Geographic market (affects receipt formats, barcode coverage, food databases, units, language). Brief examples are US-centric ($, lbs, USDA). See [MVP_PRD open questions](docs/prd/MVP_PRD.md#open-questions).
- `UNKNOWN` Monetization model (subscription? free tier? affects AI cost ceilings per user).

## 3. Primary user journeys

All `DOCUMENTED` unless noted:

1. **Stock the inventory** — scan barcode (§2A), photograph receipt and confirm parsed items (§2B), photograph shelf contents and confirm detections (§2C, explicitly "a future capability"), or manual entry/adjustment (§2A, §7).
2. **Decide what to cook** — "What can I make with what I have?" ranked by inventory utilization, expiration urgency, nutrition fit, preferences, missing-ingredient count, prep time, history (§4).
3. **Plan meals** — tonight → 7-day plans with per-meal macros and daily totals (§5).
4. **Shop** — approved plan diffs against inventory → BUY vs ALREADY HAVE list; editable, categorized, shared, offline-capable (§6).
5. **Cook & consume** — logging a meal decrements inventory; manual corrections always possible; consumption/waste history kept (§7).
6. **Avoid waste** — expiration estimates, "use it soon" notifications, recipes that consume aging items ("Use It Before You Lose It") (§8).
7. **Track nutrition** — daily calorie/macro dashboard vs goals; inventory-aware "what should I eat tonight to stay in budget" (§9).
8. **Converse** — natural-language assistant over all of the above (§10).

## 4. Functional requirements (by workflow)

### 4.1 Inventory lifecycle
- `DOCUMENTED` (§2A) Storage locations: Refrigerator, Freezer, Pantry, Other.
- `DOCUMENTED` (§2A) "2 × 16 oz yogurt" = two inventory units, not one entry.
- `DOCUMENTED` (§7) Depletion reasons: Used, Consumed, Discarded, Expired, Donated, Manually adjusted → historical record of consumption and waste.
- `DOCUMENTED` (§18C) Inventory accuracy is "the biggest product challenge"; the system must minimize manual maintenance and continuously infer inventory changes.
- `INFERRED` Inventory changes should be recorded as an auditable ledger of transactions rather than silent quantity mutation — this is the engineering realization of §7's "historical record" + §14's explainability. See [domain-model.md](docs/architecture/domain-model.md).

### 4.2 Barcode workflow
- `DOCUMENTED` (§2A) Scan UPC/GTIN → retrieve name, brand, category, quantity, package size, serving size, calories/protein/carbs/fat/fiber/sugar/sodium, ingredients, allergens, image, storage category, approximate shelf life. User can adjust quantities after scanning.
- `INFERRED` No single data source provides all fields for all products (§18A concedes this); a lookup cascade + manual-completion fallback is required.

### 4.3 Receipt workflow
- `DOCUMENTED` (§2B) Photograph receipt → OCR/AI extracts store, date, products, qty, package size, price, category → **confirmation screen before anything enters inventory** → user corrects errors → receipt stored as historical transaction.
- `DOCUMENTED` (§18B) Known hard cases: abbreviations, store SKUs, weighted produce, generic descriptions, coupons, discounts, multi-quantity lines. Receipt data must be normalized to canonical food products.
- `INFERRED` Duplicate-upload protection (same receipt scanned twice must not double-add inventory) — idempotency requirement.

### 4.4 Image-recognition workflow
- `DOCUMENTED` (§2C) Future capability. Vision proposes candidates ("We found 14 possible food items"); nothing auto-added; user confirms.
- `DOCUMENTED` (§14) Every automatic detection carries a confidence level; below-threshold detections require user confirmation.

### 4.5 Recipes & recommendations
- `DOCUMENTED` (§4) Inputs: inventory + quantities, expirations, preferences, allergies, calorie/macro goals, meal type, cook time, servings, skill, history, ratings, use-soon items. Ranked per §4's criteria.
- `DOCUMENTED` (§18D) Recipe content must be original AI-generated, licensed, or rights-cleared — **never scraped from copyrighted sites**.
- `DOCUMENTED` (§15D) System learns likes/rejections/dislikes/cuisines over time (post-MVP).
- `DOCUMENTED` (§15E, §15F) Leftover awareness; portion scaling with inventory adjustment (post-MVP).

### 4.6 Shopping list
- `DOCUMENTED` (§6) list = required ingredients − usable on-hand inventory; BUY vs ALREADY HAVE; editable; categorized by department; shared with household; available offline; syncs across devices.

### 4.7 Nutrition
- `DOCUMENTED` (§9) Track calories, protein, carbs, fat, fiber, sugar, sodium per logged meal; daily goal/consumed/remaining dashboard; inventory-aware "fit my remaining budget" suggestions.
- `INFERRED` Nutrition arithmetic must be deterministic over verified per-product values — an LLM must not "estimate" totals when source data exists (follows from §14 + §18E).

### 4.8 Household & sharing
- `DOCUMENTED` (§12) One shared inventory per household; changes propagate to all members; "multiple household members with appropriate permissions."
- `UNKNOWN` Permission model detail (roles? child accounts? who can edit profiles/allergies of others?).

### 4.9 Cloud sync
- `DOCUMENTED` (§1, §13) Cloud-connected platform; multi-user, multi-device synchronization; mobile app → API server → cloud DB → AI services → external data sources.
- `DOCUMENTED` (§6) Shopping list specifically must be *available offline*.
- `UNKNOWN` Required depth of offline support for the rest of the app (read-only cache vs full offline write + conflict resolution). Materially changes architecture → [ADR-010](docs/adr/ADR-010-offline-sync.md).

### 4.10 Conversational interface
- `DOCUMENTED` (§10) Natural-language assistant over inventory, planning, shopping, nutrition. (Scoped post-MVP in our plan — the underlying capabilities must exist first.)

### 4.11 Smart home
- `DOCUMENTED` (§11) Phase-3 ambition: Apple/Google/Alexa/SmartThings/Matter, smart fridge/oven, voice. Design constraint that applies **now**: extensible API layer, no dependence on one ecosystem.

## 5. Non-functional requirements

- `DOCUMENTED` (§14) Data-quality/confidence system: every AI-detected fact has confidence; three provenance tiers — **Known Fact / Estimated / AI Interpretation** — surfaced to users to build trust.
- `DOCUMENTED` (§18E) Safety: allergen detection uses deterministic rules + verified product data; AI is an additional layer, never the sole authority.
- `DOCUMENTED` (§3) Serious allergies: prominent warning; never imply a food is guaranteed safe merely because an allergen isn't listed.
- `DOCUMENTED` (§18F) Automation-first UX: minimize manual maintenance.
- `INFERRED` Standard NFRs not stated in the brief: security/privacy of health-adjacent data, cost ceilings for AI inference, latency targets, observability. See [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. External-data dependencies

- `DOCUMENTED` (§13, §18A) Food/product DBs, nutrition DBs, recipe sources, retail/product DBs. USDA FoodData Central named as *one* nutrition source (incl. branded foods) — explicitly **not** assumed to solve UPC identification. Multiple sources + own normalized product database required.
- `INFERRED` Additional providers implied: OCR/vision, LLM, auth, push notifications. All behind adapters → [ADR-005](docs/adr/ADR-005-ai-provider-abstraction.md), [ADR-006](docs/adr/ADR-006-food-data-sources.md), [ADR-007](docs/adr/ADR-007-receipt-ocr-pipeline.md).

## 7. Assumptions, constraints, risks

**Assumptions (INFERRED unless tagged):**
- Users will tolerate a confirmation step for AI-ingested data (`DOCUMENTED` §2B/§2C makes confirmation a design principle).
- Smartphone camera quality is sufficient for barcode + receipt capture.
- A small founding team; cost-sensitive; iteration speed matters (engineering context, not from brief).

**Constraints:**
- `DOCUMENTED` (§18D) No scraping copyrighted recipes.
- `DOCUMENTED` (§18E) No AI-only allergen decisions.
- `DOCUMENTED` (§11) No single-ecosystem lock-in for smart home.
- `INFERRED` No premature vendor lock-in for AI/OCR/food data (follows from §18A "multiple data sources").

**Top risks (ranked; engineering view):**
1. **Inventory drift** — users abandon if they must constantly correct (`DOCUMENTED` §18C). Mitigation: ledger model, confirmation flows, correction-rate metric as the primary product-health KPI.
2. **Product identification coverage** — barcode→product→nutrition mapping gaps (`DOCUMENTED` §18A). Mitigation: source cascade, own normalized DB, graceful manual fallback. RESEARCH REQUIRED: real coverage rates.
3. **Receipt normalization accuracy** (`DOCUMENTED` §18B). Mitigation: confirmation screen is load-bearing; fixture-driven evaluation before live rollout.
4. **Allergen safety failure** (`DOCUMENTED` §18E) — a single bad answer is a trust/catastrophe event. Mitigation: deterministic rule layer, warning language, never-guaranteed-safe framing.
5. **Crowded market / weak differentiation** (`DOCUMENTED` §16) — barcode+pantry+recipes alone is table stakes; differentiation is automation quality.
6. **AI/OCR unit economics** (`INFERRED`) — per-user inference cost could exceed willingness to pay. Mitigation: cost telemetry from day 1, caching, model tiering.

## 8. Unanswered questions (product owner input needed)

Tracked as OPEN items in [DECISIONS.md](DECISIONS.md); the load-bearing ones:

| # | Question | Why it matters |
|---|---|---|
| Q1 | Launch market/locale (US-only first?) | Receipt formats, food DB choice, units, language |
| Q2 | Offline depth beyond shopping list? | Sync architecture (ADR-010) |
| Q3 | Household permission model (roles, minors)? | Data model + privacy design |
| Q4 | Monetization / cost ceiling per user? | AI model tiering, feature gating |
| Q5 | Are per-member (not just household) nutrition goals in MVP? | Profile + meal-log data model |
| Q6 | Recipe strategy: AI-original only at launch, or license a DB too? | Cost, quality, legal review |
| Q7 | Age range of users (COPPA-type concerns if minors have profiles)? | Legal/compliance |
| Q8 | Brand/name of product? | Naming in app stores, repo cosmetics only |
