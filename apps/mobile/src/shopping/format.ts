/**
 * S11 row copy: amount display and origin/status lines (M3-T5).
 *
 * Amounts are rendered from a `ShoppingRowDto`'s exact decimal-text micros
 * only, via `src/inventory/quantity.ts`'s exact `bigint` helpers
 * (`parseMicros`, `microsToAmountText`, `trimAmountText`) — the same
 * micro-unit-exact discipline CLAUDE.md rule 7 requires, restated here
 * rather than reusing `formatQuantityDisplay` directly: that function's
 * signature takes an `InventoryLotDto[]` for its uniform-pack/partial-pack
 * display rules (S4/S5's concerns, not S11's — a shopping row has no lots),
 * so a small, dedicated formatter avoids passing a fake lot array through an
 * API built for a different shape. It shares the same rules that do apply
 * here: an `ESTIMATED` tier prefixes `~` (prototype's "~4 cups" convention),
 * and a count-kind unit (`"each"`, the only COUNT symbol
 * `UNITS_BY_KIND_DTO` offers) renders bare, matching prototype v4's own
 * `#scr-shopping` markup (`1` for granola/paper towels/olive oil, never
 * `1 each`).
 *
 * The one-line origin/status text is intentionally deterministic from the
 * DTO's own fields (never a per-row hand-authored string): see
 * {@link menuOriginText}'s doc comment for the one place this produces
 * slightly different wording than prototype v4's static copy for one row
 * (granola), flagged there and in the worker report rather than hidden.
 */

import type {
  ProvenanceTierDto,
  ShoppingMemberDto,
  ShoppingRowDto,
  ShoppingRowOriginDto,
} from "@smart-kitchen/contracts";
import { microsToAmountText, parseMicros, trimAmountText } from "../inventory/quantity";

/** Same small pluralization convention as `src/inventory/quantity.ts`'s `PLURAL_UNITS` (cup only; every other unit here renders invariant). */
function pluralize(unit: string, trimmedMagnitude: string): string {
  return unit === "cup" && trimmedMagnitude !== "1" ? "cups" : unit;
}

/**
 * `"0.75 lb"`, `"~4 cups"`, `"2"` (a count-kind unit renders bare — see
 * module doc comment). `tier` is `null` for a gap row's need/have amounts
 * (the prototype never tilde-prefixes those) and the row's `haveTier` for a
 * skip row's on-hand amount.
 */
export function formatShoppingAmount(
  micros: string,
  unit: string,
  tier: ProvenanceTierDto | null,
): string {
  const trimmed = trimAmountText(microsToAmountText(parseMicros(micros)));
  const prefix = tier === "ESTIMATED" ? "~" : "";
  if (unit === "each") {
    return `${prefix}${trimmed}`;
  }
  return `${prefix}${trimmed} ${pluralize(unit, trimmed)}`;
}

/**
 * The text after a menu row's `{label}` tag chip (rendered separately by the
 * screen). Three deterministic forms, chosen from the DTO alone:
 *
 * 1. `haveMicros > 0` (partial stock): `"need {need} · have {have}"` — the
 *    numeric gap is the useful fact, so the recipe name is omitted even when
 *    present (matches prototype's chicken-breast row).
 * 2. `haveMicros === 0` and `recipeName` is set: `"{recipeName} · none on
 *    hand"` (matches prototype's broccoli row).
 * 3. `haveMicros === 0` and `recipeName` is `null`: `"need {need}"`.
 *
 * **Deviation, flagged in the worker report:** prototype v4's granola row
 * has `haveMicros === 0` and a `recipeName` ("yogurt parfait") but renders
 * *without* "· none on hand" (just the bare recipe name) — a one-off copy
 * choice in the static mockup, not a rule derivable from any field this
 * contract carries. Rule 3/4 (never invent a per-row exception with no
 * DTO-visible trigger) means this module applies form 2 uniformly to every
 * zero-stock menu row with a recipe name, including granola, rather than
 * hand-carving an exception that nothing in the DTO distinguishes.
 */
export function menuOriginText(
  origin: Extract<ShoppingRowOriginDto, { kind: "menu" }>,
  needMicros: string,
  haveMicros: string,
  unit: string,
): string {
  if (parseMicros(haveMicros) > 0n) {
    return `need ${formatShoppingAmount(needMicros, unit, null)} · have ${formatShoppingAmount(haveMicros, unit, null)}`;
  }
  if (origin.recipeName !== null) {
    return `${origin.recipeName} · none on hand`;
  }
  return `need ${formatShoppingAmount(needMicros, unit, null)}`;
}

/** copy-deck.md-adjacent AI-row line (BACKLOG.md M3-T5 Objective (b), verbatim template). */
export function aiOriginText(origin: Extract<ShoppingRowOriginDto, { kind: "ai" }>): string {
  return `suggested to go with ${origin.recipeName} · a proposal until you keep it`;
}

/** A member-added row's line, before any check-off (Objective (b), verbatim). */
export function memberOriginText(
  origin: Extract<ShoppingRowOriginDto, { kind: "member" }>,
): string {
  return `added by ${origin.displayName} · not tied to a menu`;
}

/** An open row's origin line (before any check-off this session), dispatching on `origin.kind`. */
export function openRowOriginText(row: ShoppingRowDto): string {
  switch (row.origin.kind) {
    case "menu":
      return menuOriginText(row.origin, row.needMicros, row.haveMicros, row.unit);
    case "ai":
      return aiOriginText(row.origin);
    case "member":
      return memberOriginText(row.origin);
  }
}

function displayNameForInitials(initials: string, members: readonly ShoppingMemberDto[]): string {
  return members.find((m) => m.initials === initials)?.displayName ?? initials;
}

/**
 * A done row's status line, replacing its origin line entirely (Objective
 * (c)): `"added and checked off by {member}"` when the same member both
 * added it (a `member`-origin row) and checked it off, else `"checked off by
 * {member}"`. `null` for a row that is not done (the caller renders the
 * ordinary origin line instead).
 */
export function doneRowStatusText(
  row: ShoppingRowDto,
  members: readonly ShoppingMemberDto[],
): string | null {
  if (row.status !== "done" || row.checkedOffBy === null) {
    return null;
  }
  const checkerName = displayNameForInitials(row.checkedOffBy, members);
  const sameMemberAdded = row.origin.kind === "member" && row.origin.initials === row.checkedOffBy;
  return sameMemberAdded
    ? `added and checked off by ${checkerName}`
    : `checked off by ${checkerName}`;
}

/**
 * A skip row's amount text (Objective (e)): the on-hand amount (with its
 * tier's `~` convention) when {@link ShoppingRowDto.haveTier} is set, else
 * the literal "sufficient" the DTO licenses by carrying no tier at all (no
 * number is invented to go with it).
 */
export function skipRowAmountText(row: ShoppingRowDto): string {
  if (row.haveTier === null) {
    return "sufficient";
  }
  return formatShoppingAmount(row.haveMicros, row.unit, row.haveTier);
}
