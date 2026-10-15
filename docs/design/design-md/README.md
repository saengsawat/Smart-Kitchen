# Smart Kitchen design kit (v6, the Cookbook direction)

An agent-facing summary of the v6 look: how Smart Kitchen is drawn, so a coding or design agent can build a screen that matches `docs/design/mockups/smart-kitchen-prototype.html` without opening the whole prototype. Built for ticket M3-E0-T7 (2026-10-14). It adds no app code and no new design decisions.

## Files

| File | What it is |
|---|---|
| `DESIGN.md` | Nine sections plus a Safety and meaning layer: theme, colour roles with CSS variable and `tokens.ts` names, type scale, components, layout, depth, do's and don'ts, responsive and touch, and an agent prompt guide |
| `preview.html` | Self-contained token catalog, light: swatches, type scale in the real fonts, buttons, chips, Fact / Est. / AI chips, allergen verdicts with caveat, ruled lists, spacing and radius scales |
| `preview-dark.html` | The same catalog on a dark surface. A reference rendering, not a shipped theme (the app has no dark mode, OQ-D6 is open). Dark values are derived and each lists its light source; every text pair is measured and listed at the bottom of the page |
| `build-previews.mjs` | Generates both previews and `dark-contrast.json`. Holds the light values (copied from the prototype), the dark derivations and the contrast measurement |
| `dark-contrast.json` | The dark palette and the measured pairs, written by the script |
| `screenshots/` | 390px and desktop screenshots of both previews |

Both previews load the same Google Fonts link as the prototype (Bodoni Moda and Schibsted Grotesk). Offline they render with system fallbacks and everything else still works.

## Precedence

When two sources disagree, the higher one wins:

1. `docs/design/copy-deck.md` for safety and provenance strings. The kit never restates copy; it points here.
2. `docs/design/tokens.md` for measured values (contrast ratios, the tap-target table, motion).
3. The prototype `docs/design/mockups/smart-kitchen-prototype.html` for everything else (every colour, size, radius, spacing and border).
4. `DESIGN.md` is the agent-facing summary of 2 and 3. It is never the authority. If it differs from the prototype, the prototype wins and the kit is stale.

Decisions behind the look: D-033 (v6 is the build reference, with its 2026-10-14 amendment), D-021 (safety and semantic colours), D-032 (food imagery).

## How to regenerate at the next prototype version

1. Read the new prototype's `:root` and stylesheet. Update `DESIGN.md` by hand for anything that moved: colour table (section 2), type tables (section 3), component values (section 4), radius and spacing (section 5).
2. In `build-previews.mjs`, update the `L` colour map, the `LIT` literals, the `DISPLAY` and `UI` type arrays, and the preview CSS block so it matches the new stylesheet. Keep the dark derivation rules (each dark token is listed with its light source in `DARKRULE` and `LITDARKRULE`).
3. Run `node build-previews.mjs` from this folder. It rewrites both previews and `dark-contrast.json` and prints every dark pair as PASS or FLAG. Fix or report every FLAG.
4. Run `impeccable detect` on both preview pages and fix or explain each finding.
5. Spot-check 20 values between the prototype CSS, `DESIGN.md` and the previews. Any mismatch is a bug in the kit.
6. Retake the four screenshots (390px and 1280px, each page) into `screenshots/`.
7. Update `tokens.md` first if a value is new; contrast belongs there, not in `DESIGN.md`.

Preview-only differences from the prototype, so nobody mistakes them for design: literal colours are named as CSS variables so the dark page can swap them; selected chips in the catalog use classes (`.is-on`, `.alg-on`) because they are static samples, not buttons; the stat band cells carry 10px right padding.
