import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import fraunces from "../assets/fonts/Fraunces.ttf";
import inter from "../assets/fonts/Inter.ttf";
import { TabBar } from "../src/navigation/TabBar";
import { colors } from "../src/design/tokens";

// expo-router boots the splash screen and expects the app to signal it's
// ready; without a real splash-hide sequence configured (out of scope for a
// tab-shell ticket) the default hides automatically once the root renders.
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: fraunces,
    Inter: inter,
  });

  useEffect(() => {
    if (fontError) {
      // Fonts are vendored assets; a load failure here means a packaging
      // bug, worth surfacing during dev.
      console.error("Font load error", fontError);
    }
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.sand }}>
        <Slot />
        <TabBar />
      </View>
    </SafeAreaProvider>
  );
}
