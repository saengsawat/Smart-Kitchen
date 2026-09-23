/**
 * UUIDv7 key generator tests (M3-T4a). Pure: no network, no real clock.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidv7Generator, encodeUuidv7, nextIdempotencyKey } from "./idempotency";

/**
 * `expo-crypto` is aliased, repo-wide, to `test-support/expo-crypto-mock.ts`
 * (a real `node:crypto`-backed implementation: see vitest.config.ts). This
 * file overrides that alias with its own mock so the tests below can force
 * each of the module's three randomness tiers (architect ruling
 * 2026-09-22): `expoCallCount` proves tier 2 was actually reached (not just
 * that the result happens to look valid), and `expoShouldThrow` simulates
 * tier 2 itself being unavailable, to reach tier 3.
 */
let expoCallCount = 0;
let expoShouldThrow = false;
vi.mock("expo-crypto", () => ({
  getRandomBytes: (byteCount: number): Uint8Array => {
    expoCallCount += 1;
    if (expoShouldThrow) {
      throw new Error("simulated: expo-crypto native binding unavailable");
    }
    const bytes = new Uint8Array(byteCount);
    bytes.fill(0x55);
    return bytes;
  },
}));

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The wire's own key charset (packages/contracts/src/inventory.ts InventoryWriteRequestDto.idempotencyKey). */
const CLIENT_KEY_CHARSET = /^[A-Za-z0-9._-]{1,128}$/;

function versionNibble(id: string): string {
  return id.split("-")[2]?.[0] as string;
}

function variantBits(id: string): string {
  const nibble = id.split("-")[3]?.[0] as string;
  return parseInt(nibble, 16).toString(2).padStart(4, "0").slice(0, 2);
}

describe("encodeUuidv7", () => {
  it("produces the exact bytes for known inputs (same layout as apps/api's generator)", () => {
    const randB = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const id = encodeUuidv7(0x0123_4567_89ab, 0x123, randB);
    expect(id).toBe("01234567-89ab-7123-8001-020304050607");
  });

  it("always sets the version nibble to 7", () => {
    const id = encodeUuidv7(0, 0, new Uint8Array(8));
    expect(versionNibble(id)).toBe("7");
  });

  it("always sets the variant's top two bits to 10", () => {
    const randB = new Uint8Array(8).fill(0xff);
    const id = encodeUuidv7(0, 0, randB);
    expect(variantBits(id)).toBe("10");
  });

  it("matches the canonical 8-4-4-4-12 UUID shape and the wire's client-key charset", () => {
    const id = encodeUuidv7(Date.now(), 0, new Uint8Array(8));
    expect(id).toMatch(UUID_SHAPE);
    expect(id).toMatch(CLIENT_KEY_CHARSET);
  });

  it("rejects a timestamp that does not fit in 48 bits", () => {
    expect(() => encodeUuidv7(2 ** 48, 0, new Uint8Array(8))).toThrow(RangeError);
    expect(() => encodeUuidv7(-1, 0, new Uint8Array(8))).toThrow(RangeError);
  });

  it("rejects a randA outside 12 bits", () => {
    expect(() => encodeUuidv7(0, 0x1000, new Uint8Array(8))).toThrow(RangeError);
    expect(() => encodeUuidv7(0, -1, new Uint8Array(8))).toThrow(RangeError);
  });

  it("rejects fewer than 8 bytes of randB", () => {
    expect(() => encodeUuidv7(0, 0, new Uint8Array(7))).toThrow(RangeError);
  });
});

describe("createUuidv7Generator: monotonicity within a millisecond", () => {
  it("increments the rand_a counter across calls that land in the same millisecond", () => {
    const FIXED_MS = 1_700_000_000_000;
    let randIntCalls = 0;
    const generator = createUuidv7Generator({
      now: () => FIXED_MS,
      randomInt: () => {
        randIntCalls += 1;
        return 10;
      },
      randomBytes: () => new Uint8Array(8),
    });

    const first = generator();
    const second = generator();
    const third = generator();

    expect(randIntCalls).toBe(1);
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
    expect(first.slice(0, 13)).toBe(second.slice(0, 13));
    expect(second.slice(0, 13)).toBe(third.slice(0, 13));
  });

  it("draws a fresh random rand_a whenever the millisecond advances", () => {
    let ms = 1_700_000_000_000;
    const draws: number[] = [];
    const generator = createUuidv7Generator({
      now: () => ms,
      randomInt: (min) => {
        draws.push(min);
        return min;
      },
      randomBytes: () => new Uint8Array(8),
    });

    generator();
    ms += 1;
    generator();

    expect(draws).toHaveLength(2);
  });

  it("clamps a clock that runs backwards, still producing a strictly increasing id", () => {
    const timestamps = [1_700_000_000_500, 1_700_000_000_100, 1_700_000_000_100];
    let call = 0;
    const generator = createUuidv7Generator({
      now: () => timestamps[Math.min(call++, timestamps.length - 1)] as number,
      randomInt: () => 0,
      randomBytes: () => new Uint8Array(8),
    });

    const first = generator();
    const second = generator();
    const third = generator();

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
    expect(first.slice(0, 13)).toBe(second.slice(0, 13));
    expect(second.slice(0, 13)).toBe(third.slice(0, 13));
  });

  it("two independent generators carry no ordering relationship to one another", () => {
    const a = createUuidv7Generator({
      now: () => 100,
      randomInt: () => 0,
      randomBytes: () => new Uint8Array(8),
    });
    const b = createUuidv7Generator({
      now: () => 100,
      randomInt: () => 0,
      randomBytes: () => new Uint8Array(8),
    });
    // Same inputs, same generator logic: two fresh generators produce the
    // same id for the same (mocked) timestamp/randomness, proving
    // monotonicity is per-generator state, not a global counter.
    expect(a()).toBe(b());
  });
});

describe("default randomness source (no injected options): three tiers, architect ruling 2026-09-22", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  function setGlobalCrypto(value: unknown): void {
    Object.defineProperty(globalThis, "crypto", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalDescriptor);
    }
    expoCallCount = 0;
    expoShouldThrow = false;
  });

  it("tier 1: uses a global crypto.getRandomValues when present, never reaching expo-crypto", () => {
    let webCryptoCalled = false;
    setGlobalCrypto({
      getRandomValues: (arr: Uint8Array) => {
        webCryptoCalled = true;
        arr.fill(0x42);
        return arr;
      },
    });
    const generator = createUuidv7Generator();
    const id = generator();
    expect(webCryptoCalled).toBe(true);
    expect(expoCallCount).toBe(0);
    expect(id).toMatch(UUID_SHAPE);
  });

  it("tier 2: uses expo-crypto's getRandomBytes when no global crypto.getRandomValues exists (Hermes/Expo SDK 57 today)", () => {
    setGlobalCrypto(undefined);
    const generator = createUuidv7Generator();
    const id = generator();
    expect(expoCallCount).toBeGreaterThan(0);
    expect(id).toMatch(UUID_SHAPE);
    expect(id).toMatch(CLIENT_KEY_CHARSET);
  });

  it("tier 3: falls back to Math.random and warns exactly once per process when expo-crypto is also unavailable", async () => {
    setGlobalCrypto(undefined);
    expoShouldThrow = true;
    // A fresh module instance so this test's `warnedMathRandomFallback`
    // module state starts unset, regardless of what earlier tests in this
    // file (or the shared `nextIdempotencyKey` generator) already triggered.
    vi.resetModules();
    const fresh = await import("./idempotency");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const generator = fresh.createUuidv7Generator();
      const first = generator();
      const second = generator();
      expect(first).toMatch(UUID_SHAPE);
      expect(second).toMatch(UUID_SHAPE);
      expect(expoCallCount).toBeGreaterThan(0); // tier 2 was tried, and failed
      expect(warnSpy).toHaveBeenCalledTimes(1); // once per process, not once per key
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("nextIdempotencyKey (the shared, process-wide generator)", () => {
  it("produces a well-formed, monotonically increasing key on each call", () => {
    const first = nextIdempotencyKey();
    const second = nextIdempotencyKey();
    expect(first).toMatch(UUID_SHAPE);
    expect(second).toMatch(UUID_SHAPE);
    expect(first < second).toBe(true);
  });
});
