import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MajorAllergenCodeDto } from "@smart-kitchen/contracts";
import { MAJOR_ALLERGEN_CODES_DTO, MAJOR_ALLERGEN_LABELS_DTO } from "@smart-kitchen/contracts";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../design/tokens";
import { firstName, type MemberAllergyDraft } from "./allergyGate";

/**
 * One member's allergy-editing block: the nine major-allergen chips, the
 * severity picker for whatever is selected, the custom-allergen entry, and
 * the explicit "No known allergies for {name}" option.
 *
 * Extracted from `app/onboarding/allergies.tsx` (M3-T2) so S12's per-member
 * edit (BACKLOG.md M3-T6 Objective (c): "tapping a row opens S2's components
 * for that member alone") reuses this exact component rather than a second
 * copy — S2 itself is unchanged, still rendering one of these per household
 * member; the only new thing this ticket adds is `showHeading`, so a screen
 * that already shows the member's name elsewhere (S12's row above the
 * expanded section) is not forced to repeat it.
 */
export function MemberAllergySection({
  draft,
  customInput,
  showHeading = true,
  onToggleAllergen,
  onSetSeverity,
  onToggleNone,
  onCustomInputChange,
  onAddCustom,
}: {
  draft: MemberAllergyDraft;
  customInput: string;
  /** Defaults `true` (S2's own usage, unchanged); `false` when the caller already shows the member's name (S12). */
  showHeading?: boolean;
  onToggleAllergen: (code: MajorAllergenCodeDto, label: string) => void;
  onSetSeverity: (key: string, severity: "standard" | "severe") => void;
  onToggleNone: () => void;
  onCustomInputChange: (value: string) => void;
  onAddCustom: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.memberSection}>
      {showHeading ? <Text style={styles.memberHeading}>{draft.displayName}</Text> : null}
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
          // BACKLOG.md M3-T6 Objective (f): the M3-T2 review's follow-up —
          // the keyboard's own "done"/"return" key now submits the entry,
          // matching the visible "Add" button rather than requiring a
          // second, separate tap.
          onSubmitEditing={onAddCustom}
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

/** Sentence-case a MAJOR label (review F5: only MAJOR labels are re-cased; USER_DEFINED renders as entered). */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const styles = StyleSheet.create({
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

  buttonTextOnLight: { color: colors.ink, fontSize: 15, fontWeight: "700" },
});
