# KitchenSmart UI/UX Design Plan: Making a Data-Dense Kitchen App Feel Warm, Premium & Distinctive

## TL;DR
- **The founder's diagnosis is right, and it's fixable without new features.** "Looks like Claude web" = default component-library aesthetics: cool neutral grays, system fonts, flat cards, no accent discipline, no imagery, no motion. The fix is a committed visual point of view: a warm "pantry-paper" neutral base (bone/sand, not gray — think the #F2EDE4 / #C8B49A range), ONE confident accent, a real display typeface paired with a workhorse UI sans, food photography as the hero, and a rigorous elevation/radius system. Samsung Food itself is *not* typographically distinctive — its polish comes almost entirely from **large food photography + a single disciplined orange accent (#FF992A) on white with dark-gray #313131 text**. KitchenSmart can beat it by keeping that discipline but adding warmth and a proprietary type voice.
- **Confidence and safety are your differentiators — make them a visual system, not an afterthought.** Adopt the well-established "Confidence UI" pattern: three named states (Known Fact / Estimated / AI Interpretation) shown as consistent inline badges tied to each item, using shape + icon + label (not color alone), with low-confidence items gated behind an explicit "confirm" affordance. Treat allergens as a separate, always-on hard-safety layer (never the same visual language as confidence) — a persistent high-contrast red shield that survives dark mode and colorblindness.
- **Build it in Expo with NativeWind (styling) + a copy-in component layer (React Native Reusables / gluestack v3) + Reanimated (motion), NOT React Native Paper.** Paper's Material Design defaults are exactly what makes an app look templated. Load custom fonts via `expo-font`, define a token-based theme, and own your components so you can style away from iOS/Material defaults.

## Key Findings

### What actually makes Samsung Food feel polished (the app the founder admires)
1. **Photography does the heavy lifting.** The Home "For you" feed is a stack of horizontal carousels ("Would you make it again?", "Chosen for you", "Popular creators", "Recently viewed") built around large, high-quality food photography with the recipe title as overlay/caption text. Reviewers consistently call the app "very clean and tidy" and "clean, with clear icons and minimal taps." It leans on imagery, not text density, at the feed level.
2. **One accent color, used sparingly.** Samsung Food's brand palette is just three colors: **#FF992A ("Sunshade" orange), white #FFFFFF, and dark gray #313131 ("Mine Shaft")**. The orange appears only on primary actions — the floating "+" FAB, primary buttons, the star marking the default list. Everything else is white canvas + dark-gray text. This single-accent discipline is the biggest driver of the "premium" read.
3. **It is NOT typographically distinctive.** Samsung's system font is "One UI Sans," but Samsung's own apps don't reliably force it — the app most likely renders in platform default (Roboto on Android, San Francisco on iOS). Its polish is imagery + color + spacing, not type. **This is KitchenSmart's opening: a distinctive typeface pairing is a cheap, high-impact way to out-craft Samsung Food.**
4. **Feed-of-rails + sticky headers + context menus.** The Meal Planner was redesigned in 2025 into four top tabs (Plan / For You / Queue / Previous) with a sticky header that stays visible on scroll; drag-and-drop was replaced by long-press context menus. Lists use a sticky header to toggle Shopping List / Food List. These are the polished micro-patterns worth stealing. Bottom nav is a persistent five-tab bar: Home, Explore, Planner (calendar icon), Saved, Lists.
5. **Its weaknesses are instructive.** Reviewers flag that Home vs Explore tabs are confusingly redundant, recipe-detail pages are cluttered with duplicate buttons, and — critically — the Food List (pantry) has a use-by date field but **explicitly does NOT notify users when items near expiry** (Samsung's own help docs state: "we do not notify users about any items in the Food List that are close to their due date"). That is a wide-open gap KitchenSmart's expiring-ingredients Home should own.

### The competitor landscape (inventory-first vs recipe-first vs list-first)
- **NoWaste** — the best expiration UX in the category. Each item has a **colored ring/indicator showing how close to expiration it is**, and the app sorts/filters by expiration date, name, category, or placement (fridge/freezer/pantry). A representative App Store review praises it as "perfectly simple (without all the unnecessary clutter other apps add)." Steal the freshness ring.
- **SuperCook** — the reference "what can I make from what I have" flow: build a pantry from a categorized ingredient list of 2,000+ ingredients (produce, meats, etc.), then it surfaces only recipes you can make right now, matched against an aggregated **11M+ recipes pulled from ~18,000 recipe websites** (per pntrypal.com's 2026 comparison). Praised for a "simplistic UI" and voice ingredient entry; free. Its whole model is subtractive filtering.
- **KitchenPal** — pantry zones (pantry/fridge/freezer/custom), a **5M+ product barcode library** (recently up from 4M, per its current App Store/Google Play listings), Nutri-Score comparison, and auto-expiry detection "for items like fridge food / produce." But reviewers call it "too complex," with auto-categorization making items hard to find and clumsy unit entry (entering eggs prompted for ounces instead of a count). A cautionary tale about density and unit modeling.
- **Cooklist** — loyalty-card auto-import is its killer feature (removes the data-entry friction that kills pantry apps); per cooklist.com it imports purchases from **81 retailers** ("Walmart, Kroger, Safeway, Wegmans and 75 more"), matches **over 1 million recipes** against your pantry, auto-calculates expiration + fires notifications, and runs a smart loop: when you use up a pantry item, it asks if you want to add it to your shopping list. Rated 4.7 on iOS / 4.4 on Android. But the UI is repeatedly called "cluttered/busy" and "confusing at first."
- **Mealime** — clean meal-planning-to-grocery flow; its standout is grocery-list online-shopping integration that closes the plan→execution gap. Personalizes by dietary needs, **allergies, and ingredient dislikes** captured at onboarding.
- **Kitchen Stories** — the design benchmark for warmth: it won an **Apple Design Award in 2017** (Apple Newsroom: "Written almost entirely in Swift, Kitchen Stories is an impressive app that enables anyone to cook a delicious meal") and a **Google Material Design Award in 2016 in the "Expressive Layout" category** ("excels at creating effective, easy-to-scan layouts for recipes across a variety of screens and sizes"). Now **a global cooking platform with over 6 million users worldwide**, it's described as feeling "like opening a designer cookery magazine" — large clear photography, generous whitespace ("light, airy, uncluttered"), modern lightweight typography, custom illustrated food icons, and a "sunny yellow" identity with a distinctive squiggle logomark (its rebrand uses Bricolage Grotesque). This is the emotional target.

### Best-in-class adjacent inspiration (data-dense but warm/premium)
- **Copilot Money** — a **2024 Apple Design Award finalist** (Interaction category; the app launched in 2020, is built by a small Brooklyn/Santiago team, and holds a 4.8-star App Store rating across 30,000+ reviews) — proves "data-dense financial UIs can be beautiful." Principles worth borrowing: treats data as design material; **progressive disclosure** (summary cards first, no spreadsheet grid on launch); a warm-not-pure-black dark canvas (~#000814); polished micro-interactions (animated dials, Face ID confirmation); helpful empty states with clear CTAs.
- **2026 color direction** across the industry is moving away from stark white + pure gray toward **"elevated neutrals" / warm minimalism** (bone #F2EDE4, sand #C8B49A, charcoal #2E2E2E) with a single **hyper-saturated accent** used intentionally. Pure gray (#808080) now "feels dated"; tinted neutrals and near-blacks like #09090B (not #000000) are the standard. This is exactly the antidote to "Claude web generic."

## Details

### 1. Recommended Visual Design Language for KitchenSmart

Give the app a **point of view**: "a warm modern pantry — tactile, honest, and calm." The metaphor is unbleached paper, kraft, ceramic, and fresh produce, not a SaaS dashboard.

**Color system (the single biggest lever).**
- **Warm neutral base, not gray.** Backgrounds and surfaces in a "pantry paper" family: canvas around a warm bone/off-white (e.g. #F7F3EC), raised surfaces slightly lighter or with a warm hairline border, deep text in a warm near-black charcoal (~#221F1A) rather than #000. This one swap — warm neutrals instead of cool grays — is what most separates "premium" from "template."
- **ONE confident brand accent, disciplined like Samsung's orange.** Recommend a **warm herb/olive or deep avocado green** as primary (fresh-food coded without being the clichéd generic "app green"), e.g. a range around #3E5B3A–#5B7A4B; OR a warm terracotta/paprika (#C4633A range) if you want to differentiate harder from every other green food app. Pick ONE and use it only for primary actions and brand moments. Do not scatter it.
- **A secondary "warm" support hue** (honey/amber, ~#E0A03A) for highlights and delight — never for status.
- **Semantic colors are reserved and never reused for branding:** success green, warning amber, danger red must be visually distinct from your brand accent so allergen red and freshness states read unambiguously. (If your brand accent is green, use a bluer/cooler success green or lean on the freshness-ring system instead.)
- **Dark mode = warm dark, not black.** Follow Copilot's lead: a warm near-black canvas (~#1A1815) with off-white text at ~90% opacity. Elevated neutrals "blend more organically" into dark mode than stark white systems.

**Typography (your cheapest distinctiveness win — Samsung Food doesn't even try here).**
- **Pair a characterful display/heading face with a highly legible UI/data sans.** Recommended, all available as Google Fonts via `@expo-google-fonts` so they drop straight into Expo:
  - **Display/headings:** a warm humanist or editorial face with personality — **Fraunces** (soft "old-style" serif, great for a cookbook feel) or **Bricolage Grotesque** (notably, Kitchen Stories' own rebrand uses Bricolage). Fraunces on headings instantly signals "kitchen/editorial," not "SaaS."
  - **Body/UI/data:** **Inter** (or **Geist**) for excellent legibility at small sizes and a complete weight range — essential for data-dense inventory rows.
  - Optional **numeric/mono** accent for quantities/dates (e.g. Geist Mono or IBM Plex Mono) to make counts and expiry dates feel precise and "instrument-like."
- Establish a strict type scale (e.g. 12/14/16/20/28/36) and use weight, not just size, for hierarchy — bold section headers over the carousels (Samsung's move), regular for metadata.

**Spacing, grid, radius, elevation.**
- **8pt spacing system.** Generous whitespace is non-negotiable — it's what makes Kitchen Stories feel "light and airy" and what "Claude web" apps skip.
- **Corner radius with a consistent personality.** Pick a friendly-but-not-bubbly radius (cards ~16–20px, chips/pills fully rounded, inputs ~12px). Consistency across the system reads as intentional; mixed radii read as templated.
- **Soft, warm elevation.** Prefer low-spread soft shadows tinted warm (not pure black) plus hairline borders in a warm tone, over heavy Material drop-shadows. (Samsung's own web surfaces use *no* box-shadow and rely on white-vs-surface planes + typography for hierarchy — a valid, premium option too.)

**Iconography.** Use ONE cohesive set with a distinctive stroke — **Lucide** (clean, consistent, RN-friendly) or **Phosphor** (has weights/duotone for expressiveness). Never mix icon libraries (a classic "generic" tell). For food categories, consider custom illustrated food icons like Kitchen Stories — a strong warmth signal, though higher effort.

**Imagery strategy.** This is the Samsung Food lesson: **real food photography is the single biggest premium signal.** Every recipe card, meal-plan tile, and hero should lead with appetizing imagery. For inventory items where you lack a photo, use warm, consistent illustrated food icons on tinted category chips rather than empty gray boxes. Never ship gray placeholder rectangles — that's peak "template."

### 2. Surfacing the three confidence states + allergen safety

This is where KitchenSmart wins trust. Research on "Confidence UI" is clear and consistent, and I'm mapping it directly to your three states.

**Design principles from the research:**
- Show confidence as a **status, not a number** — buckets/labels ("Known Fact," "Estimated," "Needs review"), never a fake "92%." A fabricated percentage "manufactures trust and shatters the first time a high-confidence answer is wrong."
- **Attach the signal to the specific item**, not a global footer badge.
- **Encode with shape + icon + text, not color alone** (accessibility + colorblind safety).
- **Tie the signal to an action.** Confidence must change what the user does. Low confidence must always pair with a concrete "confirm/verify" affordance ("staged verification"). If nothing changes at any level, the badge is decoration.
- **Don't badge everything.** If most items are one state, badges become "wallpaper users stop seeing." Surface the signal where reliability varies.

**Recommended treatment for KitchenSmart — a three-tier "provenance chip":**
- **Known Fact** (verified, e.g., scanned barcode + product DB match): the *quiet* state. A small, understated check/shield glyph, low visual weight, neutral/brand-tinted. Optionally NO chip at all (the default), so the louder states stand out. Sub-label on tap: "Verified — scanned barcode."
- **Estimated** (e.g., quantity depleted by logged meals): a **dashed-outline** chip with a "≈"/gauge icon in a muted amber-neutral. The dashed border is the key semantic — it visually says "derived, not measured." Tapping reveals the reasoning ("Estimated: 2 of 6 eggs used across 2 logged meals") and an "Adjust" affordance.
- **AI Interpretation** (vision/receipt guess needing confirmation): the **loudest, action-oriented** state. A filled chip with a sparkle/AI glyph and the word "Confirm," rendered as a tappable affordance, not a passive label. Low-confidence detections sit in a dedicated **"Needs your confirmation" review tray/section** at the top of Inventory or in a post-scan review sheet — mirroring the "AI assists, human confirms" pattern (each extracted field shown with a "Detected / Needs review" badge, fully editable before saving). A one-time "What do these mean?" legend teaches the three states; keep definitions stable.

**Provenance + freshness combined:** on an inventory row you carry two independent signals — the **NoWaste-style freshness ring** (color = time-to-expiry) on the item thumbnail, and the **provenance chip** (data confidence) as a small trailing badge. They answer different questions ("is it still good?" vs "do we actually know it's here?") and should never share a visual language.

**Allergen safety = a separate, non-negotiable hard-safety layer.**
- Allergens are HARD restrictions, so they must **never** use the same visual system as confidence or freshness. Give them a dedicated, reserved treatment: a **high-contrast danger red with a shield/alert icon and an explicit text label** (e.g., "Contains peanuts — allergen").
- Surface allergen conflicts **proactively and early**: on recipe cards (a red allergen ribbon/banner, not a subtle chip), at the top of recipe detail before ingredients, and as a blocking confirmation if a user tries to plan/cook a conflicting meal.
- **Redundant encoding is mandatory** — icon + text + color, so it survives dark mode and colorblindness (WCAG: don't rely on color alone; maintain ≥4.5:1 contrast for warning text).
- Model allergens as a household-level profile captured at onboarding (Mealime captures allergies + dislikes up front). Treat "unknown" ingredients (low-confidence AI items) as **potentially unsafe** until confirmed — an elegant tie-in between your confidence system and your safety system.

### 3. Screen-by-screen guidance

**Home (dashboard).** Follow Copilot's progressive disclosure + Samsung's feed-of-rails, but lead with YOUR differentiators.
- Top: a warm greeting + a single **"best meal recommendation right now"** hero card (large photo, "cook this" CTA, "uses 3 items expiring soon"). This is your daily aha moment.
- **"Use it soon" rail** — horizontally scrollable expiring ingredients with freshness rings. This is the gap Samsung Food leaves wide open (it has no expiry alerts at all).
- **Compact status cards** (not a spreadsheet): Inventory Accuracy, Waste Risk, Shopping Gaps — each a single glanceable metric with a sparkline or ring and a tap-through. Copilot's lesson: summary first, detail on tap.
- A **"Needs confirmation" nudge** if there are pending AI-interpretation items.
- Avoid Samsung's mistake: don't create two near-identical top-level surfaces (Home vs Explore confusion).

**Inventory.** This is where you must NOT look like a spreadsheet.
- **Rich rows, not a table:** each item = thumbnail (photo or warm category icon) + name + quantity (in your mono/numeric face) + **freshness ring** + **provenance chip**. Group by storage location (fridge/freezer/pantry) like NoWaste/KitchenPal, with a sticky segmented header to switch (Samsung's sticky-header pattern).
- Sort/filter by expiration, category, location, confidence (NoWaste's proven filters).
- **"Needs your confirmation" section pinned to top** for low-confidence AI items.
- Item detail: a bottom sheet with editable quantity/location/use-by, the provenance explanation ("why we think this"), and allergen flags. Learn from KitchenPal's failure — get **unit modeling right** (eggs = count, milk = volume); don't force ounces on countable items.

**Add Food (the scanning hub).** Four capture modes as large, friendly tiles: Barcode, Receipt, Photo/Camera, Manual (voice later).
- **Barcode:** full-screen camera with a warm animated corner-bracket frame; on match → a **Known Fact** confirmation card (product photo + name), one-tap add.
- **Receipt OCR:** capture → honest processing status text → **review screen where every line item has a "Detected / Needs review" badge and is fully editable** before saving (the "AI assists, human confirms" gold standard). Flag when parsed items look ambiguous or line items don't sum to the total.
- **Photo/vision:** capture → **multi-select confirmation checklist** of detected items (Samsung Vision AI's exact pattern: "select the items you want to add… tap Done"), each entering inventory as an **AI Interpretation** until confirmed.
- Keep a "Processed on device / how we use your photo" privacy note visible if applicable.

**Meal Plan / Shopping.**
- Meal Plan: weekly view with photo-led meal tiles (Samsung's Plan tab), sticky header, long-press context menu (add/swap/remove), a "Queue" of unscheduled ideas. Recommendations prioritize expiring items and respect the allergen profile (hard filter).
- Shopping: items grouped by aisle/category with checkboxes; **the Cooklist loop** — when inventory depletes an item, prompt "add to shopping list?"; when shopping is checked off, prompt to update inventory (closing your Purchase→Inventory loop). Learn from Cooklist/Samsung complaints: make categories flexible and include a frozen section.

**AI Assistant.** A warm conversational surface, not a sterile chatbot.
- Use the **confidence language consistently** here too: when the assistant asserts inventory facts ("You have 2 eggs left"), tag the claim's provenance ("estimated") and offer a verify path. Evidence cards ("Based on: barcode scan + 2 logged meals") beat prose.
- Quick-action chips ("What can I make tonight?", "What's expiring?", "Build this week's plan"). SuperCook's subtractive "what can I make right now" is the highest-value query — make it one tap.
- Never let the assistant make irreversible changes (deleting inventory, planning allergen-conflicting meals) without an explicit confirm.

### 4. "What to steal from whom" — quick map
- **Samsung Food** → single-accent color discipline; photography-led recipe cards; feed-of-rails Home; sticky headers; long-press context menus; multi-select Vision-AI confirmation checklist. (But out-do it on typography and expiry alerts.)
- **NoWaste** → the freshness ring/indicator on each item; sort/filter by expiry/location; "simple, no clutter" restraint.
- **SuperCook** → one-tap "what can I make right now" subtractive flow in the AI Assistant.
- **Cooklist** → the deplete→shopping-list and purchase→inventory sync loop; loyalty-card/receipt auto-import to kill data-entry friction.
- **Mealime** → onboarding that captures allergies + dislikes; plan→grocery→(shop online) continuity.
- **KitchenPal** → what to AVOID: over-dense auto-categorization, bad unit modeling; but its pantry-zones concept is sound.
- **Kitchen Stories** → the warmth benchmark: magazine-grade photography, airy whitespace, custom food icons, distinctive logomark/type (Bricolage), sunny identity.
- **Copilot Money** → progressive disclosure, data-as-design-material, warm dark mode, premium micro-interactions, helpful empty states.

### 5. Expo / React Native implementation notes
- **Styling: NativeWind** (Tailwind for RN) is the 2026 default and the foundation most other libraries now build on. It gives you a token-driven, utility-first system that makes a custom design language easy to enforce and keeps you far from Material defaults.
- **Components: copy-in, not pre-styled.** Use **React Native Reusables** or **gluestack-ui v3** (both NativeWind-based, copy-in/CLI, headless + accessible, optimized for Expo SDK 54 + the new RN architecture) so you OWN and fully restyle each component. **Avoid React Native Paper** for the primary UI — its strict Material Design 3 adherence is precisely the "generic/templated" look to escape. (Tamagui is a strong alternative if you want an optimizing compiler + universal web parity and are willing to invest in its token system.)
- **Motion: Reanimated + Gesture Handler** (with **Moti** for quick declarative animations). Micro-interactions that punch above their weight: drag handles that lift, bouncy pull-to-refresh, a satisfying check animation when confirming an AI item, animated freshness rings, a subtle celebration when inventory accuracy hits a milestone or a meal is logged.
- **Fonts:** `npx expo install expo-font` + `@expo-google-fonts/fraunces`, `@expo-google-fonts/inter` (and Bricolage/Geist as chosen); load with `useFonts`, gate render behind an `expo-splash-screen`. Centralize font names in a tokens file to stay DRY.
- **Charts/rings:** freshness rings and sparklines via `react-native-svg` (+ Reanimated for animation) or Skia for higher-craft visuals.
- **Theme architecture:** define semantic tokens (color/space/radius/typography) once; drive light/dark from them. This is what lets you have a real point of view instead of scattered inline styles.

### 6. Anti-patterns to avoid (what makes it look "generic / like Claude web")
- **Cool gray neutrals (#808080 family) and pure #FFFFFF/#000000.** Switch to warm tinted neutrals and warm near-black. Biggest single fix.
- **System default fonts only.** Ship a real display+body pairing.
- **No imagery / gray placeholder boxes.** Food apps live or die on photography and warm iconography.
- **Scattered accent colors / rainbow status dots.** One brand accent; reserved semantics.
- **Default Material/iOS components left unstyled** (Paper out of the box, default switches, default shadows). Own your components.
- **Spreadsheet inventory** (dense mono rows, no thumbnails, no whitespace). Use rich rows + progressive disclosure.
- **Fake precision** ("92% confident"). Use named confidence buckets.
- **Confidence / freshness / allergen sharing a color language.** Keep three separate, legible systems; allergens always redundant-encoded.
- **Badging everything** until badges become wallpaper. Signal only where reliability varies.
- **Flat, motionless UI.** A few well-chosen micro-interactions are the difference between "template" and "premium."

## Recommendations (staged)

**Stage 1 — Establish the design language (week 1–2, highest ROI).** Lock the token system first: warm neutral palette + one accent, the Fraunces/Inter (or Bricolage/Geist) pairing loaded in Expo, 8pt spacing, radius + warm-elevation rules, Lucide/Phosphor icon set, NativeWind theme. Rebuild ONE screen (Home) end-to-end as the reference. **Benchmark that changes this:** if a stranger can't tell your Home screen from a generic template in a 5-second test, the palette/type/imagery aren't committed enough — push warmer and add real photography.

**Stage 2 — Ship the confidence + safety systems as reusable components.** Build the three-tier provenance chip, the NoWaste-style freshness ring, and the allergen safety banner as first-class, documented components with the "confirm" affordance and the one-time legend. **Threshold:** every inventory item and every AI output must render its provenance; every recipe/meal must render allergen status. If any surface shows an unqualified AI claim, it's not done.

**Stage 3 — Apply across the five screens + add motion.** Roll the language through Inventory, Add Food, Meal Plan/Shopping, AI Assistant. Add the Reanimated micro-interactions (confirm animation, freshness ring fill, pull-to-refresh). Wire the Cooklist-style inventory↔shopping loop.

**Stage 4 — Validate.** Usability-test the scanning→confirmation flow and the confidence legend specifically (does a new user understand Known Fact vs Estimated vs AI Interpretation?). Test allergen warnings with an allergic user. **Change trigger:** if users ignore or misread the provenance chips, simplify to two states (Confirmed vs Needs review) before adding more nuance.

## Caveats
- **No pixel-level Samsung Food spec is public.** There is no Mobbin/screensdesign case study for Samsung Food; exact corner radii, the precise in-app font (likely platform-default Roboto/SF, not confirmed One UI Sans), and active-tab styling are inferred from 2025 help-center screenshots, SamMobile's Sept 30 2025 tablet review, and App Store captions rather than a design-system source. The #FF992A / #313131 palette is from a brand-asset aggregator (Brandfetch) — reliable for brand color but not a guarantee of exact in-app usage.
- **Barcode scanning inside Samsung Food is unconfirmed** — it appears to be a Samsung Health/ecosystem feature; Vision AI photo recognition and receipt/recipe photo import are the confirmed Samsung Food capture flows.
- **Color hex ranges given here are directional starting points, not final tokens.** They need contrast testing (WCAG 4.5:1 for text) and real-device validation in both light and dark modes before shipping.
- **Font licensing:** the recommended families are open-source (SIL Open Font License via Google Fonts) and safe to embed in an Expo app, but confirm the license of any non-Google display face before shipping.
- **2026 color-trend sources are design blogs** describing direction, not laws; treat "elevated neutrals / warm minimalism" as a well-supported consensus, not a guarantee it fits your brand. The underlying principle (warm neutrals + one disciplined accent + real imagery) is what matters, not chasing a trend.
- Some competitor UI details come from app-store descriptions and third-party review sites rather than first-hand teardowns; where a specific flow matters to your build, verify it live in the current app version.