import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { HouseholdDto, MemberDto } from "@smart-kitchen/contracts";
import {
  FIXTURE_IDENTITY_EMAIL,
  FIXTURE_JOIN_CODE,
  apiClient,
  hasHouseholdCallerActions,
} from "../src/api/client";
import { colors, fontFamily, minTouchTarget, radius, spacing } from "../src/design/tokens";
import { GENERIC_READ_ERROR_MESSAGE } from "../src/inventory/errors";
import { useToast } from "../src/inventory/Toast";
import {
  ALLERGY_GATE_MESSAGE,
  ALLERGY_SAVE_ERROR_MESSAGE,
  addCustomAllergen,
  draftFromMember,
  firstName,
  isMemberComplete,
  setSeverity,
  toRestrictionDtos,
  toggleMajorAllergen,
  toggleNone,
  type MemberAllergyDraft,
} from "../src/onboarding/allergyGate";
import { MemberAllergySection } from "../src/onboarding/MemberAllergySection";
import { initialsFromName, memberAllergySummary } from "../src/profile/summary";

const FAST_FOLLOW_LINK_MESSAGE =
  "Invite by link is fast-follow · built after MVP launch, already planned.";
const FAST_FOLLOW_EMAIL_MESSAGE =
  "Invite by email is fast-follow · built after MVP launch, already planned.";

/**
 * S12 · Profile & household (M3-T6), prototype v4 `#scr-profile`.
 *
 * Reachable from the Home header's account affordance
 * (`src/screens/HomeScreen.tsx`) and, on the fixture path, via S1/S2's own
 * `avatarTap()`-equivalent routing (the app's onboarding gate already sends
 * a "returning" identity — one whose household and allergy gate are already
 * satisfied — straight to Home, whose header is this screen's only real
 * entry point; the prototype's dev-toggle ternary between S1 and S12 has no
 * separate literal button on S1 itself to mirror, see the worker report).
 *
 * Fixture vs HTTP (BACKLOG.md M3-T6 Objective (b)/(d)): the server never
 * sends a member's full name or email (M2-T3), so every place this screen
 * would show one instead shows initials, and the household's join code is
 * only ever real (rotatable, one-time-shown) against the server —
 * `hasHouseholdCallerActions(apiClient)` is this screen's one feature check
 * for the whole fork, same pattern as `hasDevOfflineToggle` elsewhere in
 * this app.
 */
export default function ProfileScreen(): React.JSX.Element {
  const router = useRouter();
  const { show } = useToast();

  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MemberAllergyDraft | null>(null);
  const [editCustomInput, setEditCustomInput] = useState("");
  const [editGateMessage, setEditGateMessage] = useState(false);
  const [editSaveError, setEditSaveError] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotatedCode, setRotatedCode] = useState<string | null>(null);
  // Single-flight guard (M3-T4d review F11's lesson: `disabled={rotating}`
  // alone takes effect only after a re-render, so two taps dispatched in the
  // same frame both fire). Rotation carries no idempotency key by design
  // (same reasoning as createHousehold/joinHousehold), so a genuine double
  // call would rotate the code twice and this screen could easily end up
  // showing the *first* response's now-already-stale code.
  const rotateInFlight = useRef(false);

  const [signingOut, setSigningOut] = useState(false);
  // Single-flight guard, same pattern as `app/onboarding/account.tsx`'s
  // `requestInFlight`: state alone cannot stop a second tap dispatched in
  // the same frame from calling `apiClient.signOut()` twice.
  const signOutInFlight = useRef(false);

  const load = useCallback(() => {
    setLoadError(false);
    let cancelled = false;
    void apiClient.getOnboardingState().then(
      (state) => {
        if (cancelled) {
          return;
        }
        if (!state.household) {
          // A household-less deep link straight at S12: there is nothing to
          // show here (same "cannot bypass the gate" reasoning S2's own
          // load() uses), so this falls back to the root route, which the
          // layout gate then routes on to S1 itself.
          router.replace("/");
          return;
        }
        setHousehold(state.household);
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

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  function startEditing(member: MemberDto): void {
    setEditingMemberId(member.memberId);
    setEditDraft(draftFromMember(member));
    setEditCustomInput("");
    setEditGateMessage(false);
    setEditSaveError(false);
  }

  function cancelEditing(): void {
    setEditingMemberId(null);
    setEditDraft(null);
    setEditCustomInput("");
    setEditGateMessage(false);
    setEditSaveError(false);
  }

  function toggleEditing(member: MemberDto): void {
    if (editingMemberId === member.memberId) {
      cancelEditing();
    } else {
      startEditing(member);
    }
  }

  function updateEditDraft(update: (draft: MemberAllergyDraft) => MemberAllergyDraft): void {
    setEditDraft((prev) => (prev ? update(prev) : prev));
  }

  /**
   * BACKLOG.md M3-T6 Objective (c): saves through the same
   * `saveMemberRestrictions(memberId, ...)` call S2 uses, scoped to this one
   * member only — closing the M3-T2 simplification that saved one shared
   * set to every member. On success the local `household` state is updated
   * directly from the just-saved draft (no extra `getOnboardingState` round
   * trip): `FixtureApiClient`'s own state and this optimistic update always
   * agree, and `HttpApiClient` delegates the same restrictions store, so
   * there is nothing a re-read would tell this screen that the draft does
   * not already know.
   */
  async function handleSaveMember(): Promise<void> {
    if (!editDraft || !editingMemberId) {
      return;
    }
    if (!isMemberComplete(editDraft)) {
      setEditGateMessage(true);
      AccessibilityInfo.announceForAccessibility(ALLERGY_GATE_MESSAGE);
      return;
    }
    setEditGateMessage(false);
    setEditSaveError(false);
    setEditSaving(true);
    const memberId = editingMemberId;
    const restrictions = toRestrictionDtos(editDraft);
    const noneConfirmed = editDraft.noneConfirmed;
    try {
      await apiClient.saveMemberRestrictions(memberId, restrictions, { noneConfirmed });
      setHousehold((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.memberId === memberId ? { ...m, restrictions, noneConfirmed } : m,
              ),
            }
          : prev,
      );
      cancelEditing();
    } catch {
      setEditSaveError(true);
      AccessibilityInfo.announceForAccessibility(ALLERGY_SAVE_ERROR_MESSAGE);
    } finally {
      setEditSaving(false);
    }
  }

  function openInviteConfirm(): void {
    setInviteConfirmOpen(true);
    setRotateError(null);
  }

  function closeInviteConfirm(): void {
    setInviteConfirmOpen(false);
    setRotateError(null);
  }

  async function handleGetNewCode(): Promise<void> {
    if (rotateInFlight.current || !hasHouseholdCallerActions(apiClient)) {
      return;
    }
    rotateInFlight.current = true;
    setRotating(true);
    setRotateError(null);
    try {
      const result = await apiClient.rotateJoinCode();
      if (result.ok) {
        setRotatedCode(result.code);
        setInviteConfirmOpen(false);
      } else {
        setRotateError(result.message);
        AccessibilityInfo.announceForAccessibility(result.message);
      }
    } finally {
      rotateInFlight.current = false;
      setRotating(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    if (signOutInFlight.current) {
      return;
    }
    signOutInFlight.current = true;
    setSigningOut(true);
    try {
      await apiClient.signOut();
      router.replace("/onboarding/account");
    } finally {
      signOutInFlight.current = false;
      setSigningOut(false);
    }
  }

  if (loadError) {
    return (
      <View style={[styles.screen, styles.loadingScreen]}>
        <View style={styles.readErrorWrap} accessibilityLiveRegion="assertive">
          <Text style={styles.readErrorTitle}>Couldn&apos;t load your household.</Text>
          <Text style={styles.readErrorBody}>{GENERIC_READ_ERROR_MESSAGE}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={load}
            style={[styles.button, styles.buttonPrimary]}
          >
            <Text style={styles.buttonTextOnDark}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!household) {
    return (
      <View style={[styles.screen, styles.loadingScreen]}>
        <ActivityIndicator color={colors.ink2} accessibilityLabel="Loading" />
      </View>
    );
  }

  const callerActions = hasHouseholdCallerActions(apiClient) ? apiClient : null;
  const isHttp = callerActions !== null;
  const caller = callerActions?.getCallerSummary() ?? null;
  // Fixture path (D-022): the one fixture identity is always Dean, and every
  // fixture household construction (`buildFixtureHousehold`,
  // `fixtureChenMembers`) always models Dean as the owner, so the owner
  // member directly answers "who is the caller" without a separate call.
  const owner = household.members.find((m) => m.role === "owner") ?? null;
  const isOwner = isHttp ? caller?.role === "owner" : true;

  const cardInitials = isHttp
    ? (caller?.displayInitials ?? "?")
    : initialsFromName(owner?.displayName ?? "");
  const cardHeading = isHttp ? cardInitials : (owner?.displayName ?? "");
  const cardRole = isHttp ? (caller?.role ?? "member") : (owner?.role ?? "member");
  const cardCaption = isHttp
    ? `${cardRole} · ${household.name}`
    : `${FIXTURE_IDENTITY_EMAIL} · ${cardRole} · ${household.name}`;

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
          <Text style={styles.iconGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Profile &amp; household</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identityCard}>
          <View style={styles.identityChip}>
            <Text style={styles.identityChipText}>{cardInitials}</Text>
          </View>
          <View style={styles.identityMeta}>
            <Text style={styles.identityName}>{cardHeading}</Text>
            <Text style={styles.identityCaption}>{cardCaption}</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Household members</Text>
          {isHttp ? (
            isOwner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Invite"
                hitSlop={15}
                onPress={openInviteConfirm}
              >
                <Text style={styles.inviteLink}>Invite</Text>
              </Pressable>
            ) : (
              <Text style={styles.mutedLine}>Ask the household owner for the join code.</Text>
            )
          ) : null}
        </View>

        {household.members.map((member) => {
          const chipInitials = isHttp ? member.displayName : initialsFromName(member.displayName);
          const summary = memberAllergySummary(member);
          const editingThisMember = editingMemberId === member.memberId;
          return (
            <View key={member.memberId}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${member.displayName}, ${summary}`}
                onPress={() => toggleEditing(member)}
                style={styles.memberRow}
              >
                <View style={styles.memberChip}>
                  <Text style={styles.memberChipText}>{chipInitials}</Text>
                </View>
                <View style={styles.memberMeta}>
                  <Text style={styles.memberName}>{member.displayName}</Text>
                  <Text style={styles.memberCaption}>{summary}</Text>
                </View>
              </Pressable>
              {editingThisMember && editDraft ? (
                <View style={styles.editPanel}>
                  <MemberAllergySection
                    draft={editDraft}
                    customInput={editCustomInput}
                    showHeading={false}
                    onToggleAllergen={(code, label) =>
                      updateEditDraft((d) => toggleMajorAllergen(d, code, label))
                    }
                    onSetSeverity={(key, severity) =>
                      updateEditDraft((d) => setSeverity(d, key, severity))
                    }
                    onToggleNone={() => updateEditDraft(toggleNone)}
                    onCustomInputChange={setEditCustomInput}
                    onAddCustom={() => {
                      updateEditDraft((d) => addCustomAllergen(d, editCustomInput));
                      setEditCustomInput("");
                    }}
                  />
                  {editGateMessage ? (
                    <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
                      <Text style={styles.noticeIcon}>{"⚠"}</Text>
                      <Text style={styles.noticeText}>{ALLERGY_GATE_MESSAGE}</Text>
                    </View>
                  ) : null}
                  {editSaveError ? (
                    <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
                      <Text style={styles.noticeIcon}>{"⚠"}</Text>
                      <Text style={styles.noticeText}>{ALLERGY_SAVE_ERROR_MESSAGE}</Text>
                    </View>
                  ) : null}
                  <View style={styles.editActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel editing allergies for ${firstName(member.displayName)}`}
                      disabled={editSaving}
                      onPress={cancelEditing}
                      style={[styles.actionButton, styles.buttonSecondary]}
                    >
                      <Text style={styles.buttonTextOnLight}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Save allergies for ${firstName(member.displayName)}`}
                      disabled={editSaving}
                      onPress={() => void handleSaveMember()}
                      style={[styles.actionButton, styles.buttonPrimary]}
                    >
                      <Text style={styles.buttonTextOnDark}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {!isHttp ? (
          <View style={[styles.memberRow, styles.memberRowMuted]}>
            <View style={styles.memberChip}>
              <Text style={styles.memberChipText}>+</Text>
            </View>
            <View style={styles.memberMeta}>
              <Text style={styles.memberName}>Add a member</Text>
              <Text style={styles.memberCaption}>{`share the join code ${FIXTURE_JOIN_CODE}`}</Text>
            </View>
          </View>
        ) : null}

        {isHttp && isOwner && inviteConfirmOpen && !rotatedCode ? (
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmText}>
              Get a new join code? The current code stops working. Share the new one with the person
              you&apos;re inviting.
            </Text>
            {rotateError ? (
              <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
                <Text style={styles.noticeIcon}>{"⚠"}</Text>
                <Text style={styles.noticeText}>{rotateError}</Text>
              </View>
            ) : null}
            <View style={styles.editActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                disabled={rotating}
                onPress={closeInviteConfirm}
                style={[styles.actionButton, styles.buttonSecondary]}
              >
                <Text style={styles.buttonTextOnLight}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Get new code"
                disabled={rotating}
                onPress={() => void handleGetNewCode()}
                style={[styles.actionButton, styles.buttonPrimary]}
              >
                <Text style={styles.buttonTextOnDark}>Get new code</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isHttp && isOwner && rotatedCode ? (
          <View style={styles.noticeBox} accessibilityLiveRegion="assertive">
            <Text style={styles.noticeIcon}>{"✓"}</Text>
            <Text style={styles.noticeText}>
              {`Your join code: ${rotatedCode}. Save it to invite others.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.fastFollowRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite by link, fast-follow"
            onPress={() => show(FAST_FOLLOW_LINK_MESSAGE)}
            style={styles.fastFollowLink}
          >
            <View style={styles.phaseBadge}>
              <Text style={styles.phaseBadgeText}>fast-follow</Text>
            </View>
            <Text style={styles.fastFollowText}>Invite by link</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite by email, fast-follow"
            onPress={() => show(FAST_FOLLOW_EMAIL_MESSAGE)}
            style={styles.fastFollowLink}
          >
            <View style={styles.phaseBadge}>
              <Text style={styles.phaseBadgeText}>fast-follow</Text>
            </View>
            <Text style={styles.fastFollowText}>Invite by email</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          disabled={signingOut}
          onPress={() => void handleSignOut()}
          style={[styles.button, styles.buttonSecondaryFull]}
        >
          <Text style={styles.buttonTextOnLight}>Sign out</Text>
        </Pressable>
      </ScrollView>
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
  iconGlyph: { fontSize: 22, color: colors.ink, lineHeight: 22 },
  title: { fontSize: 20, fontFamily: fontFamily.display, fontWeight: "600", color: colors.ink },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.sm },
  loadingScreen: { alignItems: "center", justifyContent: "center" },

  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  identityChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  identityChipText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.cream,
    fontFamily: fontFamily.body,
  },
  identityMeta: { gap: 2 },
  identityName: { fontSize: 15, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  identityCaption: { fontSize: 12.5, color: colors.ink3, fontFamily: fontFamily.body },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
  },
  inviteLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandDeep,
    fontFamily: fontFamily.body,
  },
  mutedLine: { fontSize: 12.5, color: colors.ink3, fontFamily: fontFamily.body },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
  },
  memberRowMuted: { opacity: 0.75 },
  memberChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.sand2,
    alignItems: "center",
    justifyContent: "center",
  },
  memberChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
    fontFamily: fontFamily.body,
  },
  memberMeta: { flex: 1, gap: 1 },
  memberName: { fontSize: 14, fontWeight: "700", color: colors.ink, fontFamily: fontFamily.body },
  memberCaption: { fontSize: 12.5, color: colors.ink3, fontFamily: fontFamily.body },

  editPanel: {
    gap: spacing.sm,
    paddingLeft: 46,
    paddingBottom: spacing.sm,
  },
  editActions: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.xs },
  actionButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },

  confirmSheet: {
    gap: spacing.sm,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  confirmText: { fontSize: 13, lineHeight: 19, color: colors.ink2, fontFamily: fontFamily.body },

  fastFollowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  fastFollowLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget,
  },
  phaseBadge: {
    backgroundColor: colors.aiBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  phaseBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.ai,
    fontFamily: fontFamily.body,
  },
  fastFollowText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink2,
    textDecorationLine: "underline",
    fontFamily: fontFamily.body,
  },

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

  readErrorWrap: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  readErrorTitle: {
    fontSize: 19,
    fontFamily: fontFamily.display,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
  },
  readErrorBody: {
    fontSize: 13,
    color: colors.ink2,
    fontFamily: fontFamily.body,
    textAlign: "center",
  },

  button: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.brandDeep },
  buttonSecondary: { backgroundColor: colors.sand2 },
  buttonSecondaryFull: { backgroundColor: colors.sand2, marginTop: spacing.xs },
  buttonTextOnDark: { color: colors.cream, fontSize: 15, fontWeight: "700" },
  buttonTextOnLight: { color: colors.ink, fontSize: 15, fontWeight: "700" },
});
