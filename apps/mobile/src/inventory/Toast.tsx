import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../design/tokens";

/**
 * S4/S5's toast (prototype v4 `#toastEl`/`toast()`), e.g. copy-deck.md §5's
 * undo toast text "Corrected. Undo". Shown for a few seconds, announced to a
 * screen reader, optionally carrying one "Undo" action.
 */
export interface ToastState {
  readonly message: string;
  readonly onUndo?: () => void;
}

const VISIBLE_MS = 3200;

export function useToast(): {
  toast: ToastState | null;
  show: (message: string, onUndo?: () => void) => void;
} {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const show = useCallback((message: string, onUndo?: () => void) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setToast({ message, onUndo });
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  return { toast, show };
}

export function ToastBanner({ toast }: { toast: ToastState | null }): React.JSX.Element | null {
  if (!toast) {
    return null;
  }
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner} accessibilityLiveRegion="polite">
        <Text style={styles.message}>{toast.message}</Text>
        {toast.onUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            hitSlop={10}
            onPress={toast.onUndo}
            style={styles.undo}
          >
            <Text style={styles.undoText}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xxl,
    alignItems: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.espresso,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxWidth: "90%",
  },
  message: { color: colors.cream, fontSize: 13, fontFamily: fontFamily.body, flexShrink: 1 },
  undo: {
    minHeight: minTouchTarget - 12,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  undoText: { color: colors.cream, fontSize: 13, fontWeight: "700", fontFamily: fontFamily.body },
});
