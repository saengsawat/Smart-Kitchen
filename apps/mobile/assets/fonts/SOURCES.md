# Vendored fonts

Both files are variable fonts, fetched from Google Fonts' own source
repository (`github.com/google/fonts`, OFL licensed), on 2026-10-14 (M3-T13,
prototype v6 "Cookbook", D-033). Andy approved the bundling in chat on
2026-10-14 (CLAUDE.md rule 11). A full licence review can trail the build.

| File | Family | Source URL | Repo commit (path history HEAD at fetch time) | Commit date |
|---|---|---|---|---|
| `BodoniModa.ttf` | Bodoni Moda (opsz, wght axes) | https://raw.githubusercontent.com/google/fonts/main/ofl/bodonimoda/BodoniModa%5Bopsz%2Cwght%5D.ttf | `6ce172f74aa355ea43eb964fa4a91570a4d3064d` | 2026-03-03 |
| `SchibstedGrotesk.ttf` | Schibsted Grotesk (wght axis) | https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf | `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5` | 2026-03-12 |

`BodoniModa-OFL.txt` and `SchibstedGrotesk-OFL.txt` are each family's `OFL.txt`
from the same directories (`ofl/bodonimoda`, `ofl/schibstedgrotesk`), fetched at
the same time. Both fonts are licensed under the SIL Open Font License, Version
1.1 (full text in each `-OFL.txt` file). The italic files in the same
directories were not fetched: v6 uses no italics.

The v5 fonts (Fraunces and Inter, fetched 2026-09-22) were removed in M3-T13:
nothing else referenced them (`app/_layout.tsx` and `src/design/tokens.ts` were
the only users, and both now name the v6 families).

## Why a single variable file per family, not separate weight files

`google/fonts` does not carry separate static per-weight TrueType files for
either family in its current layout (checked via the GitHub API: `ofl/bodonimoda`
and `ofl/schibstedgrotesk` each contain one roman variable `.ttf`, one italic
variable `.ttf` and no `static/` subdirectory).

Both files are registered under one font-family name each
(`apps/mobile/app/_layout.tsx`: "Bodoni Moda" and "Schibsted Grotesk"); the type
scale (`apps/mobile/src/design/tokens.ts`) applies `fontWeight` as a normal React
Native text style on top, asking the platform's text renderer to select a
weight from the file's `wght` axis rather than loading a separate pre-baked
weight. v6 asks for Bodoni Moda at 500 only, and Schibsted Grotesk at 400, 500,
600, 700 and 800. This is expected to render correctly on iOS (CoreText resolves
variable-font weight from `fontWeight` reliably) and on web. Android's behaviour
depends on OS/engine version and has not been verified on a device: it is
covered by the device pass the architect owes before release. If Android
mis-renders weights, the fallback is static per-weight instances from another
OFL source, as noted in the M3-T1 report.

Bodoni Moda's `opsz` axis (6 to 96) is left at its default: React Native has no
`font-optical-sizing` control, so the prototype's `font-optical-sizing: auto` is
not reproduced. Display sizes in the app render at the font's default optical
size.
