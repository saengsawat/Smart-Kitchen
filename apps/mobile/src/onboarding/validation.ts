/**
 * S1 form validation (M3-T2), pure so it is unit-testable without mounting a
 * screen. Prototype v4's `startHousehold('create')` silently defaults an
 * empty name to "The Chens" (`(document.getElementById('hhName').value||
 * 'The Chens').trim()`); BACKLOG.md M3-T2 Objective (a) instead requires the
 * name to be "required, trimmed, 1 to 60 characters", so this and its two
 * messages are new copy, not lifted from the prototype (proposed for
 * copy-deck.md §11 in the worker report).
 */

export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

export type ValidateHouseholdNameResult =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly message: string };

export function validateHouseholdName(raw: string): ValidateHouseholdNameResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter a household name to continue." };
  }
  if (trimmed.length > HOUSEHOLD_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `Household name must be ${HOUSEHOLD_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, name: trimmed };
}

/** Adds/removes one preference chip. Preferences carry no gate (they are optional, skippable). */
export function togglePreference(preferences: readonly string[], value: string): readonly string[] {
  return preferences.includes(value)
    ? preferences.filter((p) => p !== value)
    : [...preferences, value];
}
