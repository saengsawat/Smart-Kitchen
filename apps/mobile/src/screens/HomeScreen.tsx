import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiClient } from "../api/client";
import { colors, fontFamily, minTouchTarget, spacing, typeScale } from "../design/tokens";
import { CENTER_ACTION, TAB_ORDER } from "../navigation/tabs";

const HOME_TAB = TAB_ORDER.find((t) => t.key === "home");

/**
 * Home (M3-T2 Objective (c)). Still the M3-T1 placeholder shell plus the one
 * addition this ticket asks for: the first-run empty-kitchen state, shown
 * only while the household's inventory is empty. The full S3 dashboard
 * (non-empty states, tonight's-best-match card, etc.) is out of scope here
 * (held, OQ-D9).
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

  if (inventoryEmpty === true) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Your kitchen is empty</Text>
        <Text style={styles.subtitle}>
          Scan a barcode and we will fill in the facts. No typing, and nothing becomes a Known Fact
          until you confirm it.
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
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Home</Text>
      {inventoryEmpty === false ? (
        <Text style={styles.subtitle}>{HOME_TAB?.placeholder}</Text>
      ) : null}
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
