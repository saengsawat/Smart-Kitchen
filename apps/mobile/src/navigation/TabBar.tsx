import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontFamily, minTouchTarget, spacing } from "../design/tokens";
import { ScanIcon, TabIcon } from "./TabIcon";
import { CENTER_ACTION, TAB_ORDER, isActiveRoute } from "./tabs";

/**
 * The bar's own height above its bottom padding (px): v6 `.nav` padding-top 8
 * plus an item min-height of 48.
 */
export const TAB_BAR_HEIGHT = 8 + 48;
/**
 * The least bottom padding the bar carries (v6 `.nav` padding-bottom 20).
 * On a phone with a larger bottom inset the bar pads by the inset instead.
 */
export const TAB_BAR_BOTTOM_OFFSET = 20;

/**
 * The bar's full footprint for a given bottom safe-area inset: height plus
 * the larger of the inset and the minimum bottom padding, plus one
 * `spacing.lg` of breathing room. Pure so tests can pin the formula without
 * rendering.
 */
export function tabBarClearanceFor(bottomInset: number): number {
  return TAB_BAR_HEIGHT + Math.max(bottomInset, TAB_BAR_BOTTOM_OFFSET) + spacing.lg;
}

/**
 * Bottom padding every scrolling screen that shows the tab bar must give its
 * content (S4, S5, S11, S12) so the last row clears the bar (BUG-003).
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return tabBarClearanceFor(insets.bottom);
}

const ADD_DISC = 46;

/**
 * The five-slot tab bar, matching prototype v6's `.nav` CSS: a full-width
 * paper bar capped by a 1px ink rule, five equal columns, labels 12px 600 in
 * ink2, the current tab in ink at weight 800 with a heavier icon stroke, and a
 * 46px ink disc for the centre Add control. Not floating, no shadow.
 */
export function TabBar(): React.JSX.Element {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const left = TAB_ORDER.slice(0, 2);
  const right = TAB_ORDER.slice(2);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, TAB_BAR_BOTTOM_OFFSET) }]}>
      {left.map((tab) => (
        <TabButton
          key={tab.key}
          active={isActiveRoute(pathname, tab.route)}
          label={tab.label}
          route={tab.route}
          icon={tab.icon}
        />
      ))}
      <View style={styles.cell}>
        <Link href={CENTER_ACTION.route} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${CENTER_ACTION.label}, scan`}
            style={({ pressed }) => [styles.disc, pressed && styles.pressed]}
          >
            <ScanIcon color={colors.white} />
          </Pressable>
        </Link>
      </View>
      {right.map((tab) => (
        <TabButton
          key={tab.key}
          active={isActiveRoute(pathname, tab.route)}
          label={tab.label}
          route={tab.route}
          icon={tab.icon}
        />
      ))}
    </View>
  );
}

function TabButton({
  active,
  label,
  route,
  icon,
}: {
  active: boolean;
  label: string;
  route: string;
  icon: Parameters<typeof TabIcon>[0]["kind"];
}): React.JSX.Element {
  const color = active ? colors.ink : colors.ink2;
  return (
    <Link href={route} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={styles.cell}
      >
        <TabIcon kind={icon} color={color} stroke={active ? 2.3 : 1.8} />
        <Text style={[styles.tabLabel, { color, fontWeight: active ? "800" : "600" }]}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  // Fixed to the bottom of the window over the Slot, as the floating bar was;
  // screens clear it with `useTabBarClearance()`.
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
  },
  cell: {
    flex: 1,
    minHeight: 48,
    minWidth: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  disc: {
    width: ADD_DISC,
    height: ADD_DISC,
    borderRadius: ADD_DISC / 2,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { transform: [{ scale: 0.98 }] },
});
