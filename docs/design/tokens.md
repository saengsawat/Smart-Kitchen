# Design Tokens, v6 (Cookbook) token sheet (M3-E0-T6)

**Status:** docs only, written 2026-10-14 for ticket M3-E0-T6. This sheet describes prototype v6, the Cookbook direction, which is the build reference since D-033 (2026-10-13). It replaces the v5 sheet (M3-E0-T3), whose measured findings were adopted by D-021 and are now history. The app is still built on the v5 values in `apps/mobile/src/design/tokens.ts` until M3-T13 restyles it; section 11 is the v5-to-v6 mapping M3-T13 works from.

**Source of truth:** every value below is copied from `:root` and the stylesheet of [mockups/smart-kitchen-prototype.html](mockups/smart-kitchen-prototype.html) (v6). Nothing is invented. Where this sheet suggests a name or a fix the prototype does not make, it is marked PROPOSED (CLAUDE.md rule 5) and the architect decides. Contrast ratios are computed by script (WCAG 2.x relative luminance), never by eye.

**Unchanged by v6 (D-033 item 3):** every safety and semantic value from D-021. The hex values for `--danger`, `--danger-bg`, `--amber`, `--amber-bg`, `--green`, `--green-bg`, `--rose`, `--rose-bg`, `--ai` and `--ai-bg` in v6 `:root` are identical to the v5 values the app already carries. Section 1 marks them "carried forward unchanged".

---

## 1. Colour tokens

### 1a. Every custom property in v6 `:root`

Safety and semantic rows: hex byte-identical to D-021; use prose updated for v6 selectors (see section 6 item 1). Allergy selection controls going ink (no longer red) is PROPOSED, an open PO call, not decided here.

`:root` holds 18 colour properties. v6 has no radius, spacing or font custom properties; those values live in the stylesheet and are catalogued in sections 2 and 3.

| `:root` property | Hex | Role | Allowed uses | Forbidden uses |
|---|---|---|---|---|
| `--paper` | `#fbfaf6` | Page canvas, sheet and nav surface. v6 has one light surface; cards are unboxed or hairline-ruled | Screen background, sheets, nav bar, hero badge fill, scrim-free panels | Text colour |
| `--tile` | `#f1eee6` | Quiet panel and photo-tile fallback | Photo and thumbnail backing, "Why this?" panel, tastes card, code note, profile card, assistant bubble, empty slot, neutral stat chip (`.stat.list`), pressed/hover fill | Primary page background, text colour |
| `--ink` | `#0f0f0f` | Primary text, rules, and the primary action colour | All body text and headings, section rules, primary button fill, selected chip fill, avatar, FAB-style nav "Add" disc, toast fill, checkbox ring | Backgrounds of large areas other than the camera and button fills above |
| `--ink2` | `#5f5d58` | Secondary text | Sub-lines, meta, captions, inactive nav labels, quantities, notes | Backgrounds |
| `--ink3` | `#6f6c66` | Tertiary text (only on `--paper` and `--tile`) | "Coming soon" row sublines, "not tracked" staple chip, struck-through done rows, rank numerals, placeholder text, blocked-recipe initials | Body text smaller than 12px; any pair not measured in section 4 |
| `--hair` | `#dcd8cf` | Hairline | Row dividers, underlines, quiet borders | Fill, text, and any border that is the only thing identifying a control (see section 4 flags) |
| `--danger` | `#882020` | **Allergen only.** Carried forward unchanged | `.blockbar` (blocked recipe), `.prov.alg` (allergen legend chip), the "Blocked for Maya" lines | Everywhere else, including destructive actions, generic errors, expired food |
| `--danger-bg` | `#f9d9d9` | Allergen tint surface. Carried forward unchanged | Backing for the above | Same |
| `--amber` | `#925b0a` | Estimated, expiring-soon, short and "allergen data incomplete". Carried forward unchanged | `.prov.est`, `.days.soon`, `.stat.shortby`, `.stat.miss`, `.verdict.unk`, `.mfoot`, `.tile.short`, `.short`, `.queued` | Allergen-blocked contexts, AI content |
| `--amber-bg` | `#f6e6c8` | Amber tint surface. Carried forward unchanged | Backing for the above | Same |
| `--green` | `#2c744b` | Known Fact, have, fresh, positive. Carried forward unchanged | `.prov.fact`, `.days.ok`, `.stat.have`, `.amt.pos`, shopping "already have" check, `.loop` pantry banner | Allergen contexts, AI-tier content |
| `--green-bg` | `#dfeee3` | Green tint surface. Carried forward unchanged | Backing for the above | Same |
| `--rose` | `#9d4b51` | "Use today" urgency, never allergen. Carried forward unchanged | `.days.now` ("Today") | **Allergen contexts** (zero crossover found, section 6) |
| `--rose-bg` | `#f7dcdc` | Rose tint surface. Carried forward unchanged | Backing for the above | Same |
| `--ai` | `#7b4cb5` | AI Interpretation tier, exclusive hue. Carried forward unchanged | `.prov.ai`, the confirmation-tray heading (`.trh`) | Anywhere that is not an AI-read item |
| `--ai-bg` | `#eadff7` | AI tint surface. Carried forward unchanged | Backing for the above, and the confirmation tray background | Same |
| `--ai-ink` | `#5a4a70` | **New in v6.** Secondary text on the AI tray (`--ai-bg`) | `.tray i` source lines, `.tray .foot2` | Anywhere off the AI tray |
| `--stage` | `#e6e5e1` | **Prototype chrome only.** The page behind the drawn phone | Not a product token. Do not carry to the app | Everything in the app |

### 1b. Literal colours in the v6 stylesheet outside `:root`

These are hard-coded in v6 CSS. They are listed so M3-T13 can name them (names are PROPOSED, ENGINEERING INFERENCE) rather than leak raw hex into components.

| Literal | Where | Role | PROPOSED token |
|---|---|---|---|
| `#ffffff` (`#fff`) | `.btn.pri`, `.okb`, `.chip` pressed, `.sev` pressed, `.bub.me`, `.toast`, `.addprimary`, `.av`, `.send`, nav "Add" disc | Text and icons on ink fills | `white` (already in tokens.ts) |
| `rgba(255,255,255,.78)` | `.addprimary` subline | Secondary text on the ink primary block | `onInkMuted` (composite `#cacaca` on ink) |
| `#2b2b2b` | `:hover` on `.btn.pri`, `.okb`, `.addprimary` | Hover fill for ink buttons | `inkHover` |
| `#f4f2ec` | `:hover` on `button.row`, `.arow`, `.slot`, `.pick` | Hover fill for list rows | `rowHover` |
| `#e4e1d9` | `:hover` on `.btn.pri.inv` | Hover fill for the inverted button on the camera screen | `invHover` |
| `#5b4210` | `.verdict.unk .c/.u`, `.mfoot i` | Body text on `--amber-bg` | `amberInk` |
| `#1f4d33` | `.loop` banner text | Body text on `--green-bg` | `greenInk` |
| `#235f3d` | `:hover` on `.loop .okb` | Hover fill for the green pantry button | `greenHover` |
| `#d7c6ee` | `.tray .ci` divider | Hairline on the AI tray | `aiHair` |
| `#f5f0fb` | `.tray .ci .th` | Thumbnail backing on the AI tray | `aiTile` |
| `#2442d6` | `:focus-visible` outline (2.5px, offset 2px), `.rec:has(.reclink:focus-visible)` | Keyboard focus ring. Replaces v5 `--info` `#3898ec` and its ink halo | `focus` |
| `#121212` | `#scan` background and camera panel | The one dark surface (camera screen) | `cameraBg` |
| `#2b2a27` | camera panel radial-gradient top stop | Camera decoration | `cameraBg2` |
| `#f3f1ec` | camera brackets, laser, camera text and icons, `.btn.pri.inv` fill | Text and chrome on the camera screen | `cameraText` |
| `#d9d6cf` | `.camhint`, `.denied p` | Secondary text on the camera screen | `cameraTextMuted` |
| `rgba(255,255,255,.3)` / `.6` / `.1` | `.iconb.light` border, `.btn.light` border, `.btn.light:hover` fill | Camera-screen control outlines | `cameraLine` family |
| `rgba(15,15,15,.45)` | `.modal .scrim` | Sheet scrim (ink at 45%) | `scrim` |
| `#151515`, `#0d0d0d`, `#4a4945`, `#55534f`, `#222`, `#d3d2cd`, `#9a978f`, `#fff` on stage | Stage header, jump and state buttons, drawn phone | **Prototype chrome only.** Not product tokens | none |

### 1c. Scarcity of colour in v6

See section 5 for the rules restated for an ink-primary system with no brand accent. v6 has **no brand colour**. The v5 terracotta triad, the espresso hero, the cream-on-dark text, the sand canvas and the `--info` blue are all gone (mapping in section 11).

---

## 2. Typography

### 2a. Fonts (SOURCES.md pattern)

Both families are SIL Open Font License 1.1 and are loaded in the prototype from Google Fonts with `family=Bodoni+Moda:opsz,wght@6..96,400..700` and `family=Schibsted+Grotesk:wght@400..800`. They would be vendored into `apps/mobile/assets/fonts/` by M3-T13 the way Fraunces and Inter are today.

| Role | Family | Axes in the prototype request | Weights v6 actually uses | Licence | Source |
|---|---|---|---|---|---|
| Display (`.serif` class: headings, quantities, percentages, numerals in stats) | Bodoni Moda | `opsz` 6 to 96, `wght` 400 to 700; `font-optical-sizing: auto` | 500 only | SIL OFL 1.1 (unverified until OFL.txt is fetched) | `github.com/google/fonts`, directory `ofl/bodonimoda` (upstream project: Indestructible Type, `github.com/indestructible-type/Bodoni`) |
| UI and body (default `body`) | Schibsted Grotesk | `wght` 400 to 800 | 400, 500, 600, 700, 800 (800 only for the current nav tab) | SIL OFL 1.1 (unverified until OFL.txt is fetched) | `github.com/google/fonts`, directory `ofl/schibstedgrotesk` (upstream project: Schibsted, `github.com/schibsted/schibsted-grotesk`) |

The upstream project names above are from memory of the `google/fonts` layout and are to be confirmed against each family's `OFL.txt` (copyright line) at fetch time.

**Not yet fetched, so not pinned.** Following `apps/mobile/assets/fonts/SOURCES.md`, the vendoring step must record the exact file name, raw URL, `google/fonts` commit hash and fetch date, and copy each family's `OFL.txt` next to the font file. This ticket is docs only and did not fetch anything, so no commit hash is stated here (nothing invented). File names are expected to be the variable files `BodoniModa[opsz,wght].ttf` and `SchibstedGrotesk[wght].ttf`; verify against the directory listing at fetch time.

**Fallback stacks as written in v6:** body `'Schibsted Grotesk', system-ui, sans-serif`; display `'Bodoni Moda', serif`.

**Risks M3-T13 must check on a real device (carried from the M3-T1 note in SOURCES.md):**
1. Variable-weight selection through `fontWeight` is reliable on iOS and unverified on some Android versions. v6 relies on five Schibsted weights and one Bodoni weight.
2. Bodoni Moda's `opsz` axis (`font-optical-sizing: auto`) is a CSS behaviour. React Native has no automatic optical sizing, so display sizes from 20px to 54px will render at the font's default optical size unless M3-T13 sets variation settings or vendors fixed instances. The visual effect (hairlines thinning at large sizes) is a v6 design feature, so this is a real fidelity risk, not a nicety.
3. Numerals: v6 sets `font-variant-numeric: lining-nums` on `.num` and `tabular-nums lining-nums` on stats, macros and the big quantity. React Native needs `fontVariant: ['lining-nums', 'tabular-nums']`; confirm the fonts ship both features.

### 2b. Type scale

Every font size and weight in v6 CSS, grouped by role. Line heights are as written (unitless multipliers). All sizes are CSS px and map 1:1 to React Native points. v6 has **no size below 12px** (v5's caption was 11.5px).

**Display (Bodoni Moda 500)**

| Size | Line height | Letter spacing | Role | Selectors |
|---|---|---|---|---|
| 54 | 1 | none | Initial on a letter tile | `.ph.lettr` |
| 46 | 1 | none | Item quantity | `.qtybig b`. Applied in the prototype by M3-E0-T8 (2026-10-14), `--ink2` border. |
| 44 | 1 | -.015em | Screen title | `.title` |
| 40 | 1.02 | -.015em | Home headline, recipe name | `.h1` |
| 36 | 1 | none | Stat value | `.stats .v` |
| 30 | 1.05 | none | Scanned product name, camera-denied heading | `.pname`, `.denied h2` |
| 28 | 1 | none | Coverage badge on hero, rank numeral, empty-state heading | `.hero .pct`, `.row .ix`, `.emptyst h2` |
| 27 | 1.05 | none | Recipe card name | `.rec h2` |
| 26 | 1 | none | Coverage badge on cards, stepper value | `.rec .pct`, `.step b` |
| 26 | 1.05 | none | Sheet title | `.sheet h2` |
| 25 | 1 | none | Section heading | `.sec h2` |
| 24 | 1 | none | Macro value | `.macros b` |
| 22 | 1 | none | Group heading, menu-card heading | `.grp h2`, `.mh h3`. Applied in the prototype by M3-E0-T8 (2026-10-14). |
| 20 | 1 | none | Rail badge, picker percentage, blocked-ingredient initial | `.rph .pct`, `.pick .pp`, inline initials |

**UI and body (Schibsted Grotesk)**

| Size | Weight | Line height | Role | Selectors |
|---|---|---|---|---|
| 20 | 600 | 1 | Stepper glyph | `.step button` |
| 17 | 700 | 1.2 | Primary block title | `.addprimary b` |
| 16 | 500 | 1 | Text input | `.inp` |
| 16 | 700 | 1.2 | Profile name | `.me b` |
| 15.5 | 700 | 1.2 | Row title | `.row b`, `.arow b` |
| 15 | 400 | 1.45 | Body default | `body` |
| 15 | 700 | 1.2 | Shopping row title, box heading, tastes heading | `.srow b`, `.bh`, `.tastes b` |
| 15 | 700 | 1 | Camera title | `.camtop h1` |
| 14.5 | 700 | 1.25 | Tray item, ledger title, slot title | `.tray b`, `.led .m b`, `.slot .m b` |
| 14.5 | 600 | 1.2 to 1.3 | Picker row, none-option | `.pick`, `.noneopt` |
| 14 | 700 | 1 | Button | `.btn` |
| 14 | 600 | 1 | Segment label, amount, unit label | `.seg button`, `.srow .amt`, `.unitlbl` |
| 14 | 700 | 1.1 to 1.3 | Day label, rail title, signed amounts, key value | `.slot .d b`, `.rcard b`, `.amt.pos`, `.amt.neg`, `.kv .v`, `.mfoot b` |
| 14 | 400 | 1.5 | Paragraph on empty and camera states, chat bubble | `.emptyst p`, `.denied p`, `.bub` |
| 13.5 | 400 to 700 | 1.35 to 1.5 | Verdict line, block bar, toast, alloc row, loop banner, chip label, sub-line | `.verdict`, `.blockbar`, `.toast`, `.alloc`, `.loop`, `.chip`, `.sub`, `.trh`, `.addprimary .ap span` |
| 13 | 400 to 700 | 1 to 1.5 | Short note, link, ok button, byline, meta, status bar | `.verdict .u`, `.why`, `.arow .am>span`, `.okb`, `.by`, `.rec .meta`, `.sec .lnk`, `.sev button`, `.row .q`, `.camhint` |
| 12.5 | 400 to 500 | 1.3 to 1.6 | Caveat line, note, tray source, ledger detail, small verdict | `.verdict .c`, `.note`, `.tray i`, `.led .m i`, `.srow .s`, `.tilenote`, `.kv .vs` |
| 12 | 700 | 1 | Chip, label, stat | `.prov`, `.days`, `.stat`, `.av`, `.hero .pct small`, `.kv .k`, `.fl`, `.rlbl`, `.queued`, `.msrc`, `.mtag` |
| 12 | 500 to 600 | 1 to 1.25 | Nav label, caption, group count | `.nav button`, `.mast .name`, `.grp span`, `.rmv`, `.macros i`, `.stats .l`, `.tile .cap` |

**Letter spacing (uppercase labels)** `.22em` masthead name; `.14em` stage label (chrome); `.12em` key labels, days chips, coverage unit, field labels; `.1em` stat chips, menu tag; `.08em` source tag, macro captions. These labels use `text-transform: uppercase` (`.mast .name`, `.days`, `.stat`, `.kv .k`, `.fl`, `.rlbl`, `.mtag`, `.msrc`, `.macros i`, `.hero .pct small`, `.rec .pct small`). The copy deck must hold their strings in sentence case; React Native's `textTransform: 'uppercase'` does the rest.

---

## 3. Radius, spacing and size

### 3a. Radius

v6 has no radius custom properties. Photos and tiles are square (radius 0).

| Value | Where | PROPOSED name |
|---|---|---|
| `0` | Hero, rail and card photos, thumbnails, tiles, the labels `.mtag`, `.msrc`, `.tagm` | `radius.none` |
| `999px` | `.btn`, `.chip`, `.okb`, `.days`, `.prov`, `.stat`, `.rmv`, `.sev button` | `radius.pill` (tokens.ts already has `9999`) |
| `50%` | `.av`, `.iconb`, `.chk span`, `.mchip`, `.step button`, `.send`, nav "Add" disc, `.blockbar .sh` | `radius.circle` |
| `22px 22px 0 0` | `.sheet`, `.panel` (scan product panel) | `radius.sheet` |
| `14px` | `.tray`, `.addprimary` | `radius.panel` |
| `12px` | `.toast` | `radius.toast` (equals today's `radius.sm`) |
| `10px` | `.verdict.unk`, `.blockbar` | `radius.verdict` |
| `8px` | `.verdict.unk.sm` | `radius.verdictSm` |
| `4px` | `:focus-visible` | not tokenised; the ring's own corner |

### 3b. Spacing

Measured from every `padding`, `margin` and `gap` declaration in the product CSS (stage chrome excluded): 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 30, 40 px. Most used: **20px** (48 declarations, the screen gutter and section margin), 12px (37), 10px (35), 14px (28), 8px (24), 4px and 6px (14 each), 16px (12).

Recommendation (ENGINEERING INFERENCE, architect decides): keep the existing 4-step scale in tokens.ts (`xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 32) and add the three steps v6 leans on that the scale lacks: `snug` 10, `cozy` 14, `gutter` 20, plus `section` 30 for the large heading gap. The odd values (3, 5, 7, 9, 11, 13) are optical nudges inside chips and rows; round them to the nearest scale step in the app.

### 3c. Fixed sizes (control and media)

| Item | Value |
|---|---|
| Screen gutter | 20px (`.pad`, `margin: 0 20px`) |
| Primary button | min-height 50px; wide variant 52px |
| Nav bar | items min-height 48px, padding `8px 8px 20px`, 5-column grid; "Add" disc 46px |
| Row thumbnails | 56px (list), 48px (ingredient, shopping), 44px (tray), 64x48 (menu slot), 96px (item detail) |
| Photo aspect | 4:3 for hero and cards; tiles square |
| Row min-heights | 72 (list), 68 (shopping, Add-food rows), 62 (ingredient), 56 (key-value), 52 (picker), 76 (menu slot) |
| Inventory tiles | 4 columns, 8px gap (3 columns in the three-up variant) |
| Icon sizes | 14 to 28px strokes at 1.9 to 2.3 (nav current tab 2.3) |
| Minimum touch target | 44px (D-033 item 3, still binding); exceptions listed in section 7 |

---

## 4. Contrast table

**Formula (WCAG 2.x), shown once:**

```
for channel c in {R,G,B} (0-255): s = c/255
  c_lin = s/12.92                        if s <= 0.03928
  c_lin = ((s+0.055)/1.055)^2.4          otherwise
L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin
contrast(A,B) = (L_lighter + 0.05) / (L_darker + 0.05)
```

Translucent layers are composited first: `result_c = round(alpha*fg_c + (1-alpha)*bg_c)` per channel. Where text sits on a photo, v6 puts it on an opaque paper badge (`.pct`), so no photo-luminance assumption is needed (v5 needed one). The script is `contrast.js` run with `node`; its source is reproduced in the worker report.

**Thresholds:** body text 4.5:1; large text (24px regular or 18.66px bold and up) 3:1; alert text (allergen context) 7:1, the bar set in D-021 and kept; non-text UI (focus ring, control boundary that carries meaning) 3:1; decorative glyph fills reported only.

54 pairs measured: every text-on-background pair v6 renders, the state-change pairs (hover, pressed), the camera screen, the focus ring and the non-text borders. Stage chrome (rows 49 to 54) is prototype-only and does not bind the app.

| # | Pair | Fg | Bg (or composite) | Where and size | Category | Target | Ratio | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | ink on paper | `#0f0f0f` | `#fbfaf6` | body and headings, 13-44px | body | 4.5 | 18.35 | PASS |
| 2 | ink on tile | `#0f0f0f` | `#f1eee6` | .bub.ai, .why b, .tastes b, .me b, .tagm | body | 4.5 | 16.53 | PASS |
| 3 | ink on ai-bg | `#0f0f0f` | `#eadff7` | .tray b item names, 14.5px 700 | body | 4.5 | 14.97 | PASS |
| 4 | ink on amber-bg | `#0f0f0f` | `#f6e6c8` | not used as a text pair today (completeness) | body | 4.5 | 15.58 | PASS |
| 5 | ink2 on paper | `#5f5d58` | `#fbfaf6` | .sub, .row .q, .note, nav labels (12px 600), .pct small | body | 4.5 | 6.30 | PASS |
| 6 | ink2 on tile | `#5f5d58` | `#f1eee6` | .why, .tastes i, .codenote, .stat.list, .tile .cap | body | 4.5 | 5.67 | PASS |
| 7 | ink3 on paper | `#6f6c66` | `#fbfaf6` | .arow.soon span (13px), .stat.staple (12px 700), .srow.done (15px, struck through), input placeholder (16px) | body | 4.5 | 5.01 | PASS |
| 8 | ink3 on tile | `#6f6c66` | `#f1eee6` | blocked ingredient initials (20px Bodoni 500), blocked-recipe letter tile | body | 4.5 | 4.51 | PASS (narrow, margin 0.01) |
| 9 | ink3 on paper, large | `#6f6c66` | `#fbfaf6` | .row .ix rank numerals, 28px Bodoni 500 | large | 3 | 5.01 | PASS |
| 10 | ink3 on tile, large | `#6f6c66` | `#f1eee6` | .ph.lettr initial, 54px Bodoni 500 | large | 3 | 4.51 | PASS |
| 11 | ink2 on paper, large | `#5f5d58` | `#fbfaf6` | .rec.blocked h2 (27px), blocked recipe h1 (40px) | large | 3 | 6.30 | PASS |
| 12 | white on ink | `#ffffff` | `#0f0f0f` | .btn.pri, .okb, pressed .chip and .sev, .bub.me, .toast, .addprimary b, .av, .send, nav Add disc | body | 4.5 | 19.17 | PASS |
| 13 | white 78% on ink (composite) | `#cacaca` | `#0f0f0f` | .addprimary subline, 13.5px 400 | body | 4.5 | 11.70 | PASS |
| 14 | white on #2b2b2b (hover) | `#ffffff` | `#2b2b2b` | .btn.pri, .okb, .addprimary on hover | body | 4.5 | 14.16 | PASS |
| 15 | ink on tile (hover) | `#0f0f0f` | `#f1eee6` | .btn, .chip, .okb.ghost on hover | body | 4.5 | 16.53 | PASS |
| 16 | ink on #f4f2ec (hover) | `#0f0f0f` | `#f4f2ec` | button.row, .arow, .slot, .pick on hover | body | 4.5 | 17.12 | PASS |
| 17 | ink2 on #f4f2ec (hover) | `#5f5d58` | `#f4f2ec` | .arow span, .row .q on hover | body | 4.5 | 5.87 | PASS |
| 18 | ink on #e4e1d9 (hover) | `#0f0f0f` | `#e4e1d9` | .btn.pri.inv on hover (scan screen) | body | 4.5 | 14.67 | PASS |
| 19 | paper on #151515 (selection) | `#fbfaf6` | `#151515` | ::selection | body | 4.5 | 17.48 | PASS |
| 20 | danger on danger-bg | `#882020` | `#f9d9d9` | .blockbar 13.5px 600, .prov.alg 12px 700 | alert | 7 | 7.02 | PASS |
| 21 | danger on paper | `#882020` | `#fbfaf6` | blocked line in the menu rail (12.5px 700), .pick blocked row | alert | 7 | 8.84 | PASS |
| 22 | danger on paper at 75% opacity (composite) | `#a55756` | `#fbfaf6` | the blocked row in the Sun dinner sheet (`.pick` row carries `opacity: .75`) | alert | 7 | 4.91 | **FAIL** |
| 23 | white on danger | `#ffffff` | `#882020` | .blockbar .sh warning icon swatch, not text | decorative | n/a | 9.23 | reported only |
| 24 | amber on amber-bg | `#925b0a` | `#f6e6c8` | .verdict.unk 13.5px 600, .days.soon, .stat.shortby/.miss, .prov.est, .mfoot b, .queued, .tile.short captions | body | 4.5 | 4.59 | PASS |
| 25 | #5b4210 on amber-bg | `#5b4210` | `#f6e6c8` | .verdict.unk .u/.c, .mfoot i, 12.5-13px | body | 4.5 | 7.65 | PASS |
| 26 | amber on paper | `#925b0a` | `#fbfaf6` | .short (13px 700), .rec .need | body | 4.5 | 5.40 | PASS |
| 27 | green on green-bg | `#2c744b` | `#dfeee3` | .days.ok, .prov.fact, .stat.have | body | 4.5 | 4.71 | PASS |
| 28 | green on paper | `#2c744b` | `#fbfaf6` | .amt.pos (14px 700), shopping "already have" check (16px 700) | body | 4.5 | 5.42 | PASS |
| 29 | green on tile | `#2c744b` | `#f1eee6` | .led.sys .amt.pos | body | 4.5 | 4.89 | PASS |
| 30 | #1f4d33 on green-bg | `#1f4d33` | `#dfeee3` | .loop banner text, 13.5px 600 | body | 4.5 | 8.06 | PASS |
| 31 | white on green | `#ffffff` | `#2c744b` | .loop .okb "Add", 13px 700 | body | 4.5 | 5.67 | PASS |
| 32 | white on #235f3d (hover) | `#ffffff` | `#235f3d` | .loop .okb on hover | body | 4.5 | 7.57 | PASS |
| 33 | rose on rose-bg | `#9d4b51` | `#f7dcdc` | .days.now, 12px 700 | body | 4.5 | 4.56 | PASS |
| 34 | ai on ai-bg | `#7b4cb5` | `#eadff7` | .prov.ai 12px 700, .trh 13.5px 700 | body | 4.5 | 4.63 | PASS |
| 35 | ai-ink on ai-bg | `#5a4a70` | `#eadff7` | .tray i, .tray .foot2, 12.5px | body | 4.5 | 6.19 | PASS |
| 36 | ai on paper | `#7b4cb5` | `#fbfaf6` | AI glyph or label where a chip background is transparent (v6 always sets ai-bg; completeness) | body | 4.5 | 5.67 | PASS |
| 37 | #f3f1ec on #121212 | `#f3f1ec` | `#121212` | camera chrome, headings, brackets, laser, 15px 700 and up | body | 4.5 | 16.60 | PASS |
| 38 | #f3f1ec on #2b2a27 | `#f3f1ec` | `#2b2a27` | lightest stop of the camera gradient | body | 4.5 | 12.71 | PASS |
| 39 | #d9d6cf on #121212 | `#d9d6cf` | `#121212` | .camhint 13px 600, .denied p 14px | body | 4.5 | 12.91 | PASS |
| 40 | #d9d6cf on #2b2a27 | `#d9d6cf` | `#2b2a27` | .camhint over the lightest gradient stop | body | 4.5 | 9.89 | PASS |
| 41 | ink on #f3f1ec | `#0f0f0f` | `#f3f1ec` | .btn.pri.inv "Enter manually" | body | 4.5 | 16.98 | PASS |
| 42 | #f3f1ec on #121212 | `#f3f1ec` | `#121212` | .btn.light label 14px 700 | body | 4.5 | 16.60 | PASS |
| 43 | focus ring on paper | `#2442d6` | `#fbfaf6` | 2.5px ring, 2px offset (non-text, WCAG 1.4.11) | non-text | 3 | 7.12 | PASS |
| 44 | focus ring on tile | `#2442d6` | `#f1eee6` | ring around tile-backed controls | non-text | 3 | 6.41 | PASS |
| 45 | focus ring on camera | `#2442d6` | `#121212` | ring on the scan screen controls | non-text | 3 | 2.52 | **FAIL**. Applied in the prototype by M3-E0-T8 (2026-10-14). |
| 46 | hair on paper | `#dcd8cf` | `#fbfaf6` | dividers, `.iconb.round` and `.rmv` borders, `.stat.staple` border | non-text | 3 | 1.36 | **FAIL** (see flag) |
| 47 | ink2 on paper | `#5f5d58` | `#fbfaf6` | .emptyst dashed border, .offbar border | non-text | 3 | 6.30 | PASS |
| 48 | ink on paper | `#0f0f0f` | `#fbfaf6` | .chk ring, .noneopt box, .btn and .chip borders, .rule, .sec rule | non-text | 3 | 18.35 | PASS |
| 49 | #4a4945 on stage | `#4a4945` | `#e6e5e1` | stage heading (chrome) | body | 4.5 | 7.15 | PASS |
| 50 | #55534f on stage | `#55534f` | `#e6e5e1` | stage description and footer (chrome) | body | 4.5 | 6.09 | PASS |
| 51 | ink on white | `#0f0f0f` | `#ffffff` | jump buttons (chrome) | body | 4.5 | 19.17 | PASS |
| 52 | white on #151515 | `#ffffff` | `#151515` | pressed jump and state buttons (chrome) | body | 4.5 | 18.26 | PASS |
| 53 | ink on stage | `#0f0f0f` | `#e6e5e1` | state-button labels (chrome) | body | 4.5 | 15.21 | PASS |
| 54 | #9a978f on stage | `#9a978f` | `#e6e5e1` | dashed state-button border (chrome) | non-text | 3 | 2.31 | **FAIL** (chrome only, not product) |

### FAILs and proposed fixes (PROPOSED, architect decides; the prototype is out of scope here)

Of 54 pairs, 49 pass, 4 fail (rows 22, 45, 46, 54) and 1 is reported only (row 23). Three of the failures matter to the product.

| Row | Finding | Proposed fix | New ratio | Note |
|---|---|---|---|---|
| 22 | The blocked row in the Sun dinner sheet (`.pick` with `opacity: .75`) dims the allergen text "Blocked for Maya · not selectable" from 8.84:1 to 4.91:1, under the 7:1 alert bar | Drop the row's `opacity`. The name is already `--ink2` and the row is already not tappable, so full-strength danger text keeps the "unavailable" read | 8.84 | Safety copy. The allergen line must never be dimmed. Fix in M3-T13 (build) and note for the prototype owner |
| 45 | On the camera screen the focus ring `#2442d6` on `#121212` is 2.52:1, under 3:1. v5 solved this with an ink halo; v6 dropped the halo | Use a light ring on the camera screen only: `#f3f1ec` on `#121212` is 16.60:1 | 16.60 | Keep `#2442d6` everywhere on paper and tile (rows 43, 44) |
| 46 | `--hair` is 1.36:1 on paper. As a divider it is decorative and exempt. As the only visible boundary of `.iconb.round` (icon button) and `.rmv` (Remove, 36px) it fails 1.4.11 | Keep `--hair` for dividers. For those two controls use `--ink2` as the border (`#5f5d58` on paper 6.30:1), or drop the border and rely on the icon and label | 6.30 | `.stat.staple` ("not tracked") is a non-interactive label whose text passes (row 7), so its hairline is decorative |
| 54 | Prototype stage button border | none | n/a | Chrome only, not product |

**Narrow passes to protect** (clear 4.5:1 by under 0.1): row 8 ink3 on tile 4.51, row 24 amber on amber-bg 4.59, row 33 rose on rose-bg 4.56, row 34 ai on ai-bg 4.63 (0.13). Do not lighten any of these tokens, or change the surface under them, without re-running the script.

**What did not change since D-021:** `--danger` on its tint is 7.02:1, the 7:1 alert bar, unchanged. `--amber`, `--green`, `--rose` all clear 4.5:1 on their tints and on paper. v6 also resolves the v5 colour-only failures: `--ink3` moved from `#665c52` to `#6f6c66` and still clears 4.5:1 on both light surfaces (5.01 and 4.51).

---

## 5. Scarcity rules (ink-primary system, no brand accent)

v5's scarcity rule policed a terracotta brand colour. v6 has no brand colour, so the rule moves to **what ink is allowed to do** and **what colour is allowed to mean**. Rules 1 to 4 restate D-033 items 2 and 3; rules 5 to 7 are ENGINEERING INFERENCE derived from how v6 is drawn and need architect sign-off before they bind.

1. **Ink is the only action colour.** Primary actions, selected chips and segments, the active tab, checkboxes, the avatar and the toast are ink (`#0f0f0f`) with white or paper text. The pressed state is `scale(.98)` and the hover state is `#2b2b2b`; neither introduces a hue. No terracotta, orange or any new hue is added as an accent without an ADR or a logged decision.
2. **Colour is reserved for meaning, never decoration.** Food photography carries the colour of the product. The only coloured text and chips are the semantic set in section 1a: green (Known Fact, have, fresh, positive), amber (estimated, expiring soon, short, allergen data incomplete), rose ("use today"), purple (AI-read), allergen red.
3. **Allergen red is for allergens only.** `--danger` and `--danger-bg` appear only on the blocked-recipe bar, the allergen legend chip, and the "Blocked for Maya" lines (section 6). Never on delete, error, expired food or a selection control.
4. **The expiry ladder never turns red.** Today is rose, 2 to 3 days is amber, further out is green.
5. **One ink-filled primary per decision.** A screen region offers at most one ink-filled primary action; the alternatives are outlined (`.btn`, `.okb.ghost`, `.btn.light`). PROPOSED.
6. **Dark surfaces are the camera screen and ink controls only.** The v5 "one large dark surface" (espresso Home hero) is retired. `#121212` is allowed behind the live camera; ink is allowed as a button, toast or avatar fill. No dark hero, card or banner. PROPOSED.
7. **Ink rules structure the page, hairlines divide rows.** A 1px ink rule marks a section head, the nav top edge, a stat band or a macro band; a 1px `--hair` rule separates rows inside a list. Tinted panels use `--tile` for neutral content and a semantic tint only for its own meaning. PROPOSED.

**The one exception to rule 1 (DECIDED, Andy, 2026-10-14, D-033 amendment c):** the pantry banner `.loop` ("Olive oil checked off · add it to the pantry?") fills its **Add** button with `--green` (hover `#235f3d`) on purpose, as a positive confirmation. It passes contrast (rows 31, 32). Green fill on an action is allowed on that banner only.

**Colour-bearing rules in v6 and their classification:**

| Colour | v6 rules that use it | Meaning held |
|---|---|---|
| `--danger` / `--danger-bg` | `.blockbar`, `.blockbar .sh`, `.prov.alg`, inline "Blocked for Maya" text (menu rail, picker sheet) | Allergen only |
| `--rose` / `--rose-bg` | `.days.now` | Use today |
| `--amber` / `--amber-bg` | `.verdict.unk`, `.days.soon`, `.prov.est`, `.stat.shortby`, `.stat.miss`, `.mfoot`, `.tile.short`, `.short`, `.queued` | Estimated, expiring, short, data incomplete |
| `--green` / `--green-bg` | `.days.ok`, `.prov.fact`, `.stat.have`, `.amt.pos`, shopping "already have" check, `.loop` | Known Fact, have, fresh, positive |
| `--ai` / `--ai-bg` / `--ai-ink` | `.prov.ai`, `.trh`, `.tray`, `.tray i`, `.tray .foot2` | AI-read only |

---

## 6. Semantic decisions carried forward, and what v6 changed in use

Values are unchanged. Some **uses** changed between v5 and v6. Item 1 was reverted by the PO (red stays); the rest stand as listed.

1. **Allergen red on allergy selection controls stays (DECIDED, Andy, 2026-10-14, D-033 amendment a).** In v5 `.allergychip.on` and `.sevbtn.on` were `--danger`. The v6 prototype drew them as ordinary ink chips; that was an error in the v6 pass. As in v5: a selected allergen chip is `--danger-bg` fill with `--danger` text and border (7.02:1, border 8.84:1 on paper), and a selected severity button is solid `--danger` with white text (9.23:1). The prototype was corrected in M3-E0-T8 and M3-T13 builds it this way.
2. **The none-of-the-above allergy option (v5 section 4 item 2, left to the PO between a green check and an ink check) is drawn in ink in v6** (`.noneopt[aria-pressed=true] .box` is ink fill). That is option (b), the neutral check, which removes the "green check beside allergy copy" ambiguity. The PO choice was never recorded as decided. Built as the ink box by M3-T13 (2026-10-15); PROPOSED until the PO confirms option (b).
3. **The shopping check-off (`.chk`, v5 section 4 item 3) is ink in v6, not green.** The green positive sentiment now shows on the "have" chip and the pantry banner only.
4. **`--rose` versus `--danger` boundary.** Verified by direct grep of the v6 stylesheet: every `--danger` use is allergen context (5 CSS rules, 2 inline styles on blocked lines); the only `--rose` use is `.days.now`. **Zero crossover.** The M3 typed module should forbid `danger` outside allergen-named components (design-direction section 4).
5. **AI purple exclusivity.** `--ai`, `--ai-bg` and `--ai-ink` appear in `.prov.ai`, `.trh`, `.tray`, `.tray i` and `.tray .foot2` only. Confirmed exclusive.
6. **`--info` is replaced.** v5's `--info` `#3898ec` plus ink halo is replaced by the literal `#2442d6` focus ring without a halo (section 1b). It clears 3:1 on paper and tile (rows 43, 44) and fails on the camera screen (row 45, fix in section 4).

---

## 7. Tap-target table (v6)

**Method:** the declared `min-height`, `height` or `width` in the v6 CSS (v6 declares sizes explicitly for almost every control, so the line-height arithmetic v5 needed is not required). Controls that grow with content are not listed when their declared minimum already clears 44px. D-033 keeps 44px binding.

| Selector | Declared size | Target | Result |
|---|---|---|---|
| `.btn` | min-height 50px (wide 52px) | 44px | PASS |
| `.addprimary` | min-height 88px | 44px | PASS |
| `.nav button` | min-height 48px | 44px | PASS |
| `.iconb`, `.chk`, `.step button`, `.okb`, `.seg button`, `.sec .lnk` | 44px | 44px | PASS |
| `.send` | 46px | 44px | PASS |
| `.noneopt` | min-height 48px | 44px | PASS |
| `.row`, `.arow`, `.slot`, `.pick`, `.stats button`, `.inp` | 50 to 76px | 44px | PASS |
| `.chip` | min-height 40px | 44px | FAIL (-4px) |
| `.chips.units .chip` | min-height 40px | 44px | FAIL (-4px) |
| `.sev button` | min-height 40px | 44px | FAIL (-4px) |
| `.av` (masthead avatar as a button) | 38px | 44px | FAIL (-6px) |
| `.rmv` | min-height 36px | 44px | FAIL (-8px) |
| `.stat.miss` as a button ("+ list") | inline min-height 36px | 44px | FAIL (-8px) |
| `.lg` (inline link "what do these mean?") | min-height 32px | 44px | FAIL (-12px) |
| `.reclink` | the whole recipe card via `::after` | 44px | PASS |
| `.jump button`, `.statesbar button` | 40px | n/a | prototype chrome, not product |

**7 of the 25 product controls listed fall short.** All are near-misses fixed by invisible hit-slop, the technique v5 used (`hitSlop` per side = `ceil((44 - height) / 2)`): `.chip`, `.chips.units .chip`, `.sev button` 2px; `.av` 3px; `.rmv` and `.stat.miss` 4px; `.lg` 6px. The segmented strips (`.seg button`) already pass at 44px and need no change. This replaces the v5 table (12 of 15 failed) entirely.

---

## 8. Motion

v6 adds a global rule: `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important } }`. The v5 gap (no reduced-motion handling anywhere, laser sweep infinite) is closed: v6 has **no `@keyframes` and no infinite animation**; the camera laser is static.

| Rule | Motion | Duration | Reduced-motion treatment |
|---|---|---|---|
| `.btn:active { transform: scale(.98) }` | Press scale | instant (no transition) | Covered by the global rule |
| `.toast` (`opacity`, `translateY(8px)` to none) | Fade and rise on show | .2s | Global rule removes the transition; the toast appears and disappears instantly |
| `@media (hover:hover)` hover fills | Colour change | instant | n/a |

In the app, M3-T13 should honour the platform's reduce-motion setting (`AccessibilityInfo.isReduceMotionEnabled`) for the toast and any press animation it adds.

---

## 9. Dark-mode readiness (OQ-D6, still open)

v6 ships light only. The v1 dark table in design-direction section 2 and the v5 inventory in the previous version of this sheet predate v6 and are superseded. A dark pass would need a derived value for every token in sections 1a and 1b: `paper`, `tile`, `ink`, `ink2`, `ink3`, `hair`, the ten semantic tokens (each re-measured against its own tint, the 7:1 alert bar included), `ai-ink`, the hover literals, and the focus ring. The camera screen's `#121212` already is a dark surface and can seed `paper` in dark. OQ-D6 stays open; this is the inventory, not a resolution.

---

## 10. Device layout rules (BUG-003, 2026-10-01)

Carried forward unchanged; they describe app behaviour, not v5 tokens. One row (S7 hint) is updated for the v6 camera screen.

| Rule | Value | Where |
|---|---|---|
| Tab bar clearance (v6, M3-T13) | full-width ink bar, `TAB_BAR_HEIGHT` 56 (8 + 48) plus `max(insets.bottom, TAB_BAR_BOTTOM_OFFSET 20)` plus `spacing.lg` 16, via `useTabBarClearance()` from `src/navigation/TabBar.tsx` (106 at a 34 inset; v5 was a floating bar, 66 + 18 + inset + 16) | the content bottom padding of every scrolling screen that shows the bar (S4, S5, S6 legend, S11, S12; Home and Menu when they scroll). v6's nav is a full-width bar (min-height 48px, padding `8px 8px 20px`), not floating; M3-T13 revisits this constant |
| Bottom sheets and bottom-anchored inputs | pad by `insets.bottom` plus the sheet's own padding; keep them visible when the keyboard opens | S7 typed-code sheet today; S8 and the miss panel on the device pass |
| S7 camera panel | at most 55% of the window height, brackets centred in the panel, hint directly under it, paper below | `app/add/scan.tsx` |
| Screens that hide the bar | no clearance padding (onboarding, the Add flow) | |
| Top inset (M3-T10, 2026-10-07) | every screen header pads `insets.top + spacing.md` from `useSafeAreaInsets()`, never a fixed `spacing.xl`; on S7 the camera stays full-bleed and only the overlay controls pad | every screen under `app/` |
| S7 hint under the camera (v6) | `#d9d6cf` on `#121212`, 12.91:1 (section 4 row 39); v5 was `ink2` on `sand` | `app/add/scan.tsx` |

---

## 11. v5 to v6 token mapping (for M3-T13)

As built by M3-T13 (2026-10-15): `radius.circle` was not added (pills sit on square boxes); `typeScale` steps are named `title`, `h1`, `statValue`, `product`, `empty`, `sheetTitle`, `section`, `group`, `qtyBig`, `stepper`, `rowTitle`, `body`, `button`, `label`, `caption`, `chip`. Hover, focus, scrim and second camera tokens are defined and pinned but only partly used on touch.

Covers every export of `apps/mobile/src/design/tokens.ts` (`colors`, `radius`, `spacing`, `fontFamily`, `typeScale`, `minTouchTarget`) plus the v5 `:root` property `--info`, which tokens.ts never carried. "Same" means the hex is identical in v6. "Removed" means v6 has no equivalent and M3-T13 deletes the token and every use of it. New v6 tokens (names PROPOSED) are listed after the table.

### 11a. Colours

| Old token (tokens.ts) | v5 value | New token | v6 value | Note |
|---|---|---|---|---|
| `sand` | `#efe5d5` | `paper` | `#fbfaf6` | Page canvas is now paper |
| `sand2` | `#e4d7c2` | `tile` | `#f1eee6` | Segmented track is gone (v6 segments are underlined); tile covers panels and photo fallback |
| `paper` | `#fffbf4` | `paper` | `#fbfaf6` | Same name, new value; v6 has one light surface (no card surface lifting off a canvas) |
| `line` | `#dfd1ba` | `hair` | `#dcd8cf` | Renamed |
| `ink` | `#1e1813` | `ink` | `#0f0f0f` | Also the primary action fill |
| `ink2` | `#5b5045` | `ink2` | `#5f5d58` | |
| `ink3` | `#665c52` | `ink3` | `#6f6c66` | Pairs measured in section 4 |
| `espresso` | `#2a1f18` | removed | none | Home hero is now a photo. Camera screen uses `cameraBg` `#121212` |
| `espresso2` | `#3b2d23` | removed | none | |
| `cream` | `#f7efe2` | `white` / `cameraText` | `#ffffff` / `#f3f1ec` | Text on ink fills is `white`; text on the camera is `cameraText` |
| `brand` | `#d9673b` | removed | none | No brand accent. Primary action is `ink`; active tab is `ink` at weight 800 |
| `brandDeep` | `#b64f28` | removed | none | |
| `brandPressed` | `#9c4322` | `inkHover` (hover) | `#2b2b2b` | Pressed is `scale(.98)`, hover is `inkHover` |
| `brandTint` | `#f9dece` | removed | none | Was unused in v5 |
| `brandOnTint` | `#a74925` | removed | none | |
| `green` | `#2c744b` | `green` | `#2c744b` | Same |
| `greenBg` | `#dfeee3` | `greenBg` | `#dfeee3` | Same |
| `amber` | `#925b0a` | `amber` | `#925b0a` | Same |
| `amberBg` | `#f6e6c8` | `amberBg` | `#f6e6c8` | Same |
| `rose` | `#9d4b51` | `rose` | `#9d4b51` | Same |
| `roseBg` | `#f7dcdc` | `roseBg` | `#f7dcdc` | Same |
| `danger` | `#882020` | `danger` | `#882020` | Same. Allergen only |
| `dangerBg` | `#f9d9d9` | `dangerBg` | `#f9d9d9` | Same |
| `ai` | `#7b4cb5` | `ai` | `#7b4cb5` | Same |
| `aiBg` | `#eadff7` | `aiBg` | `#eadff7` | Same |
| `white` | `#ffffff` | `white` | `#ffffff` | Same |
| `--info` (prototype only) | `#3898ec` | `focus` | `#2442d6` | Focus ring; the ink halo is dropped. Camera screen uses `cameraText` for its ring (section 4 row 45) |

**New in v6:** `aiInk` `#5a4a70`; `amberInk` `#5b4210`; `greenInk` `#1f4d33`; `greenHover` `#235f3d`; `inkHover` `#2b2b2b`; `rowHover` `#f4f2ec`; `invHover` `#e4e1d9`; `onInkMuted` `rgba(255,255,255,.78)`; `aiHair` `#d7c6ee`; `aiTile` `#f5f0fb`; `focus` `#2442d6`; `cameraBg` `#121212`; `cameraBg2` `#2b2a27`; `cameraText` `#f3f1ec`; `cameraTextMuted` `#d9d6cf`; `scrim` `rgba(15,15,15,.45)`. `--stage` and the other stage-chrome literals are not carried.

### 11b. Radius

| Old token | v5 value | New token | v6 value | Note |
|---|---|---|---|---|
| `radius.sm` | 12 | `radius.toast` | 12 | Used by the toast only in v6 |
| `radius.md` | 18 | removed | none | Cards are square or hairline-ruled in v6. Nearest v6 value is `radius.panel` 14 for the tray and primary block |
| `radius.lg` | 24 | `radius.sheet` | 22 (top corners only) | Sheet and scan panel |
| `radius.pill` | 9999 | `radius.pill` | 9999 (CSS 999px) | Same |

New (section 3a): `radius.none` 0, `radius.circle` 50%, `radius.panel` 14, `radius.verdict` 10, `radius.verdictSm` 8.

### 11c. Spacing

| Old token | v5 value | New token | v6 value | Note |
|---|---|---|---|---|
| `spacing.xs` | 4 | `spacing.xs` | 4 | Same |
| `spacing.sm` | 8 | `spacing.sm` | 8 | Same |
| `spacing.md` | 12 | `spacing.md` | 12 | Same |
| `spacing.lg` | 16 | `spacing.lg` | 16 | Same |
| `spacing.xl` | 24 | `spacing.xl` | 24 | Same |
| `spacing.xxl` | 32 | `spacing.xxl` | 32 | Kept; v6 uses 28 and 30 nearby (PROPOSED `section` 30) |

New (section 3b, PROPOSED): `snug` 10, `cozy` 14, `gutter` 20, `section` 30.

### 11d. Fonts and type scale

| Old token | v5 value | New token | v6 value | Note |
|---|---|---|---|---|
| `fontFamily.display` | Fraunces | `fontFamily.display` | Bodoni Moda | Weight 500 only (v5 asked for 600) |
| `fontFamily.displayFallback` | serif | `fontFamily.displayFallback` | serif | Same |
| `fontFamily.body` | Inter | `fontFamily.body` | Schibsted Grotesk | |
| `fontFamily.bodyFallback` | sans-serif | `fontFamily.bodyFallback` | `system-ui, sans-serif` | v6 stack is `'Schibsted Grotesk', system-ui, sans-serif` |
| `typeScale.display` | 34 / 40, Fraunces 600 | `typeScale.h1` | 40 / 1.02 (41), Bodoni 500, -.015em | Home headline and recipe name. Screen title is `typeScale.title` 44 / 1 |
| `typeScale.heading` | 21 / 26, Fraunces 600 | `typeScale.section` | 25 / 1, Bodoni 500 (group heading 22 / 1) | |
| `typeScale.title` | 17 / 22, Inter 600 | `typeScale.rowTitle` | 15.5 / 1.2, Schibsted 700 (primary block title 17 / 1.2, 700) | |
| `typeScale.body` | 15 / 21, Inter 400 | `typeScale.body` | 15 / 1.45 (about 22), Schibsted 400 | |
| `typeScale.label` | 13 / 18, Inter 600 | `typeScale.label` | 13 / 1 to 1.3, Schibsted 600 to 700 | |
| `typeScale.caption` | 11.5 / 15, Inter 500 | `typeScale.caption` | 12.5 / 1.3, Schibsted 400 to 500 (chip floor is 12 / 1, 700) | v6 has no text under 12px |

New display steps (section 2b): 54, 46, 44, 40, 36, 30, 28, 27, 26, 25, 24, 22, 20; the sheet and screen-title sizes are the ones M3-T13 most needs named.

### 11e. Other

| Old token | v5 value | New token | v6 value | Note |
|---|---|---|---|---|
| `minTouchTarget` | 44 | `minTouchTarget` | 44 | Same, binding (D-033). Exceptions in section 7 |
| `tokens` (aggregate export) | colors, radius, spacing, fontFamily, typeScale, minTouchTarget | same | same | Add the new groups |
