import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { apiClient } from "../../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import { GENERIC_READ_ERROR_MESSAGE } from "../../src/inventory/errors";
import {
  ALLERGY_GATE_MESSAGE,
  ALLERGY_SAVE_ERROR_MESSAGE,
  addCustomAllergen,
  draftFromMember,
  isGateSatisfied,
  setSeverity,
  toRestrictionDtos,
  toggleMajorAllergen,
  toggleNone,
  type MemberAllergyDraft,
} from "../../src/onboarding/allergyGate";
import { MemberAllergySection } from "../../src/onboarding/MemberAllergySection";
import { togglePreference } from "../../src/onboarding/validation";

const PREFERENCE_OPTIONS = ["Vegetarian", "High protein", "Kid-friendly"] as const;

/**
 * S2 · allergies + preferences (M3-T2). Copy is prototype v4's `#scr-allergies`
 * word for word (docs/design/mockups/smart-kitchen-prototype.html lines
 * 980-1014), generalised from the prototype's single-member template to every
 * household member (BACKLOG.md M3-T2 Objective (b): "per member of the
 * household ... owner enters for everyone", OQ-D5 default). All gating logic
 * lives in `src/onboarding/allergyGate.ts`; this component only dispatches to
 * it and renders its result (rule 21: components stay thin).
 *
 * Preferences are rendered once per screen, not once per member: the
 * prototype only ever shows one shared preferences block, and
 * BACKLOG.md M3-T2 does not ask for a second per-member preferences UI. On
 * Continue the same selection is saved for every member via the per-member
 * `savePreferences` port call. Flagged in the worker report as a judgment
 * call for the architect/PO to confirm or split out.
 */
export default function AllergiesScreen(): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drafts, setDrafts] = useState<readonly MemberAllergyDraft[] | null>(null);
  const [preferences, setPreferences] = useState<readonly string[]>([]);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showGateMessage, setShowGateMessage] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  /** M3-T4d review F2: S2's own read gets the same fail-closed handling as `app/_layout.tsx`'s. */
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    let cancelled = false;
    void apiClient.getOnboardingState().then(
      (state) => {
        if (cancelled) {
          return;
        }
        if (!state.household) {
          // Deep link straight at S2 with no household yet: the gate has
          // nothing to attach to, so send them back to S1 rather than render
          // an empty member list (BACKLOG.md M3-T2 invariant: deep links
          // cannot bypass the gate).
          router.replace("/onboarding/account");
          return;
        }
        setDrafts(state.household.members.map(draftFromMember));
      },
      () => {
        // M3-T4d review F2: a rejected read must not spin the
        // ActivityIndicator forever — render the fallback with Try again
        // instead, same as `app/_layout.tsx`'s own read.
        if (!cancelled) {
          setLoadError(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // Loads once on mount (and again on "Try again"); the fixture client's
    // state does not change out from under this screen mid-session. `router`
    // is not a dependency (no `react-hooks` lint plugin is configured in
    // this app): expo-router's own object identity is not a signal this
    // callback needs to react to.
  }, []);

  useEffect(() => load(), [load]);

  function updateDraft(
    memberId: string,
    update: (draft: MemberAllergyDraft) => MemberAllergyDraft,
  ): void {
    setDrafts((prev) => prev?.map((d) => (d.memberId === memberId ? update(d) : d)) ?? prev);
  }

  async function runContinue(prefsToSave: readonly string[]): Promise<void> {
    if (!drafts || !isGateSatisfied(drafts)) {
      setShowGateMessage(true);
      // Cross-platform announcement (review F6): accessibilityLiveRegion alone
      // is Android-only; AccessibilityInfo.announceForAccessibility also
      // reaches iOS's VoiceOver for a message that renders in place rather
      // than navigating anywhere.
      AccessibilityInfo.announceForAccessibility(ALLERGY_GATE_MESSAGE);
      return;
    }
    setShowGateMessage(false);
    setSaveError(false);
    setSaving(true);
    try {
      await Promise.all(
        drafts.flatMap((d) => [
          apiClient.saveMemberRestrictions(d.memberId, toRestrictionDtos(d), {
            noneConfirmed: d.noneConfirmed,
          }),
          apiClient.savePreferences(d.memberId, prefsToSave),
        ]),
      );
      router.replace("/");
    } catch {
      setSaveError(true);
      AccessibilityInfo.announceForAccessibility(ALLERGY_SAVE_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  function handleContinue(): void {
    void runContinue(preferences);
  }

  function handleSkipPreferences(): void {
    setPreferences([]);
    void runContinue([]);
  }

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    }
  }

  if (loadError) {
    return (
      <View style={[styles.screen, styles.loadingScreen]}>
        <View style={styles.readErrorWrap} accessibilityLiveRegion="assertive">
          <Text style={styles.readErrorTitle}>Couldn&apos;t load your household.</Text>
          <Text style={styles.readErrorBody}>{GENERIC_READ_ERROR_MESSAGE}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={load}
            style={[styles.button, styles.buttonPrimary]}
          >
            <Text style={styles.buttonTextOnDark}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!drafts) {
    return (
      <View style={[styles.screen, styles.loadingScreen]}>
        <ActivityIndicator color={colors.ink2} accessibilityLabel="Loading" />
      </View>
    );
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
        <Text style={styles.title}>Allergies</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          Required for every member before recipes can be screened. We can only warn about what you
          tell us, so an honest &quot;none&quot; is as useful as a real allergy. Preferences below
          are optional.
        </Text>

        {drafts.map((draft) => (
          <MemberAllergySection
            key={draft.memberId}
            draft={draft}
            customInput={customInputs[draft.memberId] ?? ""}
            onToggleAllergen={(code, label) =>
              updateDraft(draft.memberId, (d) => toggleMajorAllergen(d, code, label))
            }
            onSetSeverity={(key, severity) =>
              updateDraft(draft.memberId, (d) => setSeverity(d, key, severity))
            }
            onToggleNone={() => updateDraft(draft.memberId, toggleNone)}
            onCustomInputChange={(value) =>
              setCustomInputs((prev) => ({ ...prev, [draft.memberId]: value }))
            }
            onAddCustom={() => {
              updateDraft(draft.memberId, (d) =>
                addCustomAllergen(d, customInputs[draft.memberId] ?? ""),
              );
              setCustomInputs((prev) => ({ ...prev, [draft.memberId]: "" }));
            }}
          />
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip preferences"
            hitSlop={15}
            onPress={handleSkipPreferences}
          >
            <Text style={styles.skipLink}>Skip preferences</Text>
          </Pressable>
        </View>
        <View style={styles.chipRow}>
          {PREFERENCE_OPTIONS.map((option) => {
            const selected = preferences.includes(option);
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option}${selected ? ", selected" : ""}`}
                hitSlop={6}
                onPress={() => setPreferences((prev) => togglePreference(prev, option))}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>

        {showGateMessage ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeIcon}>{"⚠"}</Text>
            <Text style={styles.noticeText}>{ALLERGY_GATE_MESSAGE}</Text>
          </View>
        ) : null}
        {saveError ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeIcon}>{"⚠"}</Text>
            <Text style={styles.noticeText}>{ALLERGY_SAVE_ERROR_MESSAGE}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue"
          disabled={saving}
          onPress={handleContinue}
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonTextOnDark}>Continue</Text>
        </Pressable>
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
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  body: { fontSize: 13, lineHeight: 19.5, color: colors.ink2, fontFamily: fontFamily.body },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  skipLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink2,
    textDecorationLine: "underline",
    fontFamily: fontFamily.body,
  },

  chip: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.espresso, borderColor: colors.espresso },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.cream },

  // No danger/rose here either (see account.tsx's note): this is a form
  // validation/save-failure notice, not an allergen verdict or an
  // expiry/urgency cue. Non-colour affordance per review F6/F10: an icon +
  // a sand2-bordered container, not colour alone.
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
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  loadingScreen: { alignItems: "center", justifyContent: "center" },
  readErrorWrap: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  readErrorTitle: {
    fontSize: 19,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
  },
  readErrorBody: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    textAlign: "center",
  },

  button: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.brandDeep },
  buttonTextOnDark: { color: colors.cream, fontSize: 15, fontWeight: "700" },
});
