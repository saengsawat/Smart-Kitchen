import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import type {
  HouseholdDto,
  ProvenanceTierDto,
  ScannedProductDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import { SCANNABLE_BARCODE_TYPES_DTO } from "@smart-kitchen/contracts";
import { apiClient } from "../../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import { GENERIC_LEDGER_ERROR_MESSAGE, messageForLedgerError } from "../../src/inventory/errors";
import { LOCATION_LABELS } from "../../src/inventory/list-view";
import { useReducedMotion } from "../../src/inventory/motion";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../../src/inventory/provenance";
import { microsToAmountText, trimAmountText } from "../../src/inventory/quantity";
import { useToast } from "../../src/inventory/Toast";
import {
  addCtaIsBlocked,
  allowedLine,
  evidenceLine,
  evidenceTier,
  extraWarningLines,
  unknownLine,
  type MemberNameResolver,
} from "../../src/scan/allergen-copy";
import { formatScannedCodeDisplay } from "../../src/scan/fixture-products";
import { packageQuantityMicros } from "../../src/scan/quantity";
import { recordRecentlyAdded } from "../../src/scan/recently-added";
import { nextIdempotencyKey } from "../../src/api/idempotency";

const SCAN_LOCATIONS: readonly StorageLocationDto[] = ["FRIDGE", "FREEZER", "PANTRY"];

/**
 * Corpus package units this fixture's records use but this app's own
 * unit vocabulary spells differently ("ct" is the adapter/label spelling
 * of a plain count, matching `UNITS_BY_KIND_DTO.COUNT`'s "each"). Applied
 * only when building the `createItem` request — the record's own
 * `packageSize.value.unit` (as scanned/displayed) is never altered.
 */
const PACKAGE_UNIT_ALIASES: Readonly<Record<string, string>> = { ct: "each" };

function normalizePackageUnit(unit: string): string {
  return PACKAGE_UNIT_ALIASES[unit] ?? unit;
}

function isProvenanceTier(value: string): value is ProvenanceTierDto {
  return value === "KNOWN_FACT" || value === "ESTIMATED" || value === "AI_INTERPRETATION";
}

/** Builds a member-name resolver from the household DTO the app holds (review F11) — never a fixed name map, never the raw id. */
function resolverFromHousehold(household: HouseholdDto | null): MemberNameResolver {
  return (memberId) => household?.members.find((m) => m.memberId === memberId)?.displayName ?? "";
}

type ScanPhase =
  | { readonly kind: "camera" }
  | { readonly kind: "confirm"; readonly code: string; readonly product: ScannedProductDto }
  | { readonly kind: "miss"; readonly code: string };

/**
 * S7 · Barcode scan (camera) + S8 · Scan confirm sheet (M3-T4b), prototype
 * v4 `#scr-scan` (its `match-panel`/`miss-panel`/`permdenied` states share one
 * screen there too — this component follows the same shape rather than
 * splitting into two routes).
 */
export default function ScanScreen(): React.JSX.Element {
  const router = useRouter();
  const { show } = useToast();
  const reducedMotion = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<ScanPhase>({ kind: "camera" });
  const [typedCode, setTypedCode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [location, setLocation] = useState<StorageLocationDto>("FRIDGE");
  const [addError, setAddError] = useState<string | null>(null);
  const [requestedOnce, setRequestedOnce] = useState(false);
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  // Review R2: distinct from `household` itself being non-null — this is
  // what tells the confirm sheet "the fetch is still in flight" apart from
  // "the fetch resolved and there genuinely is no household" (the onboarding
  // gate means the latter should not really happen on this screen, but the
  // *loading* window is real over a real network, and must not render every
  // member name as the neutral fallback while it's open).
  const [householdLoaded, setHouseholdLoaded] = useState(false);
  // Review R4 (architect finding on the R2 fix): the original fetch had no
  // rejection handler at all, so a real network failure left
  // `householdLoaded` false forever (an indefinite loading state) and threw
  // an unhandled rejection. `householdError` is that failure, distinct from
  // "still loading" — the allergen block shows an error + retry, never a
  // verdict with unnamed members, and the Add CTA stays disabled throughout.
  const [householdError, setHouseholdError] = useState(false);
  // Incrementing this re-runs the fetch effect below — the "Try again" retry.
  const [householdRetryToken, setHouseholdRetryToken] = useState(0);
  const scanLockRef = useRef(false);

  // Requests permission exactly once per screen instance: `.granted`/
  // `.canAskAgain` are plain booleans (unlike `.status`, a `PermissionStatus`
  // enum from `expo-modules-core` this app never needs to compare against
  // directly), so this never re-prompts after a denial.
  useEffect(() => {
    if (permission && !permission.granted && !requestedOnce) {
      setRequestedOnce(true);
      void requestPermission();
    }
  }, [permission, requestedOnce, requestPermission]);

  // Review F11: member names on S8's allergen row are resolved from the
  // household DTO the app actually holds, never a fixed name map. One read
  // is enough — the household does not change mid-scan. Review R2/R4: the
  // confirm sheet's allergen block stays gated (see `ConfirmSheet` below)
  // until `householdLoaded` is true, and a rejection sets `householdError`
  // instead of leaving the loading state open forever — the two-argument
  // `.then` handles the rejection right here, so there is never an
  // unhandled promise rejection. `householdRetryToken` re-runs this effect
  // when "Try again" is pressed.
  useEffect(() => {
    let cancelled = false;
    setHouseholdError(false);
    void apiClient.getOnboardingState().then(
      (state) => {
        if (!cancelled) {
          setHousehold(state.household);
          setHouseholdLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setHouseholdError(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [householdRetryToken]);

  function handleRetryHousehold(): void {
    setHouseholdRetryToken((prev) => prev + 1);
  }

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/add");
    }
  }

  async function handleCode(code: string): Promise<void> {
    const trimmed = code.trim();
    if (trimmed === "") {
      return;
    }
    setLookupError(null);
    try {
      const result = await apiClient.lookupProduct(trimmed);
      if (result.status === "hit") {
        setPhase({ kind: "confirm", code: trimmed, product: result.product });
        setCount(1);
        setLocation("FRIDGE");
      } else if (result.status === "not-found") {
        scanLockRef.current = false; // review F14: a miss must not permanently lock out further scans
        setPhase({ kind: "miss", code: trimmed });
      } else {
        // Unreachable from this ticket's fixture/HttpApiClient paths (see
        // ApiClient.lookupProduct's doc comment); kept for type parity with
        // the real port's three-state result. Never renders the raw
        // machine message, same rule as every other ledger-facing error.
        scanLockRef.current = false;
        setLookupError(GENERIC_LEDGER_ERROR_MESSAGE);
      }
    } catch (error) {
      // Review F14: a lookup failure must not permanently lock the camera
      // out of further scans — without this, one transient error stranded
      // the user on a live (but now inert) camera view forever.
      scanLockRef.current = false;
      setLookupError(messageForLedgerError(error));
    }
  }

  function handleTypedSubmit(): void {
    void handleCode(typedCode);
  }

  function handleGoManualFromMiss(code: string): void {
    router.push({ pathname: "/add/manual", params: { code } });
  }

  async function handleAdd(product: ScannedProductDto): Promise<void> {
    // Review R4: a verdict without resolved member names is not acceptable
    // on a safety row, so Add is refused (not just visually disabled) until
    // the household has actually loaded — belt-and-suspenders alongside the
    // button's own `disabled` prop, since a test/host renderer is not
    // guaranteed to enforce that itself.
    if (!householdLoaded || householdError) {
      return;
    }
    setAddError(null);
    try {
      const amountMicros = packageQuantityMicros(count, product.packageSize.value.qty);
      const summary = await apiClient.createItem({
        idempotencyKey: nextIdempotencyKey(),
        source: "BARCODE",
        displayName: product.name.value,
        storageLocation: location,
        unit: normalizePackageUnit(product.packageSize.value.unit),
        amount: microsToAmountText(amountMicros),
        quantityProvenance: {
          tier: "KNOWN_FACT",
          source: "scanned barcode",
          confidence: null,
          recordedAt: null,
        },
        // Review F18: keeps S4/S5's catalog link to this scanned product.
        productRef: product.productId,
        bestByDate: product.bestBy?.value ?? null,
        bestByProvenance: product.bestBy?.provenance ?? null,
      });
      recordRecentlyAdded(summary);
      show(`Added ${count} × ${product.name.value} to ${LOCATION_LABELS[location]} · Known Fact`);
      router.replace("/inventory");
    } catch (error) {
      setAddError(messageForLedgerError(error));
    }
  }

  if (phase.kind === "confirm") {
    return (
      <ConfirmSheet
        product={phase.product}
        count={count}
        setCount={setCount}
        location={location}
        setLocation={setLocation}
        addError={addError}
        householdLoaded={householdLoaded}
        householdError={householdError}
        onRetryHousehold={handleRetryHousehold}
        resolveMemberName={resolverFromHousehold(household)}
        onAdd={() => void handleAdd(phase.product)}
        onBack={handleBack}
      />
    );
  }

  if (phase.kind === "miss") {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <BackButton onPress={handleBack} />
          <Text style={styles.headerTitle}>Scan barcode</Text>
        </View>
        <View style={styles.missPanel}>
          <View style={styles.missBadgeRow}>
            <Text style={styles.missBadge}>No match</Text>
            <Text style={styles.missBadgeCaption}>code not found in any source we checked</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Scanned code</Text>
            <Text style={styles.kvValue}>{formatScannedCodeDisplay(phase.code)}</Text>
          </View>
          <Text style={styles.missBody}>
            We could not find this product in Open Food Facts or USDA. The code is kept so we can
            fill in the facts automatically later if it gets added.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter it manually"
            onPress={() => handleGoManualFromMiss(phase.code)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Enter it manually</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const permissionDenied = requestedOnce && permission !== null && !permission.granted;

  if (permissionDenied) {
    return (
      <View style={[styles.screen, styles.camScreen]}>
        <View style={styles.permDenied}>
          <Text style={styles.permTitle}>Camera access is off.</Text>
          <Text style={styles.permBody}>
            Turn it on to scan barcodes, or add this item by hand.
          </Text>
          <View style={styles.permButtonRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Settings"
              onPress={() => void Linking.openSettings()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Open Settings</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enter manually"
              onPress={() => router.push("/add/manual")}
              style={styles.primaryButtonFlex}
            >
              <Text style={styles.primaryButtonText}>Enter manually</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, styles.camScreen]}>
      <View style={styles.camTop}>
        <BackButton onPress={handleBack} light />
        <Text style={styles.camTitle}>Scan barcode</Text>
        <View style={{ width: minTouchTarget }} />
      </View>
      {permission?.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...SCANNABLE_BARCODE_TYPES_DTO] }}
          onBarcodeScanned={(result) => {
            if (scanLockRef.current) {
              return;
            }
            scanLockRef.current = true;
            void handleCode(result.data);
          }}
        />
      ) : (
        <View style={styles.camera} />
      )}
      <ScanFrame reducedMotion={reducedMotion} />
      <Text style={styles.camHint}>Point the camera at a barcode</Text>
      {lookupError ? (
        <View style={styles.lookupErrorBox} accessibilityLiveRegion="assertive">
          <Text style={styles.lookupErrorText}>{lookupError}</Text>
        </View>
      ) : null}
      <View style={styles.fallbackSheet}>
        <Text style={styles.fallbackLabel}>Type the barcode instead</Text>
        <View style={styles.fallbackRow}>
          <TextInput
            accessibilityLabel="Barcode number"
            placeholder="e.g. 060000100025"
            value={typedCode}
            onChangeText={setTypedCode}
            keyboardType="number-pad"
            style={styles.fallbackInput}
            onSubmitEditing={handleTypedSubmit}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Look up code"
            onPress={handleTypedSubmit}
            style={styles.fallbackButton}
          >
            <Text style={styles.fallbackButtonText}>Look up</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function BackButton({
  onPress,
  light,
}: {
  onPress: () => void;
  light?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={onPress}
      style={light ? styles.iconButtonLight : styles.iconButton}
    >
      <Text style={light ? styles.iconGlyphLight : styles.iconGlyph}>{"‹"}</Text>
    </Pressable>
  );
}

/**
 * The viewfinder brackets (four corner marks, review F12) + laser sweep.
 * `--brand`/terracotta here is the documented camera-chrome exception
 * (tokens.md §3), the one place besides the primary CTA and active-nav
 * indicator this colour is allowed. The sweep is driven by a plain
 * `setInterval` + inline style, not React Native's `Animated` API (not yet
 * part of the `react-native` test stand-in, BACKLOG.md's M3-T4a accepted
 * follow-up records that as an open test-infrastructure decision this
 * ticket does not resolve) — reduced motion freezes it at the sweep's
 * static mid-frame position (tokens.md §6).
 */
function ScanFrame({ reducedMotion }: { reducedMotion: boolean }): React.JSX.Element {
  const [top, setTop] = useState(74);
  useEffect(() => {
    if (reducedMotion) {
      setTop(74); // tokens.md §6's prescribed static mid-frame position
      return;
    }
    let direction = 1;
    const id = setInterval(() => {
      setTop((prev) => {
        const next = prev + direction * 6;
        if (next >= 140 || next <= 8) {
          direction = -direction;
        }
        return Math.min(140, Math.max(8, next));
      });
    }, 90);
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <View pointerEvents="none" style={styles.frame}>
      <View style={[styles.corner, styles.cornerTopLeft]} />
      <View style={[styles.corner, styles.cornerTopRight]} />
      <View style={[styles.corner, styles.cornerBottomLeft]} />
      <View style={[styles.corner, styles.cornerBottomRight]} />
      <View style={[styles.laser, { top }]} />
    </View>
  );
}

function ConfirmSheet({
  product,
  count,
  setCount,
  location,
  setLocation,
  addError,
  householdLoaded,
  householdError,
  onRetryHousehold,
  resolveMemberName,
  onAdd,
  onBack,
}: {
  product: ScannedProductDto;
  count: number;
  setCount: (updater: (prev: number) => number) => void;
  location: StorageLocationDto;
  setLocation: (loc: StorageLocationDto) => void;
  addError: string | null;
  householdLoaded: boolean;
  householdError: boolean;
  onRetryHousehold: () => void;
  resolveMemberName: MemberNameResolver;
  onAdd: () => void;
  onBack: () => void;
}): React.JSX.Element {
  // Review R4: a verdict is never shown with unnamed members, and Add is
  // disabled the whole time the household hasn't loaded — whether that's
  // still in flight or has failed outright.
  const canAdd = householdLoaded && !householdError;
  const blocked = addCtaIsBlocked(product.screening);
  const extraWarnings = extraWarningLines(product.screening, resolveMemberName);
  const nutrition = product.nutrition[0];
  const { evidence, unknowns } = product.screening;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <BackButton onPress={onBack} />
        <Text style={styles.headerTitle}>Confirm item</Text>
      </View>
      <View style={styles.sheet}>
        <View style={styles.identityRow}>
          {/* Review F13: this identity chip reads the full "Known fact"
              wording (design-direction §7: Known Fact scoped to product
              identity on this surface), not S4/S5's compact row form. */}
          <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel("KNOWN_FACT")}>
            ✓ Known fact
          </Text>
          <Text style={styles.identityCaption}>product identity · barcode match</Text>
        </View>
        <Text style={styles.productName}>{product.name.value}</Text>
        <Text style={styles.productMeta}>
          {product.brand?.value ? `${product.brand.value} · ` : ""}
          {trimAmountText(product.packageSize.value.qty)} {product.packageSize.value.unit}
        </Text>

        {nutrition ? (
          <>
            <View style={styles.macrosRow}>
              <Macro label="cal" value={nutrition.values.calories} />
              <Macro label="protein" value={nutrition.values.proteinG} suffix="g" />
              <Macro label="carbs" value={nutrition.values.carbsG} suffix="g" />
              <Macro label="fat" value={nutrition.values.fatG} suffix="g" />
            </View>
            {/* Review F4: the record's own tier chip, shown once for the
                whole nutrition profile (every field in one
                `NutritionProfileDto` shares one provenance — there is no
                finer-grained per-macro tier in this record). */}
            <View style={styles.nutritionTierRow}>
              <Text
                style={styles.provChipSmall}
                accessibilityLabel={chipAccessibilityLabel(nutrition.provenance.tier)}
              >
                {ROW_CHIP_TEXT[nutrition.provenance.tier]}
              </Text>
              <Text style={styles.helperCaption}>
                Nutrition & allergens: label data via Open Food Facts · tier shown per field
              </Text>
            </View>
          </>
        ) : null}

        {/* Review F3/F6/F7 ruling: one line per evidence entry and one line
            per unknown — never a single condensed "primary" pick. A product
            can be BLOCKED on one restriction and unresolved on another at
            the same time (the tahini fixture is exactly this), and every
            real finding renders, not just one.

            Review R2/R4: gated on `householdLoaded`/`householdError` —
            every line below names a member via `resolveMemberName`, built
            from the household DTO the screen fetches (F11); rendering
            before that fetch resolves (or after it fails) would render
            every member as the neutral fallback phrase over a real
            network, which copy rule 8 does not want. A rejection shows the
            copy-deck.md §8 generic fallback plus a retry, never a verdict
            with unnamed members. */}
        <View style={styles.allergenRow}>
          {householdError ? (
            <View style={styles.allergenErrorBox} accessibilityLiveRegion="assertive">
              <Text style={styles.allergenErrorText}>{GENERIC_LEDGER_ERROR_MESSAGE}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try again"
                onPress={onRetryHousehold}
                style={styles.tryAgainButton}
              >
                <Text style={styles.tryAgainButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : !householdLoaded ? (
            <Text style={styles.allergenLoadingText}>
              Checking allergen data for your household.
            </Text>
          ) : product.screening.verdict === "ALLOWED" ? (
            <Text style={styles.allergenLine} accessibilityLabel={allowedLine()}>
              {allowedLine()}
            </Text>
          ) : (
            <>
              {evidence.map((e, index) => {
                const tier = evidenceTier(e, evidence);
                const line = evidenceLine(e, resolveMemberName);
                return (
                  <View key={`evidence-${String(index)}`} style={styles.allergenLineRow}>
                    <Text
                      style={[styles.allergenLine, styles.allergenLineBlocked]}
                      accessibilityLabel={line}
                    >
                      {line}
                    </Text>
                    {tier && isProvenanceTier(tier) ? (
                      <Text
                        style={styles.provChipSmall}
                        accessibilityLabel={chipAccessibilityLabel(tier)}
                      >
                        {ROW_CHIP_TEXT[tier]}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {unknowns.map((u, index) => {
                const line = unknownLine(u, resolveMemberName);
                return (
                  <Text
                    key={`unknown-${String(index)}`}
                    style={[styles.allergenLine, styles.allergenLineUnknown]}
                    accessibilityLabel={line}
                  >
                    {line}
                  </Text>
                );
              })}
            </>
          )}
          {extraWarnings.map((line) => (
            <Text key={line} style={styles.extraWarningText}>
              {line}
            </Text>
          ))}
        </View>

        {product.bestBy ? (
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Best by</Text>
            <View style={styles.kvValueRow}>
              <Text style={styles.kvValue}>
                {new Date(product.bestBy.value).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
              <Text
                style={styles.provChipSmall}
                accessibilityLabel={chipAccessibilityLabel(product.bestBy.provenance.tier)}
              >
                {ROW_CHIP_TEXT[product.bestBy.provenance.tier]}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.stepperRow}>
          <Text style={styles.kvLabel}>Quantity</Text>
          <View style={styles.step}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease quantity"
              onPress={() => setCount((prev) => Math.max(1, prev - 1))}
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
        </View>

        <View style={styles.locsRow}>
          {SCAN_LOCATIONS.map((loc) => (
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

        {addError ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeText}>{addError}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${count} to ${LOCATION_LABELS[location]}`}
          accessibilityState={{ disabled: !canAdd }}
          disabled={!canAdd}
          onPress={onAdd}
          style={[
            styles.primaryButton,
            blocked ? styles.primaryButtonBlocked : null,
            canAdd ? null : styles.primaryButtonDisabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            Add {count} to {LOCATION_LABELS[location]}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Macro({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
}): React.JSX.Element {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>
        {value ?? "n/a"}
        {value !== undefined && suffix ? suffix : ""}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const CORNER_SIZE = 22;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sand },
  camScreen: { backgroundColor: colors.espresso },
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
  iconButtonLight: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyphLight: { fontSize: 22, color: colors.cream },
  headerTitle: {
    fontSize: 20,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  camTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  camTitle: { color: colors.cream, fontWeight: "700", fontSize: 15, fontFamily: fontFamily.body },
  camera: { flex: 1, backgroundColor: colors.espresso2 },
  frame: {
    position: "absolute",
    left: "20%",
    right: "20%",
    top: "30%",
    height: 150,
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.brand,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },
  laser: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.brand,
  },
  camHint: {
    textAlign: "center",
    color: colors.cream,
    fontSize: 12.5,
    fontFamily: fontFamily.body,
    marginTop: spacing.sm,
  },
  lookupErrorBox: {
    position: "absolute",
    bottom: 190,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  lookupErrorText: { color: colors.ink, fontSize: 13, fontFamily: fontFamily.body },
  fallbackSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  fallbackLabel: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  fallbackRow: { flexDirection: "row", gap: spacing.sm },
  fallbackInput: {
    flex: 1,
    height: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  fallbackButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackButtonText: { color: colors.cream, fontWeight: "700", fontFamily: fontFamily.body },
  permDenied: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  permTitle: {
    color: colors.cream,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    fontSize: 20,
    textAlign: "center",
  },
  permBody: { color: colors.cream, fontSize: 14, textAlign: "center", fontFamily: fontFamily.body },
  permButtonRow: { flexDirection: "row", gap: spacing.sm, width: "100%" },
  secondaryButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { color: colors.cream, fontWeight: "700", fontFamily: fontFamily.body },
  primaryButton: {
    minHeight: minTouchTarget,
    borderRadius: 14,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryButtonFlex: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonBlocked: { backgroundColor: colors.espresso },
  primaryButtonDisabled: { backgroundColor: colors.line },
  primaryButtonText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  missPanel: { padding: spacing.lg, gap: spacing.md },
  missBadgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  missBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink2,
    backgroundColor: colors.sand2,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  missBadgeCaption: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  missBody: { fontSize: 13.5, color: colors.ink2, lineHeight: 19, fontFamily: fontFamily.body },
  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  kvValueRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  kvLabel: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body },
  kvValue: { fontSize: 14, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  sheet: { padding: spacing.lg, gap: spacing.sm },
  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  identityCaption: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  productName: {
    fontSize: 19,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  productMeta: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body },
  macrosRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  macro: { alignItems: "center" },
  macroValue: { fontSize: 15, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  macroLabel: { fontSize: 10.5, color: colors.ink3, fontFamily: fontFamily.body },
  nutritionTierRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  helperCaption: { fontSize: 11, color: colors.ink3, fontFamily: fontFamily.body, flexShrink: 1 },
  allergenRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  allergenLineRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  allergenLine: {
    fontSize: 13,
    color: colors.ink,
    fontFamily: fontFamily.body,
    lineHeight: 18,
    flex: 1,
  },
  allergenLineBlocked: { color: colors.danger, fontWeight: "700" },
  allergenLineUnknown: { color: colors.amber, fontWeight: "700" },
  allergenLoadingText: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body },
  allergenErrorBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.sand2,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  allergenErrorText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  tryAgainButton: {
    alignSelf: "flex-start",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  tryAgainButtonText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  extraWarningText: {
    fontSize: 12,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    lineHeight: 17,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
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
  locsRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm },
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
  provChip: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.green,
    backgroundColor: colors.greenBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  provChipSmall: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.amber,
    backgroundColor: colors.amberBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  noticeBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.sand2,
    padding: spacing.sm,
  },
  noticeText: { fontSize: 12.5, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
});
