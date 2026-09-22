/**
 * S2 allergy-gate state machine (M3-T2), pure and framework-free so it can be
 * unit-tested without @testing-library/react-native (rule 11: no new
 * dependency without escalation; components stay thin wrappers around this).
 *
 * Mirrors prototype v4's `toggleAllergen` / `renderSeverityList` / `setSeverity`
 * / `addCustomAllergen` / `toggleNone` / `continueAllergies` binding behaviour
 * (docs/design/mockups/smart-kitchen-prototype.html) as immutable
 * transformations over one member's draft, plus the multi-member gate check
 * `continueAllergies` generalises to (every member of the household, not just
 * one).
 *
 * D-017 P4 (severity is never inferred, always chosen): every selection
 * starts at "standard" and only changes through an explicit
 * {@link setSeverity} call from the user tapping Standard/Severe; nothing here
 * ever picks or escalates a severity on a member's behalf.
 */

import type {
  MajorAllergenCodeDto,
  MemberDto,
  MemberRestrictionDto,
  RestrictionSeverityDto,
} from "@smart-kitchen/contracts";

/** The exact inline gate message (copy-deck.md §11 proposed; BACKLOG.md M3-T2 invariant). */
export const ALLERGY_GATE_MESSAGE = "Select at least one allergen, or confirm none, to continue";

/** One allergen or custom ingredient a member has declared, mid-edit. */
export interface AllergenSelectionDraft {
  /** Stable key: the major code itself, or `custom:<lowercased label>` for a free-text entry. */
  readonly key: string;
  readonly kind: "MAJOR" | "USER_DEFINED";
  readonly code?: MajorAllergenCodeDto;
  readonly label: string;
  readonly severity: RestrictionSeverityDto;
}

/** One household member's S2 draft. `selections` and `noneConfirmed` are always mutually exclusive. */
export interface MemberAllergyDraft {
  readonly memberId: string;
  readonly displayName: string;
  readonly selections: readonly AllergenSelectionDraft[];
  readonly noneConfirmed: boolean;
}

export function buildInitialMemberDraft(
  member: Pick<MemberDto, "memberId" | "displayName">,
): MemberAllergyDraft {
  return {
    memberId: member.memberId,
    displayName: member.displayName,
    selections: [],
    noneConfirmed: false,
  };
}

/**
 * Rebuilds a member's draft from whatever the client port already has saved
 * (round-trips with {@link toRestrictionDtos}), so S2 is safe to re-enter
 * without losing prior answers instead of always starting blank — a deep
 * link or a back-then-forward navigation back into S2 must not silently
 * discard a member's already-declared restrictions.
 */
export function draftFromMember(member: MemberDto): MemberAllergyDraft {
  if (member.noneConfirmed) {
    return { ...buildInitialMemberDraft(member), noneConfirmed: true };
  }
  const selections: AllergenSelectionDraft[] = member.restrictions.map((r) => ({
    key: r.kind === "MAJOR" && r.code ? r.code : `custom:${r.label.toLowerCase()}`,
    kind: r.kind,
    code: r.code,
    label: r.label,
    severity: r.severity,
  }));
  return { ...buildInitialMemberDraft(member), selections };
}

/**
 * Toggles one of the nine major-allergen chips. Selecting clears the member's
 * "none" declaration (mutual exclusion, matching prototype's `toggleAllergen`
 * clearing `noneBtn`'s `.on` class). A newly selected allergen always starts
 * at "standard" severity (D-017 P4: shown as a choice, never hidden).
 */
export function toggleMajorAllergen(
  draft: MemberAllergyDraft,
  code: MajorAllergenCodeDto,
  label: string,
): MemberAllergyDraft {
  const existingIndex = draft.selections.findIndex((s) => s.kind === "MAJOR" && s.code === code);
  if (existingIndex >= 0) {
    return { ...draft, selections: draft.selections.filter((_, i) => i !== existingIndex) };
  }
  const added: AllergenSelectionDraft = {
    key: code,
    kind: "MAJOR",
    code,
    label,
    severity: "standard",
  };
  return { ...draft, selections: [...draft.selections, added], noneConfirmed: false };
}

/**
 * Sets the severity of an already-selected allergen. A no-op if `key` is not
 * currently selected (severity is never set on a member's behalf; there is
 * nothing to change until they have chosen the allergen itself).
 */
export function setSeverity(
  draft: MemberAllergyDraft,
  key: string,
  severity: RestrictionSeverityDto,
): MemberAllergyDraft {
  return {
    ...draft,
    selections: draft.selections.map((s) => (s.key === key ? { ...s, severity } : s)),
  };
}

/**
 * Adds a free-text allergen/ingredient as a `USER_DEFINED` restriction at
 * "standard" severity (BACKLOG.md M3-T2 Objective (b)). Blank input is
 * ignored; a label already present (case-insensitively) is not duplicated.
 */
export function addCustomAllergen(draft: MemberAllergyDraft, rawLabel: string): MemberAllergyDraft {
  const label = rawLabel.trim();
  if (label.length === 0) {
    return draft;
  }
  const key = `custom:${label.toLowerCase()}`;
  if (draft.selections.some((s) => s.key === key)) {
    return draft;
  }
  const added: AllergenSelectionDraft = { key, kind: "USER_DEFINED", label, severity: "standard" };
  return { ...draft, selections: [...draft.selections, added], noneConfirmed: false };
}

/**
 * Toggles the explicit "No known allergies for {member}" option. Turning it
 * on clears every selection (mutual exclusion, matching prototype's
 * `toggleNone`); turning it off again just clears the flag, matching
 * `toggleAllergen`'s reverse case rather than inventing a restore-previous-
 * selections behaviour the prototype does not have.
 */
export function toggleNone(draft: MemberAllergyDraft): MemberAllergyDraft {
  if (draft.noneConfirmed) {
    return { ...draft, noneConfirmed: false };
  }
  return { ...draft, noneConfirmed: true, selections: [] };
}

/** A member satisfies the gate once they have a restriction or the explicit none. Never both empty. */
export function isMemberComplete(draft: MemberAllergyDraft): boolean {
  return draft.selections.length > 0 || draft.noneConfirmed;
}

/** The S2 Continue gate: every member covered, none excepted (BACKLOG.md M3-T2 invariant). */
export function isGateSatisfied(drafts: readonly MemberAllergyDraft[]): boolean {
  return drafts.length > 0 && drafts.every(isMemberComplete);
}

/** Projects one member's draft onto the wire shape `saveMemberRestrictions` sends. */
export function toRestrictionDtos(draft: MemberAllergyDraft): readonly MemberRestrictionDto[] {
  return draft.selections.map((s) =>
    s.kind === "MAJOR"
      ? { kind: "MAJOR" as const, code: s.code, label: s.label, severity: s.severity }
      : { kind: "USER_DEFINED" as const, label: s.label, severity: s.severity },
  );
}
