import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  colors,
  fontFamily,
  minTouchTarget,
  radius,
  spacing,
  typeScale,
} from "../src/design/tokens";
import { provChipStyle } from "../src/design/chips";
import { ScanIcon } from "../src/navigation/TabIcon";
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
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
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
      <ScrollView contentContainerStyle={styles.content}>
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
        <Text style={styles.title}>Add food</Text>
        <Text style={styles.sub}>
          Every path except manual is a proposal · nothing becomes a Known Fact until you confirm
          it.
        </Text>

        {/* v6 `.addprimary`: the one ink block, Scan barcode. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan barcode"
          onPress={() => router.push("/add/scan")}
          style={styles.primary}
        >
          <ScanIcon color={colors.white} />
          <View style={styles.primaryText}>
            <Text style={styles.primaryTitle}>Scan barcode</Text>
            <Text style={styles.primarySub}>Product facts fill in from the label database</Text>
          </View>
          <Text style={styles.chevron}>{"›"}</Text>
        </Pressable>

        {/* v6 `.addlist`: a 1px ink rule, then rows divided by hairlines. */}
        <View style={styles.addList}>
          <ModeRow
            title="Type it in"
            subtitle="Always available, never blocked"
            onPress={() => router.push("/add/manual")}
          />
          <ModeRow
            title="Scan receipt"
            subtitle="One photo adds the whole grocery run"
            phase="fast-follow"
            onPress={() =>
              show("Scan receipt is fast-follow · built after MVP launch, already planned.")
            }
          />
          <ModeRow
            title="Photograph a shelf"
            subtitle="AI proposes what it sees"
            phase="future"
            onPress={() => show("Photograph a shelf is future · not yet scheduled.")}
          />
        </View>

        <View style={styles.sec}>
          <Text style={styles.secTitle}>Recently added</Text>
        </View>
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
                style={provChipStyle("KNOWN_FACT")}
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

/**
 * One ruled row of v6 `.arow`: 68px minimum, title 15.5 / 700, subline 13 in
 * ink2. The not-yet-built paths (`phase` set) take v6's `.arow.soon` look:
 * ink2 title at 600, ink3 subline, and a tile tag with the deck's phase label.
 */
function ModeRow({
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
      style={styles.row}
    >
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowTitle, phase ? styles.rowTitleSoon : null]}>{title}</Text>
          {phase ? (
            <View style={styles.phaseTag}>
              <Text style={styles.phaseTagText}>{phase}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowSub, phase ? styles.rowSubSoon : null]}>{subtitle}</Text>
      </View>
      {phase ? null : <Text style={styles.rowChevron}>{"›"}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: spacing.xxl * 2 },
  // v6 `.back`: the 44px back control, no border on this screen.
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
  sub: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 6,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "500",
    fontFamily: fontFamily.body,
    color: colors.ink2,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.cozy,
    minHeight: 88,
    marginHorizontal: spacing.gutter,
    marginTop: spacing.gutter,
    paddingVertical: 18,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.ink,
    borderRadius: radius.panel,
  },
  primaryText: { flex: 1 },
  primaryTitle: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    color: colors.white,
  },
  primarySub: {
    marginTop: 3,
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: fontFamily.body,
    color: colors.onInkMuted,
  },
  chevron: { fontSize: 26, lineHeight: 28, color: colors.white, fontFamily: fontFamily.body },
  addList: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.cozy,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.cozy,
    minHeight: 68,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  rowText: { flex: 1 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  rowTitle: {
    fontSize: typeScale.rowTitle.fontSize,
    lineHeight: typeScale.rowTitle.lineHeight,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    color: colors.ink,
  },
  rowTitleSoon: { fontWeight: "600", color: colors.ink2 },
  rowSub: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
    color: colors.ink2,
  },
  rowSubSoon: { color: colors.ink3 },
  rowChevron: { fontSize: 24, lineHeight: 26, color: colors.ink2, fontFamily: fontFamily.body },
  // v6 `.msrc` / `.mtag`: 12px 700 uppercase on tile, square corners.
  phaseTag: { backgroundColor: colors.tile, paddingHorizontal: 6, paddingVertical: 3 },
  phaseTagText: {
    fontSize: typeScale.chip.fontSize,
    lineHeight: typeScale.chip.lineHeight,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    letterSpacing: 12 * 0.08,
    textTransform: "uppercase",
    color: colors.ink2,
  },
  // v6 `.sec`: Bodoni 25 over a 1px ink rule, 30px below the previous block.
  sec: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.section,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  secTitle: {
    fontSize: typeScale.section.fontSize,
    lineHeight: typeScale.section.lineHeight,
    fontFamily: typeScale.section.fontFamily,
    fontWeight: typeScale.section.fontWeight,
    color: colors.ink,
  },
  emptyText: {
    marginHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    fontSize: 13,
    fontFamily: fontFamily.body,
    color: colors.ink3,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.gutter,
    minHeight: 72,
    paddingVertical: spacing.snug,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  recentMeta: { flex: 1, gap: 3 },
  recentName: {
    fontSize: typeScale.rowTitle.fontSize,
    lineHeight: typeScale.rowTitle.lineHeight,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  recentSub: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body },
});
