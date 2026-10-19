export type BreakerState = "closed" | "open" | "half_open";
export interface BreakerOptions { failureThreshold: number; cooldownMs: number; now?: () => number }

/**
 * Stops hammering a provider that keeps failing. After `failureThreshold` failures in a row it opens and refuses calls
 * for `cooldownMs`. Then it lets exactly one probe call through: success closes it, failure opens it again.
 */
export class CircuitBreaker {
  private failures = 0; private openedAt = 0; private st: BreakerState = "closed"; private probing = false;
  constructor(private o: BreakerOptions) {}
  private now() { return (this.o.now ?? Date.now)(); }
  get state(): BreakerState { this.tick(); return this.st; }
  private tick() { if (this.st === "open" && this.now() - this.openedAt >= this.o.cooldownMs) { this.st = "half_open"; this.probing = false; } }
  /** True if a call may go ahead. In half open state only one caller gets true until it reports back. */
  allow(): boolean {
    this.tick();
    if (this.st === "closed") return true;
    if (this.st === "half_open" && !this.probing) { this.probing = true; return true; }
    return false;
  }
  success() { this.failures = 0; this.st = "closed"; this.probing = false; }
  failure() {
    this.probing = false; this.failures += 1;
    if (this.st === "half_open" || this.failures >= this.o.failureThreshold) { this.st = "open"; this.openedAt = this.now(); }
  }
  /** The call ended in a way that says nothing about provider health (user error, cancellation). Frees a half open probe. */
  release() { this.probing = false; }
  retryInSeconds(): number { return this.st === "open" ? Math.max(1, Math.ceil((this.o.cooldownMs - (this.now() - this.openedAt)) / 1000)) : 0; }
}
