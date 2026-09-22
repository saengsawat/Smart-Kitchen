import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { MajorAllergenCodeDto } from "@smart-kitchen/contracts";
import { MAJOR_ALLERGEN_CODES_DTO, MAJOR_ALLERGEN_LABELS_DTO } from "@smart-kitchen/contracts";
import { apiClient } from "../../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import {
  ALLERGY_GATE_MESSAGE,
  addCustomAllergen,
  draftFromMember,
  isGateSatisfied,
  setSeverity,
  toRestrictionDtos,
  toggleMajorAllergen,
  toggleNone,
  type MemberAllergyDraft,
} from "../../src/onboarding/allergyGate";
import { togglePreference } from "../../src/onboarding/validation";

const PREFERENCE_OPTIONS = ["Vegetarian", "High protein", "Kid-friendly"] as const;

const SAVE_ERROR_MESSAGE = "Couldn't save that. Try again.";

function firstName(displayName: string): string {
  return displayName.split(" ")[0] ?? displayName;
}

/** Sentence-case a MAJOR label (review F5: only MAJOR labels are re-cased; USER_DEFINED renders as entered). */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
  const router = useRouter();
  const [drafts, setDrafts] = useState<readonly MemberAllergyDraft[] | null>(null);
  const [preferences, setPreferences] = useState<readonly string[]>([]);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showGateMessage, setShowGateMessage] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiClient.getOnboardingState().then((state) => {
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
    });
    return () => {
      cancelled = true;
    };
    // Loads once on mount; the fixture client's state does not change out
    // from under this screen mid-session.
  }, []);

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
      AccessibilityInfo.announceForAccessibility(SAVE_ERROR_MESSAGE);
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

  if (!drafts) {
    return (
      <View style={[styles.screen, styles.loadingScreen]}>
        <ActivityIndicator color={colors.ink2} accessibilityLabel="Loading" />
      </View>
    );
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
            <Text style={styles.noticeText}>{SAVE_ERROR_MESSAGE}</Text>
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

function MemberAllergySection({
  draft,
  customInput,
  onToggleAllergen,
  onSetSeverity,
  onToggleNone,
  onCustomInputChange,
  onAddCustom,
}: {
  draft: MemberAllergyDraft;
  customInput: string;
  onToggleAllergen: (code: MajorAllergenCodeDto, label: string) => void;
  onSetSeverity: (key: string, severity: "standard" | "severe") => void;
  onToggleNone: () => void;
  onCustomInputChange: (value: string) => void;
  onAddCustom: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.memberSection}>
      <Text style={styles.memberHeading}>{draft.displayName}</Text>
      <View style={styles.chipRow}>
        {MAJOR_ALLERGEN_CODES_DTO.map((code) => {
          const label = MAJOR_ALLERGEN_LABELS_DTO[code];
          const selected = draft.selections.some((s) => s.kind === "MAJOR" && s.code === code);
          return (
            <Pressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
              hitSlop={4}
              onPress={() => onToggleAllergen(code, label)}
              style={[styles.allergenChip, selected && styles.allergenChipOn]}
            >
              <Text style={[styles.allergenChipText, selected && styles.allergenChipTextOn]}>
                {sentenceCase(label)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {draft.selections.length > 0 ? (
        <View style={styles.severityList}>
          {draft.selections.map((selection) => (
            <View key={selection.key} style={styles.severityRow}>
              <Text style={styles.severityLabel}>
                {selection.kind === "MAJOR" ? sentenceCase(selection.label) : selection.label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selection.severity === "standard" }}
                accessibilityLabel={`Standard severity for ${selection.label}`}
                onPress={() => onSetSeverity(selection.key, "standard")}
                style={[styles.sevButton, selection.severity === "standard" && styles.sevButtonOn]}
              >
                <Text
                  style={[
                    styles.sevButtonText,
                    selection.severity === "standard" && styles.sevButtonTextOn,
                  ]}
                >
                  Standard
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selection.severity === "severe" }}
                accessibilityLabel={`Severe severity for ${selection.label}`}
                onPress={() => onSetSeverity(selection.key, "severe")}
                style={[styles.sevButton, selection.severity === "severe" && styles.sevButtonOn]}
              >
                <Text
                  style={[
                    styles.sevButtonText,
                    selection.severity === "severe" && styles.sevButtonTextOn,
                  ]}
                >
                  {"⚠ Severe"}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.customRow}>
        <TextInput
          accessibilityLabel={`Add another allergen or ingredient for ${draft.displayName}`}
          placeholder="Add another allergen or ingredient"
          placeholderTextColor={colors.ink3}
          value={customInput}
          onChangeText={onCustomInputChange}
          style={styles.customInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add custom allergen for ${draft.displayName}`}
          onPress={onAddCustom}
          style={styles.addButton}
        >
          <Text style={styles.buttonTextOnLight}>Add</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: draft.noneConfirmed }}
        accessibilityLabel={`No known allergies for ${firstName(draft.displayName)}`}
        onPress={onToggleNone}
        style={[styles.noneOption, draft.noneConfirmed && styles.noneOptionOn]}
      >
        <Text style={[styles.noneOptionText, draft.noneConfirmed && styles.noneOptionTextOn]}>
          {`${draft.noneConfirmed ? "✓ " : ""}No known allergies for ${firstName(draft.displayName)}`}
        </Text>
      </Pressable>
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
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  body: { fontSize: 13, lineHeight: 19.5, color: colors.ink2, fontFamily: fontFamily.body },

  memberSection: { gap: spacing.sm, paddingTop: spacing.sm },
  memberHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.ink3,
    fontFamily: fontFamily.body,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  allergenChip: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  // Danger only here and on the Severe button (tokens.md §4: allergy-selection
  // controls are the one licensed use of --danger outside allergen verdicts).
  allergenChipOn: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  allergenChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  allergenChipTextOn: { color: colors.danger },

  severityList: { gap: 2 },
  severityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  severityLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  sevButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  sevButtonOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  sevButtonText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  sevButtonTextOn: { color: colors.white },

  customRow: { flexDirection: "row", gap: spacing.sm },
  customInput: {
    flex: 1,
    height: minTouchTarget,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    fontSize: 13.5,
    fontFamily: fontFamily.body,
    backgroundColor: colors.paper,
    color: colors.ink,
  },
  addButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    backgroundColor: colors.sand2,
    alignItems: "center",
    justifyContent: "center",
  },

  noneOption: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  // tokens.md §4 item 2 is an open PO decision between keeping this green
  // (a user declaration, distinct from a system verdict) or a neutral ink
  // checkmark; implemented per the D-023-signed-off prototype CSS
  // (`.noneopt.on` uses --green), the least-assumption choice pending a PO
  // ruling (worker report flags this for the reviewer).
  noneOptionOn: { borderColor: colors.green, backgroundColor: colors.greenBg },
  noneOptionText: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  noneOptionTextOn: { color: colors.green },

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

  button: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.brandDeep },
  buttonTextOnDark: { color: colors.cream, fontSize: 15, fontWeight: "700" },
  buttonTextOnLight: { color: colors.ink, fontSize: 15, fontWeight: "700" },
});
