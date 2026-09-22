/**
 * Design tokens (M3-T1).
 *
 * Single source of colour, type scale, radius and spacing for apps/mobile.
 * No colour literal may appear anywhere else in this app (M3-T1 invariant).
 * Import from here.
 *
 * Colour values are the D-021 palette (DECIDED 2026-09-21, DECISIONS.md), copied
 * verbatim from prototype v4's `:root` block
 * (docs/design/mockups/smart-kitchen-prototype.html lines 12-37) and cross-checked
 * against docs/design/tokens.md §1 (token table) and §2 (measured contrast). Do not
 * hand-edit a hex here without updating both the prototype and tokens.md, and
 * re-running tokens.test.ts's contrast recomputation.
 */

/** Palette. Every hex is pinned 1:1 by tokens.test.ts. */
export const colors = {
  // Neutrals / surfaces
  sand: "#efe5d5",
  sand2: "#e4d7c2",
  paper: "#fffbf4",
  line: "#dfd1ba",

  // Text on light surfaces
  ink: "#1e1813",
  ink2: "#5b5045",
  /** A12 darkening (D-021): was #8f8274. */
  ink3: "#665c52",

  // Dark hero surface (Home only, design-direction §0 "the one large dark surface allowed")
  espresso: "#2a1f18",
  espresso2: "#3b2d23",
  /** Text/icons on `espresso` only. */
  cream: "#f7efe2",

  // Brand accent (scarce: primary CTA, active-nav indicator, hero accent, camera chrome only)
  brand: "#d9673b",
  brandDeep: "#b64f28",
  /** Pressed CTA state (D-021). */
  brandPressed: "#9c4322",
  brandTint: "#f9dece",
  /** A12 new token (D-021): text on `brandTint`. */
  brandOnTint: "#a74925",

  // Semantic ladder
  /** A12 darkening (D-021): was #2f7d51. Known Fact / fresh / verified. Never allergen. */
  green: "#2c744b",
  greenBg: "#dfeee3",
  /** A12 darkening (D-021): was #b4700c. Estimated / expiring. Never verdict-danger. */
  amber: "#925b0a",
  amberBg: "#f6e6c8",
  /** A12 darkening (D-021): was #c75f66. "Use today" urgency. Never allergen. */
  rose: "#9d4b51",
  roseBg: "#f7dcdc",
  /** A12 darkening (D-021): was #b12a2a. ALLERGEN ONLY, per the nine rules (M1-T4). */
  danger: "#882020",
  dangerBg: "#f9d9d9",
  /** AI Interpretation tier, exclusive hue (design-direction §0, tokens.md §4.5). */
  ai: "#7b4cb5",
  aiBg: "#eadff7",

  white: "#ffffff",
} as const;

export type ColorToken = keyof typeof colors;

/** Radii (prototype `:root` --r-sm/--r-md/--r-lg, tokens.md §1). */
export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  /**
   * Pill / circular controls. tokens.md §1 notes `999px` and `50%` are used at
   * call sites in the prototype but never tokenized there; recorded here as the
   * typed module's own addition (`--r-pill` recommendation), not a §0 value.
   */
  pill: 9999,
} as const;

/**
 * Spacing scale. ENGINEERING INFERENCE (CLAUDE.md rule 5): design-direction §0
 * and tokens.md do not publish a spacing scale, so this is derived from the
 * padding/gap/margin values actually used across prototype v4's screen CSS
 * (e.g. 8px chip padding, 14px card padding, 16px screen gutter, 18px section
 * margin, 24px hero padding), rounded to a plain 4px-step scale. Flagged for the
 * architect in the M3-T1 worker report; not a DOCUMENTED source value like the
 * colour/radius tokens above.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Font families (design-direction §0: "Fraunces 600" display, "Inter" UI/data).
 *
 * Vendored from Google Fonts' source repository as variable fonts (the
 * repository does not carry separate static per-weight files for either
 * family; see apps/mobile/assets/fonts/SOURCES.md for the exact commit and
 * URLs). Each is registered under one family name; `fontWeight` in the type
 * scale below asks the platform's text renderer to select a weight from the
 * variable font's `wght` axis. iOS (CoreText) does this reliably; Android's
 * support depends on OS/engine version and is not verified on a device by
 * this ticket (M3-T1 ships a placeholder shell with no real typography
 * screens yet). Flagged in the M3-T1 worker report as a follow-up to verify,
 * or to fetch static weight files from a different OFL source, before a
 * design-sensitive screen (M3-T2+) depends on the distinction.
 */
export const fontFamily = {
  display: "Fraunces",
  displayFallback: "serif",
  body: "Inter",
  bodyFallback: "sans-serif",
} as const;

/**
 * Type scale. ENGINEERING INFERENCE (CLAUDE.md rule 5): no formal scale is
 * published; sizes are representative of the prototype's own bespoke font-sizes
 * (hero h1 34px, section heading 21px, card title 17px, body 15px, label 13px,
 * caption 11.5px, see docs/design/mockups/smart-kitchen-prototype.html for the
 * cited rules). Flagged for the architect in the M3-T1 worker report.
 */
export const typeScale = {
  display: { fontSize: 34, lineHeight: 40, fontFamily: fontFamily.display, fontWeight: "600" },
  heading: { fontSize: 21, lineHeight: 26, fontFamily: fontFamily.display, fontWeight: "600" },
  title: { fontSize: 17, lineHeight: 22, fontFamily: fontFamily.body, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21, fontFamily: fontFamily.body, fontWeight: "400" },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.body, fontWeight: "600" },
  caption: { fontSize: 11.5, lineHeight: 15, fontFamily: fontFamily.body, fontWeight: "500" },
} as const;

/** Minimum touch target (P9 / tokens.md §5), applied via hitSlop where the visible control is smaller. */
export const minTouchTarget = 44;

export const tokens = { colors, radius, spacing, fontFamily, typeScale, minTouchTarget } as const;

export default tokens;
