import { useFonts } from "expo-font";
import { Redirect, Slot, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import fraunces from "../assets/fonts/Fraunces.ttf";
import inter from "../assets/fonts/Inter.ttf";
import { apiClient } from "../src/api/client";
import { colors } from "../src/design/tokens";
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

  useEffect(() => {
    if (fontError) {
      // Fonts are vendored assets; a load failure here means a packaging
      // bug, worth surfacing during dev.
      console.error("Font load error", fontError);
    }
  }, [fontError]);

  useEffect(() => {
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
    // that frame is not visibly perceptible in practice.
    let cancelled = false;
    void apiClient.getOnboardingState().then((state) => {
      if (!cancelled) {
        setRead({ pathname, state });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!fontsLoaded && !fontError) {
    return null;
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
  // S1/S2 (M3-T2) are full-screen, matching prototype v4: no bottom tab bar
  // during onboarding (or while this frame is about to redirect there),
  // same as the prototype's onboarding screens never show `.nav`.
  const hideTabBar = pathname.startsWith("/onboarding") || redirectTo !== null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.sand }}>
        {redirectTo ? <Redirect href={redirectTo} /> : <Slot />}
        {hideTabBar ? null : <TabBar />}
      </View>
    </SafeAreaProvider>
  );
}
