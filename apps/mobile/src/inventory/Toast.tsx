import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../design/tokens";

/**
 * S4/S5's toast (prototype v4 `#toastEl`/`toast()`), e.g. copy-deck.md §5's
 * undo toast text "Corrected. Undo". Shown for a few seconds, announced to a
 * screen reader, optionally carrying one "Undo" action.
 *
 * **Global host (M3-T4a, BACKLOG.md Objective (f)).** A removal's toast must
 * offer "Undo" across the S5 to S4 navigation the removal itself triggers
 * (`router.back()`/`router.replace()` right after a successful removal), so
 * the toast can no longer live in per-screen state: a screen-local
 * `useState` unmounts with the screen. `ToastProvider` holds the one shared
 * toast; `useToast()` (a screen calls `show(...)`) and `ToastHost` (rendered
 * once, in `app/_layout.tsx`, alongside `<Slot />`) both read the same
 * context, so the banner keeps rendering — and its timer keeps running —
 * independent of which screen is mounted underneath it.
 */
export interface ToastState {
  readonly message: string;
  readonly onUndo?: () => void;
}

interface ToastContextValue {
  readonly toast: ToastState | null;
  readonly show: (message: string, onUndo?: () => void) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 3200;

/** Wrap the app once, in `app/_layout.tsx`, above both `<Slot />` and `<ToastHost />`. */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
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

  return <ToastContext.Provider value={{ toast, show }}>{children}</ToastContext.Provider>;
}

function useToastContext(caller: string): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(`${caller} must be rendered inside <ToastProvider> (app/_layout.tsx)`);
  }
  return ctx;
}

/** A screen's way to show a toast: `const { show } = useToast();`. */
export function useToast(): { show: (message: string, onUndo?: () => void) => void } {
  const { show } = useToastContext("useToast");
  return { show };
}

/** The one place the toast actually renders. Mount exactly once, in `app/_layout.tsx`. */
export function ToastHost(): React.JSX.Element | null {
  const { toast } = useToastContext("ToastHost");
  return <ToastBanner toast={toast} />;
}

function ToastBanner({ toast }: { toast: ToastState | null }): React.JSX.Element | null {
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
