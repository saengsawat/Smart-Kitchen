import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typeScale } from "../design/tokens";

/**
 * Every M3-T1 tab screen's only content: its name and where the real screen
 * lands (BACKLOG.md M3-T1 Objective (c): "each tab a placeholder screen whose
 * only content is the screen name and 'coming in M3-Tn'"). No other screen
 * content belongs here; S1-S12 land in M3-T2 onward.
 */
export function PlaceholderScreen({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.sand,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  title: {
    fontSize: typeScale.heading.fontSize,
    lineHeight: typeScale.heading.lineHeight,
    fontFamily: typeScale.heading.fontFamily,
    fontWeight: typeScale.heading.fontWeight,
    color: colors.ink,
  },
  subtitle: {
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
    fontFamily: typeScale.body.fontFamily,
    fontWeight: typeScale.body.fontWeight,
    color: colors.ink2,
  },
});
