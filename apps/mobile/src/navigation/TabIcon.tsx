import { View } from "react-native";
import type { TabIconKind } from "./tabs";

/**
 * Minimal stroke-style glyphs for the tab bar, built from plain Views (no SVG
 * library). react-native has no bundled vector/icon support, and a real icon
 * set is explicitly out of scope for M3-T1 (BACKLOG.md M3-T1 "Out of scope":
 * "a UI component library, rule 11, decide in M3-T2 with concrete needs").
 * These are deliberately simple placeholders that carry the right colour and
 * a recognisable silhouette; M3-T2 onward can replace them with a real icon
 * set behind a rule-11 justification once concrete screens need one.
 */

const SIZE = 22;
const STROKE = 1.8;

export function TabIcon({ kind, color }: { kind: TabIconKind; color: string }): React.JSX.Element {
  switch (kind) {
    case "home":
      return (
        <View
          style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "flex-end" }}
        >
          <View
            style={{
              position: "absolute",
              top: 0,
              width: 0,
              height: 0,
              borderLeftWidth: SIZE / 2,
              borderRightWidth: SIZE / 2,
              borderBottomWidth: SIZE / 2,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: SIZE * 0.7,
              height: SIZE * 0.55,
              borderWidth: STROKE,
              borderColor: color,
              borderTopWidth: 0,
            }}
          />
        </View>
      );
    case "inventory":
      return (
        <View style={{ width: SIZE, height: SIZE, justifyContent: "space-between" }}>
          <View
            style={{ height: SIZE * 0.4, borderWidth: STROKE, borderColor: color, borderRadius: 2 }}
          />
          <View
            style={{ height: SIZE * 0.4, borderWidth: STROKE, borderColor: color, borderRadius: 2 }}
          />
        </View>
      );
    case "calendar":
      return (
        <View
          style={{
            width: SIZE,
            height: SIZE,
            borderWidth: STROKE,
            borderColor: color,
            borderRadius: 3,
          }}
        >
          <View
            style={{ height: SIZE * 0.28, borderBottomWidth: STROKE, borderBottomColor: color }}
          />
        </View>
      );
    case "cart":
      return (
        <View style={{ width: SIZE, height: SIZE, alignItems: "center" }}>
          <View
            style={{
              width: SIZE * 0.8,
              height: SIZE * 0.55,
              borderWidth: STROKE,
              borderColor: color,
              borderTopWidth: 0,
              borderRadius: 2,
            }}
          />
          <View
            style={{
              position: "absolute",
              bottom: 0,
              flexDirection: "row",
              width: SIZE * 0.6,
              justifyContent: "space-between",
            }}
          >
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                borderWidth: STROKE,
                borderColor: color,
              }}
            />
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                borderWidth: STROKE,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    default:
      return <View style={{ width: SIZE, height: SIZE }} />;
  }
}

export function ScanIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderWidth: STROKE,
        borderColor: color,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{ width: 10, height: 10, borderRadius: 5, borderWidth: STROKE, borderColor: color }}
      />
    </View>
  );
}
