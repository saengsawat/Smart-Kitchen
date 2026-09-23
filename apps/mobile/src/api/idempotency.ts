/**
 * Client idempotency keys for the M2-T2 write/undo endpoints (M3-T4a).
 *
 * A retry must never mint a new key (BACKLOG.md M3-T4a invariant): one key
 * per user action (one `correctQuantity`/`removeQuantity`/`undo` call),
 * generated once, reused on every retry of that action. This module supplies
 * the generator; `HttpApiClient` (`src/api/client.ts`) is the one caller,
 * minting exactly one key per write and reusing it across its own internal
 * retry (a flaky-connection retry, not a second user tap: see that file's
 * doc comment).
 *
 * ## Format and layout parity
 *
 * A UUIDv7 (RFC 9562 §5.7), the same 128-bit layout as the server's own
 * generator (`apps/api/src/ids/uuidv7.ts`): 48-bit big-endian millisecond
 * timestamp, a 4-bit version (`0111`), a 12-bit `rand_a` used as a
 * per-millisecond monotonic counter (RFC 9562 §6.2 "Method 2"), a 2-bit
 * variant (`10`), and 62 bits of `rand_b`. Restated here rather than
 * imported: `apps/mobile` cannot depend on `apps/api`, and the two must stay
 * independently correct against the same spec, not coupled through a shared
 * module neither app can reach without a new package. The API's own
 * generator was never wired to mint ids in production (its doc comment says
 * so explicitly); this is a second, independent implementation for a
 * different purpose (idempotency keys, not row ids), so there is no drift
 * risk from one silently diverging behind the other's back.
 *
 * The wire only requires the key to match `^[A-Za-z0-9._-]{1,128}$`
 * (packages/contracts/src/inventory.ts): a UUIDv7 satisfies that
 * incidentally (hex digits and hyphens), it is not the reason one was
 * chosen. The reason is monotonic ordering within a millisecond (useful for
 * correlating a burst of client-generated keys in logs/telemetry) and
 * parity with the server's own id shape, which is what the ticket asks for.
 *
 * ## Randomness source (three tiers, architect ruling 2026-09-22)
 *
 * Verified against Expo SDK 57 / React Native 0.86's Hermes engine: a global
 * `crypto.getRandomValues` **is not available** (Hermes ships no `crypto`
 * global at all: no `getRandomValues`, no `randomUUID`, no `subtle`). This
 * was first escalated rather than worked around by silently adding a
 * dependency (CLAUDE.md rule 11); the architect's ruling on that escalation
 * is to add `expo-crypto` (Expo's own module: the same rule-11 precedent as
 * `expo-font`, already a dependency, and the planned `expo-camera`, M3-T4b) and
 * use its synchronous `getRandomBytes`/`getRandomValues`, which really is
 * backed by a native secure random source on-device.
 *
 * Three tiers, in order, each one a fallback for the one before it, never
 * silently masking which tier actually ran:
 *
 * 1. A global `crypto.getRandomValues`, if the runtime ever grows one (kept
 *    so this generator uses the real Web Crypto API automatically the day
 *    Hermes or a future engine adds it, with no code change here).
 * 2. `expo-crypto`'s `getRandomBytes`/`getRandomValues`: the real answer on
 *    every device today.
 * 3. `Math.random()`, only if both of the above are unavailable (e.g.
 *    `expo-crypto`'s native binding itself is missing: its own
 *    `UnavailabilityError` case), logging **one** `console.warn` the first
 *    time this happens per process, never silently. An idempotency key is
 *    never a security or authorization token: the server never trusts it
 *    as identity, only as a within-household replay/conflict key
 *    (data-model.md §6): so `Math.random`'s lack of cryptographic
 *    unpredictability costs nothing here as a last resort. It would not be
 *    an acceptable fallback for a value that needed to resist an adversary
 *    guessing it, which is exactly why reaching it is logged rather than
 *    silently reused elsewhere.
 */

import * as ExpoCrypto from "expo-crypto";

const RAND_A_BITS = 12;
const RAND_A_MAX = (1 << RAND_A_BITS) - 1; // 0xfff

/**
 * The subset of the Web Crypto API this module needs. Declared locally
 * rather than relying on `lib.dom.d.ts`'s `Crypto` type: this app's
 * tsconfig sets `"lib": ["ESNext"]` with no DOM lib (M3-T1 invariant), and
 * the whole point of this module is that this global may not exist at
 * runtime either (see the module doc comment).
 */
interface MinimalWebCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** Tier 1: whichever global `crypto.getRandomValues` this runtime has, or `undefined` if none. */
function detectGlobalWebCrypto(): ((array: Uint8Array) => Uint8Array) | undefined {
  const cryptoObj = (globalThis as { crypto?: MinimalWebCrypto }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    return (array: Uint8Array) => cryptoObj.getRandomValues(array);
  }
  return undefined;
}

let warnedMathRandomFallback = false;

/** Tier 3 is reached: log once per process, never silently (module doc comment). */
function warnMathRandomFallbackOnce(): void {
  if (warnedMathRandomFallback) {
    return;
  }
  warnedMathRandomFallback = true;
  console.warn(
    "smart-kitchen: no global crypto.getRandomValues and expo-crypto's native " +
      "random source is unavailable; idempotency keys are falling back to " +
      "Math.random() for the rest of this session. See " +
      "apps/mobile/src/api/idempotency.ts for why this is an acceptable " +
      "last resort here specifically (an idempotency key, never a security " +
      "or authorization token).",
  );
}

/** `size` random bytes, in the module doc comment's three-tier order. */
function randomBytesFallback(size: number): Uint8Array {
  const webCrypto = detectGlobalWebCrypto();
  if (webCrypto) {
    return webCrypto(new Uint8Array(size));
  }
  try {
    return ExpoCrypto.getRandomBytes(size);
  } catch {
    warnMathRandomFallbackOnce();
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }
}

/** A random integer in `[min, max)`, from the same three-tier source as {@link randomBytesFallback}. */
function randomIntFallback(min: number, max: number): number {
  const range = max - min;
  // One random byte is enough for the 12-bit rand_a range this module
  // actually calls this with (range <= 4096); a modulo bias is an
  // acceptable, well-understood trade-off for a counter seed, never a
  // security value.
  const webCrypto = detectGlobalWebCrypto();
  if (webCrypto) {
    const buf = webCrypto(new Uint8Array(2));
    return min + (((buf[0]! << 8) | buf[1]!) % range);
  }
  try {
    const buf = ExpoCrypto.getRandomBytes(2);
    return min + (((buf[0]! << 8) | buf[1]!) % range);
  } catch {
    warnMathRandomFallbackOnce();
    return min + Math.floor(Math.random() * range);
  }
}

/** Injectable randomness/clock, so tests never depend on real time or entropy. */
export interface Uuidv7Options {
  /** Milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Returns `size` random bytes. Defaults to {@link randomBytesFallback}. */
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Returns a random integer in `[min, max)`. Defaults to {@link randomIntFallback}. */
  readonly randomInt?: (min: number, max: number) => number;
}

/**
 * Encodes one UUIDv7 string from its already-decided fields (pure, no I/O).
 * Byte-for-byte the same layout as `apps/api/src/ids/uuidv7.ts`'s function of
 * the same name (restated for parity, see module doc comment); exported for
 * direct testing of the bit layout.
 */
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

  // unix_ts_ms: 48 bits, big-endian, across bytes 0-5.
  for (let i = 0; i < 6; i++) {
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
 * Creates an independent UUIDv7 generator with its own monotonic state:
 * every call is guaranteed to sort strictly after the previous one from the
 * *same* generator (real-clock ties broken by the `rand_a` counter). See
 * `apps/api/src/ids/uuidv7.ts`'s generator of the same name for the full
 * rationale; the algorithm here is identical.
 */
export function createUuidv7Generator(options: Uuidv7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? randomBytesFallback;
  const randomInt = options.randomInt ?? randomIntFallback;

  let lastMs = -1;
  let randA = 0;

  return function uuidv7(): string {
    const observed = now();
    let ms = observed;

    if (ms > lastMs) {
      randA = randomInt(0, RAND_A_MAX + 1);
    } else {
      ms = lastMs;
      randA += 1;
      if (randA > RAND_A_MAX) {
        ms += 1;
        randA = 0;
      }
    }
    lastMs = ms;

    return encodeUuidv7(ms, randA, randomBytes(8));
  };
}

/** Shared, process-wide generator (one per app instance, plenty for one device's idempotency keys). */
export const nextIdempotencyKey: () => string = createUuidv7Generator();
