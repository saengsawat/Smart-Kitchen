/**
 * Outbound request budget for one process (M2-T4a (a)): at most `limit`
 * sends in any rolling `windowMs`. It refuses rather than queues: a scan
 * waiting most of a minute for a slot is worse than an honest "try again",
 * and a queue would let a burst of scans pile up behind OFF's limit.
 *
 * `now` is injected so tests drive it with a fake clock.
 */
export class SlidingWindowThrottle {
  private readonly sent: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("throttle limit must be a positive integer");
    if (!Number.isFinite(windowMs) || windowMs <= 0)
      throw new RangeError("throttle window must be positive");
  }

  /** Spends one slot and answers `true`, or answers `false` and spends nothing. */
  tryAcquire(): boolean {
    const now = this.now();
    while (this.sent.length > 0 && now - (this.sent[0] ?? now) >= this.windowMs) {
      this.sent.shift();
    }
    if (this.sent.length >= this.limit) return false;
    this.sent.push(now);
    return true;
  }
}
