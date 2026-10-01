/**
 * Client idempotency key shape, shared by the inventory write path
 * (`write-service.ts`) and the create path (`create-service.ts`) (M9-T0 c).
 *
 * Letters, digits, dot, underscore, hyphen; 1 to 128 characters. Narrow on
 * purpose. It excludes `::`, which the ledger reserves for the rows it
 * authors itself, and `/`, which keeps every client key outside the
 * `<key>/lot/<n>` namespace the write path derives into. Without the second
 * exclusion a key ending in `/lot` would derive into another key's namespace,
 * and "the rows of this write" would stop being a well-defined set.
 */
export const CLIENT_KEY = /^[A-Za-z0-9._-]{1,128}$/;
