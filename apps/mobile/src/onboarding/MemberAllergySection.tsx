import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MajorAllergenCodeDto } from "@smart-kitchen/contracts";
import { MAJOR_ALLERGEN_CODES_DTO, MAJOR_ALLERGEN_LABELS_DTO } from "@smart-kitchen/contracts";
import { chipHitSlop } from "../design/chips";
import { colors, fontFamily, radius, spacing, typeScale } from "../design/tokens";
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
              hitSlop={chipHitSlop}
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
                hitSlop={chipHitSlop}
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
                hitSlop={chipHitSlop}
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
        style={styles.noneOption}
      >
        {/* v6 `.noneopt .box`: a 26px square, ink when confirmed (never green). */}
        <View style={[styles.noneBox, draft.noneConfirmed && styles.noneBoxOn]}>
          {draft.noneConfirmed ? <Text style={styles.noneTick}>{"✓"}</Text> : null}
        </View>
        <Text style={styles.noneOptionText}>
          {`No known allergies for ${firstName(draft.displayName)}`}
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
  memberSection: { gap: spacing.sm },
  // v6 `.grp` look for the member name: Bodoni 22 over an ink rule.
  memberHeading: {
    marginTop: spacing.xs,
    paddingBottom: 6,
    fontSize: typeScale.group.fontSize,
    lineHeight: typeScale.group.lineHeight,
    fontFamily: typeScale.group.fontFamily,
    fontWeight: typeScale.group.fontWeight,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  // v6 `.chip`: a 1.5px ink outline pill, 40px (hit slop to 44).
  allergenChip: {
    minHeight: 40,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  // D-033 amendment a: selected allergen chips are danger-bg with danger text
  // and border. Danger is licensed only here, on the Severe button and on
  // allergen verdicts (tokens.md section 6 item 1).
  allergenChipOn: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  allergenChipText: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  allergenChipTextOn: { color: colors.danger },

  severityList: {},
  // v6 `.sev`: label, then two 40px pills, a hairline above each row.
  severityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  severityLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  sevButton: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  // D-033 amendment a: a selected severity button is solid danger, white text.
  sevButtonOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  sevButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  sevButtonTextOn: { color: colors.white },

  // v6 `.addrow` and `.inp`: an underlined field and an outlined pill.
  customRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.snug,
    marginTop: spacing.xs,
  },
  customInput: {
    flex: 1,
    height: 50,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ink,
    paddingHorizontal: 2,
    fontSize: 16,
    fontWeight: "500",
    fontFamily: fontFamily.body,
    color: colors.ink,
  },
  addButton: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },

  // v6 `.noneopt`: a 26px box and a 14.5 / 600 label, 48px tall, no panel.
  noneOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    marginTop: spacing.sm,
  },
  noneBox: {
    width: 26,
    height: 26,
    borderWidth: 1.75,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  noneBoxOn: { backgroundColor: colors.ink },
  noneTick: { color: colors.white, fontSize: 14, fontWeight: "700", lineHeight: 16 },
  noneOptionText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },

  buttonTextOnLight: {
    color: colors.ink,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
