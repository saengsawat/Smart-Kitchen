# Vendored fonts

Both files are variable fonts, fetched from Google Fonts' own source
repository (`github.com/google/fonts`, OFL licensed), on 2026-09-22:

| File | Family | Source URL | Repo commit (path history HEAD at fetch time) |
|---|---|---|---|
| `Fraunces.ttf` | Fraunces | https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf | `4024282d9b0cffcdb8e3024560862746178d741f` |
| `Inter.ttf` | Inter | https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf | `0b58fb370093f9a9f4ff785d94405710b79de67c` |

`Fraunces-OFL.txt` and `Inter-OFL.txt` are each family's `OFL.txt` from the
same directories, fetched at the same time. Both fonts are licensed under the
SIL Open Font License, Version 1.1 (full text in each `-OFL.txt` file).

## Why a single variable file per family, not separate weight files

`google/fonts` does not carry separate static per-weight TrueType files for
either Fraunces or Inter in its current layout (checked via the GitHub API:
`ofl/inter` and `ofl/fraunces` each contain exactly one variable `.ttf`, no
`static/` subdirectory). Design-direction §0 calls for "Fraunces 600" as the
display face; that request assumed static weight files would be available.

Both files are registered under one font-family name each
(`apps/mobile/app/_layout.tsx`); the type scale
(`apps/mobile/src/design/tokens.ts`) applies `fontWeight` as a normal React
Native text style on top, asking the platform's text renderer to select a
weight from the file's `wght` axis rather than loading a separate pre-baked
weight. This is expected to render correctly on iOS (CoreText resolves
variable-font weight from `fontWeight` reliably); Android's behavior depends on
OS/engine version and was not verified on a device for this ticket, since
M3-T1 ships only placeholder screens (no design-sensitive typography yet).
Flagged in the M3-T1 worker report as a follow-up: either verify on a real
Android device before a design-sensitive screen ships, or replace these with
static per-weight files from another OFL source (e.g. the upstream
`rsms/inter` and `undercasetype/Fraunces` GitHub release assets, which do
publish static instances) if verification finds a problem.
