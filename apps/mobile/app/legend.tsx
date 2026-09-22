import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fontFamily, minTouchTarget, spacing } from "../src/design/tokens";
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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={handleBack}
          style={styles.iconButton}
        >
          <Text style={styles.iconGlyph}>{"‹"}</Text>
        </Pressable>
        <Text style={styles.title}>What do these mean?</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Every value in KitchenSmart wears a tag showing how sure we are. A tag is our confidence
          in a fact. It is never a safety check by itself.
        </Text>
        {LEGEND_LINES.map((line) => (
          <View key={line.tier} style={styles.row}>
            <Text style={styles.chip}>{ROW_CHIP_TEXT[line.tier]}</Text>
            <Text style={styles.rowText}>
              <Text style={styles.rowLabel}>{line.chipLabel}. </Text>
              {line.legendText}
            </Text>
          </View>
        ))}
        <Text style={styles.closing}>{LEGEND_CLOSING_LINE}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sand },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 22, color: colors.ink },
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 19.5 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  chip: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ink2,
    fontFamily: fontFamily.body,
    paddingTop: 2,
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    lineHeight: 19,
  },
  rowLabel: { color: colors.ink, fontWeight: "700" },
  closing: {
    fontSize: 12.5,
    color: colors.ink3,
    fontFamily: fontFamily.body,
    paddingTop: spacing.sm,
  },
});
