import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../src/design/tokens";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../src/inventory/provenance";
import { trimAmountText } from "../src/inventory/quantity";
import { LOCATION_LABELS } from "../src/inventory/list-view";
import { useToast } from "../src/inventory/Toast";
import { getRecentlyAdded } from "../src/scan/recently-added";

/**
 * S6 · Add hub (M3-T4b), prototype v4 `#scr-add`.
 *
 * Four mode tiles, phase labels exact (copy-deck.md §6): "Scan barcode" is
 * the one live path; "Scan receipt" is fast-follow; "Photograph a shelf" is
 * future; "Type it in" is always available. The fast-follow/future tiles
 * explain themselves on tap (P10) rather than a dead "not in mockup" toast.
 */
export default function AddHubScreen(): React.JSX.Element {
  const router = useRouter();
  const { show } = useToast();
  // Read once, at mount: expo-router's stack pushes a fresh instance of this
  // screen each time the FAB navigates here (it is popped, not merely
  // hidden, on the way back), so a mount-time read already reflects
  // whatever S8/S9 added most recently this session.
  const [recent] = useState(() => getRecentlyAdded());

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
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
        <Text style={styles.headerTitle}>Add food</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.helper}>
          Every path except manual is a proposal · nothing becomes a Known Fact until you confirm
          it.
        </Text>

        <View style={styles.grid}>
          <ModeTile
            title="Scan barcode"
            subtitle="Product facts fill in from the label database"
            onPress={() => router.push("/add/scan")}
          />
          <ModeTile
            title="Scan receipt"
            subtitle="One photo adds the whole grocery run"
            phase="fast-follow"
            onPress={() =>
              show("Scan receipt is fast-follow · built after MVP launch, already planned.")
            }
          />
          <ModeTile
            title="Photograph a shelf"
            subtitle="AI proposes what it sees"
            phase="future"
            onPress={() => show("Photograph a shelf is future · not yet scheduled.")}
          />
          <ModeTile
            title="Type it in"
            subtitle="Always available, never blocked"
            onPress={() => router.push("/add/manual")}
          />
        </View>

        <Text style={styles.sectionHeading}>Recently added</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>Nothing added yet this session.</Text>
        ) : (
          recent.map((item) => (
            <View key={item.itemId} style={styles.recentRow}>
              <View style={styles.recentMeta}>
                <Text style={styles.recentName}>{item.displayName ?? "Item"}</Text>
                <Text style={styles.recentSub}>
                  {trimAmountText(item.quantity.amount)} {item.quantity.unit} ·{" "}
                  {item.storageLocation ? LOCATION_LABELS[item.storageLocation] : "Other"}
                </Text>
              </View>
              <Text
                style={styles.provChip}
                accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}
              >
                {ROW_CHIP_TEXT.KNOWN_FACT}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ModeTile({
  title,
  subtitle,
  phase,
  onPress,
}: {
  title: string;
  subtitle: string;
  phase?: "fast-follow" | "future";
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={phase ? `${title}, ${phase}` : title}
      onPress={onPress}
      style={styles.tile}
    >
      {phase ? (
        <View style={styles.phaseBadge}>
          <Text style={styles.phaseBadgeText}>{phase}</Text>
        </View>
      ) : null}
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSubtitle}>{subtitle}</Text>
    </Pressable>
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
  headerTitle: {
    fontSize: 20,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  helper: { fontSize: 14, lineHeight: 20, color: colors.ink2, fontFamily: fontFamily.body },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    padding: spacing.md,
    gap: spacing.xs,
  },
  phaseBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.aiBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  phaseBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.ai,
    fontFamily: fontFamily.body,
  },
  tileTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
    marginTop: spacing.xs,
  },
  tileSubtitle: { fontSize: 12, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 16 },
  sectionHeading: {
    fontSize: 17,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    paddingTop: spacing.sm,
  },
  emptyText: { fontSize: 13, color: colors.ink3, fontFamily: fontFamily.body },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recentMeta: { flex: 1, gap: 2 },
  recentName: { fontSize: 14, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  recentSub: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  provChip: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.green,
    backgroundColor: colors.greenBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
});
