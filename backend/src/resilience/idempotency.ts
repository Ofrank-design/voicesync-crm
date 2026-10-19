/**
 * Remembers the finished result of a voice note for a short time, so a retry with the same Idempotency-Key
 * (for example after a dropped connection) returns it without calling the AI providers or charging again.
 * Held in memory only, per user, and gone after the TTL or a restart.
 */
export class ResultCache<T> {
  private m = new Map<string, { at: number; value: T }>();
  constructor(private ttlMs = 10 * 60_000, private max = 500, private now: () => number = Date.now) {}
  get(userId: string, key: string): T | undefined {
    const k = `${userId}:${key}`; const e = this.m.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.m.delete(k); return undefined; }
    return e.value;
  }
  set(userId: string, key: string, value: T) {
    this.m.set(`${userId}:${key}`, { at: this.now(), value });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  get size() { return this.m.size; }
}
