import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type {
  InventoryItemDetailDto,
  InventoryTransactionDto,
  ProvenanceTierDto,
} from "@smart-kitchen/contracts";
import { apiClient, type RemovalAction } from "../../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../../src/design/tokens";
import { messageForLedgerError } from "../../src/inventory/errors";
import { daysUntil, expiryUrgencyText, freshnessRing } from "../../src/inventory/expiry";
import { useReducedMotion, pressScaleStyle } from "../../src/inventory/motion";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../../src/inventory/provenance";
import {
  formatQuantityDisplay,
  formatSignedAmount,
  microsToAmountText,
  parseMicros,
  trimAmountText,
} from "../../src/inventory/quantity";
import {
  ACTION_LABELS,
  REMOVAL_REASON_CHIPS,
  REMOVAL_SUB_REASONS,
  rowIsRemoval,
} from "../../src/inventory/transactions";
import { buildWhyLine, clampSentence, formatRowTimestamp } from "../../src/inventory/why";
import { useToast, ToastBanner } from "../../src/inventory/Toast";
import { LOCATION_LABELS } from "../../src/inventory/list-view";

const STEP_MICROS = 250_000n; // 0.25 unit, matching prototype v4's stepItemQty(±0.25)

/**
 * S5 · item detail / ledger history (M3-T3), prototype v4 `#scr-item`.
 * Tolerates the pre-redirect frame the same way S4 does: `itemId` from the
 * route may resolve before a household exists, so every state here starts
 * `null` and the component renders an empty shell rather than assuming data.
 */
export default function ItemDetailScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ itemId: string }>();
  const itemId = params.itemId;
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { toast, show } = useToast();

  const [detail, setDetail] = useState<InventoryItemDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draftMicros, setDraftMicros] = useState<bigint | null>(null);
  const [pendingReason, setPendingReason] = useState<RemovalAction | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);

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
        setDraftMicros(parseMicros(result.summary.quantity.micros));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => load(), [load]);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/inventory");
    }
  }

  function stepDraft(deltaMicros: bigint): void {
    setDraftMicros((prev) => {
      if (prev === null) {
        return prev;
      }
      const next = prev + deltaMicros;
      return next < 0n ? 0n : next;
    });
  }

  async function handleUndo(transactionId: string): Promise<void> {
    if (!itemId) {
      return;
    }
    await apiClient.undo(transactionId);
    const updated = await apiClient.getInventoryItem(itemId);
    setDetail(updated);
    if (updated) {
      setDraftMicros(parseMicros(updated.summary.quantity.micros));
    }
  }

  async function handleSaveCorrection(): Promise<void> {
    if (!itemId || draftMicros === null) {
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
      setDraftMicros(parseMicros(updated.summary.quantity.micros));
    }
    show("Corrected. Undo", () => void handleUndo(result.transactionId));
  }

  async function handleApplyReason(subReason: string): Promise<void> {
    if (!itemId || !pendingReason) {
      return;
    }
    // Review F7: the reason top-chips are disabled at a zero balance (see
    // the render below), but catch anyway rather than leave an unhandled
    // rejection for a race (another write zeroing the item between render
    // and this tap).
    try {
      await apiClient.removeQuantity(itemId, pendingReason, subReason);
    } catch (error) {
      const message = messageForLedgerError(error);
      setRemovalError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setPendingReason(null);
    setRemovalError(null);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/inventory");
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
  const draftAmountText = formatDraftAmount(draftMicros);
  const canSave = draftMicros !== parseMicros(summary.quantity.micros);
  // Review F7: nothing to remove at a zero balance; disable the reason
  // chips rather than let a tap reach a rejected removeQuantity call.
  const isZeroBalance = parseMicros(summary.quantity.micros) <= 0n;
  const historyNewestFirst = [...detail.history].reverse();
  const whyLine = buildWhyLine(qtyDisplay, summary.quantity.unit, detail.history);

  return (
    <View style={styles.screen}>
      <Header onBack={handleBack} title={summary.displayName ?? "Item"} chip={tier} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.qtyBig}>
          <Text style={styles.qtyBigText}>{qtyDisplay}</Text>
          <Text style={styles.qtyBigSub}>
            on hand ·{" "}
            {summary.storageLocation ? LOCATION_LABELS[summary.storageLocation] : "Unassigned"}
          </Text>
        </View>

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
              accessibilityLabel="Decrease quantity by 0.25"
              onPress={() => stepDraft(-STEP_MICROS)}
              style={({ pressed }) => [styles.stepButton, pressScaleStyle(pressed, reducedMotion)]}
            >
              <Text style={styles.stepButtonText}>{"−"}</Text>
            </Pressable>
            <Text style={styles.stepValue}>{draftAmountText}</Text>
            <Text style={styles.stepUnit}>{summary.quantity.unit}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase quantity by 0.25"
              onPress={() => stepDraft(STEP_MICROS)}
              style={({ pressed }) => [styles.stepButton, pressScaleStyle(pressed, reducedMotion)]}
            >
              <Text style={styles.stepButtonText}>+</Text>
            </Pressable>
          </View>
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

        {summary.lots.length > 0 ? (
          <>
            <Text style={styles.sectionHeading}>Lots</Text>
            {summary.lots.map((lot) => {
              const lotTier = lot.expiresAtProvenance?.tier ?? null;
              const days =
                lot.expiresAt === null ? null : daysUntil(new Date().toISOString(), lot.expiresAt);
              const ring = freshnessRing(days);
              const urgency = expiryUrgencyText(days);
              return (
                <View key={lot.lotId} style={styles.lotRow}>
                  <View style={[styles.lotRing, ringStyleFor(ring)]} />
                  <View style={styles.lotMeta}>
                    <Text style={styles.lotAmount}>
                      {trimAmountText(lot.quantity.amount)} {lot.quantity.unit}
                    </Text>
                    <Text style={styles.lotCaption}>
                      {lot.label ?? "acquired"}
                      {urgency
                        ? ` · expires ${urgency === "use today" ? "today" : `in ${urgency}`}`
                        : ""}
                    </Text>
                  </View>
                  {lotTier ? (
                    <Text
                      style={styles.provChip}
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
        {historyNewestFirst.map((tx) => (
          <HistoryRow key={tx.transactionId} tx={tx} unit={summary.quantity.unit} />
        ))}
      </ScrollView>
      <ToastBanner toast={toast} />
    </View>
  );
}

function formatDraftAmount(draftMicros: bigint): string {
  return trimAmountText(microsToAmountText(draftMicros));
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
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={onBack}
        style={styles.iconButton}
      >
        <Text style={styles.iconGlyph}>{"‹"}</Text>
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      {chip ? (
        <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel(chip)}>
          {ROW_CHIP_TEXT[chip]}
        </Text>
      ) : null}
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
              style={styles.provChipSmall}
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
  // title, and is never set on a removal row.
  const title = tx.correlationLabel
    ? `${ACTION_LABELS[tx.type]} in ${tx.correlationLabel}`
    : ACTION_LABELS[tx.type];
  const captionText =
    rowIsRemoval(tx.type) && tx.provenance.source
      ? `reason: ${tx.provenance.source.toLowerCase()}`
      : tx.provenance.source;
  const isNegative = tx.deltaMicros.startsWith("-");

  return (
    <View style={styles.historyRow}>
      <View style={styles.historyIcon}>
        <Text style={styles.historyIconGlyph}>{isNegative ? "−" : "+"}</Text>
      </View>
      <View style={styles.historyMeta}>
        <Text style={styles.historyTitle}>{title}</Text>
        <View style={styles.historyCaptionRow}>
          {tx.actor.displayInitials ? (
            <Text style={styles.initialsChip}>{tx.actor.displayInitials}</Text>
          ) : null}
          {captionText ? <Text style={styles.historyCaption}>{captionText}</Text> : null}
          <Text
            style={styles.provChipSmall}
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

function ringStyleFor(ring: ReturnType<typeof freshnessRing>): { borderColor: string } {
  switch (ring) {
    case "now":
      return { borderColor: colors.rose };
    case "soon":
      return { borderColor: colors.amber };
    case "fresh":
      return { borderColor: colors.green };
    default:
      return { borderColor: colors.line };
  }
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
    flex: 1,
    fontSize: 20,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  notFound: { padding: spacing.lg, fontSize: 14, color: colors.ink2, fontFamily: fontFamily.body },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.sm },
  qtyBig: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  qtyBigText: {
    fontSize: 30,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  qtyBigSub: { fontSize: 13, color: colors.ink3, fontFamily: fontFamily.body },
  whyBlock: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  whyText: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 18 },
  legendLink: {
    fontSize: 12.5,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    textDecorationLine: "underline",
  },
  sectionHeading: {
    fontSize: 16,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardBody: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 18 },
  // Non-colour affordance (no danger/rose here: a ledger write error is
  // neither an allergen verdict nor an expiry cue, same reasoning as
  // onboarding's noticeBox pattern): an icon plus a sand2-bordered container.
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
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
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
  stepUnit: { fontSize: 13, color: colors.ink3, fontFamily: fontFamily.body },
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
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 12.5, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.cream },
  lotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  lotRing: { width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
  lotMeta: { flex: 1, gap: 1 },
  lotAmount: { fontSize: 14, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  lotCaption: { fontSize: 11.5, color: colors.ink3, fontFamily: fontFamily.body },
  provChip: { fontSize: 11, fontWeight: "700", color: colors.ink2, fontFamily: fontFamily.body },
  provChipSmall: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.ink3,
    fontFamily: fontFamily.body,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  historyRowSystem: { backgroundColor: colors.sand2 },
  historyIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  historyIconGlyph: { fontSize: 13, color: colors.ink2 },
  historyMeta: { flex: 1, gap: 2 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  historyTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  autoBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.ink2,
    backgroundColor: colors.sand,
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  historyCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  historyCaption: { fontSize: 11.5, color: colors.ink2, fontFamily: fontFamily.body },
  initialsChip: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.ink,
    backgroundColor: colors.sand2,
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  historyTime: { fontSize: 10.5, color: colors.ink3, fontFamily: fontFamily.body },
  amtPositive: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.green,
    fontFamily: fontFamily.body,
  },
  amtNegative: { fontSize: 13, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
});
