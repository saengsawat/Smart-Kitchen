/** The join-attempt limiter (M2-T3 (b)). Pure; the HTTP behaviour is in households.db.test.ts. */

import { describe, expect, it } from "vitest";
import {
  createJoinAttemptLimiter,
  createSlidingWindowLimiter,
  JOIN_ATTEMPT_LIMIT,
  JOIN_ATTEMPT_WINDOW_MS,
} from "./rate-limit.js";

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe("join attempt limiter", () => {
  it("is 10 attempts per 10 minutes, as the ticket states", () => {
    expect(JOIN_ATTEMPT_LIMIT).toBe(10);
    expect(JOIN_ATTEMPT_WINDOW_MS).toBe(600_000);
  });

  it("allows ten attempts and refuses the eleventh inside the window", () => {
    const time = clock();
    const limiter = createJoinAttemptLimiter(time.now);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(limiter.tryAcquire("user-a"), `attempt ${String(attempt)}`).toBe(true);
      time.advance(1_000);
    }
    expect(limiter.tryAcquire("user-a")).toBe(false);
  });

  it("keys per user: one user's burst does not spend another's budget", () => {
    const time = clock();
    const limiter = createJoinAttemptLimiter(time.now);
    for (let attempt = 0; attempt < 10; attempt += 1) limiter.tryAcquire("user-a");
    expect(limiter.tryAcquire("user-a")).toBe(false);
    expect(limiter.tryAcquire("user-b")).toBe(true);
  });

  it("frees a slot once the oldest attempt leaves the window, and not before", () => {
    const time = clock();
    const limiter = createJoinAttemptLimiter(time.now);
    for (let attempt = 0; attempt < 10; attempt += 1) limiter.tryAcquire("user-a");
    time.advance(JOIN_ATTEMPT_WINDOW_MS - 1);
    expect(limiter.tryAcquire("user-a")).toBe(false);
    time.advance(1);
    expect(limiter.tryAcquire("user-a")).toBe(true);
  });

  it("does not record refused attempts, so waiting out the window always works", () => {
    const time = clock();
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 100, now: time.now });
    limiter.tryAcquire("k");
    limiter.tryAcquire("k");
    for (let attempt = 0; attempt < 50; attempt += 1) expect(limiter.tryAcquire("k")).toBe(false);
    time.advance(100);
    expect(limiter.tryAcquire("k")).toBe(true);
  });

  it("refuses nonsense configuration", () => {
    expect(() => createSlidingWindowLimiter({ limit: 0, windowMs: 1 })).toThrow();
    expect(() => createSlidingWindowLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
