import { useFonts } from "expo-font";
import { Redirect, Slot, usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import fraunces from "../assets/fonts/Fraunces.ttf";
import inter from "../assets/fonts/Inter.ttf";
import { apiClient } from "../src/api/client";
import { colors, fontFamily, minTouchTarget, spacing } from "../src/design/tokens";
import { GENERIC_READ_ERROR_MESSAGE } from "../src/inventory/errors";
import { ToastHost, ToastProvider } from "../src/inventory/Toast";
import { TabBar } from "../src/navigation/TabBar";
import { GateCoveredContext } from "../src/onboarding/gate-context";
import {
  resolveLayoutRedirectForRead,
  resolveOnboardingRoute,
  type OnboardingStateRead,
} from "../src/onboarding/route";

// expo-router boots the splash screen and expects the app to signal it's
// ready; without a real splash-hide sequence configured (out of scope for a
// tab-shell ticket) the default hides automatically once the root renders.
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: fraunces,
    Inter: inter,
  });
  const pathname = usePathname();
  const router = useRouter();
  const [read, setRead] = useState<OnboardingStateRead | null>(null);
  /**
   * BUG-001: whether `<Slot />` (expo-router's root navigator) has mounted
   * yet. Before its first mount this layout may render nothing, the
   * fallback alone, or `<Redirect>` (nothing to lose, nothing can loop);
   * from its first mount on it never unmounts it, and covers instead.
   * Only ever goes from false to true.
   */
  const [navigatorMounted, setNavigatorMounted] = useState(false);
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
    // stale read (it shows the destination for that one frame when the
    // stale route was already "home", and holds otherwise; see the
    // function's own doc comment for the exact bug this closes, and the
    // pending-window note below). The fixture client's promises resolve
    // within a microtask, so that frame is not visibly perceptible in
    // practice. A *rejected* read is different (M3-T4d review F2): it must
    // never be treated as "render the destination for one frame", because
    // there is no fresh read on the way to correct it; see the render logic
    // below, which checks `readErrorPathname` before it ever looks at
    // `read`.
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

  // M3-T4d review F2: fail CLOSED. A rejected read for the *current*
  // pathname always blocks: cold start (no household ever read yet) and a
  // later navigation's re-read both take this branch identically, and a
  // stale `read` from an earlier, different pathname is never consulted
  // here, so a deep link straight at /inventory or /add can never ride a
  // stale success past a fresh failure on its own read.
  const readFailed = readErrorPathname === pathname;

  // M3-T4d review round 2, F2: the pending window. Nothing is decided until
  // a read has landed at all (cold start), and `read` can be non-null but
  // *stale* (tagged for an earlier pathname) while this pathname's own
  // fresh read is still in flight. That is exactly the M3-T2 review F18
  // case, whose fix is to never compute a redirect from stale data
  // (`resolveLayoutRedirectForRead` returns `null` on a pathname mismatch).
  // F18's own scenario is safe to show: the stale route was already
  // "home", so showing the destination while a fresh confirmation is in
  // flight risks nothing. But when the stale route was NOT "home" (it
  // called for S1/S2) and the current pathname is not already under
  // "/onboarding", showing the destination would expose real content for
  // as long as the fresh read takes, unbounded over a real network,
  // exactly the bypass F2 closes for a *rejected* read; a *pending* read is
  // the same bypass, just not failed yet. Hold until the fresh read for
  // this pathname lands (render nothing before the navigator's first
  // mount, cover after it; see below): a hold never redirects either, so
  // F18's fix still holds too.
  const pendingHold =
    !readFailed &&
    (read === null ||
      (read.pathname !== pathname &&
        !pathname.startsWith("/onboarding") &&
        resolveOnboardingRoute(read.state) !== "home"));

  // M3-T2 review F2: this is the ONE gate every route in the app goes
  // through, not just "/": app.json declares scheme "smartkitchen" and
  // enables web, so /inventory, /menu, /shopping and /add are all directly
  // reachable by deep link without ever rendering index.tsx. Computing this
  // here, once, means no individual screen can forget to re-derive it.
  const redirectTo = readFailed ? null : resolveLayoutRedirectForRead(read, pathname);

  const fontsReady = fontsLoaded || Boolean(fontError);
  // Everything that is not "show the current screen": a failed read, the
  // pending-window hold, a redirect about to be issued.
  const covered = readFailed || pendingHold || redirectTo !== null;
  // Before the first mount `<Slot />` renders only for an uncovered screen;
  // after it, always.
  const rendersNavigator = fontsReady && (navigatorMounted || !covered);
  useLayoutEffect(() => {
    if (rendersNavigator && !navigatorMounted) {
      setNavigatorMounted(true);
    }
  }, [rendersNavigator, navigatorMounted]);

  // BUG-001: once the navigator has mounted, a redirect is issued
  // imperatively, once per (pathname, target), never by rendering
  // `<Redirect>` in place of `<Slot />`. Before that, the `<Redirect>`
  // rendered below issues it. Either way it is only ever computed from a
  // read tagged for the current pathname (F18), so a stale read never
  // redirects. `router` is deliberately not a dependency (same convention
  // as allergies.tsx): its object identity is not a signal, and re-running
  // on it could replace twice for one decision.
  useEffect(() => {
    if (navigatorMounted && redirectTo !== null) {
      router.replace(redirectTo);
    }
  }, [navigatorMounted, redirectTo, pathname]);

  if (!fontsReady) {
    return null;
  }

  const fallback = (
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
  );

  // Cold start, before the navigator's first mount (BUG-001 review F2a):
  // 74371f1's mechanism, unchanged. Nothing is mounted under a gate that
  // has not decided yet, so no screen's mount effects (S7's camera, any
  // read) run before it does, and with no navigator mounted there is
  // nothing whose unmount could loop.
  if (!navigatorMounted && covered) {
    if (readFailed) {
      return <SafeAreaProvider>{fallback}</SafeAreaProvider>;
    }
    if (redirectTo !== null) {
      return (
        <SafeAreaProvider>
          <View style={styles.app}>
            <Redirect href={redirectTo} />
          </View>
        </SafeAreaProvider>
      );
    }
    return null;
  }

  // BUG-001: from the navigator's first mount on, everything that is not
  // "show the current screen" COVERS it instead of unmounting it.
  // `<Slot />` is expo-router's navigator; unmounting it mid-navigation
  // throws its state away, the router store falls back to another route,
  // this layout re-renders with that pathname and mounts the navigator
  // again, which restores the URL's pathname, which unmounts it again:
  // synchronously, inside layout effects, until React stops it with
  // "Maximum update depth exceeded" (S2's Continue to "/" while the
  // S2-routed read was still stale was the repro). So `<Slot />` stays
  // mounted at the same tree position from then on, and a covered screen
  // is not visible (an opaque full-screen cover on top), not tappable
  // (`pointerEvents: "none"` on its subtree, and the cover absorbs
  // touches), not reachable by keyboard on web (`inert`; review F1:
  // `pointerEvents` and `aria-hidden` do not stop Tab focus, and a hidden
  // form could be filled and submitted), and not announced (hidden from
  // accessibility on every platform). Screens with side effects outside
  // the app read `GateCoveredContext` and hold them while covered (S7).
  //
  // S1/S2 (M3-T2) and S6-S9 (M3-T4b, the FAB's Add-food flow: hub, camera
  // scan, scan confirm, manual add) are full-screen, matching prototype v4:
  // no bottom tab bar during onboarding or Add (or while covered): the
  // prototype's own `#scr-add`/`#scr-scan`/`#scr-manual` never render
  // `.nav`, unlike the four tab screens.
  const hideTabBar = covered || pathname.startsWith("/onboarding") || pathname.startsWith("/add");
  // `inert` is a DOM attribute react-native-web 0.21 forwards on View;
  // native gets no unknown prop.
  const inertWhenCovered = Platform.OS === "web" ? { inert: covered } : {};

  return (
    <SafeAreaProvider>
      {/* One host for the whole app (BACKLOG.md M3-T4a Objective (f)): a
          removal's "Undo" toast must survive the S5 to S4 navigation the
          removal itself triggers, which a per-screen toast cannot do (it
          unmounts with the screen). ToastHost is a sibling of <Slot />, not
          inside it, so a route change never remounts it. It is not shown
          while the gate covers the app; its state lives in ToastProvider,
          so a toast in flight comes back once the cover lifts. */}
      <ToastProvider>
        <View style={styles.app}>
          <View
            style={[styles.app, { pointerEvents: covered ? "none" : "auto" }]}
            aria-hidden={covered}
            accessibilityElementsHidden={covered}
            importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
            {...inertWhenCovered}
          >
            <GateCoveredContext.Provider value={covered}>
              <Slot />
            </GateCoveredContext.Provider>
            {hideTabBar ? null : <TabBar />}
          </View>
          {covered ? (
            <View testID="root-gate-cover" style={styles.cover} accessibilityViewIsModal>
              {readFailed ? fallback : null}
            </View>
          ) : null}
        </View>
        {covered ? null : <ToastHost />}
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.sand },
  // Opaque and full-screen: nothing of the covered screen shows through.
  // Spelled out rather than `StyleSheet.absoluteFill` so the vitest
  // react-native stand-in needs no new export.
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.sand,
  },
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
