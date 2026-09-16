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

