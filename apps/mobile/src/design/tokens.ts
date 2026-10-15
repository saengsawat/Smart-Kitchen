/**
 * Design tokens (M3-T1, moved to prototype v6 "Cookbook" by M3-T13).
 *
 * Single source of colour, type scale, radius and spacing for apps/mobile.
 * No colour literal may appear anywhere else in this app (M3-T1 invariant).
 * Import from here.
 *
 * Values are prototype v6's `:root` block and stylesheet
 * (docs/design/mockups/smart-kitchen-prototype.html), as catalogued in
 * docs/design/tokens.md (sections 1 to 3, v5 to v6 mapping in section 11) and
 * docs/design/design-md/DESIGN.md. v6 has no brand colour: ink is the primary
 * action. Safety and semantic hexes are unchanged from D-021. Do not hand-edit a
 * hex here without updating the prototype and tokens.md, and re-running
 * tokens.test.ts's contrast recomputation.
 */

/** Palette. Every hex is pinned 1:1 by tokens.test.ts. */
export const colors = {
  // Surface and text
  /** Page canvas, sheet and tab bar surface. v6 has one light surface. */
  paper: "#fbfaf6",
  /** Quiet panel, photo-tile backing, neutral stat chip, pressed fill. */
  tile: "#f1eee6",
  /** Text, rules, primary action fill, selected chip fill, checkbox ring. */
  ink: "#0f0f0f",
  ink2: "#5f5d58",
  /** Tertiary text on paper and tile only (tokens.md section 4). */
  ink3: "#6f6c66",
  /** Row dividers, underlines, quiet borders. Never the only edge of a control. */
  hair: "#dcd8cf",

  // Semantic ladder (unchanged from D-021)
  /** Known Fact / fresh / positive. Never allergen. */
  green: "#2c744b",
  greenBg: "#dfeee3",
  /** Estimated / expiring in 2 to 3 days / short. Never verdict-danger. */
  amber: "#925b0a",
  amberBg: "#f6e6c8",
  /** "Use today" urgency. Never allergen. */
  rose: "#9d4b51",
  roseBg: "#f7dcdc",
  /** ALLERGEN ONLY, per the nine rules (M1-T4). */
  danger: "#882020",
  dangerBg: "#f9d9d9",
  /** AI Interpretation tier, exclusive hue (design-direction section 0). */
  ai: "#7b4cb5",
  aiBg: "#eadff7",
  /** Secondary text on the AI tray (new in v6). */
  aiInk: "#5a4a70",

  // Literals v6 hard-codes outside `:root` (names from tokens.md section 1b)
  white: "#ffffff",
  /** Secondary text on the ink primary block: white at 78%. */
  onInkMuted: "rgba(255,255,255,.78)",
  inkHover: "#2b2b2b",
  rowHover: "#f4f2ec",
  invHover: "#e4e1d9",
  /** Body text on amberBg. */
  amberInk: "#5b4210",
  /** Body text on greenBg. */
  greenInk: "#1f4d33",
  greenHover: "#235f3d",
  /** Hairline on the AI tray. */
  aiHair: "#d7c6ee",
  /** Thumbnail backing on the AI tray. */
  aiTile: "#f5f0fb",
  /** Keyboard focus ring on paper and tile. */
  focus: "#2442d6",
  /** The one dark surface (camera screen). */
  cameraBg: "#121212",
  cameraBg2: "#2b2a27",
  /** Text and chrome on the camera screen. */
  cameraText: "#f3f1ec",
  cameraTextMuted: "#d9d6cf",
  /** Camera-screen control outlines (`.iconb.light`, `.btn.light`, hover fill). */
  cameraLine: "rgba(255,255,255,.3)",
  cameraLineStrong: "rgba(255,255,255,.6)",
  cameraHover: "rgba(255,255,255,.1)",
  /** Sheet scrim: ink at 45%. */
  scrim: "rgba(15,15,15,.45)",
} as const;

export type ColorToken = keyof typeof colors;

/** Radii (tokens.md section 3a). Photos and tiles are square (`none`). */
export const radius = {
  none: 0,
  /** CSS 999px. Also used for circles on square boxes (the app's `50%`). */
  pill: 9999,
  /** `.toast`. */
  toast: 12,
  /** `.tray`, `.addprimary`. */
  panel: 14,
  /** `.verdict.unk`, `.blockbar`. */
  verdict: 10,
  verdictSm: 8,
  /** `.sheet` and the scan product panel (top corners only). */
  sheet: 22,
} as const;

/**
 * Spacing scale. The 4px-step members (`xs`..`xxl`) are the M3-T1 scale;
 * `snug`, `cozy`, `gutter` and `section` are the four v6 steps tokens.md
 * section 3b adds (ENGINEERING INFERENCE, measured from the v6 stylesheet).
 */
export const spacing = {
  xs: 4,
  sm: 8,
  snug: 10,
  md: 12,
  cozy: 14,
  lg: 16,
  /** The v6 screen gutter (`.pad`, `margin: 0 20px`). */
  gutter: 20,
  xl: 24,
  /** Gap above a section head (`.sec`). */
  section: 30,
  xxl: 32,
} as const;

/**
 * Font families (v6: Bodoni Moda display at 500, Schibsted Grotesk UI).
 * Vendored from Google Fonts' source repository as variable files; see
 * apps/mobile/assets/fonts/SOURCES.md. Each is registered under one family
 * name and `fontWeight` asks the platform to pick a point on the `wght` axis.
 */
export const fontFamily = {
  display: "Bodoni Moda",
  displayFallback: "serif",
  body: "Schibsted Grotesk",
  bodyFallback: "system-ui, sans-serif",
} as const;

/** Display weight: v6 uses Bodoni Moda 500 only. */
export const DISPLAY_WEIGHT = "500" as const;

/**
 * Type scale, from DESIGN.md section 3 (every size is a v6 stylesheet size).
 * `lineHeight` is in px (React Native has no unitless line height): the v6
 * ratio times the size, rounded. Display steps are Bodoni Moda 500; the rest
 * are Schibsted Grotesk. `letterSpacing` is the v6 em value times the size.
 */
export const typeScale = {
  /** `.title`: screen title. */
  title: {
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: -0.66,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.h1`: Home headline, recipe name. */
  h1: {
    fontSize: 40,
    lineHeight: 41,
    letterSpacing: -0.6,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.stats .v`: stat value. */
  statValue: {
    fontSize: 36,
    lineHeight: 36,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.pname`, `.denied h2`: scanned product name, camera-denied heading. */
  product: {
    fontSize: 30,
    lineHeight: 32,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.emptyst h2`, `.row .ix`. */
  empty: {
    fontSize: 28,
    lineHeight: 29,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.sheet h2`. */
  sheetTitle: {
    fontSize: 26,
    lineHeight: 27,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.sec h2`: section heading. */
  section: {
    fontSize: 25,
    lineHeight: 25,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.grp h2`: group heading. */
  group: {
    fontSize: 22,
    lineHeight: 22,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.qtybig b`: item quantity. */
  qtyBig: {
    fontSize: 46,
    lineHeight: 46,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.step b`: stepper value. */
  stepper: {
    fontSize: 26,
    lineHeight: 26,
    fontFamily: fontFamily.display,
    fontWeight: DISPLAY_WEIGHT,
  },
  /** `.row b`, `.arow b`: row title. */
  rowTitle: {
    fontSize: 15.5,
    lineHeight: 19,
    fontFamily: fontFamily.body,
    fontWeight: "700",
  },
  /** `body`: 15 / 1.45. */
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.body, fontWeight: "400" },
  /** `.btn`: 14 / 700. */
  button: { fontSize: 14, lineHeight: 16, fontFamily: fontFamily.body, fontWeight: "700" },
  /** `.chip`, `.verdict`: 13.5 / 600. */
  label: { fontSize: 13.5, lineHeight: 18, fontFamily: fontFamily.body, fontWeight: "600" },
  /** `.verdict .c`, `.note`: 12.5 / 1.4. */
  caption: { fontSize: 12.5, lineHeight: 17, fontFamily: fontFamily.body, fontWeight: "400" },
  /** `.prov`, `.days`, `.fl`: 12 / 700. The product has no size below 12. */
  chip: { fontSize: 12, lineHeight: 12, fontFamily: fontFamily.body, fontWeight: "700" },
} as const;

/** Minimum touch target (P9 / tokens.md section 7), applied via hitSlop where the visible control is smaller. */
export const minTouchTarget = 44;

export const tokens = { colors, radius, spacing, fontFamily, typeScale, minTouchTarget } as const;

export default tokens;
