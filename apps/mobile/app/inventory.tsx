import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { InventoryItemSummaryDto } from "@smart-kitchen/contracts";
import { apiClient } from "../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../src/design/tokens";
import { CENTER_ACTION } from "../src/navigation/tabs";
import { daysUntil, expiryUrgencyText, freshnessRing } from "../src/inventory/expiry";
import {
  buildInventoryListView,
  LOCATION_LABELS,
  type LocationFilter,
} from "../src/inventory/list-view";
import { GENERIC_LEDGER_ERROR_MESSAGE } from "../src/inventory/errors";
import { loadInventoryList } from "../src/inventory/load-inventory";
import { useReducedMotion, pressScaleStyle } from "../src/inventory/motion";
import {
  chipAccessibilityLabel,
  ROW_CHIP_TEXT,
  tierRowAnnouncement,
} from "../src/inventory/provenance";
import { formatQuantityDisplay } from "../src/inventory/quantity";
import { useToast } from "../src/inventory/Toast";

const LOCATION_TABS: readonly LocationFilter[] = ["all", "FRIDGE", "FREEZER", "PANTRY"];
const LOCATION_TAB_LABELS: Readonly<Record<LocationFilter, string>> = {
  all: "All",
  FRIDGE: "Fridge",
  FREEZER: "Freezer",
  PANTRY: "Pantry",
  OTHER: "Other",
};

/**
 * S4 · inventory list (M3-T3), prototype v4 `#scr-inventory`. Loads once on
 * mount; screens must not assume a household exists yet (M3-T2 follow-up:
 * `app/_layout.tsx` can render this component for one frame before its
 * redirect resolves), so every read here tolerates an empty/loading result
 * rather than assuming one.
 */
export default function InventoryScreen(): React.JSX.Element {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { show } = useToast();

  const [items, setItems] = useState<readonly InventoryItemSummaryDto[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [location, setLocation] = useState<LocationFilter>("all");
  const [sortByExpiry, setSortByExpiry] = useState(false);
  const [needsConfirmationOnly, setNeedsConfirmationOnly] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    void loadInventoryList(apiClient).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setItems(result.items);
        setStale(result.stale);
      } else {
        // Review F5: a cold-start read has no cache to fall back to (the
        // client rejects rather than serving stale data it doesn't have),
        // so without this the screen stayed a blank shell forever. items
        // stays null; the render below shows the generic fallback instead.
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  async function handleConfirm(itemId: string, name: string): Promise<void> {
    await apiClient.confirmAiProposal(itemId);
    load();
    show(`${name} confirmed`);
  }

  function clearFilters(): void {
    setLocation("all");
    setNeedsConfirmationOnly(false);
  }

  // Tolerates the pre-redirect frame (M3-T2 follow-up): render the shell,
  // nothing crashes while `items` is still null.
  if (items === null) {
    if (loadError) {
      // Review F5: a cold-start read has no cache to fall back to (unlike a
      // failure after a prior success, which the stale-offline banner below
      // handles), so without this the screen stayed blank forever.
      return (
        <View style={styles.screen}>
          <View style={styles.emptyWrap} accessibilityLiveRegion="assertive">
            <Text style={styles.emptyTitle}>Couldn't load your inventory.</Text>
            <Text style={styles.emptyBody}>{GENERIC_LEDGER_ERROR_MESSAGE}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={load}
              style={({ pressed }) => [
                styles.primaryButton,
                pressScaleStyle(pressed, reducedMotion),
              ]}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return <View style={styles.screen} />;
  }

  const now = new Date().toISOString();
  const view = buildInventoryListView(
    items,
    { location, sortByExpiry, needsConfirmationOnly },
    now,
  );
  const isFirstRun = items.length === 0;
  // Review F2: the location-only empty state ("No items here yet.") and the
  // filtered-empty state ("No items match that filter.") are two different
  // copy-deck.md §7 S4 states with two different causes; branch on
  // view.emptyCause rather than a single isFilteredEmpty flag that always
  // won.
  const isLocationEmpty = !isFirstRun && view.emptyCause === "location";
  const isFilteredEmpty = !isFirstRun && view.emptyCause === "filtered";
  const verifiedCount = items.filter((i) => i.provenance.quantity?.tier === "KNOWN_FACT").length;
  const verifiedPercent = items.length === 0 ? 0 : Math.round((verifiedCount / items.length) * 100);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Inventory</Text>
          {isFirstRun ? (
            <View style={styles.subRow}>
              <Text style={styles.sub}>no items yet · </Text>
              <LegendLink onPress={() => router.push("/legend")} />
            </View>
          ) : (
            <View style={styles.subRow}>
              <Text style={styles.sub}>
                {items.length} items · {verifiedPercent}% verified ·{" "}
              </Text>
              <LegendLink onPress={() => router.push("/legend")} />
            </View>
          )}
        </View>
        {/* Review F18 (architect): the prototype's search icon only ever
            toasts "not in this mockup" (P10 scope honesty forbids shipping
            an affordance that does nothing real); hidden entirely until it
            has a real implementation, planned for M4. */}
      </View>

      {stale ? (
        <View style={styles.staleBanner} accessibilityLiveRegion="polite">
          <Text style={styles.staleText}>
            Showing your last saved list. Changes from your household will appear when you're back
            online.
          </Text>
        </View>
      ) : null}

      {isFirstRun ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>
            Every item you add shows its provenance, so you always know what is a verified fact and
            what is a guess.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan a barcode"
            onPress={() => router.push(CENTER_ACTION.route)}
            style={({ pressed }) => [styles.primaryButton, pressScaleStyle(pressed, reducedMotion)]}
          >
            <Text style={styles.primaryButtonText}>Scan a barcode</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.seg}>
            {LOCATION_TABS.map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="button"
                accessibilityLabel={LOCATION_TAB_LABELS[tab]}
                accessibilityState={{ selected: location === tab }}
                onPress={() => setLocation(tab)}
                style={[styles.segButton, location === tab ? styles.segButtonOn : null]}
              >
                <Text style={[styles.segText, location === tab ? styles.segTextOn : null]}>
                  {LOCATION_TAB_LABELS[tab]}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.chipsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort by expiry"
              accessibilityState={{ selected: sortByExpiry }}
              hitSlop={6}
              onPress={() => setSortByExpiry((v) => !v)}
              style={[styles.chip, sortByExpiry ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, sortByExpiry ? styles.chipTextOn : null]}>
                Sort · expiry
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Needs confirmation"
              accessibilityState={{ selected: needsConfirmationOnly }}
              hitSlop={6}
              onPress={() => setNeedsConfirmationOnly((v) => !v)}
              style={[styles.chip, needsConfirmationOnly ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, needsConfirmationOnly ? styles.chipTextOn : null]}>
                Needs confirmation
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {view.needsConfirmationTray.length > 0 ? (
              <View style={styles.tray}>
                <View style={styles.trayHeader}>
                  <Text style={styles.trayHeading}>Needs your confirmation</Text>
                  <Text style={styles.trayCount}>{view.needsConfirmationTray.length}</Text>
                </View>
                {view.needsConfirmationTray.map((item) => (
                  <TrayRow
                    key={item.itemId}
                    item={item}
                    reducedMotion={reducedMotion}
                    onConfirm={() => void handleConfirm(item.itemId, item.displayName ?? "Item")}
                    onEdit={() => router.push(`/inventory/${item.itemId}`)}
                  />
                ))}
              </View>
            ) : null}

            {isFilteredEmpty ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No items match that filter.</Text>
                <Text style={styles.emptyBody}>Try a different location or clear your search.</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear filter"
                  onPress={clearFilters}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressScaleStyle(pressed, reducedMotion),
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Clear filter</Text>
                </Pressable>
              </View>
            ) : isLocationEmpty ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No items here yet.</Text>
                <Text style={styles.emptyBody}>
                  Everything you add to this location will show up here.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add an item"
                  onPress={() => router.push(CENTER_ACTION.route)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressScaleStyle(pressed, reducedMotion),
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Add an item</Text>
                </Pressable>
              </View>
            ) : (
              view.groups.map((group) => (
                <View key={group.location}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle}>{LOCATION_LABELS[group.location]}</Text>
                    <Text style={styles.groupCount}>
                      {group.items.length} {group.items.length === 1 ? "item" : "items"}
                    </Text>
                  </View>
                  {group.items.map((item) => (
                    <InventoryRow
                      key={item.itemId}
                      item={item}
                      now={now}
                      reducedMotion={reducedMotion}
                      onPress={() => router.push(`/inventory/${item.itemId}`)}
                      onConfirm={() => void handleConfirm(item.itemId, item.displayName ?? "Item")}
                    />
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function LegendLink({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="What do these mean?"
      hitSlop={15}
      onPress={onPress}
    >
      <Text style={styles.legendLink}>what do these mean?</Text>
    </Pressable>
  );
}

function TrayRow({
  item,
  reducedMotion,
  onConfirm,
  onEdit,
}: {
  item: InventoryItemSummaryDto;
  reducedMotion: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  const qty = formatQuantityDisplay(
    item.quantity,
    item.lots,
    item.provenance.quantity?.tier ?? null,
  );
  return (
    <View style={styles.trayRow}>
      <View style={styles.trayThumb}>
        <Text style={styles.trayThumbGlyph}>{(item.displayName ?? "?").charAt(0)}</Text>
      </View>
      <View style={styles.trayMeta}>
        <Text style={styles.trayName}>
          {item.displayName} · {qty}?
        </Text>
        {item.provenance.quantity?.source ? (
          <Text style={styles.traySource}>{item.provenance.quantity.source}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Confirm ${item.displayName ?? "item"}`}
        onPress={onConfirm}
        style={({ pressed }) => [styles.okButton, pressScaleStyle(pressed, reducedMotion)]}
      >
        <Text style={styles.okButtonText}>Confirm</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.displayName ?? "item"}`}
        onPress={onEdit}
        style={({ pressed }) => [
          styles.okButton,
          styles.okButtonGhost,
          pressScaleStyle(pressed, reducedMotion),
        ]}
      >
        <Text style={styles.okButtonGhostText}>Edit</Text>
      </Pressable>
    </View>
  );
}

function InventoryRow({
  item,
  now,
  reducedMotion,
  onPress,
  onConfirm,
}: {
  item: InventoryItemSummaryDto;
  now: string;
  reducedMotion: boolean;
  onPress: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const tier = item.provenance.quantity?.tier ?? null;
  const qty = formatQuantityDisplay(item.quantity, item.lots, tier);
  const days = item.earliestExpiresAt === null ? null : daysUntil(now, item.earliestExpiresAt);
  const ring = freshnessRing(days);
  const urgency = expiryUrgencyText(days);
  const chip = tier ? ROW_CHIP_TEXT[tier] : null;
  const name = item.displayName ?? "Item";
  // Review F8: the chip is a separate element (and, for AI, its own
  // Pressable per F9), so the row's own label would otherwise never
  // announce the tier at all; append it explicitly.
  const rowLabel = `${name}, ${qty}${urgency ? `, ${urgency}` : ""}${tier ? `, ${tierRowAnnouncement(tier)}` : ""}`;

  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.itemMain, pressScaleStyle(pressed, reducedMotion)]}
      >
        <View style={[styles.ring, ringStyleFor(ring)]}>
          <Text style={styles.ringGlyph}>{name.charAt(0)}</Text>
        </View>
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.displayName}</Text>
          <Text style={styles.itemQty}>
            {qty}
            {urgency ? ` · ${urgency}` : ""}
          </Text>
        </View>
      </Pressable>
      {/* Review F9: the AI chip on a row is the Confirm action itself
          (copy-deck.md §4), same as the tray's Confirm button, not a
          passive label; it is its own 44pt target, not nested inside the
          row's navigate-to-detail Pressable. */}
      {tier === "AI_INTERPRETATION" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Confirm ${name}`}
          onPress={onConfirm}
          style={({ pressed }) => [styles.okButton, pressScaleStyle(pressed, reducedMotion)]}
        >
          <Text style={styles.okButtonText}>{chip}</Text>
        </Pressable>
      ) : chip && tier ? (
        <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel(tier)}>
          {chip}
        </Text>
      ) : null}
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 28, fontFamily: fontFamily.display, fontWeight: "600", color: colors.ink },
  subRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  sub: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  legendLink: {
    fontSize: 12.5,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    textDecorationLine: "underline",
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
  iconGlyph: { fontSize: 16 },
  staleBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.sand2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  staleText: { fontSize: 12, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 17 },
  seg: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 3,
  },
  segButton: {
    flex: 1,
    // tokens.md §5 remediation C: `.seg button` sits edge-to-edge in a shared
    // row, so the row's own height grows to 44pt rather than using hitSlop
    // (hitSlop here would overlap the neighbouring segment).
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm - 3,
  },
  segButtonOn: { backgroundColor: colors.espresso },
  segText: { fontSize: 12.5, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  segTextOn: { color: colors.cream },
  chipsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
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
  chipText: { fontSize: 12.5, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  chipTextOn: { color: colors.cream },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  tray: {
    borderRadius: radius.md,
    backgroundColor: colors.aiBg,
    borderWidth: 1,
    borderColor: colors.ai,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  trayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  trayHeading: { fontSize: 13, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  trayCount: { fontSize: 12, color: colors.ink2, fontFamily: fontFamily.body },
  trayRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  trayThumb: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  trayThumbGlyph: { fontFamily: "monospace", color: colors.ink2 },
  trayMeta: { flex: 1, gap: 1 },
  trayName: { fontSize: 13, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  traySource: { fontSize: 11, color: colors.ink3, fontFamily: fontFamily.body },
  okButton: {
    minHeight: minTouchTarget,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.ai,
    alignItems: "center",
    justifyContent: "center",
  },
  okButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.white,
    fontFamily: fontFamily.body,
  },
  okButtonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.ai },
  okButtonGhostText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ai,
    fontFamily: fontFamily.body,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  groupTitle: { fontSize: 13, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  groupCount: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // Review F9: the row's navigate-to-detail area and the AI chip's own
  // Confirm action are siblings, not nested Pressables, so a screen reader
  // reaches both as separate focusable elements.
  itemMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ring: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  ringGlyph: { fontFamily: "monospace", color: colors.ink2 },
  itemMeta: { flex: 1, gap: 1 },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  itemQty: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
  provChip: { fontSize: 11, fontWeight: "700", color: colors.ink2, fontFamily: fontFamily.body },
  emptyWrap: {
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  emptyTitle: {
    fontSize: 19,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
  },
  emptyBody: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body, textAlign: "center" },
  primaryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
