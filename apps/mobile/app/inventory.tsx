import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { InventoryItemSummaryDto } from "@smart-kitchen/contracts";
import { apiClient } from "../src/api/client";
import { provChipStyle } from "../src/design/chips";
import {
  colors,
  fontFamily,
  minTouchTarget,
  radius,
  spacing,
  typeScale,
} from "../src/design/tokens";
import { useTabBarClearance } from "../src/navigation/TabBar";
import { CENTER_ACTION } from "../src/navigation/tabs";
import { daysUntil, expiryDisplayText, freshnessRing } from "../src/inventory/expiry";
import {
  buildInventoryListView,
  LOCATION_LABELS,
  type LocationFilter,
} from "../src/inventory/list-view";
import { GENERIC_LEDGER_ERROR_MESSAGE, GENERIC_READ_ERROR_MESSAGE } from "../src/inventory/errors";
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
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
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
    try {
      await apiClient.confirmAiProposal(itemId);
    } catch {
      // BUG-004: a failed confirm is a failed write. Generic ledger fallback
      // (copy-deck §8), the tray row stays, nothing reloads. Never the raw
      // Error.message.
      show(GENERIC_LEDGER_ERROR_MESSAGE);
      return;
    }
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
      // handles), so without this the screen stayed blank forever. A load is
      // a read, so it wears the copy-deck §8 read fallback, never the save
      // string (M9-T0 h).
      return (
        <View style={styles.screen}>
          <View style={styles.emptyWrap} accessibilityLiveRegion="assertive">
            <Text style={styles.emptyTitle}>Couldn't load your inventory.</Text>
            <Text style={styles.emptyBody}>{GENERIC_READ_ERROR_MESSAGE}</Text>
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
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
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

          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
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
  const urgency = expiryDisplayText(days, item.provenance.earliestExpiresAt?.tier);
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
        <View style={styles.thumb}>
          <Text style={styles.thumbGlyph}>{name.charAt(0)}</Text>
        </View>
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.displayName}</Text>
          <View style={styles.qtyLine}>
            <Text style={styles.itemQty}>{qty}</Text>
            {urgency ? <Text style={[styles.days, daysStyleFor(ring)]}>{urgency}</Text> : null}
          </View>
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
          hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
          onPress={onConfirm}
          style={({ pressed }) => pressScaleStyle(pressed, reducedMotion)}
        >
          <Text style={provChipStyle("AI_INTERPRETATION")}>{chip}</Text>
        </Pressable>
      ) : chip && tier ? (
        <Text style={provChipStyle(tier)} accessibilityLabel={chipAccessibilityLabel(tier)}>
          {chip}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * v6 `.days`: the expiry ladder, rose (use today), amber (soon), green (further
 * out), each on its tint. Never red. The words always travel with the colour.
 */
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
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xs,
  },
  headerText: { flex: 1, gap: 6 },
  // v6 `.title`: Bodoni 44.
  title: {
    paddingTop: spacing.md,
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
    letterSpacing: typeScale.title.letterSpacing,
    fontFamily: typeScale.title.fontFamily,
    fontWeight: typeScale.title.fontWeight,
    color: colors.ink,
  },
  subRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  sub: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "500",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  // v6 `.lg`: ink, 600, underlined.
  legendLink: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.ink,
    fontFamily: fontFamily.body,
    textDecorationLine: "underline",
  },
  staleBanner: {
    marginHorizontal: spacing.gutter,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.tile,
    borderWidth: 1,
    borderColor: colors.ink2,
  },
  staleText: { fontSize: 13, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 19 },
  // v6 `.seg`: underlined tabs, a hairline under the row and a 2px ink bar on
  // the selected one.
  seg: {
    flexDirection: "row",
    gap: spacing.gutter,
    marginHorizontal: spacing.gutter,
    marginTop: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  segButton: {
    // tokens.md section 5 remediation C: 44pt tall without hitSlop.
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  segButtonOn: { borderBottomColor: colors.ink },
  segText: { fontSize: 14, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  segTextOn: { color: colors.ink },
  // v6 `.chip`: 1.5px ink outline pill; pressed state is ink fill.
  chipsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: 2,
  },
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
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs,
  },
  // v6 `.tray`: AI tint panel, 14px corners, no border, hairlines between rows.
  tray: {
    borderRadius: radius.panel,
    backgroundColor: colors.aiBg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.cozy,
    marginTop: spacing.snug,
  },
  trayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: spacing.snug,
    paddingBottom: spacing.xs,
  },
  trayHeading: { fontSize: 13.5, fontWeight: "700", color: colors.ai, fontFamily: fontFamily.body },
  trayCount: { fontSize: 13.5, fontWeight: "700", color: colors.ai, fontFamily: fontFamily.body },
  trayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.snug,
    paddingVertical: spacing.snug,
    borderBottomWidth: 1,
    borderBottomColor: colors.aiHair,
  },
  trayThumb: {
    width: 44,
    height: 44,
    backgroundColor: colors.aiTile,
    alignItems: "center",
    justifyContent: "center",
  },
  trayThumbGlyph: {
    fontFamily: fontFamily.display,
    fontWeight: "500",
    fontSize: 20,
    color: colors.ink3,
  },
  trayMeta: { flex: 1, minWidth: 0 },
  trayName: {
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  traySource: { fontSize: 12.5, lineHeight: 17, color: colors.aiInk, fontFamily: fontFamily.body },
  // v6 `.okb`: ink pill, white label, 44px; `.okb.ghost` is an ink outline.
  okButton: {
    minHeight: minTouchTarget,
    minWidth: 56,
    paddingHorizontal: spacing.cozy,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  okButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.white,
    fontFamily: fontFamily.body,
  },
  okButtonGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.ink },
  okButtonGhostText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  // v6 `.grp`: Bodoni 22 over a 1px ink rule, count at the right.
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.xl,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  groupTitle: {
    fontSize: typeScale.group.fontSize,
    lineHeight: typeScale.group.lineHeight,
    fontFamily: typeScale.group.fontFamily,
    fontWeight: typeScale.group.fontWeight,
    color: colors.ink,
  },
  groupCount: { fontSize: 12, fontWeight: "600", color: colors.ink2, fontFamily: fontFamily.body },
  // v6 `.row`: 56px square tile, title 15.5 / 700, detail 13 in ink2, hairline.
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.snug,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  // Review F9: the row's navigate-to-detail area and the AI chip's own
  // Confirm action are siblings, not nested Pressables, so a screen reader
  // reaches both as separate focusable elements.
  itemMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: {
    width: 56,
    height: 56,
    backgroundColor: colors.tile,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbGlyph: {
    fontFamily: fontFamily.display,
    fontWeight: "500",
    fontSize: 24,
    color: colors.ink3,
  },
  itemMeta: { flex: 1, gap: 3 },
  itemName: {
    fontSize: typeScale.rowTitle.fontSize,
    lineHeight: typeScale.rowTitle.lineHeight,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  qtyLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  itemQty: { fontSize: 13, lineHeight: 17, color: colors.ink2, fontFamily: fontFamily.body },
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
  // v6 `.emptyst`: dashed ink2 panel, Bodoni 28, ink pill button.
  emptyWrap: {
    alignItems: "center",
    gap: spacing.snug,
    marginHorizontal: spacing.gutter,
    marginTop: 22,
    paddingVertical: 28,
    paddingHorizontal: spacing.gutter,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.ink2,
  },
  emptyTitle: {
    fontSize: typeScale.empty.fontSize,
    lineHeight: typeScale.empty.lineHeight,
    fontFamily: typeScale.empty.fontFamily,
    fontWeight: typeScale.empty.fontWeight,
    color: colors.ink,
    textAlign: "center",
  },
  emptyBody: {
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    textAlign: "center",
  },
  // v6 `.btn.pri`: ink pill, 50px.
  primaryButton: {
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: typeScale.button.fontSize,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
