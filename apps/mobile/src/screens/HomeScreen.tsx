import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiClient } from "../api/client";
import { colors, fontFamily, minTouchTarget, spacing, typeScale } from "../design/tokens";
import { CENTER_ACTION, TAB_ORDER } from "../navigation/tabs";

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
  const [inventoryEmpty, setInventoryEmpty] = useState<boolean | null>(null);

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
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        hitSlop={4}
        onPress={handleAccountPress}
        style={styles.accountButton}
      />
    </View>
  );

  if (inventoryEmpty === true) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={styles.content}>
          <Text style={styles.title}>Your kitchen is empty</Text>
          <Text style={styles.subtitle}>
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
  screen: { flex: 1, backgroundColor: colors.sand },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  accountButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
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
    textAlign: "center",
  },
  button: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.cream, fontSize: 15, fontWeight: "700", fontFamily: fontFamily.body },
});
