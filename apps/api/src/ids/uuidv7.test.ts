/**
 * UUIDv7 generator tests (M1-T10-h). Pure — no I/O, no DATABASE_URL guard.
 */

import { describe, expect, it } from "vitest";
import { createUuidv7Generator, encodeUuidv7, uuidv7 } from "./uuidv7.js";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Version nibble (first hex digit of the third group). */
function versionNibble(id: string): string {
  return id.split("-")[2]?.[0] as string;
}

/** Top two bits of the variant byte (first hex digit of the fourth group), as "10"/"11"/etc. */
function variantBits(id: string): string {
  const nibble = id.split("-")[3]?.[0] as string;
  return parseInt(nibble, 16).toString(2).padStart(4, "0").slice(0, 2);
}

describe("encodeUuidv7", () => {
  it("produces the exact bytes for known inputs", () => {
    // timestampMs = 0x0123_4567_89ab (48 bits), randA = 0x123 (fits 12 bits),
    // randB = 8 bytes 0x00..0x07.
    const randB = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const id = encodeUuidv7(0x0123_4567_89ab, 0x123, randB);
    // bytes 0-5: 01 23 45 67 89 ab
    // byte 6: version 7 | top nibble of randA (0x1) = 0x71
    // byte 7: bottom byte of randA (0x23) = 0x23
    // byte 8: variant 10 | (randB[0]=0x00 & 0x3f) = 0x80
    // bytes 9-15: randB[1..7] = 01 02 03 04 05 06 07
    expect(id).toBe("01234567-89ab-7123-8001-020304050607");
  });

  it("always sets the version nibble to 7", () => {
    const id = encodeUuidv7(0, 0, new Uint8Array(8));
    expect(versionNibble(id)).toBe("7");
  });

  it("always sets the variant's top two bits to 10", () => {
    // randB[0] with every bit set: the variant nibble must still read as 1xxx
    // with the top two bits fixed at 10, regardless of the random fill.
    const randB = new Uint8Array(8).fill(0xff);
    const id = encodeUuidv7(0, 0, randB);
    expect(variantBits(id)).toBe("10");
  });

  it("matches the canonical 8-4-4-4-12 UUID shape", () => {
    const id = encodeUuidv7(Date.now(), 0, new Uint8Array(8));
    expect(id).toMatch(UUID_SHAPE);
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

describe("createUuidv7Generator — monotonicity", () => {
  it("increments the rand_a counter across calls that land in the same millisecond", () => {
    const FIXED_MS = 1_700_000_000_000;
    let randIntCalls = 0;
    const generator = createUuidv7Generator({
      now: () => FIXED_MS,
      randomInt: () => {
        randIntCalls += 1;
        return 10; // only used for the very first call at a new timestamp
      },
      randomBytes: () => new Uint8Array(8), // deterministic rand_b — irrelevant to ordering here
    });

    const first = generator();
    const second = generator();
    const third = generator();

    // Called exactly once: only the first id at a new (higher) timestamp
    // draws a fresh random rand_a; the rest increment it instead.
    expect(randIntCalls).toBe(1);

    expect(first < second).toBe(true);
    expect(second < third).toBe(true);

    // Same encoded timestamp for all three (the clock never advanced) —
    // ordering came entirely from rand_a.
    expect(first.slice(0, 13)).toBe(second.slice(0, 13));
    expect(second.slice(0, 13)).toBe(third.slice(0, 13));
  });

  it("draws a fresh random rand_a whenever the millisecond advances", () => {
    let ms = 1_700_000_000_000;
    const draws: number[] = [];
    const generator = createUuidv7Generator({
      now: () => ms,
      randomInt: (min) => {
        const value = min; // deterministic: always the low end of the range
        draws.push(value);
        return value;
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
    // The clamped calls both encode the *first* (later, held) timestamp, not
    // the backwards-jumping `now()` values.
    expect(first.slice(0, 13)).toBe(second.slice(0, 13));
    expect(second.slice(0, 13)).toBe(third.slice(0, 13));
  });

  it("advances the virtual clock by one tick rather than wrapping rand_a past 4095", () => {
    const FIXED_MS = 1_700_000_000_000;
    const generator = createUuidv7Generator({
      now: () => FIXED_MS,
      // Seed rand_a at the top of its range so the very next call overflows.
      randomInt: () => 0xfff,
      randomBytes: () => new Uint8Array(8),
    });

    const atLimit = generator();
    const overflowed = generator();

    expect(atLimit < overflowed).toBe(true);
    // The overflowed id's encoded timestamp is one tick later than the
    // (unchanging) `now()` value — proof the virtual clock, not `now()`,
    // advanced.
    const atLimitMs = parseInt(atLimit.replaceAll("-", "").slice(0, 12), 16);
    const overflowedMs = parseInt(overflowed.replaceAll("-", "").slice(0, 12), 16);
    expect(overflowedMs).toBe(atLimitMs + 1);
  });

  it("two independent generators share no monotonic relationship", () => {
    // Documented behaviour, not a bug: monotonicity is per-generator.
    const a = createUuidv7Generator({ now: () => 100, randomInt: () => 0xfff });
    const b = createUuidv7Generator({ now: () => 0, randomInt: () => 0 });
    const fromA = a();
    const fromB = b();
    expect(fromA > fromB).toBe(true); // true here, but only because of the chosen clocks
  });
});

describe("uuidv7 (shared, real-clock generator)", () => {
  it("produces well-formed, version-7/variant-correct ids", () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_SHAPE);
    expect(versionNibble(id)).toBe("7");
    expect(variantBits(id)).toBe("10");
  });

  it("consecutive calls are strictly increasing", () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i - 1]! < ids[i]!).toBe(true);
    }
  });

  it("every id is unique across a larger batch", () => {
    const ids = Array.from({ length: 500 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
