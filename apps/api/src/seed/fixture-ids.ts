/**
 * Deterministic ids for the development seed (M2-T2).
 *
 * The seed has to be idempotent: running it twice must change nothing. That is
 * only possible if the rows it writes have the same primary keys every time,
 * so the ids are derived from a name rather than generated.
 *
 * Derivation is SHA-256 over a namespaced name, with the RFC 9562 version and
 * variant bits stamped into the first 16 bytes, which is exactly the recipe
 * UUIDv5 uses with SHA-1. Version **8** ("custom") is set rather than 5,
 * because a v5 uuid promises the SHA-1-over-namespace-uuid construction and
 * this is not that; claiming a version we do not implement would be a small
 * lie in a column other people will read.
 *
 * These ids are not secrets and are not reachable in production: the seed
 * refuses to run outside the fixture environments (`seed-fixture.ts`).
 */

import { createHash } from "node:crypto";

/** Namespace prefix, so a name here can never collide with a name elsewhere. */
const NAMESPACE = "smart-kitchen:fixture-seed:";

/** A stable uuid for `name`, the same on every machine and every run. */
export function fixtureSeedUuid(name: string): string {
  const digest = createHash("sha256").update(`${NAMESPACE}${name}`, "utf8").digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  // Version 8 in the high nibble of byte 6; RFC 4122 variant (10xx) in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
