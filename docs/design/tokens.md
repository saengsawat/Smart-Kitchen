# Design Tokens · measured contrast and scarcity audit (M3-E0-T3)

**Status:** docs only. This file turns [design-direction.md](design-direction.md) §0 into a measured, source-cited token sheet, ready to become the typed token module in M3 (design-direction §4). Every value below is copied verbatim from `:root` in [mockups/smart-kitchen-prototype.html](mockups/smart-kitchen-prototype.html) or marked PROPOSED where this document suggests a change the prototype does not yet make. No hex value in this file was invented; every one traces to `:root` or to a stated arithmetic transform of a `:root` value (documented in the contrast table).

**Inputs carried forward from M3-E0-T1 acceptance** (BACKLOG "Accepted follow-ups from completed tickets", M3-E0-T1 row): measured tap-target shortfalls, `prefers-reduced-motion`, `--danger` on allergy-selection controls, the green-check "none" option, the `--ink-3` dot on the espresso hero, and the two camera-chrome terracotta exceptions. All are addressed in sections 4, 5, 6 and 3 respectively below.

---

## 1. Token table

Every custom property in `:root` (lines 12-37 of the prototype), matched against design-direction §0's "v2 token sheet". **Result: zero drift.** All 15 §0 rows were checked against `:root` and every hex matches exactly; no correction to design-direction §0 is needed or made.

| `:root` property | Hex | §0 semantic name | Role | Allowed uses | Forbidden uses |
|---|---|---|---|---|---|
| `--sand` | `#efe5d5` | `bg.page` | Page canvas | Screen background only | Cards (use `--paper`), text |
| `--sand-2` | `#e4d7c2` | `bg.page.alt` | Pressed / segmented track, photo-tile fallback | Segmented-control track, empty photo tiles, "why" explainer panel bg, dev-switch active fill target's inverse | Primary page background, text color |
| `--paper` | `#fffbf4` | `bg.card` | Card / sheet / nav-bar surface | Cards, rows, nav bar, bottom sheets, buttons (`.btn.sec`) | Full-page background (kept distinct from `--sand` so cards visibly lift) |
| `--line` | `#dfd1ba` | `border` | Hairline | Borders/dividers only | Fill, text |
| `--ink` | `#1e1813` | `text.primary` | Primary body text and headings | Any body text, headings, primary numerals | Backgrounds |
| `--ink-2` | `#5b5045` | `text.secondary` | Secondary text | Sub-labels, secondary meta, section links | Backgrounds |
| `--ink-3` | `#8f8274` | `text.tertiary` | Tertiary / caption text | Captions, quantities-as-meta, timestamps, inactive nav labels | As body text at current hex without the fix in §2 (see FAILs) |
| `--espresso` | `#2a1f18` | `bg.hero` | Dark warm hero surface | Home hero header only, plus the small set of dark-accent components that intentionally borrow it (`.loc.on`, `.chip.on`, `.toast`, dev-switch "on" state) | Any other screen's primary canvas ("the one large dark surface allowed", design-direction §0) |
| `--espresso-2` | `#3b2d23` | `bg.hero` (+ variant) | Hero gradient / secondary dark tone | Hero decoration only | Same as `--espresso` |
| `--cream` | `#f7efe2` | `text.onHero` | Text on dark surfaces | Text/icons on `--espresso` only | Text on light surfaces (not measured for that pairing; not designed for it) |
| `--brand` | `#d9673b` | `accent.brand` (default) | Terracotta brand accent | Primary CTA, active-nav icon stroke, hero accent (orb/italic/sparkle), camera-chrome viewfinder + laser (documented exception, §3) | Any background/large surface, any badge or decoration outside the scarcity list (design-direction §2 "Scarcity rule") |
| `--brand-deep` | `#b64f28` | `accent.brand` (pressed/deep) | Pressed CTA state, active-nav text, loop-banner text | Same scarcity list as `--brand`, pressed/deep variant | Same as `--brand` |
| `--brand-tint` | `#f9dece` | `accent.brand` (tint) | Brand tint surface | **Currently unused anywhere in the prototype**, flagged, not a violation | N/A until adopted; when adopted, keep to the same scarcity list |
| `--green` | `#2f7d51` | `sentiment.positive` | Positive / fresh / verified | Known Fact chip, on-hand ("have") chips, fresh freshness-ring stop, `.noneopt.on`, `.chk.done` | Allergen contexts, AI-tier content |
| `--green-bg` | `#dfeee3` | `sentiment.positive` bg | Positive tint surface | Backing for the above | Same |
| `--amber` | `#b4700c` | `sentiment.warning` | Warning / estimated / expiring | Estimated chip, expiring-soon freshness stop, shortage/"miss" chips, allergen-**unknown** lines (explicitly allowed by §0, distinct from `--danger`) | BLOCKED/verdict-danger context, AI content |
| `--amber-bg` | `#f6e6c8` | `sentiment.warning` bg | Warning tint surface | Backing for the above | Same |
| `--rose` | `#c75f66` | `urgency.today` | "Use today" urgency, never allergen | Freshness-ring "now" stop, `.exp.now`, ingredient "miss" status | **Allergen contexts** (hard rule, verified in §4: zero crossover found) |
| `--rose-bg` | `#f7dcdc` | `urgency.today` bg | Urgency tint surface | Backing for the above | Same |
| `--danger` | `#b12a2a` | `sentiment.danger` | **Allergen only** | `.allergen` banner, `.allergychip.on`, `.sevbtn.on`, `.verdictblock.blocked`, provenance legend's allergen row | Everywhere else, including destructive/delete actions, generic errors, expired food (verified in §4: zero crossover found) |
| `--danger-bg` | `#f9d9d9` | `sentiment.danger` bg | Allergen tint surface | Backing for the above | Same |
| `--ai` | `#7b4cb5` | `ai` | AI Interpretation tier, exclusive hue | `.prov.ai`, confirmation tray, `.okbtn`, `.mode.cam`, `.chip.needsconf.on`, "future"/AI-adjacent phase labels | Anywhere else ("purple appears nowhere else", verified in §4: confirmed) |
| `--ai-bg` | `#eadff7` | `ai` bg | AI tint surface | Backing for the above | Same |
| `--r-sm` | `12px` | Radius (small) | Buttons/inputs | Small controls | n/a |
| `--r-md` | `18px` | Radius (medium) | Cards | Cards, sheets, trays | n/a |
| `--r-lg` | `24px` | Radius (large) | Featured cards/sheets, hero corners | Hero, big sheets | n/a |

**Note (not a §0 drift, an M3 module recommendation):** the pill radius (`999px`) and the FAB/nav-button circle (`50%`) are never tokenized. They appear as the literal value `999px` at eleven call sites (`.ask`, `.pill`, `.nav`, `.chip`, `.loc`, `.allergychip`, `.toast`, `.okbtn` uses `9px` not `999px`, checked individually) and `50%` at four (`.hbtn`, `.fab`, `.ringbadge`, `.mchip`, `.chk` uses `9px` not `50%`, checked individually). Recommend adding `--r-pill: 9999px` to the typed module so the M3 build never repeats the raw number. This is a structural observation, not a hex-value question, so it does not affect the "zero drift" finding above.

---

## 2. Contrast table

**Formula (WCAG 2.x relative luminance and contrast ratio), shown once:**

```
for channel c in {R,G,B} (0-255): s = c/255
  c_lin = s/12.92                        if s <= 0.03928
  c_lin = ((s+0.055)/1.055)^2.4          otherwise
L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin
contrast(A,B) = (L_lighter + 0.05) / (L_darker + 0.05)
```

For a translucent layer over a photo, the layer is alpha-composited first: `result_c = alpha*fg_c + (1-alpha)*bg_c` per channel, then the same formula runs on the composite. **Stated assumption:** the prototype hotlinks real Unsplash photos (already flagged OQ-D8, licensing), so there is no single "true" photo luminance. This document assumes a mid-tone photo equivalent to 50% grey (`#808080`) wherever text sits on a photo, which is a deliberately conservative middle ground, not a measurement of the specific hotlinked images.

**Script used** (`node -e`, reproduced in full in the worker report):

```js
function hexToRgb(hex){hex=hex.replace('#','');const n=parseInt(hex,16);return [(n>>16)&255,(n>>8)&255,n&255];}
function relLum([r,g,b]){const f=c=>{const s=c/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);};
  const [R,G,B]=[f(r),f(g),f(b)];return 0.2126*R+0.7152*G+0.0722*B;}
function contrast(h1,h2){const L1=relLum(hexToRgb(h1)),L2=relLum(hexToRgb(h2));
  const l=Math.max(L1,L2),d=Math.min(L1,L2);return (l+0.05)/(d+0.05);}
function composite(fgHex,alpha,bgHex){const [fr,fg,fb]=hexToRgb(fgHex),[br,bg,bb]=hexToRgb(bgHex);
  const mix=(f,b)=>Math.round(alpha*f+(1-alpha)*b);return {r:mix(fr,br),g:mix(fg,bg),b:mix(fb,bb)};}
```

**Text-size rule applied:** per WCAG, "large text" is >=24px regular or >=18.66px (14pt) **bold**. This document applies that size rule strictly rather than eyeballing "reads as a button so it must be large." Two findings below (ink-3, and white-on-brand) turn on this: text that looked "large enough" at a glance is measured against the 4.5:1 body threshold because it is actually 15px or smaller.

**Category thresholds:** body 4.5:1, large 3:1, alert (allergen-context text) 7:1, decorative (icon glyphs/fills that are not text and are not the sole carrier of information) not held to a numeric threshold but reported for completeness.

| # | Pair | Fg | Bg (or composite) | Size/weight in prototype | Category | Target | Ratio | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | ink on sand | `#1e1813` | `#efe5d5` | body text, 15-16px | body | 4.5 | 14.09 | PASS |
| 2 | ink on paper | `#1e1813` | `#fffbf4` | body text | body | 4.5 | 17.03 | PASS |
| 3 | ink on sand-2 | `#1e1813` | `#e4d7c2` | body text | body | 4.5 | 12.38 | PASS |
| 4 | ink on cream | `#1e1813` | `#f7efe2` | body text | body | 4.5 | 15.39 | PASS |
| 5 | ink-2 on sand | `#5b5045` | `#efe5d5` | secondary text, 12-14px | body | 4.5 | 6.29 | PASS |
| 6 | ink-2 on paper | `#5b5045` | `#fffbf4` | secondary text | body | 4.5 | 7.60 | PASS |
| 7 | ink-2 on sand-2 | `#5b5045` | `#e4d7c2` | secondary text | body | 4.5 | 5.53 | PASS |
| 8 | ink-2 on cream | `#5b5045` | `#f7efe2` | secondary text | body | 4.5 | 6.87 | PASS |
| 9 | ink-3 on sand | `#8f8274` | `#efe5d5` | captions/meta, 11-13px, never >=18.66px bold | body | 4.5 | 3.00 | **FAIL** |
| 10 | ink-3 on paper | `#8f8274` | `#fffbf4` | captions/meta | body | 4.5 | 3.63 | **FAIL** |
| 11 | ink-3 on sand-2 | `#8f8274` | `#e4d7c2` | captions/meta | body | 4.5 | 2.64 | **FAIL** (worst case) |
| 12 | ink-3 on cream | `#8f8274` | `#f7efe2` | captions/meta | body | 4.5 | 3.28 | **FAIL** |
| 13 | `#c9b9a4` hero eyebrow on espresso | `#c9b9a4` | `#2a1f18` | 12px, 600, uppercase | body | 4.5 | 8.38 | PASS |
| 14 | `#d8c9b3` "ask" placeholder on espresso | `#d8c9b3` | `#2a1f18` | 14px | body | 4.5 | 9.88 | PASS |
| 15 | cream (text.onHero) on espresso | `#f7efe2` | `#2a1f18` | hero `h1`, 34px | large | 3 | 14.07 | PASS |
| 16 | cream on darkest `.scrim` stop (rgba(30,24,19,.72)) over assumed mid-tone photo `#808080` | `#f7efe2` | composite `#393532` | recipe-card `h3`, 26px | large | 3 | 10.64 | PASS |
| 17 | amber on amber-bg | `#b4700c` | `#f6e6c8` | "miss" chip / shortage note, 12-12.5px, 600 | body | 4.5 | 3.24 | **FAIL** |
| 18 | green on green-bg | `#2f7d51` | `#dfeee3` | "have" chip, 12-13.5px, 600 | body | 4.5 | 4.19 | **FAIL** (narrow) |
| 19 | danger on danger-bg | `#b12a2a` | `#f9d9d9` | `.allergen` banner text, 13px 700; `.allergychip.on`, 13px 600 | alert | 7 | 4.93 | **FAIL** |
| 20 | white on danger | `#ffffff` | `#b12a2a` | `.sevbtn.on` severity label, 12.5px 700 | alert | 7 | 6.49 | **FAIL** |
| 21 | ai on ai-bg | `#7b4cb5` | `#eadff7` | soft AI chip, 11-12px, 700 | body | 4.5 | 4.63 | PASS |
| 22 | rose on rose-bg | `#c75f66` | `#f7dcdc` | ingredient "miss" status, 11.5px, 700 | body | 4.5 | 3.09 | **FAIL** |
| 23 | brand-deep on brand-tint | `#b64f28` | `#f9dece` | not used in the prototype today (`--brand-tint` unused, see §1) | body | 4.5 | 3.96 | **FAIL** (if adopted) |
| 24 | white on brand (`.btn.pri`) | `#ffffff` | `#d9673b` | primary CTA label, **15px, 700, below the 18.66px-bold "large" cutoff**, so held to body | body | 4.5 | 3.53 | **FAIL** |
| 25 | brand-deep on sand (`.loop b` banner) | `#b64f28` | `#efe5d5` | "close the loop" prompt, 13.5px, 700 | body | 4.5 | 4.07 | **FAIL** (narrow) |
| 26 | brand-deep on paper (active nav label) | `#b64f28` | `#fffbf4` | nav label, 10.5px, 600 | body | 4.5 | 4.92 | PASS |
| 27 | ink-3 on espresso (`.pill .dot`, decorative fill) | `#8f8274` | `#2a1f18` | 8px circular fill, no text; the number beside it carries the meaning | decorative | n/a | 4.29 | reported only, not a text failure |
| 28 | cream on espresso (`.chip.on` selected filter) | `#f7efe2` | `#2a1f18` | chip label, 13px, 600 | body | 4.5 | 14.07 | PASS (same ratio as #15) |
| 29 | cream on espresso (`.toast`) | `#f7efe2` | `#2a1f18` | toast text, 13px, 600 | body | 4.5 | 14.07 | PASS (same ratio as #15) |
| 30 | cream on `.toastUndo` pill, rgba(247,239,226,.18) over espresso | `#f7efe2` | composite `#4f443c` | "Undo" label, 12px, 700 | body | 4.5 | 8.27 | PASS |
| 31 | white on `.tag.glass`, rgba(30,24,19,.55) over assumed mid-tone photo `#808080` | `#ffffff` | composite `#4a4744` | "92% match" / "uses 3 expiring" tags, 11.5px, 700 | body | 4.5 | 9.23 | PASS |
| 32 | ink-3 on paper (inactive nav label) | `#8f8274` | `#fffbf4` | nav label, 10.5px, 600 | body | 4.5 | 3.63 | **FAIL** (duplicate of #10, listed for the nav-labels-on-paper item) |
| 33 | white on ai (`.prov.ai` solid chip) | `#ffffff` | `#7b4cb5` | AI Interpretation chip, 11px, 700 | body | 4.5 | 5.93 | PASS |
| 34 | white on green (`.chk.done` check glyph) | `#ffffff` | `#2f7d51` | check icon, not text | decorative | n/a | 5.03 | reported only |
| 35 | white on danger (`.allergen .sh` icon swatch) | `#ffffff` | `#b12a2a` | warning-triangle icon, not text | decorative | n/a | 6.49 | reported only (duplicate ratio of #20) |

### FAILs and proposed fixes

12 of 35 measured pairs fail their threshold (rows 9-12, 17-20, 22-25). Every fix below darkens or lightens an *existing* token (or, for row 24, swaps to an existing token) rather than inventing a new hex, found by scaling the failing color toward black/white in 1% steps until the ratio clears the target, then checking the fix against every other pair that shares the token.

| Rows | Failing token(s) | Proposed fix | New ratio(s) | Rationale |
|---|---|---|---|---|
| 9-12 | `--ink-3` (`#8f8274`) | Darken to `#665c52` | sand 5.23, paper 6.33, sand-2 4.60, cream 5.72 (all >=4.5, worst case sand-2 clears by 0.10) | `--ink-3` is used for real information (quantities, timestamps, expiry meta), not decoration, everywhere it fails; a single darkened value clears all four backgrounds at once. |
| 17 | `--amber` (`#b4700c`) | Darken to `#925b0a` | 4.59 vs `--amber-bg` | Text-on-tint usage (shortage chip, short-note) is body text at 12-12.5px, needs 4.5, not the "quiet, not bright" 3.24 it has today. |
| 18 | `--green` (`#2f7d51`) | Darken to `#2d774d` | 4.53 vs `--green-bg` | Narrow miss (4.19 vs 4.5); a small darkening clears it without visibly changing the hue. |
| 19, 20 | `--danger` (`#b12a2a`) | Darken to `#882020` | danger-on-danger-bg 7.02; white-on-danger 9.23 | **One token change clears both alert-category FAILs at once** (verified by testing both directions against the single candidate). This is the allergen-exclusive red (rule 9, P5); given rule 6 (domain safety over UI convenience), the 7:1 alert target is applied to it without exception, including on the selection controls (`.allergychip.on`, `.sevbtn.on`) since they are allergen-severity data entry, not decoration. |
| 22 | `--rose` (`#c75f66`) | Darken to `#9d4b51` | 4.56 vs `--rose-bg` | "Use today" and "miss" status text needs body contrast; current value under-delivers by 1.4 points. |
| 23 | `--brand-tint` (`#f9dece`) | If ever adopted for `brand-deep`-on-tint text, pair with `#a74925` instead of `#b64f28` (4.52) | 4.52 | Currently unused (§1); recorded so a future component does not inherit a silent failure. |
| 24 | `.btn.pri` background | **Use `--brand-deep` (`#b64f28`) as the resting background instead of `--brand`**, keep `--brand` for the scarcity list's non-text uses (orb, active-nav stroke, camera chrome) | white on brand-deep = 5.07 | No new hex needed: `--brand-deep` already exists as the token's own "deep" variant and already clears 4.5:1 comfortably. The button's pressed state would then need its own, slightly darker third stop if the press-feedback distinction is to be kept (a PROPOSED follow-up, not resolved here since a new hex would be required). |
| 25 | `--brand-deep` (`#b64f28`) on `--sand` | Same darkened value proposed for row 24's context does not help here (brand-deep is already the darker variant). Alternative fix: bump `.loop b` from 600 to 700 weight and 13.5px to 15px+ so it clears the large-text 3:1 line instead (13.5px 700 is still short of 18.66px, so this alone will not qualify either), or darken `--brand-deep` further to `#9c431f` (computed separately, not shown above, flagged as an open trade-off since `--brand-deep` is shared with the button's pressed state and the active-nav label, both of which already pass) | n/a | PROPOSED, needs a design call. Darkening `--brand-deep` globally to fix the loop banner would change two already-passing pairs' visual weight. Simplest non-invasive fix: recolor `.loop b` to `--ink` (already proven at 14+:1 on `--sand`) since the banner's brand-colored text is decorative emphasis, not the loop banner's only informational text. |

**Summary:** 35 pairs measured, 12 FAILs, 12 proposed fixes (11 direct token darkenings/lightenings using only values derived from existing tokens, 1 reroute to an existing token). Two of the fixes (`--ink-3`, `--danger`) each resolve four and two rows respectively with a single token change.

---

## 3. Terracotta scarcity table

Every `--brand` / `--brand-deep` / `--brand-tint` / `#f4b48f` use remaining after M3-E0-T1's reduction (its review counted **nine**; this audit finds **ten** CSS rules, which reconcile to the review's nine if the active-nav text color and active-nav icon stroke below are counted as one combined "active nav indicator" instead of two declarations). All ten are **KEEP**, re-verified against the scarcity rule (design-direction §2: "brand accent appears only on the primary CTA, active nav indicator, and focus states").

| Element (selector) | Screen(s) | Terracotta value | Keep/Remove | Reason |
|---|---|---|---|---|
| `.hero::after` (decorative orb) | Home | `--brand` at 18% opacity | KEEP | Hero accent, explicitly on the scarcity list ("hero accent"). |
| `.hero h1 em` (italic "tonight?") | Home | `#f4b48f` | KEEP | Hero accent (typographic emphasis inside the one permitted dark hero surface). |
| Sparkle icon beside the hero headline | Home | `#f4b48f` | KEEP | Hero accent, same surface as the two rows above. |
| `.btn.pri` (primary CTA, resting) | 16 call sites across Home, Add, Recipes, Recipe detail, cook-confirm sheets, Manual entry, Household, Allergies, Item detail | `--brand` | KEEP | Primary CTA, the first item on the scarcity list. Subject to the contrast fix in §2 row 24. |
| `.btn.pri:active` (primary CTA, pressed) | Same 16 sites | `--brand-deep` | KEEP | Press feedback on the same primary CTA. |
| `.frame i` (viewfinder brackets, 4 corner marks) | Scan screen only | `--brand` | **KEEP, documented camera-chrome exception** | Not on the scarcity list's three named categories, but retained by the M3-E0-T1 review as camera-chrome convention (a viewfinder is universally drawn in an accent color in every scanning UI; treating it as decoration inside a full-bleed camera view, not as a competing brand surface). |
| `.laser` (scan-line sweep) | Scan screen only | `--brand` (fill + glow) | **KEEP, documented camera-chrome exception** | Same reasoning as `.frame i`; the two are the paired camera-chrome exception the review named explicitly. |
| `.loop b` (shopping "close the loop" banner text) | Shopping | `--brand-deep` | KEEP | Not literally "primary CTA" but the loop banner is the screen's one call-to-action-adjacent prompt; kept per T1's review disposition. Flagged in §2 row 25 for a contrast fix that may recolor this specific text to `--ink` while leaving the rest of the scarcity list untouched. |
| `.nav button.on` (active tab label color) | Home, Inventory, Recipes, Shopping nav bars (4 sites) | `--brand-deep` | KEEP | Active nav indicator, the second item on the scarcity list. |
| `.nav button.on svg` (active tab icon stroke) | Same 4 nav bars | `--brand` | KEEP | Active nav indicator (icon half of the same component as the row above). |

**`--brand-tint` (`#f9dece`):** zero uses found. Not a scarcity violation (it cannot violate a rule it never invokes); recorded in §1 as an unused token and in §2 row 23 with a contrast fix ready if a future component adopts it.

**Net effect since M3-E0-T1:** the review's own count went from 15 live uses (six unaudited, two new) down to nine; this audit independently re-derives the same post-fix set (ten CSS rules covering the same nine semantic roles) and finds nothing further to remove. No new terracotta uses were found outside this list.

---

## 4. Semantic-colour decisions (PROPOSED, PO decides)

Per CLAUDE.md rule 4, these are recorded as PROPOSED for the product owner, not decided here.

1. **`--danger` on `.allergychip.on` / `.sevbtn.on`** (declaring an allergy, and choosing its severity). PROPOSED: **keep**. This is data entry directly about an allergy, the narrowest possible allergen context, not a scarcity violation of the "allergen only" rule, it *is* the allergen rule applied to input controls rather than output verdicts. Audited in this ticket (see below): every other `--danger`/`--danger-bg` use in the file is also allergen-context; there is no crossover. Dependent on §2's proposed `--danger` darkening to clear the alert-category FAIL.
2. **`.noneopt.on` green check beside allergy copy.** PROPOSED, PO to decide between: (a) **keep** the green check, on the reasoning that it marks a **user's declaration** ("I have no allergies") rather than a **system verdict** ("this food is safe"), a different semantic register from the banned ALLOWED-as-green-check pattern (P5, rule 9); pair with a copy-deck note (M3-E0-T2's deck) explicitly distinguishing "declaration checkmark" from "verdict clearance" so the distinction is documented, not just assumed; or (b) **swap** to a neutral ink checkmark to remove the visual ambiguity the M3-E0-T1 reviewer flagged ("one glance from the banned pattern"). This document does not choose between (a) and (b); both are viable and the choice is a PO call, not an engineering one.
3. **`.chk.done` green** (shopping check-off). PROPOSED: **keep, no PO decision needed.** This is the general "positive/complete" sentiment use design-direction §0 already permits broadly (task done, item fresh, item verified), not the allergen-verdict-specific banned pattern; it sits outside any allergen surface entirely (Shopping screen, no allergen data present).
4. **`--rose` vs `--danger` boundary.** Verified by direct grep of the prototype: every `--danger`/`--danger-bg` use (7 CSS rules: `.allergen`, `.allergen .sh`, `.allergychip.on`, `.sevbtn.on`, `.verdictblock.blocked`, plus the legend row's inline style) is allergen-context; every `--rose`/`--rose-bg` use (4 CSS rules: freshness-ring "now" stop, `.exp.now`, `.ingredrow .stat.miss`, plus one inline style on the same ring) is expiry/urgency-context. **Zero crossover found.** PROPOSED: record the boundary as CONFIRMED, not just designed, ready for the M3 typed module's lint rule (design-direction §4 mentions a typed token module; recommend a rule there forbidding `--danger` outside `allergen*`-named components).
5. **AI purple exclusivity.** Verified by grep: every `--ai`/`--ai-bg` use (10 sites: `.prov.ai`, `.prov.ai.soft`, `.tray`, `.okbtn`, `.mode.cam`, `.chip.needsconf.on`, the "Needs your confirmation" section label, and the "future" phase label on one AI-adjacent scan-mode tile) is provenance/AI-tier or AI-adjacent phase-labeling. **Confirmed exclusive**, PROPOSED as CONFIRMED for the M3 module.
6. **Freshness-ring ramp.** Verified by grep: `.fr-now` uses `--rose`, `.fr-soon` uses `--amber`, `.fr-fresh` uses `--green`; `--danger` never appears in the ramp. **Confirmed** it never touches allergen red, matching design-direction §0's explicit rule.

---

## 5. Tap-target table

**Method:** height = (font-size x line-height) + top-padding + bottom-padding + top-border + bottom-border, for controls with no explicit CSS height/width. **Line-height assumption: 1.2x font-size** where no `line-height` is set (this is the value that reproduces the M3-E0-T1 review's own measured estimates exactly for `.leglink` (14.4 vs "~15"), `.toastUndo` (24.4 vs "~24"), `.chip` (33.6 vs "~34"), and `.loc` (34.6 vs "~35"), so it is used consistently here rather than assumed fresh). Where a rule sets an explicit `width`/`height`, that value is used directly (no line-height math needed); `box-sizing: border-box` is set globally so an explicit dimension already includes padding/border.

| Selector | CSS basis | Computed height | Target | Result |
|---|---|---|---|---|
| `.chip` | 13px font x 1.2 + 2x8px padding + 2x1px border | 33.6px (~34px) | 44px | FAIL (-10px) |
| `.loc` | 13px x 1.2 + 2x8px padding + 2x1.5px border | 34.6px (~35px) | 44px | FAIL (-9px) |
| `.seg button` | explicit `height: 36px` | 36px | 44px | FAIL (-8px) |
| `.chk` | explicit `width/height: 26px` | 26px | 44px | FAIL (-18px, worst case) |
| `.okbtn` | explicit `height: 32px` | 32px | 44px | FAIL (-12px) |
| `.sevbtn` | explicit `height: 34px` | 34px | 44px | FAIL (-10px) |
| `.allergychip` | 13px x 1.2 + 2x9px padding + 2x1.5px border | 36.6px (~37px) | 44px | FAIL (-7px) |
| `.leglink` | 12px x 1.2, no padding/border (plain underlined text) | 14.4px (~14px) | 44px | FAIL (-30px, worst case) |
| `.toastUndo` | 12px x 1.2 + 2x5px padding | 24.4px (~24px) | 44px | FAIL (-20px) |
| `.hbtn` | explicit `width/height: 40px` | 40px | 44px | FAIL (-4px) |
| `.iconb` | explicit `width/height: 42px` | 42px | 44px | FAIL (-2px) |
| `.step button` | explicit `width/height: 42px` | 42px | 44px | FAIL (-2px) |
| `.btn` | explicit `height: 48px` | 48px | 44px | PASS |
| `.fab` | explicit `width/height: 62px` | 62px | 44px | PASS |
| `.nav button` | `height: 100%` of `.nav`'s explicit `height: 66px` | 66px | 44px | PASS |

**12 of 15 controls fail.** Remediation without changing the look uses two techniques:

**A. Grow the box (near-misses, <=4px short):** `.hbtn` 40 -> 44px, `.iconb` 42 -> 44px, `.step button` 42 -> 44px. A 2-4px larger circle/square is not visually distinguishable at a glance and needs no other layout change.

**B. Invisible hit-slop, keep the visible pill exactly as drawn (far short, growing the box would blow the compact aesthetic):** add touch-area padding beyond the rendered control (React Native `hitSlop`, or on web a transparent `::before` sized to 44x44 and centered via `inset: calc((44px - width)/-2)`), computed as `ceil((44 - height)/2)` per side:

| Selector | Per-side hit-slop needed |
|---|---|
| `.chk` | 9px |
| `.leglink` | 15px |
| `.toastUndo` | 10px |
| `.okbtn` | 6px |
| `.chip` | 5px |
| `.sevbtn` | 5px |
| `.loc` | 5px |
| `.allergychip` | 4px |

**C. Grow the strip, not hit-slop (adjacent flex items sharing one continuous track, so per-item hit-slop would overlap the neighbor):** `.seg button` and `.sevbtn` sit edge-to-edge (or 8px-gapped) inside a shared row (`.seg`, `.sevrow`) with only a few px of container padding around them; recommend raising the row's own height (36 -> 44 for `.seg`, 34 -> 44 for `.sevbtn`) rather than hit-slop, since hit-slop on one segment would extend into the next segment's rendered area. This is a real, if minor, visual change (a segmented control and a severity-picker row 8-10px taller); flagged as the one remediation in this table that is not purely invisible.

---

## 6. Motion table

**No `prefers-reduced-motion` media query exists anywhere in the file** (grep confirmed: zero matches for `prefers-reduced-motion`). Design-principles P9 requires reduced motion to be respected; this is currently un-met everywhere below.

| Rule | Motion | Duration | Trigger | Proposed `prefers-reduced-motion: reduce` treatment |
|---|---|---|---|---|
| `.screen.active { animation: in .28s ease both; }` | Slide-up + fade-in on every screen transition | 0.28s, once per navigation | Every `go()` screen change | Disable entirely (`animation: none`); screen appears instantly. This is the review's flagged "screen-in animation." |
| `.laser { animation: sweep 1.8s ease-in-out infinite alternate; }` | Continuous vertical sweep | 1.8s, **infinite loop** | Always running while the scan screen is open | Disable (`animation: none`) and freeze at a static mid-frame position (`top: 74px`, the sweep's midpoint) so the viewfinder still reads as a scan indicator without motion. This is the review's flagged "laser sweep," and the highest-priority fix in this table since it is the only truly infinite, continuous animation in the file (a known vestibular/motion-sickness trigger class). |
| `.card.tap { transition: transform .12s ease; }` + `:active { transform: scale(.985); }` | Press-scale feedback | 0.12s, on tap | Card tap | Drop `transition` (instant scale on press) or drop the rule entirely; the scale itself (1.5%) is small enough that removing only the *animated interpolation* (not the state change) satisfies "respected" while keeping tactile feedback. |
| `.btn { transition: transform .1s; }` + `:active { transform: scale(.97); }` | Press-scale feedback | 0.1s | Button tap | Same treatment as `.card.tap`. |
| `.item { transition: transform .1s; }` + `:active { transform: scale(.985); }` | Press-scale feedback | 0.1s | Inventory/list row tap | Same treatment. |
| `.mode { transition: transform .1s; }` + `:active { transform: scale(.97); }` | Press-scale feedback | 0.1s | Add-food mode tile tap | Same treatment. |
| `.fab { transition: transform .12s; }` + `:active { transform: translateX(-50%) scale(.93); }` | Press-scale feedback | 0.12s | FAB tap | Same treatment. |
| `.chk svg { opacity: 0; transform: scale(.6); transition: .15s; }` | Check-mark fade/scale-in | 0.15s | Checkbox toggled | Keep the opacity fade (content appearing/disappearing is exempted by most reduced-motion guidance); drop the `scale(.6)` component so the glyph appears at full size instead of growing in. |
| `.toast { transition: .18s; }` | Toast fade/slide-in | 0.18s | Any `toast()` call | Keep the opacity fade; drop the `translateY` component (currently baked into the same `transform` the rule animates via the `.show` class swap). |

**Summary:** 9 animation/transition declarations, 0 currently guarded, 2 flagged by the M3-E0-T1 review (screen-in, laser sweep) as the priority fixes, 7 secondary (micro press-feedback and toast/check transitions) that should drop their transform component under reduced motion while most can keep opacity fades.

---

## 7. Dark-mode readiness (OQ-D6, still open)

Design-direction §2's v1 foundation table is the only place a dark counterpart exists at all, and it predates the v2 token sheet in §0 that the prototype actually ships (§0 changed most of the light-side hex values; the dark side was never re-derived to match).

**Have a documented dark counterpart (v1 table, §2), but the light side is now stale relative to §0/`:root`:**

| Token | v1 light (documented, now superseded) | v2 light (`:root`, actually shipped) | Documented dark | Status |
|---|---|---|---|---|
| `bg.page` | `#f5f4ed` | `#efe5d5` | `#141413` | Dark value never re-checked against the new, warmer light value |
| `bg.card` | `#faf9f5` | `#fffbf4` | `#30302e` | Same gap |
| `bg.interactive` | `#e8e6dc` | `#e4d7c2` (closest v2 analog, `bg.page.alt`) | `#3d3d3a` | Same gap |
| `border.subtle` / `border.strong` | `#f0eee6` / `#d1cfc5` | `#dfd1ba` (single `--line`, v2 collapsed subtle/strong to one token) | `#30302e` / `#4d4c48` | v2 merged two border tokens into one; the dark table still has two, needs reconciling |
| `text.primary` | `#141413` | `#1e1813` | `#faf9f5` | Same gap |
| `text.secondary` | `#5e5d59` | `#5b5045` | `#b0aea5` | Same gap |
| `text.tertiary` | `#87867f` | `#8f8274` | `#87867f` (identical to its own light value, likely a placeholder, not a real dark derivation) | Needs a real dark value, and the light side needs the §2 fix from this document first |

**No dark counterpart exists at all (v2-only tokens):**

`--espresso` / `--espresso-2` (bg.hero), `--cream` (text.onHero), `--brand` / `--brand-deep` / `--brand-tint` (accent.brand triad), `--green` / `--green-bg`, `--amber` / `--amber-bg` (both updated hexes from v1), `--rose` / `--rose-bg` (urgency.today, new in v2), `--danger` / `--danger-bg` (updated hex from v1), `--ai` / `--ai-bg`, the freshness-ring ramp, and the Fraunces display face's dark-mode legibility (untested).

**Recommendation for M3:** dark mode (OQ-D6) stays open; this section is the inventory of what a dark pass would need to produce (a re-derivation of the 7-row v1 table against the actual v2 light values, plus a from-scratch dark value for every v2-only token above), not a resolution of it.
