import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { ShoppingListDto, ShoppingRowDto } from "@smart-kitchen/contracts";
import { apiClient, hasDevOfflineToggle } from "../src/api/client";
import { nextIdempotencyKey } from "../src/api/idempotency";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../src/design/tokens";
import { useTabBarClearance } from "../src/navigation/TabBar";
import { GENERIC_READ_ERROR_MESSAGE, messageForLedgerError } from "../src/inventory/errors";
import { LOCATION_LABELS } from "../src/inventory/list-view";
import { useReducedMotion, pressScaleStyle } from "../src/inventory/motion";
import { chipAccessibilityLabel, ROW_CHIP_TEXT } from "../src/inventory/provenance";
import { microsToAmountText, parseMicros, trimAmountText } from "../src/inventory/quantity";
import { useToast } from "../src/inventory/Toast";
import {
  aiOriginText,
  doneRowStatusText,
  formatShoppingAmount,
  memberOriginText,
  menuOriginText,
  skipRowAmountText,
} from "../src/shopping/format";
import { buildShoppingListView } from "../src/shopping/list-view";
import type { QueuedCheckOff } from "../src/shopping/queue";
import { sharedShoppingQueue } from "../src/shopping/shared-queue";

/**
 * RN/Metro's dev-mode global (review round 1, F11): the "Simulate offline"
 * dev toggle must never ship in a release bundle, regardless of which
 * `ApiClient` is active. Declared locally (same pattern as
 * `src/config/env.ts`'s `process`): apps/mobile's tsconfig sets `"types":
 * []`, and this identifier genuinely does not exist at all under vitest (no
 * Metro) — confirmed empirically by `test-support/expo-crypto-mock.ts`'s own
 * doc comment ("a bare `import 'expo-crypto'`... throws `ReferenceError:
 * __DEV__ is not defined`") — so `typeof __DEV__` (never a bare reference)
 * is the only safe way to read it. `test-support/vitest-setup.ts` sets it
 * to `true` for the whole test run (the closest test-environment analogue
 * of "a dev build"), which is what lets this screen's own component tests
 * exercise the toggle at all.
 */
declare const __DEV__: boolean;

function isDevBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

/** The fixture identity this session always checks off/adds as (D-022). */
const SESSION_INITIALS = "DC";

/**
 * Reapplies every still-pending queue entry's desired state onto a freshly
 * fetched list (review round 1, F1): a queued check-off made offline never
 * reached the port, so a plain refetch would otherwise show that row back
 * at its pre-check-off state with no "Queued" tag, the exact "never lost
 * silently" violation the blocker finding reproduced (offline check, route
 * away and back, refetch shows it open again). The queue itself is a module
 * singleton (`shared-queue.ts`) that outlives this component, so the entry
 * is still there to reapply after a remount; this function is what actually
 * makes the *rendered* row agree with it again.
 */
function applyQueuedOverlay(list: ShoppingListDto): ShoppingListDto {
  if (sharedShoppingQueue.size === 0) {
    return list;
  }
  return {
    ...list,
    rows: list.rows.map((row) => {
      const entry = sharedShoppingQueue.get(row.rowId);
      if (!entry) {
        return row;
      }
      return {
        ...row,
        status: entry.checked ? "done" : "open",
        checkedOffBy: entry.checked ? SESSION_INITIALS : null,
      };
    }),
  };
}

/**
 * S11 · Shopping list (M3-T5), prototype v4 `#scr-shopping`.
 *
 * ## Close-the-loop, and why the loop bar never appears on load
 *
 * The loop bar (Objective (d)) is tied to *this session's own* check-off
 * action, tracked in `activeLoopRowId` state, never derived from a row that
 * merely arrives `status: "done"` from the fixture (the seeded "Olive oil,
 * added and checked off by Dean" row): that row represents something that
 * already happened before this screen ever loaded, with nothing for this
 * session to "close the loop" on. This is a judgment call flagged in the
 * worker report — the ticket's prose ("after a check-off the loop bar
 * appears") reads naturally as session-scoped, but the static prototype
 * mockup happens to also show the bar for that pre-seeded row, which this
 * screen deliberately does not reproduce. Review round 1 accepted this call.
 *
 * ## Offline and the queue (review round 1, F1/F2/F4 fixes)
 *
 * `apiClient.isOffline()`/`subscribeOffline` (ADR-010 option C) drive the
 * banner. `sharedShoppingQueue` (a module singleton, `shared-queue.ts`) —
 * not a `useRef` — holds the in-session offline queue so it survives this
 * screen unmounting on a route change; `applyQueuedOverlay` (above)
 * reapplies its still-pending entries on every load, including after a
 * remount. A check-off updates its row optimistically first; if this
 * client is offline, **or if this row already has a pending queue entry**
 * (a stale/failed one from an earlier tap), the new tap is enqueued too
 * (replacing that stale entry, never bypassing it — review F2) rather than
 * calling the port directly, and, if online, replayed immediately so it
 * does not wait for the next connectivity flap. `ShoppingCheckOffQueue`
 * itself now also collapses two overlapping `replay` calls into one walk
 * (F4), so a flap while a replay is already running cannot double-apply an
 * entry. The loop bar's Add is never queued (Objective (f), widened at
 * F10): it always needs the server (a no-`itemId` row's Add still saves
 * through S9), so it is refused inline ("Add when you're back online.")
 * for every row kind while offline, not just a tracked item's PURCHASE.
 *
 * ## Round 2 residuals (R1/R2/R3, F14)
 *
 * `load()` itself is also a connectivity signal now (R1): its success
 * branch replays the queue whenever it resolves online with entries still
 * pending, so reconnecting while this screen was unmounted is caught by
 * the very next load rather than waiting for a flap or tap that might
 * never come. `load()` also prunes the queue to whatever rowIds the fresh
 * list actually has (R3): a row that disappeared between the tap and the
 * next load stops being retried forever. `ShoppingCheckOffQueue.replay`
 * itself now chains one collapsed follow-up walk after an in-flight one
 * (R2, tightened again at R2b for a follow-up walk's own follow-up), so an
 * entry enqueued while a walk is already running is not stranded either.
 * `landedRowIds` (F14) stops the loop bar reopening at all for a row once
 * its Add has landed this mount (round 2's first pass still opened a bare,
 * action-less headline for it, which read as broken; round 3 skips
 * opening it altogether), since the fixture's own per-row cache already
 * makes a repeat Add a silent no-op and reoffering it only invited a
 * redundant, misleading success toast.
 */
export default function ShoppingScreen(): React.JSX.Element {
  // M3-T10: the header clears the status bar, as Home does (BUG-007).
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { show } = useToast();

  const [list, setList] = useState<ShoppingListDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [offline, setOffline] = useState(() => apiClient.isOffline());
  const [queuedRowIds, setQueuedRowIds] = useState<ReadonlySet<string>>(
    () => new Set(sharedShoppingQueue.queuedRowIds()),
  );
  const [activeLoopRowId, setActiveLoopRowId] = useState<string | null>(null);
  // Review F3: one Add idempotency key per loop-bar-open event, minted when
  // the row is checked off and reused for every Add press on that same
  // opening (never re-minted per press, so a double-tap before the first
  // press settles cannot mint two different keys for the same intent).
  const [addKeyByRowId, setAddKeyByRowId] = useState<Readonly<Record<string, string>>>({});
  // Review F3: disables Add while its own request is in flight.
  const [addingRowId, setAddingRowId] = useState<string | null>(null);
  // Review round 2, F14: rows whose Add has already landed this mount, so
  // re-checking a row after Add succeeded (uncheck, re-check) never offers
  // Add again (the fixture-level per-row cache in `addCheckedOffToInventory`
  // already stops a second PURCHASE; this stops the redundant success toast
  // that would otherwise fire from a second, harmless-but-misleading Add).
  // Scoped to this mount only, same as `addKeyByRowId`/`addingRowId`: a
  // remount can re-offer Add for an already-landed row, which would show
  // one redundant toast but, per the fixture's own guard, never a second
  // PURCHASE (flagged in the worker report, not a data-integrity risk).
  const [landedRowIds, setLandedRowIds] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    void apiClient.getShoppingList().then(
      (result) => {
        if (!cancelled) {
          // Review R3: a row that dropped out of a fresh list (removed, or
          // simply no longer part of it) has nothing left to sync; retrying
          // it forever would only ever fail. Pruned before the overlay so a
          // gone row's stale entry never gets re-displayed either.
          sharedShoppingQueue.pruneToKnownRows(new Set(result.rows.map((r) => r.rowId)));
          setList(applyQueuedOverlay(result));
          setQueuedRowIds(new Set(sharedShoppingQueue.queuedRowIds()));
          // Review R1: a load is also a connectivity signal. Without this,
          // an entry queued while this screen was unmounted, followed by
          // reconnecting while still unmounted, sat until the next flap or
          // tap once the screen came back, even though this very load just
          // proved the client is online right now.
          if (!apiClient.isOffline() && sharedShoppingQueue.size > 0) {
            void replayQueue();
          }
        }
      },
      () => {
        if (!cancelled) {
          setLoadError(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    return apiClient.subscribeOffline((value) => {
      setOffline(value);
      if (!value) {
        void replayQueue();
      }
    });
  }, []);

  function replayQueue(): Promise<void> {
    return sharedShoppingQueue
      .replay((entry) =>
        apiClient.checkOffShoppingRow(entry.rowId, entry.checked, entry.idempotencyKey),
      )
      .then(() => {
        setQueuedRowIds(new Set(sharedShoppingQueue.queuedRowIds()));
      });
  }

  function updateRow(rowId: string, update: (row: ShoppingRowDto) => ShoppingRowDto): void {
    setList((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.rowId === rowId ? update(r) : r)) } : prev,
    );
  }

  async function handleToggleCheck(row: ShoppingRowDto): Promise<void> {
    const checked = row.status !== "done";
    const key = nextIdempotencyKey();

    updateRow(row.rowId, (r) => ({
      ...r,
      status: checked ? "done" : "open",
      checkedOffBy: checked ? SESSION_INITIALS : null,
    }));
    if (checked) {
      // Review round 3, F14 copy: a row whose Add already landed this
      // mount never reopens the loop bar at all (not just "with no Add
      // action" — round 2's fix still showed the bare headline with
      // nothing under it, which read as broken, not as "already done").
      // There is nothing left to close the loop on for it.
      if (!landedRowIds.has(row.rowId)) {
        setActiveLoopRowId(row.rowId);
        setAddKeyByRowId((prev) => ({ ...prev, [row.rowId]: nextIdempotencyKey() }));
      }
    } else {
      setActiveLoopRowId((current) => (current === row.rowId ? null : current));
    }

    const offlineNow = apiClient.isOffline();
    const hasPendingEntry = sharedShoppingQueue.isQueued(row.rowId);

    if (offlineNow || hasPendingEntry) {
      // Offline: queue it, plain and simple. Online but a stale/failed
      // entry is still pending for this row (review F2): route the new tap
      // through the queue too, replacing that stale entry, rather than
      // bypassing it with a direct call that would leave the stale entry
      // free to resurrect this row's old state on a later replay.
      const entry: QueuedCheckOff = { rowId: row.rowId, checked, idempotencyKey: key };
      sharedShoppingQueue.enqueue(entry);
      setQueuedRowIds(new Set(sharedShoppingQueue.queuedRowIds()));
      if (offlineNow) {
        show(`${row.name} queued. It will sync when you're back online.`);
        return;
      }
      await replayQueue();
      return;
    }

    try {
      await apiClient.checkOffShoppingRow(row.rowId, checked, key);
    } catch (error) {
      // Revert the optimistic update; the ledger/fixture never applied it.
      updateRow(row.rowId, (r) => ({
        ...r,
        status: checked ? "open" : "done",
        checkedOffBy: checked ? null : r.checkedOffBy,
      }));
      if (checked) {
        setActiveLoopRowId((current) => (current === row.rowId ? null : current));
      }
      show(messageForLedgerError(error));
    }
  }

  async function handleRemove(row: ShoppingRowDto): Promise<void> {
    try {
      await apiClient.removeShoppingSuggestion(row.rowId);
      setList((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((r) => r.rowId !== row.rowId) } : prev,
      );
      show(`${row.name} removed · AI suggestion declined`);
    } catch (error) {
      show(messageForLedgerError(error));
    }
  }

  function handleLoopAdd(row: ShoppingRowDto): void {
    if (apiClient.isOffline()) {
      // Refused inline for every row kind (review F10): a no-`itemId` row's
      // Add still saves through S9, a real write, just as much as a
      // tracked item's PURCHASE needs the server.
      return;
    }
    if (addingRowId === row.rowId) {
      return; // already in flight for this row (review F3)
    }
    if (row.itemId === null) {
      setActiveLoopRowId(null);
      router.push({
        pathname: "/add/manual",
        params: {
          name: row.name,
          // Exact decimal text, never re-derived or rounded (review F9;
          // S9's own `prefillCount` is what decides whether this is whole
          // enough to prefill the stepper at all).
          amount: trimAmountText(microsToAmountText(parseMicros(row.buyMicros))),
          unit: row.unit,
          location: row.defaultLocation,
        },
      });
      return;
    }
    // Reuses the key minted when the loop bar opened for this row (review
    // F3); falls back to a fresh one only if this Add is somehow reached
    // without that (defensive, not expected in practice).
    const key = addKeyByRowId[row.rowId] ?? nextIdempotencyKey();
    setAddingRowId(row.rowId);
    apiClient.addCheckedOffToInventory(row.rowId, key).then(
      () => {
        setAddingRowId(null);
        setActiveLoopRowId(null);
        setLandedRowIds((prev) => new Set(prev).add(row.rowId));
        show(`${row.name} added to ${LOCATION_LABELS[row.defaultLocation]} · inventory updated`);
      },
      (error: unknown) => {
        setAddingRowId(null);
        show(messageForLedgerError(error));
      },
    );
  }

  if (list === null) {
    if (loadError) {
      return (
        <View style={styles.screen}>
          <View style={styles.emptyWrap} accessibilityLiveRegion="assertive">
            <Text style={styles.emptyTitle}>Couldn't load your shopping list.</Text>
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

  const view = buildShoppingListView(list);
  const activeLoopRow = list.rows.find((r) => r.rowId === activeLoopRowId) ?? null;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Shopping</Text>
          <Text style={styles.sub}>
            shared · <Text style={styles.subStrong}>{view.buyCount}</Text> to buy · each item shows
            where it came from: a menu gap, an AI suggestion, or the member who added it
          </Text>
        </View>
        <MemberAvatars members={list.members} />
      </View>

      {isDevBuild() && hasDevOfflineToggle(apiClient) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={offline ? "Simulate back online" : "Simulate offline"}
          onPress={() => {
            if (hasDevOfflineToggle(apiClient)) {
              apiClient.setOfflineForDev(!offline);
            }
          }}
          style={({ pressed }) => [styles.devToggle, pressScaleStyle(pressed, reducedMotion)]}
        >
          <Text style={styles.devToggleText}>
            {offline ? "Simulate online" : "Simulate offline"}
          </Text>
        </Pressable>
      ) : null}

      {offline ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>
            <Text style={styles.bannerStrong}>You're offline.</Text> Check-offs are saved and will
            sync when you're back online.
          </Text>
        </View>
      ) : null}

      {activeLoopRow ? (
        <LoopBar
          row={activeLoopRow}
          offline={offline}
          disabled={addingRowId === activeLoopRow.rowId}
          onAdd={() => handleLoopAdd(activeLoopRow)}
        />
      ) : null}

      {view.isEmpty ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Your shopping list is empty.</Text>
          <Text style={styles.emptyBody}>
            Anything with a gap between what you need and what you have will show up here.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse recipes"
            onPress={() => router.push("/menu")}
            style={({ pressed }) => [styles.primaryButton, pressScaleStyle(pressed, reducedMotion)]}
          >
            <Text style={styles.primaryButtonText}>Browse recipes</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}>
          {view.groups.map((group, index) => (
            <View key={`${group.group}-${String(index)}`}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{group.group}</Text>
              </View>
              {group.rows.map((row) => (
                <ShoppingRow
                  key={row.rowId}
                  row={row}
                  members={list.members}
                  reducedMotion={reducedMotion}
                  isQueued={queuedRowIds.has(row.rowId)}
                  onToggle={() => void handleToggleCheck(row)}
                  onRemove={() => void handleRemove(row)}
                />
              ))}
            </View>
          ))}

          {view.skipped.length > 0 ? (
            <View>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>Already have · skipped</Text>
              </View>
              {view.skipped.map((row) => (
                <SkipRow key={row.rowId} row={row} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function MemberAvatars({ members }: { members: ShoppingListDto["members"] }): React.JSX.Element {
  return (
    <View style={styles.avatarRow}>
      {members.map((member, index) => (
        <View
          key={member.memberId}
          style={[styles.avatar, index > 0 ? styles.avatarOverlap : null]}
        >
          <Text style={styles.avatarText}>{member.initials}</Text>
        </View>
      ))}
    </View>
  );
}

function LoopBar({
  row,
  offline,
  disabled,
  onAdd,
}: {
  row: ShoppingRowDto;
  offline: boolean;
  disabled: boolean;
  onAdd: () => void;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  // Review F10: refused inline for every row kind while offline, not just a
  // tracked item's PURCHASE — a no-itemId row's Add still saves through S9,
  // a real server write.
  const refusedInline = offline;
  return (
    <View style={styles.loop}>
      <Text style={styles.loopText}>{row.name} checked off · add it to the pantry?</Text>
      {refusedInline ? (
        <Text style={styles.loopRefused}>Add when you're back online.</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${row.name} to inventory`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={5}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.loopButton,
            disabled ? styles.loopButtonDisabled : null,
            pressScaleStyle(pressed, reducedMotion),
          ]}
        >
          <Text style={styles.loopButtonText}>Add</Text>
        </Pressable>
      )}
    </View>
  );
}

function ShoppingRow({
  row,
  members,
  reducedMotion,
  isQueued,
  onToggle,
  onRemove,
}: {
  row: ShoppingRowDto;
  members: ShoppingListDto["members"];
  reducedMotion: boolean;
  isQueued: boolean;
  onToggle: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const checked = row.status === "done";
  const statusText = doneRowStatusText(row, members);
  const isAiSuggestion = row.origin.kind === "ai" && !checked;

  return (
    <View style={[styles.row, isAiSuggestion ? styles.rowAiSuggestion : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.name}, ${checked ? "checked off" : "not checked off"}`}
        hitSlop={9}
        onPress={onToggle}
        style={[styles.chk, checked ? styles.chkDone : null]}
      >
        {checked ? <Text style={styles.chkGlyph}>{"✓"}</Text> : null}
      </Pressable>
      <View style={styles.rowMeta}>
        <Text style={[styles.rowName, checked ? styles.rowNameDone : null]}>{row.name}</Text>
        {statusText ? (
          <View style={styles.rowSubRow}>
            <Text style={styles.rowSubMuted}>{statusText}</Text>
            {isQueued ? <QueuedTag /> : null}
          </View>
        ) : (
          <View style={styles.rowSubRow}>
            <OriginPrefix row={row} />
            <Text style={styles.rowSub}>{originSuffixText(row)}</Text>
            {isQueued ? <QueuedTag /> : null}
          </View>
        )}
      </View>
      <View style={styles.rowTrailing}>
        <Text style={[styles.amt, checked ? styles.amtDone : null]}>
          {formatShoppingAmount(row.buyMicros, row.unit, null)}
        </Text>
        {isAiSuggestion ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${row.name}`}
            // tokens.md §5 formula: ceil((44 - 24) / 2) = 10, not 6 — the
            // Remove control's rendered height is 24px, not the 32px the
            // deck's own `.okbtn` table entry assumes (review F8).
            hitSlop={10}
            onPress={onRemove}
            style={({ pressed }) => [styles.removeButton, pressScaleStyle(pressed, reducedMotion)]}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function OriginPrefix({ row }: { row: ShoppingRowDto }): React.JSX.Element | null {
  if (row.origin.kind === "menu") {
    return <Text style={styles.msrc}>{row.origin.label}</Text>;
  }
  if (row.origin.kind === "ai") {
    return (
      <Text style={styles.aiChip} accessibilityLabel="AI">
        AI
      </Text>
    );
  }
  return <Text style={styles.mchip}>{row.origin.initials}</Text>;
}

function originSuffixText(row: ShoppingRowDto): string {
  switch (row.origin.kind) {
    case "menu":
      return menuOriginText(row.origin, row.needMicros, row.haveMicros, row.unit);
    case "ai":
      return aiOriginText(row.origin);
    case "member":
      return memberOriginText(row.origin);
  }
}

/**
 * copy-deck.md §7 S11: "icon + text, never a colour change alone" (P9). The
 * glyph is decorative (`accessibilityElementsHidden`/`importantForAccessibility`
 * so a screen reader announces "Queued" once, not the glyph plus the word).
 */
function QueuedTag(): React.JSX.Element {
  return (
    <View style={styles.queuedTag}>
      <Text
        style={styles.queuedTagGlyph}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {"↻"}
      </Text>
      <Text style={styles.queuedTagText}>Queued</Text>
    </View>
  );
}

function SkipRow({ row }: { row: ShoppingRowDto }): React.JSX.Element {
  const amountText = skipRowAmountText(row);
  return (
    <View style={styles.skipRow}>
      <Text style={styles.skipCheck}>{"✓"}</Text>
      <Text style={styles.skipName}>{row.name}</Text>
      <View style={styles.skipTrailing}>
        <Text style={styles.skipAmount}>{amountText}</Text>
        {row.haveTier ? (
          <Text style={styles.provChip} accessibilityLabel={chipAccessibilityLabel(row.haveTier)}>
            {ROW_CHIP_TEXT[row.haveTier]}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sand },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 28, fontFamily: fontFamily.display, fontWeight: "600", color: colors.ink },
  sub: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 17 },
  subStrong: { color: colors.ink, fontWeight: "700" },
  avatarRow: { flexDirection: "row" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sand2,
    borderWidth: 1,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOverlap: { marginLeft: -8 },
  avatarText: { fontSize: 11, fontWeight: "700", color: colors.ink2, fontFamily: fontFamily.body },
  devToggle: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  devToggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink2,
    fontFamily: fontFamily.body,
  },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.sand2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bannerText: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body, lineHeight: 17 },
  bannerStrong: { color: colors.ink, fontWeight: "700" },
  loop: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loopText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.brandOnTint,
    fontFamily: fontFamily.body,
  },
  loopButton: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  loopButtonDisabled: { opacity: 0.5 },
  loopButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  loopRefused: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  groupHeader: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.ink3,
    fontFamily: fontFamily.body,
  },
  row: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowAiSuggestion: { borderColor: colors.ai, backgroundColor: colors.aiBg },
  chk: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  chkDone: { backgroundColor: colors.green, borderColor: colors.green },
  chkGlyph: { color: colors.white, fontSize: 13, fontWeight: "700" },
  rowMeta: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.ink, fontFamily: fontFamily.body },
  rowNameDone: { textDecorationLine: "line-through", color: colors.ink3 },
  rowSubRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowSub: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  rowSubMuted: { fontSize: 12, color: colors.ink3, fontFamily: fontFamily.body },
  msrc: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.brandOnTint,
    backgroundColor: colors.brandTint,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiChip: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.ai,
    backgroundColor: colors.aiBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mchip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    fontSize: 10,
    fontWeight: "800",
    color: colors.ink2,
    backgroundColor: colors.sand2,
    textAlign: "center",
    textAlignVertical: "center",
    overflow: "hidden",
  },
  rowTrailing: { alignItems: "flex-end", gap: 4 },
  amt: { fontSize: 15, fontWeight: "800", color: colors.ink, fontFamily: fontFamily.body },
  amtDone: { color: colors.ink3 },
  removeButton: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.ai,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ai,
    fontFamily: fontFamily.body,
  },
  queuedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.sand2,
  },
  queuedTagGlyph: { fontSize: 11, color: colors.ink3 },
  queuedTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ink3,
    fontFamily: fontFamily.body,
  },
  skipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  skipCheck: { color: colors.green, fontSize: 14, fontWeight: "700" },
  skipName: { flex: 1, fontSize: 14, color: colors.ink2, fontFamily: fontFamily.body },
  skipTrailing: { flexDirection: "row", alignItems: "center", gap: 6 },
  skipAmount: { fontSize: 12.5, color: colors.ink2, fontFamily: fontFamily.body },
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
