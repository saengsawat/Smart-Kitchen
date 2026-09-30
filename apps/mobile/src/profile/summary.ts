/**
 * Pure S12 helpers (M3-T6), unit-testable without mounting `app/profile.tsx`:
 * the household-member allergy summary line and a display-name -> initials
 * fallback for the fixture path (the HTTP path's `member.displayName` is
 * already initials by the time it reaches this screen, see
 * `src/api/client.ts`'s `householdSyncInputFromSummary` doc comment).
 */

import type { MemberDto } from "@smart-kitchen/contracts";
import { MAJOR_ALLERGEN_LABELS_DTO } from "@smart-kitchen/contracts";

/**
 * BACKLOG.md M3-T6 Objective (c), verbatim forms: "No known allergies · edit"
 * or "{Allergen}, {allergen} · {severity} · edit". `severe` appears only when
 * at least one of the member's restrictions is severe (never "standard" --
 * the unmarked case is the absence of the word, matching the prototype);
 * allergen labels come from {@link MAJOR_ALLERGEN_LABELS_DTO} for a `MAJOR`
 * restriction or the member's own wording for a `USER_DEFINED` one, joined in
 * whatever order the member's restrictions already carry (selection order,
 * from `allergyGate.ts`'s `toggleMajorAllergen`/`addCustomAllergen`) -- never
 * re-sorted, and never the word "safe" (copy-deck.md §10).
 *
 * Review round 1, F4: a member with zero restrictions and `noneConfirmed`
 * still `false` is the "gate not yet answered for this member" state, not
 * "no known allergies" (that word pair is an explicit declaration, per S2's
 * own gate copy, and it must never be shown for a member who has not
 * actually made it). Unreachable through this screen today: the onboarding
 * gate (`app/_layout.tsx`) redirects to S2 for as long as any member has
 * neither a restriction nor a confirmed none, so nobody reaches S12 with a
 * member left in this state -- pinned anyway, as the honest answer for the
 * shape rather than an assumption this screen happens to get away with.
 */
export function memberAllergySummary(
  member: Pick<MemberDto, "restrictions" | "noneConfirmed">,
): string {
  if (member.noneConfirmed) {
    return "No known allergies · edit";
  }
  if (member.restrictions.length === 0) {
    return "Allergies not set yet · edit";
  }
  const labels = member.restrictions.map((r) =>
    r.kind === "MAJOR" && r.code ? MAJOR_ALLERGEN_LABELS_DTO[r.code] : r.label,
  );
  const joined = labels.join(", ");
  const capitalized = joined.charAt(0).toUpperCase() + joined.slice(1);
  const hasSevere = member.restrictions.some((r) => r.severity === "severe");
  return hasSevere ? `${capitalized} · severe · edit` : `${capitalized} · edit`;
}

/**
 * "Dean Chen" -> "DC" for the fixture path's avatar chips (the identity card
 * and every member row): first and last token's initial, uppercased. A
 * single-token name falls back to its first two characters — never exercised
 * by the shipped fixture household (both members are two-word names), kept
 * only so this never throws or returns an empty chip on an unexpected name.
 * The HTTP path never calls this: the server already sends initials (M2-T3).
 */
export function initialsFromName(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return "?";
  }
  if (tokens.length === 1) {
    return tokens[0]!.slice(0, 2).toUpperCase();
  }
  return (tokens[0]!.charAt(0) + tokens[tokens.length - 1]!.charAt(0)).toUpperCase();
}
