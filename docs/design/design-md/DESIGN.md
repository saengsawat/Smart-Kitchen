# Design System: Smart Kitchen (v6, the Cookbook direction)

Agent-facing summary of `docs/design/mockups/smart-kitchen-prototype.html` (prototype v6, the build reference since D-033). Every value below is taken from that file's `:root` and stylesheet, or from `docs/design/tokens.md` and the D-033 amendment of 2026-10-14. Nothing is invented. Strings are never restated here: `docs/design/copy-deck.md` holds the binding copy, and `docs/design/tokens.md` holds the measured contrast.

Precedence when two sources disagree: copy-deck.md for safety and provenance strings, tokens.md for measured values, the prototype for everything else. This file is the summary, never the authority.

The product name is "Smart Kitchen" for now (D-033 amendment b).

## 1. Visual Theme & Atmosphere

Smart Kitchen reads like a printed cookbook, not an app dashboard. A warm paper canvas (`#fbfaf6`) carries near-black ink (`#0f0f0f`) and nothing else: there is no brand accent colour. Food photography supplies the colour, and the primary action is ink itself. Headings are set in Bodoni Moda, a high-contrast display serif, at weight 500. All working text is Schibsted Grotesk.

Structure comes from rules, not boxes. A 1px ink rule opens a section, closes a stat band and caps the tab bar. A 1px hairline (`#dcd8cf`) separates rows inside a list. Photos and tiles are square. Controls are pills. The few panels that exist are rounded and tinted.

Colour is reserved for meaning. The only coloured text and chips are the semantic set (section 2). That scarcity is the point: when something is red, it is an allergen.

**Key characteristics**
- One light surface, paper `#fbfaf6`, with `--tile` `#f1eee6` as the quiet panel.
- Ink `#0f0f0f` is text, rules and the primary action fill. No brand colour.
- Bodoni Moda 500 for display, Schibsted Grotesk 400 to 800 for UI. Nothing below 12px.
- Square photos and tiles (radius 0), pill controls (999px), rounded tinted panels (10 to 22px).
- Hairline-ruled lists, ink-ruled section heads, no card shadows.
- Colour carries meaning only: allergen red, expiry ladder, amber estimates, purple AI.
- 44px touch targets, a visible focus ring, reduced motion honoured.

## 2. Color Palette & Roles

Each row lists the prototype CSS variable and, where `tokens.md` section 11 maps one, the `tokens.ts` name (v5 name today, then the v6 name M3-T13 uses). Hex values are from v6 `:root`.

### Surface and text

| Name | Hex | CSS variable | tokens.ts | Role |
|---|---|---|---|---|
| Paper | `#fbfaf6` | `--paper` | `paper` (value changes) | Page canvas, sheet and tab bar surface, hero badge fill |
| Tile | `#f1eee6` | `--tile` | `sand2` to `tile` | Quiet panel, photo-tile backing, neutral stat chip, pressed and hover fill |
| Ink | `#0f0f0f` | `--ink` | `ink` | Text, rules, primary button fill, selected chip fill, avatar, Add disc, toast, checkbox ring |
| Ink 2 | `#5f5d58` | `--ink2` | `ink2` | Secondary text, captions, inactive tab labels |
| Ink 3 | `#6f6c66` | `--ink3` | `ink3` | Tertiary text on paper and tile only: "coming soon" sublines, placeholder, struck-through rows |
| Hairline | `#dcd8cf` | `--hair` | `line` to `hair` | Row dividers, underlines, quiet borders |

### Semantic

| Name | Hex | CSS variable | tokens.ts | Meaning (never used for anything else) |
|---|---|---|---|---|
| Danger | `#882020` | `--danger` | `danger` | **Allergen only.** Text, border and solid fill |
| Danger tint | `#f9d9d9` | `--danger-bg` | `dangerBg` | Allergen surface |
| Amber | `#925b0a` | `--amber` | `amber` | Estimated, expiring in 2 to 3 days, short, allergen data incomplete |
| Amber tint | `#f6e6c8` | `--amber-bg` | `amberBg` | Amber surface |
| Green | `#2c744b` | `--green` | `green` | Known Fact, have, fresh, further out than 3 days, positive |
| Green tint | `#dfeee3` | `--green-bg` | `greenBg` | Green surface |
| Rose | `#9d4b51` | `--rose` | `rose` | "Use today" urgency, never an allergen |
| Rose tint | `#f7dcdc` | `--rose-bg` | `roseBg` | Rose surface |
| AI purple | `#7b4cb5` | `--ai` | `ai` | AI-read items only |
| AI tint | `#eadff7` | `--ai-bg` | `aiBg` | AI surface and the confirmation tray |
| AI ink | `#5a4a70` | `--ai-ink` | `aiInk` (new in v6) | Secondary text on the AI tray |
| Stage | `#e6e5e1` | `--stage` | none | Prototype chrome only (the page behind the drawn phone). Not a product token |

### Literals the prototype hard-codes (names PROPOSED in tokens.md section 1b)

| Hex | Where | Role | tokens.ts (PROPOSED) |
|---|---|---|---|
| `#ffffff` | `.btn.pri`, `.okb`, `.toast`, `.addprimary`, `.av`, nav Add disc | Text and icons on ink fills; text on the two solid fills | `white` |
| `rgba(255,255,255,.78)` | `.addprimary` subline | Secondary text on the ink primary block | `onInkMuted` |
| `#2b2b2b` | hover on `.btn.pri`, `.okb`, `.addprimary` | Hover fill of ink buttons | `inkHover` |
| `#f4f2ec` | hover on `button.row`, `.arow`, `.slot`, `.pick` | Hover fill of list rows | `rowHover` |
| `#e4e1d9` | hover on `.btn.pri.inv` | Hover fill of the inverted camera button | `invHover` |
| `#5b4210` | `.verdict.unk .c`, `.verdict.unk .u`, `.mfoot i` | Body text on amber tint | `amberInk` |
| `#1f4d33` | `.loop` banner text | Body text on green tint | `greenInk` |
| `#235f3d` | hover on `.loop .okb` | Hover fill of the green Add button | `greenHover` |
| `#d7c6ee` | `.tray .ci` divider | Hairline on the AI tray | `aiHair` |
| `#f5f0fb` | `.tray .ci .th` | Thumbnail backing on the AI tray | `aiTile` |
| `#2442d6` | `:focus-visible` outline | Keyboard focus ring on paper and tile | `focus` |
| `#121212` | `#scan`, camera panel | The one dark surface (camera screen) | `cameraBg` |
| `#2b2a27` | camera gradient top stop | Camera decoration | `cameraBg2` |
| `#f3f1ec` | camera brackets, laser, text, icons; `.btn.pri.inv` fill | Text and chrome on the camera screen; the camera focus ring (T8, below) | `cameraText` |
| `#d9d6cf` | `.camhint`, `.denied p` | Secondary text on the camera screen | `cameraTextMuted` |
| `rgba(15,15,15,.45)` | `.modal .scrim` | Sheet scrim | `scrim` |

### Values the 2026-10-14 decisions fix (D-033 amendment, ticket M3-E0-T8)

The v6 prototype carries drawing errors that ticket M3-E0-T8 corrects in parallel. This kit documents the corrected values, taken from the D-033 amendment and tokens.md section 4 rows 22, 45 and 46:

- A selected allergen chip is a `--danger-bg` fill with `--danger` text and a `--danger` border (as v5 `.allergychip.on`). A selected severity button is a solid `--danger` fill with white text (as v5 `.sevbtn.on`). The prototype drew both ink; that was an error.
- The blocked allergen line "Blocked for Maya" carries no opacity. Dimmed it falls under the 7:1 alert bar (row 22).
- On the camera screen the focus ring is `#f3f1ec` (row 45). Everywhere else it is `#2442d6`.
- `.iconb.round` and `.rmv` take an `--ink2` border, not `--hair` (row 46). Hairlines stay for dividers.
- The green Add button on the pantry banner (`.loop .okb`, `--green` fill, white text, hover `#235f3d`) is intended: the one green action in the app, on that banner only.

## 3. Typography

Both families are SIL OFL, loaded from Google Fonts with the prototype's own link:
`family=Bodoni+Moda:opsz,wght@6..96,400..700&family=Schibsted+Grotesk:wght@400..800`.

| Role | Family | Stack as written | Weights used |
|---|---|---|---|
| Display (`.serif`) | Bodoni Moda, `font-optical-sizing: auto` | `'Bodoni Moda', serif` | 500 only |
| UI and body | Schibsted Grotesk | `'Schibsted Grotesk', system-ui, sans-serif` | 400, 500, 600, 700, 800 (800 only for the current tab) |

Base: `body` is 15px with line-height 1.45, antialiased. Numerals: `.num` is `lining-nums`; stats, macros and the big quantity use `tabular-nums lining-nums`. Uppercase labels use `text-transform: uppercase` with the letter spacing below, so strings stay in sentence case in the copy deck.

### Type scale (every size in the stylesheet)

**Display, Bodoni Moda 500**

| Size | Line height | Letter spacing | Role | Selectors |
|---|---|---|---|---|
| 54 | 1 | none | Initial on a letter tile | `.ph.lettr` |
| 46 | 1 | none | Item quantity | `.qtybig b` |
| 44 | 1 | -.015em | Screen title | `.title` |
| 40 | 1.02 | -.015em | Home headline, recipe name | `.h1` |
| 36 | 1 | none | Stat value | `.stats .v` |
| 30 | 1.05 | none | Scanned product name, camera-denied heading | `.pname, .denied h2` |
| 28 | 1 | none | Coverage badge on hero, rank numeral, empty-state heading | `.hero .pct, .row .ix, .emptyst h2` |
| 27 | 1.05 | none | Recipe card name | `.rec h2` |
| 26 | 1 | none | Coverage badge on cards, stepper value | `.rec .pct, .step b` |
| 26 | 1.05 | none | Sheet title | `.sheet h2` |
| 25 | 1 | none | Section heading | `.sec h2` |
| 24 | 1 | none | Macro value | `.macros b` |
| 22 | 1 | none | Group heading, menu-card heading | `.grp h2, .mh h3` |
| 20 | 1 | none | Rail badge, picker percentage, initials | `.rph .pct, .pick .pp` |

**UI and body, Schibsted Grotesk**

| Size | Weight | Line height | Role | Selectors |
|---|---|---|---|---|
| 20 | 600 | 1 | Stepper glyph | `.step button` |
| 17 | 700 | 1.2 | Primary block title | `.addprimary b` |
| 16 | 500 | 1 | Text input | `.inp` |
| 16 | 700 | 1.2 | Profile name | `.me b` |
| 15.5 | 700 | 1.2 | Row title | `.row b, .arow b` |
| 15 | 400 | 1.45 | Body default | `body` |
| 15 | 700 | 1.2 | Shopping row title, box heading | `.srow b, .bh, .tastes b` |
| 14.5 | 700 | 1.25 | Tray item, ledger title, slot title | `.tray b, .led .m b, .slot .m b` |
| 14.5 | 600 | 1.2 | Picker row, none-option | `.pick, .noneopt` |
| 14 | 700 | 1 | Button | `.btn` |
| 14 | 600 | 1 | Segment label, amount, unit label | `.seg button, .srow .amt, .unitlbl` |
| 14 | 400 | 1.5 | Paragraph on empty and camera states, chat bubble | `.emptyst p, .denied p, .bub` |
| 13.5 | 600 | 1.35 | Verdict line, block bar, toast, loop banner, chip label | `.verdict, .blockbar, .toast, .loop, .chip` |
| 13 | 700 | 1 | Ok button, severity button | `.okb, .sev button` |
| 13 | 400 | 1.5 | Short note, byline, row meta | `.verdict .u, .why, .by, .row .q` |
| 12.5 | 400 | 1.4 | Caveat line, note, tray source, ledger detail | `.verdict .c, .note, .tray i, .led .m i` |
| 12 | 700 | 1 | Chip, label, status | `.prov, .days, .stat, .kv .k, .fl, .queued, .msrc, .mtag` |
| 12 | 600 | 1.2 | Nav label, caption, group count | `.nav button, .grp span, .macros i, .stats .l` |

**Uppercase label letter spacing:** `.22em` masthead name; `.12em` key labels, days chips, coverage unit, field labels; `.1em` stat chips, menu tag; `.08em` source tag, macro captions.

Smaller sizes appear in a few stage-chrome rules only; the product has no size below 12px.

## 4. Component Stylings

All values are the prototype's. Hover states apply under `@media (hover:hover)` only.

### Buttons
- **Primary (`.btn.pri`)**: ink fill, white text, 1.5px ink border, pill, min-height 50px, 14px 700. Hover `#2b2b2b`; pressed `transform: scale(.98)`.
- **Outlined (`.btn`)**: transparent, 1.5px ink border, same size. Hover fill `--tile`.
- **Wide (`.btn.wide`)**: full width, min-height 52px.
- **Small action (`.okb`)**: ink fill, white text, pill, min-height 44px, min-width 56px, 13px 700. `.okb.ghost` is transparent with a 1.5px ink border.
- **Green Add (`.loop .okb`)**: `--green` fill, the single exception, banner only.
- **Inverted (`.btn.pri.inv`, camera only)**: `#f3f1ec` fill, ink text. `.btn.light` is outlined in `rgba(255,255,255,.6)`.
- **Icon button (`.iconb`)**: 44px circle. `.iconb.round` has a 1px border (`--ink2` after T8). `.iconb.light` (camera) has a 1px `rgba(255,255,255,.3)` border.
- **Stepper (`.step button`)**: 44px circle, 1.5px ink border, 20px 600 glyph; value is Bodoni 26px.
- **Link (`.lnk`, `.lg`)**: 600, underlined with a 2px `--hair` underline offset 4px (3px for `.lg`); `.lnk` min-height 44px.

### Pills and chips
- **Choice chip (`.chip`)**: pill, 1.5px ink border, min-height 40px (44px hit area in the app, tokens.md section 7), padding 0 15px, 13.5px 600. Pressed: ink fill, white text.
- **Allergen chip, selected**: `--danger-bg` fill, `--danger` text and border (see section 2).
- **Severity button (`.sev button`)**: pill, 1.5px ink border, min-height 40px, 13px 600. Selected: solid `--danger` fill, white text.
- **Expiry pill (`.days`)**: 12px 700, uppercase, `.12em`, pill, padding 6px 8px. `.now` rose, `.soon` amber, `.ok` green, each on its tint.
- **Stat chip (`.stat`)**: 12px 700, uppercase, `.1em`, pill. `.have` green, `.shortby` and `.miss` amber, `.list` tile with ink2 text, `.staple` transparent with ink3 text and a hairline border.
- **Provenance chip (`.prov`)**: 12px 700, pill, padding 4px 9px. `.fact` green, `.est` amber, `.ai` purple, `.alg` danger tint with a warning icon. Glyph and words always travel with the colour.
- **Source tag (`.msrc`) and menu tag (`.mtag`)**: 12px 700 uppercase on `--tile`, radius 0.

### Rounded tinted panels
- **AI confirmation tray (`.tray`)**: `--ai-bg`, radius 14px, padding 4px 14px; rows divided by `#d7c6ee`; heading `.trh` in `--ai`, 13.5px 700.
- **Add food primary block (`.addprimary`)**: ink fill, white text, radius 14px, min-height 88px, padding 18px 16px; title 17px 700, subline 13.5px at 78% white.
- **Unknown-allergen verdict (`.verdict.unk`)**: `--amber-bg`, radius 10px, padding 11px 12px; caveat text `#5b4210`.
- **Block bar (`.blockbar`)**: `--danger-bg` fill, `--danger` text, 1.5px `--danger` border, radius 10px; a 24px solid-danger disc holds a white warning icon.
- **Pantry banner (`.loop`)**: `--green-bg`, text `#1f4d33`, padding 12px 14px, 13.5px 600, radius 0.
- **Neutral panels** (`.why`, `.codenote`, `.tastes`, `.me`, `.bub.ai`): `--tile`, radius 0.

### Hairline-ruled lists
- **Row (`.row`)**: grid `56px 1fr auto`, gap 12px, padding 10px 0, 1px `--hair` bottom border, min-height 72px. Title 15.5px 700; detail line 13px `--ink2`.
- **Shopping row (`.srow`)**: grid `44px 48px 1fr auto`, gap 10px, min-height 68px.
- **Group head (`.grp`)**: Bodoni 22px with a 1px ink rule underneath. **Section head (`.sec`)**: Bodoni 25px with a 1px ink rule.
- **Stat band (`.stats`)**: three columns between 1px ink rules, hairline column dividers, Bodoni 36px values.
- **Checkbox (`.chk`)**: 44px target around a 26px circle with a 1.75px ink ring; checked is ink fill with a white tick. Never green.

### Square photo tiles
- **Tile (`.tile .ti`, `.row .th`, `.srow .th`)**: square, radius 0, `--tile` backing, image `object-fit: contain`. Letter fallback is Bodoni 500 in `--ink3`.
- **Hero and card photo**: 4:3, radius 0, `object-fit: cover`. A coverage badge (`.pct`) sits in a paper-filled corner so text never rests on the photo.
- **Blocked recipe photo**: `grayscale(1) contrast(.92)` at opacity .6.
- **Short tile (`.tile.short`)**: amber tint backing and amber caption.

### Tab bar
Five-column grid on `--paper` with a 1px ink top rule, padding `8px 8px 20px`, items min-height 48px, labels 12px 600 in `--ink2`. The current tab is ink, 800, with the icon stroke at 2.3 (others 1.8). The centre Add control is a 46px ink disc with a white icon.

### Sheets and modals
- **Sheet (`.sheet`)**: paper, radius `22px 22px 0 0`, padding `20px 20px 28px`, max-height 86%, title Bodoni 26px. Scrim is `rgba(15,15,15,.45)`.
- **Toast (`.toast`)**: ink fill, white text, radius 12px, padding 12px 14px, 13.5px; fades and rises 8px over .2s.

### Inputs
- **Text input (`.inp`)**: no box. Height 50px, bottom border 1.5px ink, 16px 500, placeholder `#6f6c66`, caret `#151515`. **Field label (`.fl`)**: 12px 700 uppercase `.12em` in `--ink2`.

### The Add food structure
One ink primary block (Scan barcode) first, then a ruled list: a 1px ink rule, rows (`.arow`, min-height 68px, 15.5px 700 title, 13px `--ink2` subline, hairline dividers), and a "Coming soon" group whose rows (`.arow.soon`) drop to `--ink2` titles at weight 600 with `--ink3` sublines. Strings live in the prototype and the copy deck; this section fixes structure only.

## 5. Layout Principles

### Spacing scale
Measured from every padding, margin and gap in the product CSS: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 30, 40 px. The screen gutter is **20px** (`.pad`, `margin: 0 20px`), the most used value. Section heads sit 30px below the previous block; group heads 24px. tokens.md section 3b proposes the app scale (`xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 32 plus `snug` 10, `cozy` 14, `gutter` 20, `section` 30); the odd values (3, 5, 7, 9, 11, 13) are optical nudges.

### Radius scale

| Value | Where |
|---|---|
| 0 | Photos, tiles, `.mtag`, `.msrc`, `.tagm`, neutral panels |
| 999px | `.btn`, `.chip`, `.okb`, `.days`, `.prov`, `.stat`, `.rmv`, `.sev button` |
| 50% | `.av`, `.iconb`, `.chk span`, `.mchip`, `.step button`, `.send`, Add disc, warning disc |
| `22px 22px 0 0` | `.sheet`, `.panel` |
| 14px | `.tray`, `.addprimary` |
| 12px | `.toast` |
| 10px | `.verdict.unk`, `.blockbar` |
| 8px | `.verdict.unk.sm` |
| 4px | the focus ring's own corner |

### Frame, safe area and tab bar
- **Phone frame:** the prototype draws a 390px-wide device (max-width `calc(100vw - 32px)`, height 820px, radius 46px, screen radius 37px). Below 520px wide the frame disappears and the app fills the screen. The frame and its stage are prototype chrome, not product.
- **Fixed sizes:** primary button min-height 50px; tab bar items 48px; Add disc 46px; thumbnails 56 (list), 48 (ingredient, shopping), 44 (tray), 64x48 (menu slot), 96 (item detail); photos 4:3, tiles square; inventory tiles four columns, 8px gap.
- **Tab bar clearance (tokens.md section 10):** scrolling screens that show the bar pad their bottom by `TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_OFFSET + insets.bottom + spacing.lg` through `useTabBarClearance()`. v6's bar is full-width, not floating; M3-T13 revisits the constant.
- **Top inset:** every screen header pads `insets.top + spacing.md`, never a fixed value. On the camera screen the view stays full-bleed and only the overlay controls pad.
- **Sheets and bottom inputs:** pad by `insets.bottom` plus their own padding and stay visible when the keyboard opens.
- **Screens that hide the bar** (onboarding, the Add flow) take no clearance padding.
- **Camera panel:** at most 55% of the window height, brackets centred, hint directly under it, paper below.

## 6. Depth & Elevation

The product is flat. Depth comes from rules, tints and surface changes, not shadows.

| Level | Treatment | Use |
|---|---|---|
| Flat | `--paper`, no border | Page canvas |
| Ruled | 1px ink rule or 1px `--hair` rule | Sections, stat bands, list rows, tab bar edge |
| Tinted | `--tile` or a semantic tint fill, radius 0 to 14px | Panels, chips, verdicts, trays |
| Outlined | 1.5px ink border | Outlined buttons, chips, checkbox ring |
| Overlay | `rgba(15,15,15,.45)` scrim behind a paper sheet with a `22px 22px 0 0` radius | Sheets, modals |
| Floating | Ink toast, radius 12px, 8px rise | Confirmations |
| Camera | `#121212` surface with a radial gradient `#2b2a27` to `#121212` | The scan screen, the one dark surface |

The only `box-shadow` in the prototype (`0 30px 60px -30px rgba(0,0,0,.45)`) belongs to the drawn phone frame, which is stage chrome and is not carried into the app. Press feedback is `scale(.98)`; hover is a fill change.

## 7. Do's and Don'ts

**Do**
- Use ink for every primary action, selected chip, active tab and checkbox.
- Use `--danger` only for allergens: the blocked bar, the Allergen chip, "Blocked for" lines, the selected allergy chip and severity button.
- Show the expiry ladder as rose (today), amber (2 to 3 days), green (further out). Never red.
- Mark every fallible fact with a Fact, Est. or AI chip.
- Keep photos and tiles square; keep controls as pills; keep panels rounded only where the table in section 5 says.
- Set display text in Bodoni Moda 500 and everything else in Schibsted Grotesk.
- Point to `copy-deck.md` for any string; point to `tokens.md` for any contrast claim.

**Don't**
- Don't add a brand colour, gradient, shadow, glow or decorative colour.
- Don't use red for delete, errors, expired food or any selection that is not an allergen.
- Don't use purple for anything that is not an AI-read item.
- Don't claim a food is safe; the verdict states known matches only (copy-deck.md).
- Don't dim an allergen line (no opacity) or set it below the 7:1 alert bar.
- Don't let colour be the only signal: pair it with an icon or words (P9).
- Don't use em dashes anywhere, in UI copy or docs (P11).
- Don't go below 12px, and don't ship a hit area under 44px.
- Don't put text directly on a photo; use the paper badge.
- Don't rely on `--hair` as the only boundary of a control (tokens.md row 46).

## 8. Responsive Behavior

- **Breakpoint:** one, at 520px. Above it the prototype shows a drawn 390px phone; at or below it the app fills the viewport and the stage pickers collapse. The product is phone-first and has no tablet or desktop layout.
- **Touch targets:** 44px minimum (D-033 item 3). `.btn` 50px, `.okb`, `.iconb`, `.chk`, `.step button`, `.seg button`, `.sec .lnk` 44px, tab items 48px, rows 52 to 76px. Controls drawn smaller (`.chip`, `.sev button` 40px; `.av` 38px; `.rmv` 36px; `.lg` 32px) get invisible hit slop in the app so the target reaches 44px (tokens.md section 7).
- **Focus ring:** `:focus-visible { outline: 2.5px solid #2442d6; outline-offset: 2px; border-radius: 4px }`. On paper and tile it passes 3:1 (tokens.md rows 43 and 44). On the camera screen use `#f3f1ec` (row 45). A recipe card shows the ring on the whole card (`.rec:has(.reclink:focus-visible)`, offset 4px).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important } }`. v6 has no keyframes; the only motion is the toast fade and the press scale.
- **Safe areas:** section 5. **Readability:** body 15px, nothing under 12px, line heights 1.3 to 1.5 for multi-line text.
- **Dark mode:** not shipped (OQ-D6 open). `preview-dark.html` is a derived reference rendering only.

## Safety and meaning layer

These rules outrank any visual preference (CLAUDE.md rules 6 and 9; D-021; D-033 item 3).

1. **Allergen red only for allergens.** `--danger` and `--danger-bg` appear on the blocked bar, the Allergen chip, "Blocked for" lines, and the selected allergy chip and severity button. Nowhere else.
2. **The expiry ladder never turns red.** Rose is "use today", amber is 2 to 3 days, green is further out. Rose is never an allergen colour.
3. **Amber means estimate or unknown.** Estimated chip, expiring soon, short, and "allergen data incomplete".
4. **Purple means AI-read, only.** `--ai`, `--ai-bg` and `--ai-ink` appear on `.prov.ai`, the confirmation tray and its text, and nowhere else.
5. **Fact, Est. and AI chips on every fallible fact.** There is no "no chip" state. The chips are `✓ Fact`, `≈ Est.` and `AI · confirm` in their compact form; the deck holds the labels and legend.
6. **Colour is never the only signal (P9).** Each chip, verdict and ladder step pairs colour with a glyph or words.
7. **AI proposes, people confirm.** The AI chip is an action ("Confirm"), and AI output may add allergen warnings, never clear them.
8. **No em dashes (P11).** Use a full stop or a middle dot.
9. **No copy here.** Verdict, caveat, legend and empty-state strings live in `copy-deck.md` and the prototype. The deck wins on safety copy.

## 9. Agent Prompt Guide

### Quick reference
- Canvas `#fbfaf6` (`--paper`); panel `#f1eee6` (`--tile`); text `#0f0f0f` (`--ink`); secondary `#5f5d58`; tertiary `#6f6c66`; hairline `#dcd8cf`.
- Semantic pairs, text on tint: danger `#882020` on `#f9d9d9`; amber `#925b0a` on `#f6e6c8`; green `#2c744b` on `#dfeee3`; rose `#9d4b51` on `#f7dcdc`; AI `#7b4cb5` on `#eadff7`.
- Fonts: Bodoni Moda 500 for display, Schibsted Grotesk for UI; body 15px/1.45; nothing under 12px.
- Shapes: square photos and tiles; pill controls (999px); panels 14px; sheet `22px 22px 0 0`; gutter 20px.
- Primary action is ink with white text, min-height 50px; small action 44px; focus ring `#2442d6`, 2.5px, offset 2px.
- Colour means something. When unsure, use ink.

### Example prompts
- "Build an inventory row: 56px square tile, item name 15.5px 700, a 13px `--ink2` detail line with an expiry pill, and a Fact chip on the right. Hairline `#dcd8cf` bottom border, min-height 72px. No shadow, no card."
- "Show a recipe's allergen result with the unknown-data verdict: `--amber-bg` panel, radius 10px, amber text, a warning icon, and the caveat line in `#5b4210`. Take every string from copy-deck.md. Never use red here."
- "Make a blocked-recipe bar: `--danger-bg` fill, `--danger` text and 1.5px border, radius 10px, a 24px solid-danger disc with a white warning icon. No opacity on the text."
- "Make the Add food screen: an ink block (radius 14px, min-height 88px) for the main action, then a ruled list with a 1px ink top rule. Use `.arow` sizing, 68px rows. 'Coming soon' rows use `--ink2` and `--ink3` text."
- "Make a confirmation tray for AI-read items: `--ai-bg`, radius 14px, heading in `--ai`, source lines in `--ai-ink`, a 44px ink Confirm pill per item. Purple is only for AI-read items."
- "Make the allergy chip row: unselected chips are 1.5px ink outlines, selected allergen chips are `--danger-bg` with `--danger` text and border, severity buttons turn solid `--danger` with white text when selected."
- "Make a bottom sheet: paper, radius `22px 22px 0 0`, Bodoni 26px title, ink primary pill plus outlined pill, scrim `rgba(15,15,15,.45)`."

### Iteration rules
1. Start from tokens, not hex: use the variable names in section 2.
2. Check every colour against its meaning before using it. If it does not mean allergen, expiry, estimate, positive or AI, use ink.
3. Take strings from `copy-deck.md` or the prototype. Never write new safety copy.
4. Re-measure contrast with tokens.md section 4 if a pair is new. Narrow passes (ink3 on tile, amber on amber-tint, rose on rose-tint, AI on AI-tint) must not be lightened.
5. When the prototype and this file differ, the prototype wins; tell the architect so this file can be regenerated.
