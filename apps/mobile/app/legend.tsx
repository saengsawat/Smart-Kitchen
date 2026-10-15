import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { provChipStyle } from "../src/design/chips";
import { colors, fontFamily, minTouchTarget, spacing, typeScale } from "../src/design/tokens";
import { useTabBarClearance } from "../src/navigation/TabBar";
import { LEGEND_CLOSING_LINE, LEGEND_LINES, ROW_CHIP_TEXT } from "../src/inventory/provenance";

/**
 * Legend screen (M3-T3), prototype v4 `#scr-legend`. The three lines are
 * copy-deck.md §4 verbatim, in tier order, plus its closing line
 * (BACKLOG.md M3-T3 Objective (c)): copy-deck wins over the prototype's own
 * legend wording here because these are provenance strings, the one
 * category the precedence rule (copy-deck.md header) keeps with the deck
 * even where prototype v4 differs. The allergen legend row the prototype
 * also shows is out of this ticket's scope (only the three provenance tiers
 * plus the closing line).
 *
 * Review F17 ruling: the intro paragraph restores the prototype's exact
 * sentence, including "It is never a safety check by itself." (a negation,
 * not a claim, the same shape as the standing NO_SAFETY_GUARANTEE caveat).
 * An earlier draft reworded it to clear the copy scan's forbidden-word gate
 * on the "safe" substring; the gate's allowed-sentence list is extended
 * instead (`src/lint-rules/copy-scan.test.ts`), and the architect records
 * this sentence in copy-deck.md §10's exception table at acceptance.
 */
export default function LegendScreen(): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/inventory");
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
        <View style={[styles.back, { paddingTop: insets.top + spacing.md }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={8}
            onPress={handleBack}
            style={styles.iconButton}
          >
            <Text style={styles.iconGlyph}>{"‹"}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>What do these mean?</Text>
        <Text style={styles.intro}>
          Every value in Smart Kitchen wears a tag showing how sure we are. A tag is our confidence
          in a fact. It is never a safety check by itself.
        </Text>
        {/* v6 `.legrows`: a 1px ink rule, then a 116px chip column and the legend line. */}
        <View style={styles.rows}>
          {LEGEND_LINES.map((line) => (
            <View key={line.tier} style={styles.row}>
              <View style={styles.chipCol}>
                <Text style={provChipStyle(line.tier)}>{ROW_CHIP_TEXT[line.tier]}</Text>
              </View>
              <Text style={styles.rowText}>
                <Text style={styles.rowLabel}>{line.chipLabel}. </Text>
                {line.legendText}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.closing}>{LEGEND_CLOSING_LINE}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {},
  back: { paddingHorizontal: spacing.md },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 30, lineHeight: 32, color: colors.ink, fontFamily: fontFamily.body },
  title: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 2,
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
    letterSpacing: typeScale.title.letterSpacing,
    fontFamily: typeScale.title.fontFamily,
    fontWeight: typeScale.title.fontWeight,
    color: colors.ink,
  },
  intro: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 6,
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: "500",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  rows: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.cozy,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  chipCol: { width: 116, alignItems: "flex-start" },
  rowText: {
    flex: 1,
    fontSize: 13.5,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    lineHeight: 20,
  },
  rowLabel: { color: colors.ink, fontWeight: "700" },
  closing: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
});
