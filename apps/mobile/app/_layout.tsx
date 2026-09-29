import { useFonts } from "expo-font";
import { Redirect, Slot, usePathname } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import fraunces from "../assets/fonts/Fraunces.ttf";
import inter from "../assets/fonts/Inter.ttf";
import { apiClient } from "../src/api/client";
import { colors, fontFamily, minTouchTarget, spacing } from "../src/design/tokens";
import { GENERIC_READ_ERROR_MESSAGE } from "../src/inventory/errors";
import { ToastHost, ToastProvider } from "../src/inventory/Toast";
import { TabBar } from "../src/navigation/TabBar";
import { resolveLayoutRedirectForRead, type OnboardingStateRead } from "../src/onboarding/route";

// expo-router boots the splash screen and expects the app to signal it's
// ready; without a real splash-hide sequence configured (out of scope for a
// tab-shell ticket) the default hides automatically once the root renders.
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: fraunces,
    Inter: inter,
  });
  const pathname = usePathname();
  const [read, setRead] = useState<OnboardingStateRead | null>(null);
  /**
   * M3-T4d review F2: the pathname a `getOnboardingState()` read most
   * recently *failed* for (network error, 401, 5xx, anything). Compared
   * against the *current* `pathname` below, never trusted on its own: a
   * failure recorded for a pathname the user has since navigated away from
   * must not keep blocking a different, unrelated screen forever.
   */
  const [readErrorPathname, setReadErrorPathname] = useState<string | null>(null);

  useEffect(() => {
    if (fontError) {
      // Fonts are vendored assets; a load failure here means a packaging
      // bug, worth surfacing during dev.
      console.error("Font load error", fontError);
    }
  }, [fontError]);

  const load = useCallback(() => {
    // A fresh attempt for this pathname always clears its own prior
    // failure first (shopping.tsx's `load()` does the same): "Try again"
    // must not keep showing the old fallback while a new read is in
    // flight, and a failure recorded for a *different*, earlier pathname
    // was already irrelevant to this one.
    setReadErrorPathname((prev) => (prev === pathname ? null : prev));
    let cancelled = false;
    // Re-reads on every pathname change, not just on mount: this layout
    // does not remount when S1 creates/joins a household or S2's Continue
    // calls router.replace("/"), so a mount-only read would keep serving a
    // stale OnboardingStateDto and could redirect a just-completed user
    // straight back to the screen they just finished.
    //
    // The read is tagged with the pathname it was fetched for (M3-T2 review
    // F18) precisely because this fetch is async: `resolveLayoutRedirectForRead`
    // (src/onboarding/route.ts) only computes a redirect once `read.pathname`
    // matches the *current* `pathname`, so the one render between a
    // navigation landing and this fetch resolving never redirects off a
    // stale read (it renders the destination screen for that one frame
    // instead — see the function's own doc comment for the exact bug this
    // closes). The fixture client's promises resolve within a microtask, so
    // that frame is not visibly perceptible in practice. A *rejected* read
    // is different (M3-T4d review F2): it must never be treated as "render
    // the destination for one frame", because there is no fresh read on the
    // way to correct it — see the render logic below, which checks
    // `readErrorPathname` before it ever looks at `read`.
    void apiClient.getOnboardingState().then(
      (state) => {
        if (!cancelled) {
          setRead({ pathname, state });
        }
      },
      () => {
        if (!cancelled) {
          setReadErrorPathname(pathname);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => load(), [load]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // M3-T4d review F2: fail CLOSED. A rejected read for the *current*
  // pathname always blocks — cold start (no household ever read yet) and a
  // later navigation's re-read both take this branch identically, and a
  // stale `read` from an earlier, different pathname is never consulted
  // here, so a deep link straight at /inventory or /add can never ride a
  // stale success past a fresh failure on its own read. Never renders
  // `<Slot />` or `<Redirect />` on this branch.
  if (readErrorPathname === pathname) {
    return (
      <SafeAreaProvider>
        <View style={styles.errorScreen} accessibilityLiveRegion="assertive">
          <Text style={styles.errorTitle}>Couldn&apos;t load your household.</Text>
          <Text style={styles.errorBody}>{GENERIC_READ_ERROR_MESSAGE}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={load}
            style={styles.errorButton}
          >
            <Text style={styles.errorButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!read) {
    return null;
  }

  // M3-T2 review F2: this is the ONE gate every route in the app goes
  // through, not just "/" — app.json declares scheme "smartkitchen" and
  // enables web, so /inventory, /menu, /shopping and /add are all directly
  // reachable by deep link without ever rendering index.tsx. Computing this
  // here, once, means no individual screen can forget to re-derive it.
  const redirectTo = resolveLayoutRedirectForRead(read, pathname);
  // S1/S2 (M3-T2) and S6-S9 (M3-T4b, the FAB's Add-food flow: hub, camera
  // scan, scan confirm, manual add) are full-screen, matching prototype v4:
  // no bottom tab bar during onboarding or Add (or while this frame is
  // about to redirect there) — the prototype's own `#scr-add`/`#scr-scan`/
  // `#scr-manual` never render `.nav`, unlike the four tab screens.
  const hideTabBar =
    pathname.startsWith("/onboarding") || pathname.startsWith("/add") || redirectTo !== null;

  return (
    <SafeAreaProvider>
      {/* One host for the whole app (BACKLOG.md M3-T4a Objective (f)): a
          removal's "Undo" toast must survive the S5 to S4 navigation the
          removal itself triggers, which a per-screen toast cannot do (it
          unmounts with the screen). ToastHost is a sibling of <Slot />, not
          inside it, so a route change never remounts it. */}
      <ToastProvider>
        <View style={{ flex: 1, backgroundColor: colors.sand }}>
          {redirectTo ? <Redirect href={redirectTo} /> : <Slot />}
          {hideTabBar ? null : <TabBar />}
        </View>
        <ToastHost />
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.sand,
  },
  errorTitle: {
    fontSize: 19,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
  },
  errorBody: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body, textAlign: "center" },
  errorButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  errorButtonText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
