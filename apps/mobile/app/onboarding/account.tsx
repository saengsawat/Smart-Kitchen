import { useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { apiClient, hasDevOfflineToggle } from "../../src/api/client";
import {
  colors,
  fontFamily,
  minTouchTarget,
  radius,
  spacing,
  typeScale,
} from "../../src/design/tokens";
import {
  GENERIC_READ_ERROR_MESSAGE,
  LedgerRefusedError,
  messageForLedgerError,
} from "../../src/inventory/errors";
import { validateHouseholdName } from "../../src/onboarding/validation";

/**
 * copy-deck.md §8's household-name refusal (added at M2-T3 acceptance):
 * the server's own 400 `BAD_REQUEST` for a name outside 1 to 60 characters.
 * Client-side `validateHouseholdName` already refuses this before a request
 * is ever sent, so reaching this is defence in depth (a server-side rule
 * the client's own check does not perfectly mirror, e.g. code-point
 * counting), not a path a person normally hits.
 */
const HOUSEHOLD_NAME_REFUSAL_MESSAGE = "Give the household a name of 1 to 60 characters.";

/**
 * S1 · account + household (M3-T2, extended M3-T4d). Copy is prototype v4's
 * `#scr-account` word for word (docs/design/mockups/smart-kitchen-prototype.html
 * lines 958-977), plus new copy this ticket requires beyond the prototype's
 * binding behaviour (household-name validation messages, the Google phase
 * label/explanation, the create-household failure notice and the one-time
 * join-code confirmation below) — all proposed for copy-deck.md §11 in the
 * worker report.
 *
 * M3-T4d mapping-forced change: `apiClient.createHousehold` can now
 * genuinely reject (a real network call, BACKLOG.md M3-T4d Objective (a)),
 * where the fixture path never did. Neither had anywhere to go without
 * touching this screen, so both are handled here rather than silently
 * dropped. Review F1 corrected this ticket's original premise: the fixture
 * path never showed a code after create (the prototype puts a household's
 * code on S12/profile, not S1), so the post-create interstitial below is
 * `HttpApiClient`-only — `created.joinCode` is `undefined` on the fixture
 * path (`FixtureApiClient.createHousehold`'s own doc comment), and this
 * screen goes straight to S2 exactly as it always did.
 */
export default function AccountScreen(): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [googleExplained, setGoogleExplained] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const [householdNameError, setHouseholdNameError] = useState<string | null>(null);
  const [householdBusy, setHouseholdBusy] = useState(false);
  const [createdJoinCode, setCreatedJoinCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  /**
   * Review round 1, F2: a fixed-token identity (fixture or HTTP alike) can
   * already belong to a household by the time "Continue with email" is
   * tapped again (HTTP: the same persona signed in before; reproduced live
   * as the same caller ending up with two server-side households and no
   * way back). A rejected check fails closed, same convention as every
   * other read in this app: shown, never silently treated as "no
   * household".
   */
  const [affiliationCheckError, setAffiliationCheckError] = useState(false);
  /**
   * Review F11/F4: a synchronous, `useRef`-backed single-flight guard.
   * `householdBusy`/`joinBusy` (React state) are not enough on their own —
   * two taps dispatched in the same frame both read the pre-update state
   * before either commit lands, so state alone cannot stop a second
   * `createHousehold`/`joinHousehold` call, and neither endpoint carries an
   * idempotency key (worker report §5.4), so a duplicate call is a
   * duplicate household or a second counted join attempt, not a safely
   * replayed one. One shared flag (not two) also closes F4's last bullet:
   * create and join can never be in flight together either.
   */
  const requestInFlight = useRef(false);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    }
  }

  /**
   * Review round 1, F2 ruling: after signing in, S1 reads
   * `getOnboardingState()` and routes an already-affiliated caller straight
   * to "/" instead of ever showing the create/join cards. Reuses
   * `requestInFlight` (already shared by create/join, F4/F11) so a
   * same-frame double tap cannot start this check twice, and so Create/Join
   * are refused for the moment this check is in flight too: showing either
   * card usable while "do you already have a household" is still an open
   * question is exactly the race this fixes.
   */
  async function handleContinueWithEmail(): Promise<void> {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    setAffiliationCheckError(false);
    try {
      await apiClient.signInWithEmail();
      const state = await apiClient.getOnboardingState();
      if (state.household) {
        router.replace("/");
        return;
      }
      setSignedIn(true);
    } catch {
      setAffiliationCheckError(true);
      AccessibilityInfo.announceForAccessibility(GENERIC_READ_ERROR_MESSAGE);
    } finally {
      requestInFlight.current = false;
    }
  }

  function handleContinueWithGoogle(): void {
    setGoogleExplained(true);
  }

  async function handleCreateHousehold(): Promise<void> {
    if (requestInFlight.current) {
      return;
    }
    const validated = validateHouseholdName(householdName);
    if (!validated.ok) {
      setHouseholdNameError(validated.message);
      // review F20: accessibilityLiveRegion alone is Android-only; also
      // announce for iOS VoiceOver, same as the S2 gate message (F6).
      AccessibilityInfo.announceForAccessibility(validated.message);
      return;
    }
    setHouseholdNameError(null);
    requestInFlight.current = true;
    setHouseholdBusy(true);
    try {
      const created = await apiClient.createHousehold(validated.name);
      if (created.joinCode) {
        // M3-T4d: the plaintext join code is on this response and nowhere
        // else (household.ts's header, rule 3), so it is shown once, here,
        // before moving on, rather than navigated past and lost.
        // HttpApiClient-only (review F1): FixtureApiClient never sets
        // `joinCode`, so this branch is simply never taken there.
        setCreatedJoinCode(created.joinCode);
        return;
      }
      router.push("/onboarding/allergies");
    } catch (error) {
      // Review F9: the server's exact household-name sentence when that is
      // what actually refused it (a coded 400 `BAD_REQUEST` with no
      // `ledgerCode` — `messageForLedgerError` has no case for that code and
      // would otherwise fall through to the unrelated ledger-save generic
      // fallback); every other failure keeps the existing generic mapping.
      const message =
        error instanceof LedgerRefusedError && error.code === "BAD_REQUEST"
          ? HOUSEHOLD_NAME_REFUSAL_MESSAGE
          : messageForLedgerError(error);
      setHouseholdNameError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      requestInFlight.current = false;
      setHouseholdBusy(false);
    }
  }

  function handleContinueAfterCreate(): void {
    router.push("/onboarding/allergies");
  }

  // Review F4's last bullet: create and join disable each other's card
  // while either is in flight, not just their own (the `requestInFlight`
  // ref above is the actual guard against a duplicate call; this is its
  // visible counterpart, so a second tap is never even offered).
  const anyBusy = householdBusy || joinBusy;

  async function handleJoinHousehold(): Promise<void> {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
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
      requestInFlight.current = false;
      setJoinBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
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
        {/*
         * BACKLOG.md M3-T6 Objective (e): the profile screen's "Sign out"
         * clears this device's local state, but the identity token itself is
         * fixed by env (D-022, no auth vendor yet) — signing back in lands
         * as the same fixture/env persona, not a different one. New copy
         * (proposed for copy-deck.md §11 in the worker report), placed here
         * rather than only on the profile screen so it is visible before
         * anyone signs in at all.
         */}
        <Text style={styles.phaseLabel}>
          Sign out (on the profile screen) is local only, until the auth vendor lands.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with email"
          onPress={() => void handleContinueWithEmail()}
          style={[styles.button, styles.buttonDark]}
        >
          <Text style={styles.buttonTextOnDark}>Continue with email</Text>
        </Pressable>
        {/* Review F5: fixture-path only — this app has one fixture identity
            per `EXPO_PUBLIC_IDENTITY_TOKEN` (Dean is only the default), and
            `signInWithEmail()` never actually changes which one is signed
            in, so this line must not claim "Dean Chen" while running as
            Noor Haddad or anyone else. `hasDevOfflineToggle` is the
            existing fixture-vs-HTTP feature check (`src/api/client.ts`):
            true only for `FixtureApiClient`. */}
        {signedIn && hasDevOfflineToggle(apiClient) ? (
          <Text style={styles.confirmation}>Signed in as Dean Chen.</Text>
        ) : null}
        {affiliationCheckError ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeIcon}>{"⚠"}</Text>
            <Text style={styles.noticeText}>{GENERIC_READ_ERROR_MESSAGE}</Text>
          </View>
        ) : null}

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
          {createdJoinCode ? (
            <>
              <View style={styles.noticeBox}>
                <Text style={styles.noticeIcon}>{"✓"}</Text>
                <Text style={styles.noticeText}>
                  {`Household created. Your join code: ${createdJoinCode}. Save it to invite others.`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue"
                onPress={handleContinueAfterCreate}
                style={[styles.button, styles.buttonPrimary]}
              >
                <Text style={styles.buttonTextOnDark}>Continue</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Household name"
                placeholder="Household name, for example The Chens"
                placeholderTextColor={colors.ink3}
                value={householdName}
                onChangeText={setHouseholdName}
                style={styles.input}
                maxLength={200}
                editable={!anyBusy}
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
                disabled={anyBusy}
                style={[styles.button, styles.buttonPrimary]}
              >
                <Text style={styles.buttonTextOnDark}>Create household</Text>
              </Pressable>
            </>
          )}
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
            editable={!anyBusy}
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
            disabled={anyBusy}
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
  screen: { flex: 1, backgroundColor: colors.paper },
  // v6 `.back` then `.title`: a borderless 44px back control, Bodoni 44 below.
  header: {
    alignItems: "flex-start",
    paddingHorizontal: spacing.gutter,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    marginLeft: -spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 30, lineHeight: 32, color: colors.ink, fontFamily: fontFamily.body },
  title: {
    paddingTop: 2,
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
    letterSpacing: typeScale.title.letterSpacing,
    fontFamily: typeScale.title.fontFamily,
    fontWeight: typeScale.title.fontWeight,
    color: colors.ink,
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.snug,
  },
  body: {
    paddingTop: 6,
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: "500",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  // v6 `.btn.wide`: pill, 1.5px ink border, 52px.
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonDark: { backgroundColor: colors.ink },
  buttonSecondary: { backgroundColor: "transparent" },
  buttonPrimary: { backgroundColor: colors.ink },
  buttonTextOnDark: {
    color: colors.white,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonTextOnLight: {
    color: colors.ink,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  confirmation: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  phaseLabel: { fontSize: 12.5, color: colors.ink3, fontFamily: fontFamily.body },
  explanation: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  // v6 `.sec`: Bodoni 25 over a 1px ink rule.
  sectionHeader: {
    marginTop: spacing.xs,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  sectionTitle: {
    fontSize: typeScale.section.fontSize,
    lineHeight: typeScale.section.lineHeight,
    fontFamily: typeScale.section.fontFamily,
    fontWeight: typeScale.section.fontWeight,
    color: colors.ink,
  },
  // v6 `.boxed`: a 1px ink box, square, 16px padding.
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.ink,
    gap: spacing.sm,
  },
  // v6 `.bh`: 15 / 700.
  cardLabel: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.inp`: no box, a 1.5px ink rule underneath, 16 / 500.
  input: {
    height: 50,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ink,
    paddingHorizontal: 2,
    fontSize: 16,
    fontWeight: "500",
    fontFamily: fontFamily.body,
    color: colors.ink,
  },
  // No danger/rose here (tokens.md §4: danger is allergen-exclusive, rose is
  // expiry/urgency-exclusive; a form validation message is neither). Non-colour
  // affordance (review F10, consistent with allergies.tsx's F6 notice): an
  // icon plus an ink2-bordered tile panel (v6 `.offbar`), not colour alone.
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.snug,
    borderWidth: 1,
    borderColor: colors.ink2,
    backgroundColor: colors.tile,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.cozy,
  },
  noticeIcon: { fontSize: 14, color: colors.ink },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
});
