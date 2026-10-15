import { useCallback, useEffect, useRef, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import type {
  InventoryItemDetailDto,
  InventoryMoveEntryDto,
  InventoryTransactionDto,
  ProvenanceTierDto,
  StorageLocationDto,
} from "@smart-kitchen/contracts";
import { apiClient, type RemovalAction } from "../../src/api/client";
import { chipHitSlop, provChipStyle } from "../../src/design/chips";
import {
  colors,
  fontFamily,
  minTouchTarget,
  radius,
  spacing,
  typeScale,
} from "../../src/design/tokens";
import { useTabBarClearance } from "../../src/navigation/TabBar";
import { GENERIC_READ_ERROR_MESSAGE, messageForLedgerError } from "../../src/inventory/errors";
import {
  isMoveEntry,
  ledgerRowsOf,
  movedRowCaption,
  movedRowTitle,
  otherLocations,
} from "../../src/inventory/history";
import {
  daysUntil,
  expiryDisplayText,
  freshnessRing,
  lotCaptionExpiry,
} from "../../src/inventory/expiry";
import { useReducedMotion, pressScaleStyle } from "../../src/inventory/motion";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../../src/inventory/provenance";
import {
  classifyTypedAmount,
  COUNT_NOT_WHOLE_HINT,
  formatQuantityDisplay,
  formatSignedAmount,
  isCountUnit,
  microsToTypedText,
  parseMicros,
  stepAmountMicros,
  trimAmountText,
} from "../../src/inventory/quantity";
import {
  ACTION_LABELS,
  REMOVAL_REASON_CHIPS,
  REMOVAL_SUB_REASONS,
  rowIsRemoval,
} from "../../src/inventory/transactions";
import { buildWhyLine, clampSentence, formatRowTimestamp } from "../../src/inventory/why";
import { useToast } from "../../src/inventory/Toast";
import { LOCATION_LABELS, needsConfirmation } from "../../src/inventory/list-view";

/** M3-T7: shown under the amount field while its text is not a usable amount (proposed for copy-deck §7 S5). */
const AMOUNT_HINT = "Enter a number, like 2 or 0.5.";

/** What is wrong with the amount field's text, if anything (M3-T7, M2-T8). */
type DraftProblem = null | "unusable" | "fraction";

/** The hint for a problem: a count unit's fraction gets its own (D-029). */
function hintFor(problem: Exclude<DraftProblem, null>): string {
  return problem === "fraction" ? COUNT_NOT_WHOLE_HINT : AMOUNT_HINT;
}

/**
 * S5 · item detail / ledger history (M3-T3), prototype v4 `#scr-item`.
 * Tolerates the pre-redirect frame the same way S4 does: `itemId` from the
 * route may resolve before a household exists, so every state here starts
 * `null` and the component renders an empty shell rather than assuming data.
 */
export default function ItemDetailScreen(): React.JSX.Element {
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ itemId: string }>();
  const itemId = params.itemId;
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { show } = useToast();

  const [detail, setDetail] = useState<InventoryItemDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draftMicros, setDraftMicros] = useState<bigint | null>(null);
  // M3-T7: what the amount field shows. `draftMicros` is the last usable
  // amount; `draftText` may be mid-edit or unparsable, in which case Save is
  // off and the hint shows. Always set together with `draftMicros` except on
  // an unparsable keystroke. M2-T8: a fraction typed for a count unit sets
  // `draftMicros` to that fraction (so the stepper steps from it to the next
  // whole number) but is a problem, so Save stays off.
  const [draftText, setDraftText] = useState("");
  const [draftProblem, setDraftProblem] = useState<DraftProblem>(null);
  const draftInvalid = draftProblem !== null;
  const [pendingReason, setPendingReason] = useState<RemovalAction | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  // M2-T6: true while a move is in flight, so a double tap sends one request.
  const [moving, setMoving] = useState(false);
  // The guard itself is a ref: state updates are batched, so two taps inside
  // one frame would both read `moving === false`.
  const movingRef = useRef(false);

  const resetDraft = useCallback((micros: bigint): void => {
    setDraftMicros(micros);
    setDraftText(microsToTypedText(micros));
    setDraftProblem(null);
  }, []);

  const load = useCallback((): (() => void) => {
    let cancelled = false;
    if (!itemId) {
      return () => {
        cancelled = true;
      };
    }
    void apiClient.getInventoryItem(itemId).then((result) => {
      if (cancelled) {
        return;
      }
      setDetail(result);
      setNotFound(result === null);
      if (result) {
        resetDraft(parseMicros(result.summary.quantity.micros));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, resetDraft]);

  useEffect(() => load(), [load]);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/inventory");
    }
  }

  function stepDraft(direction: 1 | -1): void {
    if (draftMicros === null || !detail) {
      return;
    }
    // Steps from the typed value; from the last usable amount when the field
    // holds unparsable text (the step then replaces that text). A count unit
    // steps by 1, and from a fraction to the next whole number (D-029).
    resetDraft(stepAmountMicros(draftMicros, direction, detail.summary.quantity.unit));
  }

  function handleAmountTyped(text: string): void {
    setDraftText(text);
    const typed = classifyTypedAmount(text, detail?.summary.quantity.unit ?? "");
    if (typed.kind === "valid") {
      setDraftProblem(null);
      setDraftMicros(typed.micros);
      return;
    }
    if (typed.kind === "fraction") {
      setDraftMicros(typed.micros);
    }
    if (draftProblem !== typed.kind) {
      // Live regions are Android-only; this reaches iOS and Android alike.
      AccessibilityInfo.announceForAccessibility(hintFor(typed.kind));
    }
    setDraftProblem(typed.kind);
  }

  async function handleUndo(transactionId: string): Promise<void> {
    if (!itemId) {
      return;
    }
    await apiClient.undo(itemId, transactionId);
    const updated = await apiClient.getInventoryItem(itemId);
    setDetail(updated);
    if (updated) {
      resetDraft(parseMicros(updated.summary.quantity.micros));
    }
  }

  async function handleSaveCorrection(): Promise<void> {
    if (!itemId || draftMicros === null || draftInvalid) {
      return;
    }
    setCorrectionError(null);
    // Review F3: the toast (and its undo target) must come from the write
    // actually succeeding, never from re-reading history and assuming its
    // last row is the one this call just appended (a concurrent write from
    // elsewhere in the household could land in between).
    let result: { readonly transactionId: string };
    try {
      result = await apiClient.correctQuantity(itemId, draftMicros.toString());
    } catch (error) {
      const message = messageForLedgerError(error);
      setCorrectionError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    const updated = await apiClient.getInventoryItem(itemId);
    setDetail(updated);
    if (updated) {
      resetDraft(parseMicros(updated.summary.quantity.micros));
    }
    show("Corrected. Undo", () => void handleUndo(result.transactionId));
  }

  async function handleApplyReason(subReason: string): Promise<void> {
    if (!itemId || !pendingReason) {
      return;
    }
    const removedFromItemId = itemId;
    // Review F7: the reason top-chips are disabled at a zero balance (see
    // the render below), but catch anyway rather than leave an unhandled
    // rejection for a race (another write zeroing the item between render
    // and this tap).
    let result: { readonly transactionId: string };
    try {
      result = await apiClient.removeQuantity(itemId, pendingReason, subReason);
    } catch (error) {
      const message = messageForLedgerError(error);
      setRemovalError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setPendingReason(null);
    setRemovalError(null);
    // Objective (f): the toast (and its Undo) must survive the navigation
    // below — show() writes to the global toast host (app/_layout.tsx),
    // not screen-local state, so it does. `handleUndo` closes over
    // `removedFromItemId`, not the (about to unmount) screen's `itemId`
    // param, so the Undo action still targets the right item afterward.
    show(`${ACTION_LABELS[pendingReason]}. Undo`, () => {
      void apiClient.undo(removedFromItemId, result.transactionId);
    });
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/inventory");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!itemId) {
      return;
    }
    try {
      await apiClient.confirmAiProposal(itemId);
      const updated = await apiClient.getInventoryItem(itemId);
      setDetail(updated);
    } catch (error) {
      // BUG-004: a failed confirm (or re-read) is a failed write. Generic
      // ledger fallback in the toast (copy-deck §8); nothing is marked
      // confirmed and a failed confirm never re-reads.
      show(messageForLedgerError(error));
    }
  }

  async function handleMove(toLocation: StorageLocationDto): Promise<void> {
    if (!itemId || movingRef.current) {
      return;
    }
    movingRef.current = true;
    setMoving(true);
    try {
      try {
        await apiClient.moveItem(itemId, toLocation);
      } catch (error) {
        // A failed move is a failed write: the §8 fallback in the toast,
        // nothing changes on screen, and the chips stay for another try.
        const message = messageForLedgerError(error);
        show(message);
        AccessibilityInfo.announceForAccessibility(message);
        return;
      }
      let updated: InventoryItemDetailDto | null;
      try {
        updated = await apiClient.getInventoryItem(itemId);
      } catch {
        // The move is recorded; only the re-read failed. Say so honestly.
        show(GENERIC_READ_ERROR_MESSAGE);
        return;
      }
      setDetail(updated);
      show(`Moved to ${LOCATION_LABELS[toLocation]}`);
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  }

  if (notFound) {
    return (
      <View style={styles.screen}>
        <Header onBack={handleBack} title="Item" chip={null} />
        <Text style={styles.notFound}>This item is no longer available.</Text>
      </View>
    );
  }

  if (!detail || draftMicros === null) {
    // Tolerates the pre-redirect frame and the initial load: an empty shell,
    // never a crash on an assumed household/item.
    return <View style={styles.screen} />;
  }

  const { summary } = detail;
  const tier = summary.provenance.quantity?.tier ?? null;
  const qtyDisplay = formatQuantityDisplay(summary.quantity, summary.lots, tier);
  const canSave = !draftInvalid && draftMicros !== parseMicros(summary.quantity.micros);
  // M2-T8 (D-029): a count unit steps by 1 and takes whole numbers only.
  const stepLabel = isCountUnit(summary.quantity.unit) ? "1" : "0.25";
  // Review F7: nothing to remove at a zero balance; disable the reason
  // chips rather than let a tap reach a rejected removeQuantity call.
  const isZeroBalance = parseMicros(summary.quantity.micros) <= 0n;
  const historyNewestFirst = [...detail.history].reverse();
  // M2-T6: the "Why {qty}?" narrative is about quantity, so it sees ledger rows only.
  const whyLine = buildWhyLine(qtyDisplay, summary.quantity.unit, ledgerRowsOf(detail.history));
  // Objective (g): Confirm reachable from S5, same action and label as the
  // tray/row (app/inventory.tsx's handleConfirm/TrayRow), for an AI-tier
  // item opened directly (e.g. by deep link, review F2's warm-open case).
  const showConfirm = needsConfirmation(summary);

  return (
    <View style={styles.screen}>
      <Header onBack={handleBack} title={summary.displayName ?? "Item"} chip={tier} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
        <View style={styles.qtyBig}>
          <Text style={styles.qtyBigText}>{qtyDisplay}</Text>
          <Text style={styles.qtyBigSub}>
            on hand ·{" "}
            {summary.storageLocation ? LOCATION_LABELS[summary.storageLocation] : "Unassigned"}
          </Text>
        </View>

        {showConfirm ? (
          <View style={styles.confirmRow}>
            <Text style={styles.confirmText}>Needs your confirmation</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Confirm ${summary.displayName ?? "item"}`}
              onPress={() => void handleConfirm()}
              style={({ pressed }) => [
                styles.confirmButton,
                pressScaleStyle(pressed, reducedMotion),
              ]}
            >
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.whyBlock}>
          <Text style={styles.whyText}>{whyLine}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="What do these badges mean?"
            hitSlop={15}
            onPress={() => router.push("/legend")}
          >
            <Text style={styles.legendLink}>What do these badges mean?</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionHeading}>Correct this</Text>
        <View style={styles.card}>
          <Text style={styles.cardBody}>
            One tap if this number is wrong. A correction teaches the system. It is never an
            apology.
          </Text>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Decrease quantity by ${stepLabel}`}
              onPress={() => stepDraft(-1)}
              style={({ pressed }) => [styles.stepButton, pressScaleStyle(pressed, reducedMotion)]}
            >
              <Text style={styles.stepButtonText}>{"−"}</Text>
            </Pressable>
            <TextInput
              accessibilityLabel="Quantity amount"
              accessibilityHint={draftProblem !== null ? hintFor(draftProblem) : undefined}
              keyboardType="decimal-pad"
              inputMode="decimal"
              selectTextOnFocus
              value={draftText}
              onChangeText={handleAmountTyped}
              style={[styles.amountInput, draftInvalid ? styles.amountInputInvalid : null]}
            />
            <Text style={styles.stepUnit}>{summary.quantity.unit}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Increase quantity by ${stepLabel}`}
              onPress={() => stepDraft(1)}
              style={({ pressed }) => [styles.stepButton, pressScaleStyle(pressed, reducedMotion)]}
            >
              <Text style={styles.stepButtonText}>+</Text>
            </Pressable>
          </View>
          {draftProblem !== null ? (
            <Text style={styles.amountHint} accessibilityLiveRegion="polite">
              {hintFor(draftProblem)}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save correction"
            disabled={!canSave}
            onPress={() => void handleSaveCorrection()}
            style={({ pressed }) => [
              styles.primaryButton,
              !canSave ? styles.primaryButtonDisabled : null,
              pressScaleStyle(pressed, reducedMotion),
            ]}
          >
            <Text style={styles.primaryButtonText}>Save correction</Text>
          </Pressable>
          {correctionError ? (
            <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
              <Text style={styles.noticeIcon}>{"⚠"}</Text>
              <Text style={styles.noticeText}>{correctionError}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionHeading}>Use or remove</Text>
        <View style={styles.chipsRow}>
          {REMOVAL_REASON_CHIPS.map((reason) => (
            <Pressable
              key={reason.type}
              hitSlop={chipHitSlop}
              accessibilityRole="button"
              accessibilityLabel={reason.label}
              accessibilityState={{
                selected: pendingReason === reason.type,
                disabled: isZeroBalance,
              }}
              disabled={isZeroBalance}
              onPress={() => setPendingReason(reason.type)}
              style={[
                styles.chip,
                pendingReason === reason.type ? styles.chipOn : null,
                isZeroBalance ? styles.chipDisabled : null,
              ]}
            >
              <Text
                style={[styles.chipText, pendingReason === reason.type ? styles.chipTextOn : null]}
              >
                {reason.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {removalError ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeIcon}>{"⚠"}</Text>
            <Text style={styles.noticeText}>{removalError}</Text>
          </View>
        ) : null}
        {pendingReason ? (
          <View style={styles.chipsRow}>
            {REMOVAL_SUB_REASONS.map((sub) => (
              <Pressable
                key={sub}
                hitSlop={chipHitSlop}
                accessibilityRole="button"
                accessibilityLabel={sub}
                onPress={() => void handleApplyReason(sub)}
                style={({ pressed }) => [styles.chip, pressScaleStyle(pressed, reducedMotion)]}
              >
                <Text style={styles.chipText}>{sub}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionHeading}>Move to</Text>
        <View style={styles.chipsRow}>
          {otherLocations(summary.storageLocation).map((location) => (
            <Pressable
              key={location}
              hitSlop={chipHitSlop}
              accessibilityRole="button"
              accessibilityLabel={`Move to ${LOCATION_LABELS[location]}`}
              accessibilityState={{ disabled: moving }}
              disabled={moving}
              onPress={() => void handleMove(location)}
              style={({ pressed }) => [
                styles.chip,
                moving ? styles.chipDisabled : null,
                pressScaleStyle(pressed, reducedMotion),
              ]}
            >
              <Text style={styles.chipText}>{LOCATION_LABELS[location]}</Text>
            </Pressable>
          ))}
        </View>

        {summary.lots.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>Lots</Text>
            {summary.lots.map((lot) => {
              const lotTier = lot.expiresAtProvenance?.tier ?? null;
              const days =
                lot.expiresAt === null ? null : daysUntil(new Date().toISOString(), lot.expiresAt);
              const ring = freshnessRing(days);
              const urgency = expiryDisplayText(days, lotTier);
              return (
                <View key={lot.lotId} style={styles.lotRow}>
                  <View style={styles.lotMeta}>
                    <Text style={styles.lotAmount}>
                      {trimAmountText(lot.quantity.amount)} {lot.quantity.unit}
                    </Text>
                    <View style={styles.lotCaptionRow}>
                      <Text style={styles.lotCaption}>{lot.label ?? "acquired"}</Text>
                      {urgency ? (
                        <Text style={[styles.days, daysStyleFor(ring)]}>
                          {lotCaptionExpiry(urgency)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {lotTier ? (
                    <Text
                      style={provChipStyle(lotTier)}
                      accessibilityLabel={chipAccessibilityLabel(lotTier)}
                    >
                      {ROW_CHIP_TEXT[lotTier]}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        <Text style={styles.sectionHeading}>History</Text>
        {historyNewestFirst.map((entry) =>
          isMoveEntry(entry) ? (
            <MovedRow key={entry.moveId} entry={entry} />
          ) : (
            <HistoryRow key={entry.transactionId} tx={entry} unit={summary.quantity.unit} />
          ),
        )}
      </ScrollView>
    </View>
  );
}

function Header({
  onBack,
  title,
  chip,
}: {
  onBack: () => void;
  title: string;
  chip: ProvenanceTierDto | null;
}): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.back}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={onBack}
          style={styles.iconButton}
        >
          <Text style={styles.iconGlyph}>{"‹"}</Text>
        </Pressable>
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.headerTitle}>{title}</Text>
        {chip ? (
          <Text
            style={[provChipStyle(chip), styles.titleChip]}
            accessibilityLabel={chipAccessibilityLabel(chip)}
          >
            {ROW_CHIP_TEXT[chip]}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** M2-T6: a move between locations. No amount and no tier chip: it is where the item is, not how much (ADR-008). */
function MovedRow({ entry }: { entry: InventoryMoveEntryDto }): React.JSX.Element {
  const caption = movedRowCaption(entry);
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyIcon}>
        <Text style={styles.historyIconGlyph}>{"→"}</Text>
      </View>
      <View style={styles.historyMeta}>
        <Text style={styles.historyTitle}>{movedRowTitle(entry)}</Text>
        <View style={styles.historyCaptionRow}>
          {entry.actor.displayInitials ? (
            <Text style={styles.initialsChip}>{entry.actor.displayInitials}</Text>
          ) : null}
          {caption ? <Text style={styles.historyCaption}>{caption}</Text> : null}
        </View>
        <Text style={styles.historyTime}>{formatRowTimestamp(entry.recordedAt)}</Text>
      </View>
    </View>
  );
}

function HistoryRow({
  tx,
  unit,
}: {
  tx: InventoryTransactionDto;
  unit: string;
}): React.JSX.Element {
  const isClamp = tx.systemFlag === "OVER_CONSUMPTION";
  const timestamp = formatRowTimestamp(tx.recordedAt);
  const tierChip = ROW_CHIP_TEXT[tx.provenance.tier];

  if (isClamp) {
    return (
      <View style={[styles.historyRow, styles.historyRowSystem]}>
        <View style={styles.historyIcon}>
          <Text style={styles.historyIconGlyph}>{"⚠"}</Text>
        </View>
        <View style={styles.historyMeta}>
          <View style={styles.historyTitleRow}>
            <Text style={styles.historyTitle}>Adjustment</Text>
            <Text style={styles.autoBadge}>auto</Text>
            {/* Review F10: there is no "no chip" state (copy-deck.md §4);
                the clamp is a fallible fact like any other row. */}
            <Text
              style={provChipStyle(tx.provenance.tier)}
              accessibilityLabel={chipAccessibilityLabel(tx.provenance.tier)}
            >
              {tierChip}
            </Text>
          </View>
          <Text style={styles.historyCaption}>{clampSentence(tx.amount, unit)}</Text>
          <Text style={styles.historyTime}>{timestamp}</Text>
        </View>
        <Text style={styles.amtPositive}>{formatSignedAmount(tx.amount, unit)}</Text>
      </View>
    );
  }

  // Review F4 ruling: a removal's reason is never folded into the title as
  // "{action} in {reason}" (reads as if the reason were a place); it gets
  // its own "reason: {lowercased}" caption instead. correlationLabel (a
  // recipe name) is the only thing that earns the "{action} in {label}"
  // title, and is never set on a removal row. M3-T4a: reads the wire's own
  // `reason` field, removing the M3-T3 `provenance.source` workaround this
  // used to read instead.
  const title = tx.correlationLabel
    ? `${ACTION_LABELS[tx.type]} in ${tx.correlationLabel}`
    : ACTION_LABELS[tx.type];
  const captionText =
    rowIsRemoval(tx.type) && tx.reason
      ? `reason: ${tx.reason.toLowerCase()}`
      : tx.provenance.source;
  const isNegative = tx.deltaMicros.startsWith("-");

  return (
    <View style={styles.historyRow}>
      <View style={styles.historyMeta}>
        <Text style={styles.historyTitle}>{title}</Text>
        <View style={styles.historyCaptionRow}>
          {tx.actor.displayInitials ? (
            <Text style={styles.initialsChip}>{tx.actor.displayInitials}</Text>
          ) : null}
          {captionText ? <Text style={styles.historyCaption}>{captionText}</Text> : null}
          <Text
            style={provChipStyle(tx.provenance.tier)}
            accessibilityLabel={chipAccessibilityLabel(tx.provenance.tier)}
          >
            {tierChip}
          </Text>
        </View>
        <Text style={styles.historyTime}>{timestamp}</Text>
      </View>
      <Text style={isNegative ? styles.amtNegative : styles.amtPositive}>
        {formatSignedAmount(tx.amount, unit)}
      </Text>
    </View>
  );
}

/** v6 `.days`: rose (use today), amber (soon), green (further out), each on its tint. Never red. */
function daysStyleFor(ring: ReturnType<typeof freshnessRing>): {
  color: string;
  backgroundColor: string;
} {
  switch (ring) {
    case "now":
      return { color: colors.rose, backgroundColor: colors.roseBg };
    case "soon":
      return { color: colors.amber, backgroundColor: colors.amberBg };
    case "fresh":
      return { color: colors.green, backgroundColor: colors.greenBg };
    default:
      return { color: colors.ink2, backgroundColor: colors.tile };
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.gutter },
  // v6 `.back`: the 44px back control sits 8px left of the gutter, no border.
  back: { marginLeft: -spacing.sm },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 30, lineHeight: 32, color: colors.ink, fontFamily: fontFamily.body },
  // v6 `.itemhead`: Bodoni 44 title with the tier chip under it.
  titleBlock: { paddingTop: 2, paddingBottom: spacing.xs, alignItems: "flex-start" },
  headerTitle: {
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
    letterSpacing: typeScale.title.letterSpacing,
    fontFamily: typeScale.title.fontFamily,
    fontWeight: typeScale.title.fontWeight,
    color: colors.ink,
  },
  titleChip: { marginTop: spacing.sm },
  notFound: {
    padding: spacing.gutter,
    fontSize: 14,
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  content: { paddingHorizontal: spacing.gutter },
  // v6 `.qtybig`: Bodoni 46 between two ink rules.
  qtyBig: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.snug,
    marginTop: 18,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.ink,
  },
  qtyBigText: {
    fontSize: typeScale.qtyBig.fontSize,
    lineHeight: typeScale.qtyBig.lineHeight,
    fontFamily: typeScale.qtyBig.fontFamily,
    fontWeight: typeScale.qtyBig.fontWeight,
    color: colors.ink,
  },
  qtyBigSub: { fontSize: 13.5, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  // The AI confirmation tray (v6 `.tray`): AI tint, 14px corners, ai-ink text.
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.cozy,
    borderRadius: radius.panel,
    backgroundColor: colors.aiBg,
    paddingVertical: spacing.snug,
    paddingHorizontal: spacing.cozy,
  },
  confirmText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.ai,
    fontFamily: fontFamily.body,
  },
  // v6 `.okb`: ink pill, 44px.
  confirmButton: {
    minHeight: minTouchTarget,
    minWidth: 56,
    paddingHorizontal: spacing.cozy,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButtonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  // v6 `.whyplain`: unboxed, 13.5 / 1.55 in ink2.
  whyBlock: { marginTop: spacing.cozy, gap: spacing.xs },
  whyText: { fontSize: 13.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 21 },
  legendLink: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
    textDecorationLine: "underline",
  },
  // v6 `.sec`: Bodoni 25 over a 1px ink rule, 30px below the previous block.
  sectionHeading: {
    marginTop: spacing.section,
    paddingBottom: 6,
    fontSize: typeScale.section.fontSize,
    lineHeight: typeScale.section.lineHeight,
    fontFamily: typeScale.section.fontFamily,
    fontWeight: typeScale.section.fontWeight,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  // v6 `.boxed`: a 1px ink box, square, 16px padding.
  card: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.ink,
    gap: spacing.md,
  },
  cardBody: { fontSize: 13.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 20 },
  // Non-colour affordance (no danger/rose here: a ledger write error is
  // neither an allergen verdict nor an expiry cue, same reasoning as
  // onboarding's noticeBox pattern): an icon plus an ink2-bordered tile panel
  // (v6 `.offbar`).
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.snug,
    marginTop: spacing.md,
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
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.cozy },
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
  // v6 `.step b` (Bodoni 26) on an editable field: bottom rule like `.inp`.
  amountInput: {
    flex: 1,
    minWidth: 72,
    minHeight: minTouchTarget,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.ink,
    paddingHorizontal: 2,
    textAlign: "center",
    fontSize: typeScale.stepper.fontSize,
    fontFamily: typeScale.stepper.fontFamily,
    fontWeight: typeScale.stepper.fontWeight,
    color: colors.ink,
  },
  // Invalid input stays ink, heavier: danger is allergen-only (tokens.md section 5).
  amountInputInvalid: { borderBottomWidth: 3 },
  amountHint: { fontSize: 12.5, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  // v6 `.unitlbl`: 14 / 600 ink2.
  stepUnit: { fontSize: 14, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  // v6 `.btn.pri.wide`: ink pill, 52px.
  primaryButton: {
    minHeight: 52,
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
  // v6 `.chips.wrap` and `.chip`: 1.5px ink outline pills, 40px (hit slop to 44).
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
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
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.white },
  // v6 `.row` (lots): hairline-ruled, 60px minimum.
  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.snug,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  lotMeta: { flex: 1, gap: 3 },
  lotAmount: {
    fontSize: typeScale.rowTitle.fontSize,
    lineHeight: typeScale.rowTitle.lineHeight,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  lotCaptionRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  lotCaption: { fontSize: 13, lineHeight: 17, color: colors.ink2, fontFamily: fontFamily.body },
  // v6 `.days`: 12px 700 uppercase pill, tinted by the expiry ladder.
  days: {
    fontSize: typeScale.chip.fontSize,
    lineHeight: 12,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    letterSpacing: 12 * 0.12,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  // v6 `.led`: ruled ledger rows; the system adjustment sits on a tile.
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.snug,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  historyRowSystem: { backgroundColor: colors.tile, paddingHorizontal: spacing.snug },
  historyIcon: { width: 20, alignItems: "center", paddingTop: 1 },
  historyIconGlyph: { fontSize: 14, color: colors.ink2 },
  historyMeta: { flex: 1, gap: 3 },
  historyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  historyTitle: {
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.msrc`: 12 / 700 uppercase on a tile, square.
  autoBadge: {
    fontSize: typeScale.chip.fontSize,
    fontWeight: "700",
    color: colors.ink2,
    backgroundColor: colors.paper,
    paddingHorizontal: 6,
    paddingVertical: 3,
    letterSpacing: 12 * 0.08,
    textTransform: "uppercase",
    overflow: "hidden",
  },
  historyCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  historyCaption: {
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  // v6 `.mchip`: 26px ink disc, white initials.
  initialsChip: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    color: colors.white,
    textAlign: "center",
    lineHeight: 26,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    overflow: "hidden",
  },
  historyTime: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  amtPositive: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.green,
    fontFamily: fontFamily.body,
  },
  amtNegative: { fontSize: 14, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
});
