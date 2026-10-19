import { AppError } from "../lib/errors";

/** Caps how many voice notes are processed at once. Extra requests wait in line, briefly, then get a clear "busy" answer. */
export class Limiter {
  private active = 0; private waiters: Array<() => void> = [];
  constructor(private max: number, private waitMs: number) {}
  get stats() { return { max: this.max, active: this.active, queued: this.waiters.length }; }
  async acquire(): Promise<() => void> {
    if (this.active < this.max) { this.active++; return this.releaser(); }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== go); reject(new AppError(503, "busy", "Lots of voice notes are being processed right now. Please try again in a moment.")); }, this.waitMs);
      const go = () => { clearTimeout(timer); resolve(); };
      this.waiters.push(go);
    });
    this.active++; return this.releaser();
  }
  private releaser() { let done = false; return () => { if (done) return; done = true; this.active--; this.waiters.shift()?.(); }; }
}
