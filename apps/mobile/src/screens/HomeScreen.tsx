import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiClient } from "../api/client";
import { colors, fontFamily, radius, spacing, typeScale } from "../design/tokens";
import { CENTER_ACTION, TAB_ORDER } from "../navigation/tabs";

/** v6 `.av`: the masthead avatar is 38px (hit slop brings the target to 44). */
const AVATAR = 38;

const HOME_TAB = TAB_ORDER.find((t) => t.key === "home");

/**
 * Home (M3-T2 Objective (c), header affordance added M3-T6). Still the
 * M3-T1 placeholder shell plus the one addition M3-T2 asked for (the
 * first-run empty-kitchen state, shown only while the household's inventory
 * is empty) and the one addition this ticket adds: the header's account
 * affordance (prototype v4's avatar, `onclick="avatarTap()"`), reachable
 * from every Home state alike, that opens S12 (`app/profile.tsx`). The full
 * S3 dashboard (non-empty states, tonight's-best-match card, the eyebrow/
 * hero copy, the real avatar initials, etc.) is out of scope here (held,
 * OQ-D9) and untouched by this addition — the two existing branches below
 * are unchanged except for the shared header now wrapping them.
 *
 * Copy (review F4, architect ruling): where prototype v4 and copy-deck §7
 * disagree on non-safety copy, prototype v4 wins (it is what the PO and Dean
 * reviewed and D-023 signed off) — the deck stays binding for allergen/
 * provenance strings and §2/§10. The empty-state heading, body and button
 * below are prototype v4 strings, not new copy this ticket invented; the
 * architect updates copy-deck §7 with them at acceptance.
 */
export function HomeScreen(): React.JSX.Element {
  const router = useRouter();
  // BUG-007: the header clears the status bar / camera cutout. The fixed
  // spacing.xl it used before was shorter than many Android status bars.
  const insets = useSafeAreaInsets();
  const [inventoryEmpty, setInventoryEmpty] = useState<boolean | null>(null);
  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" });

  useEffect(() => {
    let cancelled = false;
    void apiClient.getInventoryItems().then((items) => {
      if (!cancelled) {
        setInventoryEmpty(items.length === 0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAccountPress(): void {
    router.push("/profile");
  }

  // The tap target itself, not its visible glyph, is prototype v4's binding
  // behaviour here (`avatarTap()`): the prototype shows the caller's own
  // initials on the button ("DC"), which needs an identity read this
  // placeholder does not otherwise make (BACKLOG.md M3-T6 Objective (a):
  // "without touching the held dashboard states"). A plain circle today, no
  // letters (copy-deck.md §2: an icon never carries information the text
  // label does not also carry, and `accessibilityLabel="Account"` already
  // does), real initials once the full S3 dashboard already holds that
  // state (OQ-D9) — flagged in the worker report as a deferred, low-risk
  // gap, not a missing requirement (the tap itself, this ticket's actual
  // ask, works identically either way).
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.mast}>
        <Text style={styles.mastText} numberOfLines={1}>
          <Text style={styles.mastName}>Smart Kitchen</Text>
          <Text style={styles.mastWhen}>{` · ${weekday}`}</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          hitSlop={4}
          onPress={handleAccountPress}
          style={styles.accountButton}
        />
      </View>
      <View style={styles.rule} />
    </View>
  );

  if (inventoryEmpty === true) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.content}>
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Your kitchen is empty</Text>
            <Text style={styles.emptyBody}>
              Scan a barcode and we will fill in the facts. No typing, and nothing becomes a Known
              Fact until you confirm it.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan your first item"
              onPress={() => router.push(CENTER_ACTION.route)}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Scan your first item</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.content}>
        <Text style={styles.title}>Home</Text>
        {inventoryEmpty === false ? (
          <Text style={styles.subtitle}>{HOME_TAB?.placeholder}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.gutter },
  // v6 `.mast`: name and weekday on the left, the account avatar on the right.
  mast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  mastText: { flexShrink: 1, color: colors.ink },
  mastName: {
    fontFamily: fontFamily.body,
    fontSize: typeScale.chip.fontSize,
    fontWeight: "600",
    letterSpacing: 12 * 0.22,
    textTransform: "uppercase",
    color: colors.ink,
  },
  mastWhen: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink2,
  },
  accountButton: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  // v6 `.rule`: the 1px ink rule under the masthead.
  rule: { height: 1, backgroundColor: colors.ink, marginTop: spacing.md },
  content: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
  },
  title: {
    fontSize: typeScale.h1.fontSize,
    lineHeight: typeScale.h1.lineHeight,
    letterSpacing: typeScale.h1.letterSpacing,
    fontFamily: typeScale.h1.fontFamily,
    fontWeight: typeScale.h1.fontWeight,
    color: colors.ink,
  },
  subtitle: {
    fontSize: typeScale.body.fontSize,
    lineHeight: typeScale.body.lineHeight,
    fontFamily: typeScale.body.fontFamily,
    fontWeight: typeScale.body.fontWeight,
    color: colors.ink2,
  },
  // v6 `.emptyst`: a dashed ink2 box, centred.
  emptyPanel: {
    alignItems: "center",
    gap: spacing.snug,
    paddingVertical: 28,
    paddingHorizontal: spacing.gutter,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.ink2,
  },
  emptyTitle: {
    fontSize: typeScale.empty.fontSize,
    lineHeight: typeScale.empty.lineHeight,
    fontFamily: typeScale.empty.fontFamily,
    fontWeight: typeScale.empty.fontWeight,
    color: colors.ink,
    textAlign: "center",
  },
  emptyBody: {
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fontFamily.body,
    color: colors.ink2,
    textAlign: "center",
  },
  // v6 `.btn.pri`: ink pill, white label, 50px.
  button: {
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  buttonText: {
    color: colors.white,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
