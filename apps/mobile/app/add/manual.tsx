import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  UNIT_KINDS_DTO,
  UNITS_BY_KIND_DTO,
  type StorageLocationDto,
  type UnitKindDto,
} from "@smart-kitchen/contracts";
import { apiClient } from "../../src/api/client";
import { nextIdempotencyKey } from "../../src/api/idempotency";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import { messageForLedgerError } from "../../src/inventory/errors";
import { LOCATION_LABELS } from "../../src/inventory/list-view";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../../src/inventory/provenance";
import { microsToAmountText } from "../../src/inventory/quantity";
import { useToast } from "../../src/inventory/Toast";
import { formatScannedCodeDisplay } from "../../src/scan/fixture-products";
import { wholeUnitQuantityMicros } from "../../src/scan/quantity";
import { recordRecentlyAdded } from "../../src/scan/recently-added";

const MANUAL_LOCATIONS: readonly StorageLocationDto[] = ["FRIDGE", "FREEZER", "PANTRY"];
const UNIT_KIND_LABELS: Readonly<Record<UnitKindDto, string>> = {
  MASS: "Mass",
  VOLUME: "Volume",
  COUNT: "Count",
};

/**
 * S9 · Manual add (M3-T4b), prototype v4 `#scr-manual`. Manual entries are
 * Known Fact for identity and quantity, per objective (d); no confirmation
 * step, no allergen row (that data does not exist for a hand-typed item).
 */
export default function ManualAddScreen(): React.JSX.Element {
  const router = useRouter();
  const { show } = useToast();
  const params = useLocalSearchParams<{ code?: string }>();
  const retainedCode = params.code;

  const [name, setName] = useState("");
  const [unitKind, setUnitKind] = useState<UnitKindDto>("MASS");
  const [unit, setUnit] = useState(UNITS_BY_KIND_DTO.MASS[0]!);
  const [count, setCount] = useState(1);
  const [location, setLocation] = useState<StorageLocationDto>("FRIDGE");
  const [nameError, setNameError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/add");
    }
  }

  function handlePickUnitKind(kind: UnitKindDto): void {
    setUnitKind(kind);
    setUnit(UNITS_BY_KIND_DTO[kind][0]!);
  }

  // Review F17: zero is not a quantity worth recording (S8's stepper floors
  // at 1 packages for the same reason; S9's floors at 0 only so a typo can
  // be corrected back up, never so a zero-amount item can be saved).
  const canSave = count > 0;

  async function handleSave(): Promise<void> {
    if (!canSave) {
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setNameError("Name this item before adding it.");
      return;
    }
    setNameError(null);
    setAddError(null);
    try {
      const amountMicros = wholeUnitQuantityMicros(count);
      const summary = await apiClient.createItem({
        idempotencyKey: nextIdempotencyKey(),
        source: "MANUAL",
        displayName: trimmedName,
        storageLocation: location,
        unit,
        amount: microsToAmountText(amountMicros),
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: "manual entry",
          confidence: null,
          recordedAt: null,
        },
      });
      recordRecentlyAdded(summary);
      show(`Added ${trimmedName} · ${count} ${unit} to ${LOCATION_LABELS[location]} · Known Fact`);
      router.replace("/inventory");
    } catch (error) {
      setAddError(messageForLedgerError(error));
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
          <Text style={styles.iconGlyph}>{"‹"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Add manually</Text>
      </View>
      <View style={styles.content}>
        {retainedCode ? (
          <View style={styles.codeNote}>
            <Text style={styles.codeNoteText}>
              Barcode {formatScannedCodeDisplay(retainedCode)} kept on file. If it is added to a
              data source later, we will offer to fill in these facts automatically.
            </Text>
          </View>
        ) : null}

        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}>
              {ROW_CHIP_TEXT.KNOWN_FACT}
            </Text>
          </View>
          <TextInput
            accessibilityLabel="Item name"
            placeholder="e.g. Trader Joe's frozen dumplings"
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (nameError) {
                setNameError(null);
              }
            }}
            style={styles.textInput}
          />
          {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
        </View>

        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Amount</Text>
            <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}>
              {ROW_CHIP_TEXT.KNOWN_FACT}
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {UNIT_KINDS_DTO.map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={UNIT_KIND_LABELS[kind]}
                accessibilityState={{ selected: unitKind === kind }}
                onPress={() => handlePickUnitKind(kind)}
                style={[styles.chip, unitKind === kind ? styles.chipOn : null]}
              >
                <Text style={[styles.chipText, unitKind === kind ? styles.chipTextOn : null]}>
                  {UNIT_KIND_LABELS[kind]}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.amountRow}>
            <View style={styles.step}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                onPress={() => setCount((prev) => Math.max(0, prev - 1))}
                style={styles.stepButton}
              >
                <Text style={styles.stepButtonText}>{"−"}</Text>
              </Pressable>
              <Text style={styles.stepValue}>{count}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                onPress={() => setCount((prev) => prev + 1)}
                style={styles.stepButton}
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
            <View style={styles.chipsRow}>
              {UNITS_BY_KIND_DTO[unitKind].map((u) => (
                <Pressable
                  key={u}
                  accessibilityRole="button"
                  accessibilityLabel={u}
                  accessibilityState={{ selected: unit === u }}
                  onPress={() => setUnit(u)}
                  style={[styles.chip, unit === u ? styles.chipOn : null]}
                >
                  <Text style={[styles.chipText, unit === u ? styles.chipTextOn : null]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Location</Text>
            <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}>
              {ROW_CHIP_TEXT.KNOWN_FACT}
            </Text>
          </View>
          <View style={styles.locsRow}>
            {MANUAL_LOCATIONS.map((loc) => (
              <Pressable
                key={loc}
                accessibilityRole="button"
                accessibilityLabel={LOCATION_LABELS[loc]}
                accessibilityState={{ selected: location === loc }}
                onPress={() => setLocation(loc)}
                style={[styles.locChip, location === loc ? styles.locChipOn : null]}
              >
                <Text style={[styles.locChipText, location === loc ? styles.locChipTextOn : null]}>
                  {LOCATION_LABELS[loc]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {addError ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeText}>{addError}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add to inventory"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={() => void handleSave()}
          style={[styles.primaryButton, canSave ? null : styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>Add to inventory</Text>
        </Pressable>
      </View>
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
  iconGlyph: { fontSize: 22, color: colors.ink },
  headerTitle: {
    fontSize: 20,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  codeNote: {
    backgroundColor: colors.sand2,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  codeNoteText: { fontSize: 12, color: colors.ink2, lineHeight: 17, fontFamily: fontFamily.body },
  field: { gap: spacing.sm },
  fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body, fontWeight: "600" },
  provChip: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.green,
    backgroundColor: colors.greenBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  textInput: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  errorText: { fontSize: 12, color: colors.danger, fontFamily: fontFamily.body },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
  chipText: { fontSize: 12.5, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.cream },
  amountRow: { gap: spacing.sm },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.sand2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: { fontSize: 20, color: colors.ink, fontFamily: fontFamily.body },
  stepValue: { fontSize: 20, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  locsRow: { flexDirection: "row", gap: spacing.sm },
  locChip: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  locChipOn: { backgroundColor: colors.espresso, borderColor: colors.espresso },
  locChipText: { fontSize: 13, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  locChipTextOn: { color: colors.cream },
  noticeBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.sand2,
    padding: spacing.sm,
  },
  noticeText: { fontSize: 12.5, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  primaryButton: {
    minHeight: minTouchTarget,
    borderRadius: 14,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: { backgroundColor: colors.line },
  primaryButtonText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
