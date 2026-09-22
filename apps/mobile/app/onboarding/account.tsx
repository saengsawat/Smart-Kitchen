import { useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { apiClient } from "../../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import { validateHouseholdName } from "../../src/onboarding/validation";

/**
 * S1 · account + household (M3-T2). Copy is prototype v4's `#scr-account`
 * word for word (docs/design/mockups/smart-kitchen-prototype.html lines
 * 958-977), plus new copy this ticket requires beyond the prototype's binding
 * behaviour (household-name validation messages, the Google phase label/
 * explanation) — both proposed for copy-deck.md §11 in the worker report.
 */
export default function AccountScreen(): React.JSX.Element {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [googleExplained, setGoogleExplained] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const [householdNameError, setHouseholdNameError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    }
  }

  async function handleContinueWithEmail(): Promise<void> {
    await apiClient.signInWithEmail();
    setSignedIn(true);
  }

  function handleContinueWithGoogle(): void {
    setGoogleExplained(true);
  }

  async function handleCreateHousehold(): Promise<void> {
    const validated = validateHouseholdName(householdName);
    if (!validated.ok) {
      setHouseholdNameError(validated.message);
      // review F20: accessibilityLiveRegion alone is Android-only; also
      // announce for iOS VoiceOver, same as the S2 gate message (F6).
      AccessibilityInfo.announceForAccessibility(validated.message);
      return;
    }
    setHouseholdNameError(null);
    await apiClient.createHousehold(validated.name);
    router.push("/onboarding/allergies");
  }

  async function handleJoinHousehold(): Promise<void> {
    setJoinBusy(true);
    try {
      const result = await apiClient.joinHousehold(joinCode);
      if (!result.ok) {
        setJoinError(result.message);
        // review F20: same cross-platform announcement as the household-name error above.
        AccessibilityInfo.announceForAccessibility(result.message);
        return;
      }
      setJoinError(null);
      router.push("/onboarding/allergies");
    } finally {
      setJoinBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={handleBack}
          style={styles.iconButton}
        >
          <Text style={styles.iconGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Welcome</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          Sign in to start your kitchen. This mockup skips real authentication.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with email"
          onPress={() => void handleContinueWithEmail()}
          style={[styles.button, styles.buttonDark]}
        >
          <Text style={styles.buttonTextOnDark}>Continue with email</Text>
        </Pressable>
        {signedIn ? <Text style={styles.confirmation}>Signed in as Dean Chen.</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          onPress={handleContinueWithGoogle}
          style={[styles.button, styles.buttonSecondary]}
        >
          <Text style={styles.buttonTextOnLight}>Continue with Google</Text>
        </Pressable>
        <Text style={styles.phaseLabel}>Arrives with the auth vendor.</Text>
        {googleExplained ? (
          <Text style={styles.explanation}>
            Not built yet. It arrives once we pick the auth vendor. Continue with email for now.
          </Text>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your household</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Create a new household</Text>
          <TextInput
            accessibilityLabel="Household name"
            placeholder="Household name, for example The Chens"
            placeholderTextColor={colors.ink3}
            value={householdName}
            onChangeText={setHouseholdName}
            style={styles.input}
            maxLength={200}
          />
          {householdNameError ? (
            <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
              <Text style={styles.noticeIcon}>{"⚠"}</Text>
              <Text style={styles.noticeText}>{householdNameError}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create household"
            onPress={() => void handleCreateHousehold()}
            style={[styles.button, styles.buttonPrimary]}
          >
            <Text style={styles.buttonTextOnDark}>Create household</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Join with a code</Text>
          <TextInput
            accessibilityLabel="Join code"
            placeholder="Join code, for example CHEN-482"
            placeholderTextColor={colors.ink3}
            value={joinCode}
            onChangeText={setJoinCode}
            style={styles.input}
            autoCapitalize="characters"
            maxLength={40}
          />
          {joinError ? (
            <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
              <Text style={styles.noticeIcon}>{"⚠"}</Text>
              <Text style={styles.noticeText}>{joinError}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join household"
            onPress={() => void handleJoinHousehold()}
            disabled={joinBusy}
            style={[styles.button, styles.buttonSecondary]}
          >
            <Text style={styles.buttonTextOnLight}>Join household</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sand },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 22, color: colors.ink, lineHeight: 22 },
  title: { fontSize: 24, fontFamily: fontFamily.display, fontWeight: "600", color: colors.ink },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.md,
  },
  body: { fontSize: 13, lineHeight: 19.5, color: colors.ink2, fontFamily: fontFamily.body },
  button: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonDark: { backgroundColor: colors.espresso },
  buttonSecondary: { backgroundColor: colors.sand2 },
  buttonPrimary: { backgroundColor: colors.brandDeep },
  buttonTextOnDark: { color: colors.cream, fontSize: 15, fontWeight: "700" },
  buttonTextOnLight: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  confirmation: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  phaseLabel: { fontSize: 11.5, color: colors.ink3, fontFamily: fontFamily.body },
  explanation: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  sectionHeader: { paddingTop: spacing.md },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  // review F10: dropped from ink to ink2 so it reads distinctly from the
  // (ink, boxed) error notice below it.
  cardLabel: { fontSize: 13, fontWeight: "700", color: colors.ink2, fontFamily: fontFamily.body },
  input: {
    height: minTouchTarget,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    fontFamily: fontFamily.body,
    backgroundColor: colors.paper,
    color: colors.ink,
  },
  // No danger/rose here (tokens.md §4: danger is allergen-exclusive, rose is
  // expiry/urgency-exclusive; a form validation message is neither). Non-colour
  // affordance (review F10, consistent with allergies.tsx's F6 notice): an
  // icon plus a sand2-bordered container, not colour alone, so it reads
  // distinctly from a plain label rather than by colour.
  noticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.sand2,
    padding: spacing.sm,
  },
  noticeIcon: { fontSize: 14, color: colors.ink },
  noticeText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
});
