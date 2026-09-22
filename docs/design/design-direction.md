# Design Direction — v2 (2026-09-15), reconciled to the PO's revamped prototype

**Status:** ADOPTED as the visual direction by PO decision (2026-09-15, D-019) — tokens below are the **v2 values used by [mockups/smart-kitchen-prototype.html](mockups/smart-kitchen-prototype.html)**; final token file is produced in M3-E0 with contrast ratios documented. Sections 1–5 below are the v1 synthesis (2026-09-03) kept as rationale; **where v1 and the v2 table in §0 disagree, §0 wins.** Competitor research and the "point of view" argument live in [KitchenSmart UIUX Design Plan_09-14-2026.md](KitchenSmart%20UIUX%20Design%20Plan_09-14-2026.md) (PO's design agent); architect assessment of that plan is §7.

## 0. v2 token sheet (authoritative)

| Token | v2 value | v1 value | Note |
|---|---|---|---|
| `bg.page` | `#efe5d5` sand | `#f5f4ed` | warmer, more saturated "pantry paper" |
| `bg.page.alt` | `#e4d7c2` sand-2 | — | photo-tile fallback |
| `bg.card` | `#fffbf4` paper | `#faf9f5` | |
| `bg.hero` | `#2a1f18` espresso (+ `#3b2d23`) | — | **new:** dark warm header on Home only; the one large dark surface allowed |
| `text.onHero` | `#f7efe2` cream | — | |
| `border` | `#dfd1ba` | `#d1cfc5` | |
| `text.primary` | `#1e1813` | `#141413` | |
| `text.secondary` | `#5b5045` | `#5e5d59` | |
| `text.tertiary` | `#665c52` (was `#8f8274`) | `#87867f` | **D-021 (2026-09-21):** darkened for AA on all four surfaces |
| `accent.brand` | `#d9673b` terracotta (deep `#b64f28`, pressed `#9c4322`, tint `#f9dece`, text on tint `#a74925`) · **primary CTA fill is `deep` (D-021)** | `#c96442` | **OQ-D1 resolved: terracotta.** Scarcity rule still binds — see §7 finding 2 |
| `sentiment.positive` | `#2c744b` (bg `#dfeee3`; was `#2f7d51`, D-021) | `#1f7a4d` | Known Fact chip, on-hand chips, fresh |
| `sentiment.warning` | `#925b0a` (bg `#f6e6c8`; was `#b4700c`, D-021) | `#ab6400` | Estimated chip, expiring soon, **allergen-unknown lines** |
| `urgency.today` | `#9d4b51` rose (bg `#f7dcdc`; was `#c75f66`, D-021) | `#c4666b` | "use today" — explicitly *not* allergen red |
| `sentiment.danger` | `#882020` (bg `#f9d9d9`; was `#b12a2a`, D-021) | `#b53333` | **ALLERGEN ONLY**, unchanged rule |
| `ai` | `#7b4cb5` (bg `#eadff7`) | `#8145b5` | AI Interpretation chip only |
| Display face | **Fraunces 600** (headings, recipe titles, hero) | optional | **OQ-D2 resolved: adopted** |
| UI/data face | Inter, `tnum`/`lnum` on all numbers | Inter | unchanged |
| Radius | 12 / 18 / 24 px, pills 9999, FAB circle | 8 / 12 / 16 | rounder, friendlier |
| Depth | borders + two-tone surfaces; warm shadow on the phone frame/sheets only | same | unchanged |

Freshness ring (NoWaste-style, from the plan) is adopted as a shared component: colour = time-to-expiry on the ladder positive → warning → rose, **never danger red**.
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
- ~~OQ-D1~~ **resolved 2026-09-15 (D-019): terracotta** — the PO adopted the v3 prototype, which uses it; fresh-green alternative retired.
- ~~OQ-D2~~ **resolved 2026-09-15: Fraunces** adopted as the display face (headings, recipe titles, hero).
- ~~OQ-D3~~ **done:** three prototype iterations; v3 is the PO's revamp (v1/v2 and the GPT reference kept in `mockups/Archives/`).
- **OQ-D7 (new):** provenance tier for Open Food Facts–sourced nutrition and allergen *label data* — the prototype shows the product identity as Known Fact but leaves nutrition/allergen rows tier-labelled per field; who may mint a KNOWN_FACT declaration from label data is D-017's open item (pre-M4 gate b). Decide before M4.
- **OQ-D8 (new):** photo licensing — the prototype hotlinks Unsplash; product imagery must come from the catalog source or licensed assets (add to R-4 legal list).

## 7. Architect assessment of the PO's revamp (2026-09-15) — what was adopted, fixed, or rejected

**Adopted from the plan and v3 prototype:** warm pantry-paper base and Fraunces/Inter pairing; dark espresso hero on Home; three-tier provenance chips as icon+text with the AI tier rendered as a `Confirm` action and a pinned "Needs your confirmation" tray; freshness ring; phase labels on Add Food; visible gap math and the check-off → "add to pantry?" loop on Shopping; "Why this?" expander; assistant as a labelled post-MVP preview entered from the Home header, not the nav.

**Fixed in the prototype at adoption (design-principles P5 / SR-2 violations):**
1. "Allergen screen passed · all 4 members" with a green check-shield (CSS class `safe`) on the Home and Recipes hero cards → now a neutral-ink `verdict` line "No known allergen match · 4 members · label data" plus the standing caveat "Known matches only · not a guarantee this food is safe." (canonical form, also used by the copy deck). Class renamed; `.safe` no longer exists.
2. Only the happy allergen state was designed → added an **ALLOWED_WITH_UNKNOWNS** card (amber, names *what* is unknown and for *whom*: "Allergen data unknown for Maya (severe: sesame) — miso has no ingredient statement on file · Not blocked, not cleared") and gave the existing **BLOCKED** row its evidence line ("Matched 'peanuts' in the ingredient statement") with the statement that blocked recipes are shown for transparency and cannot be cooked or planned.
3. Scan confirm claimed "Known fact · barcode verified · label data" for the whole sheet → Known Fact now scoped to *product identity (barcode match)*; nutrition/allergen rows carry a per-field source note and the allergen row reads "no known household match · label declaration · not a safety guarantee" in neutral ink (OQ-D7).
4. The Home "Ask your kitchen…" entry and the Inventory confirmation tray lacked phase labels (P10) → "post-MVP preview" and "fast-follow" added.
5. "92% match" could read as a confidence (the plan itself bans fake percentages) → the Why-this text now states it is a coverage score (4/4 on hand, expiry-weighted), not a confidence.

**Still to fix (design debt, M3-E0):** terracotta scarcity — v3 uses the brand hue on match badges, hero italic, buttons, active tab, scan tile and the loop banner; reduce to primary CTA, active nav indicator and the hero accent. Contrast ratios for `#c9b9a4`-on-espresso eyebrow text and cream-on-photo scrims must be measured (P9).

**Rejected from the plan (conflicts with recorded decisions):**
- "Known Fact: optionally no chip at all" — P2 requires every fallible fact to wear its tier; a quiet chip is fine, an absent chip is ambiguous with "no data".
- "Blocking confirmation if a user tries to plan a conflicting meal" — D-017/P5: BLOCKED is never offered as a choice; there is no confirm dialog.
- Stage-4 fallback to two confidence states — brief §14 and the ledger keep Estimated as a distinct tier; the *legend* may simplify, the model may not.
- Expo stack picks (NativeWind, React Native Reusables/gluestack v3, Reanimated, Moti, Skia) — recorded as **PROPOSED input to ADR-001** and M3 ticketing under rule 11, not adopted here.

**Screens the v3 prototype still lacks (ux-plan §7):** onboarding allergies (S2), item detail/history with one-tap correct (S5), barcode-miss → manual completion (S9), account/household (S1/S12), consume/discard from a row, recipe detail with the cook → USE_IN_MEAL confirm, empty/offline/permission states, provenance legend, undo, who-did-what, inventory sort/filter.
