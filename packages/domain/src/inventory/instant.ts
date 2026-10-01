/**
 * The one ISO-8601 instant shape and its strict parser (M9-T0 item a).
 *
 * Before this module the same expression was copied into `ledger.ts`,
 * `lot-selection.ts` and the API's create path. Shape alone is not enough:
 * `Date.parse` rolls impossible calendar values over (`2026-02-30T00:00:00Z`
 * becomes 2 March, `T24:00:00Z` becomes the next midnight), so a stored
 * instant could differ from the one the caller wrote. `parseIsoInstantStrict`
 * refuses those by checking that the calendar and clock fields survive a
 * round trip through UTC arithmetic.
 */

/** ISO-8601 instant with an explicit offset: `YYYY-MM-DDTHH:MM:SS[.f{1,9}](Z|+-HH:MM)`. */
export const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Epoch milliseconds for a well-formed, non-rolled-over instant, or
 * `undefined` for anything else (wrong shape, a date or time that does not
 * exist, an offset outside `-23:59..+23:59`, or a value `Date.parse` refuses).
 *
 * Sub-millisecond digits are accepted and truncated, as `Date.parse` does.
 */
export function parseIsoInstantStrict(value: unknown): number | undefined {
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));

  // Calendar round trip. `setUTCFullYear` avoids `Date.UTC`'s 0..99 => 1900s mapping.
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(hour, minute, second, 0);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return undefined;

  const millis = Date.parse(value);
  return Number.isNaN(millis) ? undefined : millis;
}
