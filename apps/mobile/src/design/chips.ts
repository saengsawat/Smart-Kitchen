import { StyleSheet } from "react-native";
import { colors, fontFamily, radius } from "./tokens";

/**
 * v6 provenance chip (`.prov`): 12px 700, pill, padding 4px 9px, one tier per
 * colour pair. The glyph and words always travel with the colour (P9), so a
 * chip never relies on colour alone. Shared by every screen that draws a tier
 * chip so the pairs live in one place.
 */
export const provChipStyles = StyleSheet.create({
  base: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: "hidden",
    flexShrink: 0,
  },
  KNOWN_FACT: { color: colors.green, backgroundColor: colors.greenBg },
  ESTIMATED: { color: colors.amber, backgroundColor: colors.amberBg },
  AI_INTERPRETATION: { color: colors.ai, backgroundColor: colors.aiBg },
});

export type ProvChipTier = "KNOWN_FACT" | "ESTIMATED" | "AI_INTERPRETATION";

/** The style layers for a tier chip: base, then the tier's colour pair. */
export function provChipStyle(tier: ProvChipTier): [typeof provChipStyles.base, object] {
  return [provChipStyles.base, provChipStyles[tier]];
}

/**
 * v6 `.chip` and `.sev button` are drawn 40px tall; the invisible hit slop brings
 * the target to the 44px minimum (tokens.md section 7).
 */
export const chipHitSlop = { top: 2, bottom: 2, left: 0, right: 0 } as const;
