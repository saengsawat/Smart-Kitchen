/**
 * UUIDv7 generation (RFC 9562 §5.7), hand-rolled on `node:crypto` — no new
 * dependency (CLAUDE.md rule 11; M1-T2 worker report §11 backlog item 1).
 *
 * **Not wired anywhere.** Where ids are minted (client, API, or a future
 * Postgres built-in) is an M2 decision (data-model.md §1 assumes time-ordered
 * ids; today's schema accepts caller-supplied `uuid` columns of any version).
 * This module only makes a correct generator available for that decision to
 * use.
 *
 * ## Layout (128 bits)
 *
 * ```text
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                           unix_ts_ms                         |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |          unix_ts_ms          |  ver  |       rand_a          |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |var|                        rand_b                            |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                            rand_b                            |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * ```
 *
 * - `unix_ts_ms` — 48 bits, big-endian milliseconds since the Unix epoch.
 * - `ver` — 4 bits, always `0111` (7).
 * - `rand_a` — 12 bits. RFC 9562's "Method 2" (monotonic random, §6.2)
 *   repurposes this field as a per-millisecond counter, seeded randomly and
 *   incremented for every id minted within the same millisecond, so ids
 *   generated in the same tick still sort strictly after one another — a
 *   plain `Math.random()` fill here would let two same-millisecond ids come
 *   back in either order.
 * - `var` — 2 bits, always `10` (the RFC 4122 variant).
 * - `rand_b` — 62 bits of cryptographically random data (`node:crypto`,
 *   never `Math.random`), split 6 bits alongside `var` and 56 bits after.
 *
 * Because `unix_ts_ms` and `rand_a` are both big-endian, fixed-width fields
 * ahead of the purely random `rand_b`, two UUIDv7 strings compare correctly
 * with plain lexicographic (byte/hex) ordering — the property the whole
 * format exists for.
 */

import { randomBytes as nodeRandomBytes, randomInt as nodeRandomInt } from "node:crypto";

const RAND_A_BITS = 12;
const RAND_A_MAX = (1 << RAND_A_BITS) - 1; // 0xfff

/** Injectable randomness/clock, so tests never depend on real time or entropy. */
export interface Uuidv7Options {
  /** Milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Returns `size` cryptographically random bytes. Defaults to `node:crypto.randomBytes`. */
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Returns a random integer in `[min, max)`. Defaults to `node:crypto.randomInt`. */
  readonly randomInt?: (min: number, max: number) => number;
}

/** Encodes one UUIDv7 string from its already-decided fields (pure, no I/O — exported for direct testing of the bit layout). */
export function encodeUuidv7(timestampMs: number, randA: number, randB: Uint8Array): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > 0xffff_ffff_ffff) {
    throw new RangeError(`uuidv7 timestampMs must fit in 48 bits, got ${String(timestampMs)}`);
  }
  if (!Number.isInteger(randA) || randA < 0 || randA > RAND_A_MAX) {
    throw new RangeError(
      `uuidv7 randA must be a ${String(RAND_A_BITS)}-bit integer, got ${String(randA)}`,
    );
  }
  if (randB.length < 8) {
    throw new RangeError(`uuidv7 randB must supply at least 8 bytes, got ${String(randB.length)}`);
  }

  const bytes = new Uint8Array(16);

  // unix_ts_ms — 48 bits, big-endian, across bytes 0-5.
  for (let i = 0; i < 6; i++) {
    // Shifting a 48-bit value by more than 31 bits overflows a plain `<<`
    // (which coerces to a 32-bit signed int), so this divides instead.
    const shift = 8 * (5 - i);
    bytes[i] = Math.floor(timestampMs / 2 ** shift) & 0xff;
  }

  // version (0111) + top 4 bits of rand_a.
  bytes[6] = 0x70 | ((randA >> 8) & 0x0f);
  // bottom 8 bits of rand_a.
  bytes[7] = randA & 0xff;

  // variant (10) + top 6 bits of rand_b.
  bytes[8] = 0x80 | ((randB[0] as number) & 0x3f);
  // remaining 56 bits of rand_b.
  for (let i = 9; i < 16; i++) {
    bytes[i] = randB[i - 8] as number;
  }

  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Creates an independent UUIDv7 generator with its own monotonic state —
 * every call to the returned function is guaranteed to sort strictly after
 * the previous one from the *same* generator (real-clock ties broken by the
 * `rand_a` counter; a clock that runs backwards is clamped forward rather
 * than emitting a smaller id). Two different generators (or the shared
 * {@link uuidv7} below, called from two processes) carry no such relationship
 * to one another — monotonicity is a per-generator, single-process property,
 * exactly what RFC 9562 §6.2's "Method 2" promises.
 */
export function createUuidv7Generator(options: Uuidv7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));
  const randomInt = options.randomInt ?? nodeRandomInt;

  let lastMs = -1;
  let randA = 0;

  return function uuidv7(): string {
    const observed = now();
    let ms = observed;

    if (ms > lastMs) {
      randA = randomInt(0, RAND_A_MAX + 1);
    } else {
      // Same millisecond as the previous id (the common case at any real
      // request rate), or the clock went backwards — either way, hold the
      // timestamp at `lastMs` and increment the counter so this id still
      // sorts strictly after the previous one.
      ms = lastMs;
      randA += 1;
      if (randA > RAND_A_MAX) {
        // 4096 ids minted at the same stored millisecond: advance the
        // virtual clock by one tick rather than silently wrapping the
        // counter back to a smaller value (which would break monotonicity).
        ms += 1;
        randA = 0;
      }
    }
    lastMs = ms;

    return encodeUuidv7(ms, randA, randomBytes(8));
  };
}

/** Shared, process-wide generator using real time and `node:crypto` randomness. */
export const uuidv7: () => string = createUuidv7Generator();
