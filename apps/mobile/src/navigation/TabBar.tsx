import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, minTouchTarget, radius } from "../design/tokens";
import { ScanIcon, TabIcon } from "./TabIcon";
import { CENTER_ACTION, TAB_ORDER, isActiveRoute } from "./tabs";

/**
 * The five-slot floating tab bar (M3-T1), matching prototype v4's `.nav` /
 * `.fab` CSS (docs/design/mockups/smart-kitchen-prototype.html lines 280-286):
 * a paper pill bar with four flex tabs either side of a 72px gap, and an
 * espresso-coloured circular scan button floating above the gap.
 */
export function TabBar(): React.JSX.Element {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const left = TAB_ORDER.slice(0, 2);
  const right = TAB_ORDER.slice(2);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 18 + insets.bottom }]}>
      <View style={styles.bar}>
        {left.map((tab) => (
          <TabButton
            key={tab.key}
            active={isActiveRoute(pathname, tab.route)}
            label={tab.label}
            route={tab.route}
            icon={tab.icon}
          />
        ))}
        <View style={styles.gap} />
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
      <Link href={CENTER_ACTION.route} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${CENTER_ACTION.label}, scan`}
          hitSlop={8}
          style={styles.fab}
        >
          <ScanIcon color={colors.cream} />
        </Pressable>
      </Link>
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
  const color = active ? colors.brandDeep : colors.ink3;
  const iconColor = active ? colors.brand : colors.ink3;
  return (
    <Link href={route} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={styles.tabButton}
      >
        <TabIcon kind={icon} color={iconColor} />
        <Text style={[styles.tabLabel, { color }]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  bar: {
    width: "100%",
    height: 66,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: colors.ink,
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  gap: {
    flexBasis: 72,
    flexGrow: 0,
    flexShrink: 0,
  },
  tabButton: {
    flex: 1,
    height: "100%",
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: "600",
  },
  fab: {
    position: "absolute",
    top: -22,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.espresso,
    borderWidth: 4,
    borderColor: colors.sand,
    alignItems: "center",
    justifyContent: "center",
  },
});
