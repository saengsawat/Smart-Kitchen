# Design Direction — mix-and-match synthesis

**Status:** PROPOSED (awaiting product-owner reaction; final ratification alongside M3 UX work)
**Method:** all 53 brand design systems in the owner's template library (`999_Design Templates\...\design-md\`) were reviewed and scored against this app's needs: warm consumer feel (food/home/family), safety-critical clarity (allergens), data legibility (quantities/macros/expiry), provenance badges (§14 Known Fact / Estimated / AI Interpretation), light-first with dark support, React Native implementability.

**Verdict:** no single system fits whole. The recommendation is a composite of six, with one rule inherited from each.

## 1. Scoring summary (what fit and what didn't)

- **Top donors:** Claude (warm surfaces + real dark mode), Zapier (warm neutral ramp, border-first depth), Pinterest & Airbnb (consumer warmth, card/badge mechanics), Stripe (numeric/data discipline), Wise (sentiment tokens, press feedback), Expo (semantic colors, RN-native geometry, free fonts), Intercom (reserve-one-hue-for-AI rule), Notion (badge formula, lining numerals).
- **Rejected as bases:** all dark-first/dev-tool systems (Linear, Vercel, Raycast, Supabase, Warp, ClickHouse, Composio, x.ai, Figma — cold, achromatic, or dark-only), entertainment dark (Spotify), industrial (BMW, Nvidia, SpaceX), achromatic consumer (Uber, Cal, Ollama — good geometry, but a colorless system cannot express expiry urgency or allergy danger).
- **Reserves:** Clay's food-named color ramps (Matcha/Lemon/Pomegranate) and Miro's pastel light/dark pairs — for future category/storage-zone chips.

## 2. The composite

### Foundation: warm neutrals (from Claude, cross-checked by Zapier/Pinterest/Notion — all four independently warm-shift their grays)
Rule adopted: **every neutral has a warm undertone; no cool blue-grays anywhere; never pure `#ffffff`/`#000000` as page/text.**

| Token | Light | Dark | Source |
|---|---|---|---|
| `bg.page` | `#f5f4ed` parchment | `#141413` | Claude |
| `bg.card` | `#faf9f5` ivory | `#30302e` | Claude |
| `bg.interactive` | `#e8e6dc` warm sand | `#3d3d3a` | Claude |
| `border.subtle` | `#f0eee6` | `#30302e` | Claude |
| `border.strong` | `#d1cfc5` | `#4d4c48` | Claude |
| `text.primary` | `#141413` | `#faf9f5` | Claude |
| `text.secondary` | `#5e5d59` | `#b0aea5` | Claude |
| `text.tertiary` | `#87867f` | `#87867f` | Claude |

Mockup-validated neutral additions (2026-09-03): `bg.tile #efede3` (icon/photo placeholder tiles), `bg.chipNeutral #eceae0` (neutral chips, muted rows), `border.divider #e8e6dc` (tab strips, prominent dividers — same value as `bg.interactive`).

Depth = **borders + two-tone surfaces, not shadows** (Zapier/Expo — sidesteps iOS `shadowOffset` vs Android `elevation` inconsistency). One soft shadow allowed for overlays/bottom sheets (scanner sheet), warm-tinted per Stripe's formula re-tinted brown (`rgba(60,45,35,0.22)`).

### Brand accent: terracotta (from Claude), kept scarce (rule from Airbnb/Zapier)
- `accent.brand` = **`#c96442` terracotta** (pressed `#a54f33`, tint surface `#f3e0d8`). Warm, appetitive, kitchen-not-lab, and — critically — **not** red, green, amber, or purple, so it never collides with the semantic ladder.
- **Scarcity rule (adopted verbatim):** brand accent appears only on the primary CTA, active nav indicator, and focus states. Never on backgrounds or large surfaces. This scarcity is what lets an allergen alert outrank everything.
- *Considered alternative:* Wise-style fresh lime (`#9fe870`/`#163300`) — produce-fresh and lovely, rejected as primary because green is needed as a *semantic* (fresh/verified) color; using it for brand would dilute both. Revisit only if branding (Q8) demands green.

### Semantic ladder (Wise sentiment tokens + Expo's alarm-fatigue principle)
Named by sentiment, not color; each with default/pressed/tint variants (opencode's 3-stage ladder).

| Token | Value | Use | Rule |
|---|---|---|---|
| `sentiment.danger` | `#b53333` (Claude crimson) | **Allergen alerts ONLY** | The only saturated red in the app. Never reused for expired food, errors, or destructive buttons (those use muted rose `#c4666b`). |
| `sentiment.warning` | `#ab6400` deep amber (Expo) | Expiring soon, low-confidence data | Deliberately deep, not bright — quiet enough that danger stays loud |
| `sentiment.positive` | `#1f7a4d` (Stripe-family green, warm-shifted) | Fresh, in-stock, verified | Also the "use-by OK" state |
| `sentiment.info` | `#3898ec` (Claude focus blue) | Focus rings, informational | The single cool color, per Claude — accessibility only |

Expiry urgency = a ramp within the ladder (positive green → amber → muted rose), **never touching allergen red** (Webflow's 6-hue ramp inspired the gradation; our version stays within sentiment tokens).

### Provenance badges — §14 made visible (Stripe's alpha-tint formula × Intercom's reserved-hue rule)
Badge anatomy (Stripe, verbatim): `bg = hue @20%, border = hue @40%, text = darkened hue, radius 9999px (pill), 12px/600, +0.125px tracking` (Notion's micro-tracking).

| Tier | Hue | Reads as |
|---|---|---|
| **Known Fact** (barcode-verified) | `sentiment.positive` green | verified, settled |
| **Estimated** (shelf-life-derived date etc.) | `sentiment.warning` amber | honest uncertainty |
| **AI Interpretation** (OCR/vision/normalization) | **`#8145b5` preview purple** (Expo) | provisional, machine-suggested |

Intercom's rule adopted with a twist: they reserve one hue exclusively for AI content; we use Expo's purple (not orange, which would collide with our terracotta brand). **Purple appears nowhere else in the app.**

### Typography (Expo/Stripe/Notion consensus)
- **Inter** (free, variable, ships naturally with Expo/RN) for ALL UI and body. Weights decisive: 400 body / 500 UI / 600 emphasis / 700 headings — no in-between weights (Expo), no weight-300 anywhere (frail at kitchen glance-distance).
- **`font-feature-settings: "tnum"` on every number** — quantities, grams, calories, prices, days-to-expiry (Stripe). Lining numerals (`lnum`) on data text (Notion). Numbers must not jitter in scrolling lists.
- Compact functional band: 12px badges / 13px captions / 15–16px body / 18px card titles / 22–28px screen titles (Pinterest's app-density scale — most template systems are marketing-page scales and would feel bloated in-app).
- **Optional display face** (recipe titles, onboarding heroes only): a warm serif in the Claude spirit — e.g. Fraunces (free, Google Fonts) at a single weight. DECIDE-LATER with branding (Q8); Inter-only is the safe default.
- Micro-labels above values (`PROTEIN`, `EXPIRES`, `SOURCE`): 10–11px, 600, +0.5–1px tracking, uppercase, `text.tertiary` (MongoDB pattern).

### Geometry & interaction
- Radius by role (Airbnb/Expo): 8px buttons/inputs · 12px cards · 16px featured cards/sheets · 9999px chips & badges · 50% circular FAB (scan button — Pinterest's circular action, `bg.interactive` + icon).
- Press feedback = **scale, not color**: `scale(0.97)` on press via `Pressable` + spring (Wise's pattern; color-based press states are unreliable across Android ripple).
- Segmented control (Inventory / Recipes / List): 3px bottom-inset indicator in terracotta on the active tab, hover in `border.strong`, idle tabs unmarked (Zapier's inset-underline — no layout shift).
- Cards: photography-top recipe/product cards at 16:10 (Airbnb anatomy) — food photos carry the visual warmth so the chrome stays quiet.

## 3. Safety-specific rules (bind UI to SR-1/SR-2)
1. Allergen red `#b53333` is exclusive to allergen contexts; any PR introducing it elsewhere fails review.
2. Allergen alerts use fill + icon + text — never color alone (color-blind users; WCAG).
3. "Unknown allergen data" renders as amber `allowed-with-unknowns` chip + warning line — never a green badge, never the word "safe."
4. Contrast: document a ratio per token pair (Notion's practice); minimum 4.5:1 body, 3:1 large text, alert text ≥7:1.

## 4. Implementation notes (for M3)
- Token architecture: three tiers `base → semantic → component` (Pinterest) — base hex never referenced by components; dark mode flips only the semantic layer (Mintlify's mapping table as the template).
- Everything above ships as a typed `packages/contracts` (or `packages/ui`) token module; no raw hex in screens.
- Claude's ring-shadows translate to RN as `borderWidth: 1` + border color — keep the values, drop the shadow mechanism.

## 5. Adopted from external mockup review (GPT Sol 5.6 mockup, 2026-09-03)

A comparison mockup (`mockups/kitchenos_mvp_mockup_GPT.html`, product-owner supplied) was reviewed against this direction. Four ideas were adopted, re-skinned into our tokens:
1. **Home dashboard** as the app's landing screen: greeting → "tonight's best match" card → kitchen-snapshot stat tiles → use-it-soon list.
2. **Explainability affordance:** deterministic match score (e.g. "92% match") + a "Why this?" expander stating the ranking factors — §14 trust expressed as UI. Copy must state the score is computed, not generated.
3. **Inventory-accuracy tile** ("94% · 2 items need confirmation"): our north-star correction metric surfaced as a user-facing re-engagement hook.
4. **Multi-method Add screen** (barcode / receipt / shelf photo / manual) with confirm-before-add behavior on every probabilistic path; non-MVP methods carry phase badges ("fast-follow", "future") so mockups stay scope-honest.

Explicitly **rejected** from that mockup: cool blue-gray neutrals and gradients (violates the warm-neutral rule), emoji-as-icons, red badges for expiration urgency (red is allergen-exclusive here), meal-plan/nutrition-dashboard screens (deferred scope, D-002), and allergy safety as chat-text disclaimer (violates SR-1).

**Assistant (added later at PO request, 2026-09-03):** included in the prototype as an explicitly labeled **post-MVP preview** — entered from a Home header button, deliberately *not* in the primary nav (nav reflects MVP scope). The preview demonstrates the safe pattern: every answer carries a provenance caption; the allergen exchange shows the answer coming from verified label data + household rules with the standard red alert bar, and never claims a food is safe. D-002 scope is unchanged — the assistant remains deferred for implementation.

## 6. Open items
- OQ-D1: brand accent final call — terracotta (recommended) vs fresh-green (alternative) — cheap to flip until M3 mockups; ties to product name/brand (Q8).
- OQ-D2: optional serif display face — decide with branding.
- OQ-D3: validate the palette in real mockups — first pass done: clickable prototype at [mockups/smart-kitchen-prototype.html](mockups/smart-kitchen-prototype.html) (open in any browser); awaiting PO reaction.
