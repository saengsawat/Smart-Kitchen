/**
 * Initials for a person's display name (M2-T2; moved here from `detail.ts` by
 * M2-T5 so `snapshot.ts` can use it for the "confirmed by" source without an
 * import cycle, unchanged).
 *
 * A person is reduced to initials and nowhere else: the name enters, two
 * letters leave, and the name is never returned or logged (ARCHITECTURE.md
 * §7.7, §7.15).
 */

/**
 * Two-letter chip for a display name: first letter of the first word, first
 * letter of the last (`Dean Chen` becomes `DC`).
 *
 * Returns `undefined` for a name with no letters in it rather than an empty
 * chip. Uses the string's code points so a name outside the Basic Multilingual
 * Plane is not cut in half.
 */
export function displayInitials(displayName: string | null): string | undefined {
  if (displayName === null) return undefined;
  const words = displayName.split(/\s+/).filter((word) => word !== "");
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const letters =
    words.length === 1 ? [firstCodePoint(first)] : [firstCodePoint(first), firstCodePoint(last)];
  const chip = letters.join("").toUpperCase();
  return chip === "" ? undefined : chip;
}

function firstCodePoint(word: string): string {
  return [...word][0] ?? "";
}
