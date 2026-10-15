import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  UNIT_KINDS_DTO,
  UNITS_BY_KIND_DTO,
  type StorageLocationDto,
  type UnitKindDto,
} from "@smart-kitchen/contracts";
import { apiClient } from "../../src/api/client";
import { nextIdempotencyKey } from "../../src/api/idempotency";
import { chipHitSlop, provChipStyle } from "../../src/design/chips";
import {
  colors,
  fontFamily,
  minTouchTarget,
  radius,
  spacing,
  typeScale,
} from "../../src/design/tokens";
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

/** `location` narrowed to one of S9's own pickable locations, or the default when unset/unrecognised. */
function prefillLocation(location: string | undefined): StorageLocationDto {
  return (MANUAL_LOCATIONS as readonly string[]).includes(location ?? "")
    ? (location as StorageLocationDto)
    : "FRIDGE";
}

/** The `UnitKindDto` that lists `unit`, or `null` if none does (an unrecognised/omitted prefill). */
function unitKindForUnit(unit: string | undefined): UnitKindDto | null {
  if (!unit) {
    return null;
  }
  for (const kind of UNIT_KINDS_DTO) {
    if (UNITS_BY_KIND_DTO[kind].includes(unit)) {
      return kind;
    }
  }
  return null;
}

/**
 * A prefilled whole-unit count from S11's close-the-loop Add (M3-T5
 * Objective (d); tightened at review round 1, F9). S9's stepper is
 * whole-unit-only regardless of source (review F17: it floors at zero,
 * never offers a fraction), so a fractional gap (e.g. 0.5 lb) cannot be
 * represented at all: this leaves the stepper at S9's own default of 1
 * rather than silently rounding it, which is exactly the client-side
 * quantity change CLAUDE.md rules 6/7 forbid (a 1.5 lb gap silently
 * becoming "1" would look like a legitimate whole-number prefill, not a
 * lossy one, if this parsed with `Number.parseInt`/`Math.floor` — both
 * truncate a fraction into a same-shaped integer instead of rejecting it).
 * `amount` must therefore already be the caller's *exact* decimal text
 * (never re-derived or rounded before reaching here — see
 * `app/shopping.tsx`'s own doc comment on how it builds this string), and
 * this function only ever *recognises* a whole value, never rounds one:
 * `/^\d+$/` matches a bare non-negative integer string and nothing else,
 * so "1.5", "1.0" and "-1" all correctly fall through to the default.
 */
function prefillCount(amount: string | undefined): number {
  if (!amount || !/^\d+$/.test(amount)) {
    return 1;
  }
  // Small enough (a shopping-list quantity) to safely fit `Number` here —
  // this is only ever a UI stepper's *initial* value, never a quantity
  // written to the ledger (S9's own save still goes through
  // `wholeUnitQuantityMicros` -> `BigInt` for the actual write).
  const parsed = Number.parseInt(amount, 10);
  return parsed > 0 ? parsed : 1;
}

/**
 * S9 · Manual add (M3-T4b), prototype v4 `#scr-manual`. Manual entries are
 * Known Fact for identity and quantity, per objective (d); no confirmation
 * step, no allergen row (that data does not exist for a hand-typed item).
 *
 * **M3-T5 addition:** `name`/`amount`/`unit`/`location` search params
 * prefill the form (never auto-save it) for S11's close-the-loop Add on a
 * gap row with no `itemId` yet (Objective (d): "opens S9 manual add
 * prefilled ... S9's existing save creates the item" — no new form, no
 * change to what happens on Save).
 */
export default function ManualAddScreen(): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { show } = useToast();
  const params = useLocalSearchParams<{
    code?: string;
    name?: string;
    amount?: string;
    unit?: string;
    location?: string;
  }>();
  const retainedCode = params.code;
  const prefillKind = unitKindForUnit(params.unit) ?? "MASS";

  const [name, setName] = useState(params.name ?? "");
  const [unitKind, setUnitKind] = useState<UnitKindDto>(prefillKind);
  const [unit, setUnit] = useState(
    params.unit && UNITS_BY_KIND_DTO[prefillKind].includes(params.unit)
      ? params.unit
      : UNITS_BY_KIND_DTO[prefillKind][0]!,
  );
  const [count, setCount] = useState(() => prefillCount(params.amount));
  const [location, setLocation] = useState<StorageLocationDto>(() =>
    prefillLocation(params.location),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * Review F3: `createItem`'s idempotency key, held across retaps of Save
   * until either a save succeeds or an input actually changes. Ref, not
   * state: `handleSave` reads and mints it synchronously (see
   * `saveInFlight` below for why state cannot gate this), and a `null`
   * value means "mint fresh" (first tap, or any tap after an input
   * changed the payload this key would otherwise have been reused for).
   */
  const heldIdempotencyKey = useRef<string | null>(null);
  /**
   * Review F3/F11: a synchronous single-flight guard, same reasoning as
   * `app/onboarding/account.tsx`'s `requestInFlight` — two Save taps
   * dispatched in the same frame both read `saving` (React state) as
   * `false` before either commit lands, so state alone cannot stop a
   * second `createItem` call. `createItem` *is* idempotency-key-protected
   * server-side (unlike account.tsx's household calls), so a genuine
   * double-send would still resolve to one item, not a duplicate — but it
   * would still be a second wasted request, and the point of holding one
   * key across retaps (above) is exactly to make retries safe, not to
   * lean on the network sending two of them.
   */
  const saveInFlight = useRef(false);

  /** Any real change to what Save would send discards a held key (review F3): a reused key needs the same body. */
  function forgetHeldKey(): void {
    heldIdempotencyKey.current = null;
  }

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
    forgetHeldKey();
  }

  // Review F17: zero is not a quantity worth recording (S8's stepper floors
  // at 1 packages for the same reason; S9's floors at 0 only so a typo can
  // be corrected back up, never so a zero-amount item can be saved).
  const canSave = count > 0;

  async function handleSave(): Promise<void> {
    if (!canSave || saveInFlight.current) {
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setNameError("Name this item before adding it.");
      return;
    }
    setNameError(null);
    setAddError(null);
    saveInFlight.current = true;
    setSaving(true);
    try {
      // Review F3: reuse the key held from an earlier failed attempt on
      // this exact payload; mint one only when none is held (first tap, or
      // the first tap since an input last changed it away).
      const idempotencyKey = heldIdempotencyKey.current ?? nextIdempotencyKey();
      heldIdempotencyKey.current = idempotencyKey;
      const amountMicros = wholeUnitQuantityMicros(count);
      const summary = await apiClient.createItem({
        idempotencyKey,
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
      heldIdempotencyKey.current = null; // done: a later Save (a new item) starts fresh
      recordRecentlyAdded(summary);
      show(`Added ${trimmedName} · ${count} ${unit} to ${LOCATION_LABELS[location]} · Known Fact`);
      router.replace("/inventory");
    } catch (error) {
      // The key stays held (not cleared): a retap with the same,
      // unchanged inputs must replay under the same key, never mint a new
      // one (invariant: a 409 is never retried with a new key, and more
      // generally a retry is the same user action, not a new one).
      setAddError(messageForLedgerError(error));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
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
            <Text
              style={provChipStyle("KNOWN_FACT")}
              accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}
            >
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
              forgetHeldKey();
            }}
            style={styles.textInput}
          />
          {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
        </View>

        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Amount</Text>
            <Text
              style={provChipStyle("KNOWN_FACT")}
              accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}
            >
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
                hitSlop={chipHitSlop}
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
                onPress={() => {
                  setCount((prev) => Math.max(0, prev - 1));
                  forgetHeldKey();
                }}
                style={styles.stepButton}
              >
                <Text style={styles.stepButtonText}>{"−"}</Text>
              </Pressable>
              <Text style={styles.stepValue}>{count}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                onPress={() => {
                  setCount((prev) => prev + 1);
                  forgetHeldKey();
                }}
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
                  onPress={() => {
                    setUnit(u);
                    forgetHeldKey();
                  }}
                  hitSlop={chipHitSlop}
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
            <Text
              style={provChipStyle("KNOWN_FACT")}
              accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}
            >
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
                onPress={() => {
                  setLocation(loc);
                  forgetHeldKey();
                }}
                hitSlop={chipHitSlop}
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
          accessibilityState={{ disabled: !canSave || saving }}
          disabled={!canSave || saving}
          onPress={() => void handleSave()}
          style={[styles.primaryButton, canSave && !saving ? null : styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>Add to inventory</Text>
        </Pressable>
      </View>
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
  headerTitle: {
    paddingTop: 2,
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
    letterSpacing: typeScale.title.letterSpacing,
    fontFamily: typeScale.title.fontFamily,
    fontWeight: typeScale.title.fontWeight,
    color: colors.ink,
  },
  content: { paddingHorizontal: spacing.gutter, paddingBottom: spacing.xxl },
  // v6 `.codenote`: a square tile panel, 13 / 1.5 in ink2.
  codeNote: {
    marginTop: spacing.cozy,
    backgroundColor: colors.tile,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.cozy,
  },
  codeNoteText: { fontSize: 13, color: colors.ink2, lineHeight: 20, fontFamily: fontFamily.body },
  // v6 `.field` and `.fl`: 22px above, a 12 / 700 uppercase label in ink2.
  field: { marginTop: 22 },
  fieldHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: {
    fontSize: typeScale.chip.fontSize,
    lineHeight: typeScale.chip.lineHeight,
    fontWeight: "700",
    letterSpacing: 12 * 0.12,
    textTransform: "uppercase",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  // v6 `.inp`: no box, a 1.5px ink rule underneath, 16 / 500.
  textInput: {
    height: 50,
    marginTop: spacing.sm,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ink,
    paddingHorizontal: 2,
    fontSize: 16,
    fontWeight: "500",
    fontFamily: fontFamily.body,
    color: colors.ink,
  },
  errorText: {
    marginTop: spacing.xs,
    fontSize: 12.5,
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.chip`: a 1.5px ink outline pill, 40px (hit slop to 44); selected is ink.
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  chip: {
    minHeight: 40,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.white },
  amountRow: { gap: spacing.xs, marginTop: spacing.md },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.cozy },
  // v6 `.step button`: 44px circle, 1.5px ink border, 20 / 600 glyph.
  stepButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.step b`: Bodoni 26.
  stepValue: {
    minWidth: 22,
    textAlign: "center",
    fontSize: typeScale.stepper.fontSize,
    lineHeight: typeScale.stepper.lineHeight,
    fontFamily: typeScale.stepper.fontFamily,
    fontWeight: typeScale.stepper.fontWeight,
    color: colors.ink,
  },
  locsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  locChip: {
    minHeight: 40,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  locChipOn: { backgroundColor: colors.ink },
  locChipText: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  locChipTextOn: { color: colors.white },
  // v6 `.offbar`: tile panel with a 1px ink2 border.
  noticeBox: {
    marginTop: spacing.cozy,
    borderWidth: 1,
    borderColor: colors.ink2,
    backgroundColor: colors.tile,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.cozy,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.btn.pri.wide`: ink pill, 52px.
  primaryButton: {
    minHeight: 52,
    marginTop: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: { backgroundColor: colors.ink3, borderColor: colors.ink3 },
  primaryButtonText: {
    color: colors.white,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
