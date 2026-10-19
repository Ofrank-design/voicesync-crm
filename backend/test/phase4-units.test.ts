import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../src/resilience/breaker";
import { Limiter } from "../src/resilience/limiter";
import { ResultCache } from "../src/resilience/idempotency";
import { isTransient, countsAgainstBreaker, fallbackEligible } from "../src/resilience/classify";
import { summarize, todayTotals, toCsv, startOfUtcDay, nextUtcMidnight, MemoryUsageRepo, type UsageEvent } from "../src/services/usage-repo";
import { loadConfig } from "../src/config";
import { validateFallback } from "../src/providers/registry";
import { env } from "./helpers";

describe("circuit breaker", () => {
  const make = () => { let t = 0; const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000, now: () => t }); return { b, tick: (ms: number) => (t += ms) }; };
  it("stays closed until the failure threshold, and a success resets the count", () => {
    const { b } = make();
    b.failure(); b.failure(); b.success(); b.failure(); b.failure();
    expect(b.state).toBe("closed"); expect(b.allow()).toBe(true);
    b.failure(); expect(b.state).toBe("open"); expect(b.allow()).toBe(false);
  });
  it("tells callers how long to wait, then lets exactly one probe through", () => {
    const { b, tick } = make();
    for (let i = 0; i < 3; i++) b.failure();
    expect(b.retryInSeconds()).toBe(30); tick(10_000); expect(b.retryInSeconds()).toBe(20);
    tick(20_000);
    expect(b.state).toBe("half_open"); expect(b.allow()).toBe(true); expect(b.allow()).toBe(false);   // one probe only
  });
  it("closes after a good probe and reopens after a bad one", () => {
    const { b, tick } = make();
    for (let i = 0; i < 3; i++) b.failure(); tick(30_000);
    b.allow(); b.failure(); expect(b.state).toBe("open");
    tick(30_000); b.allow(); b.success(); expect(b.state).toBe("closed"); expect(b.allow()).toBe(true);
  });
  it("a probe that fails for a reason unrelated to provider health frees the slot", () => {
    const { b, tick } = make();
    for (let i = 0; i < 3; i++) b.failure(); tick(30_000);
    expect(b.allow()).toBe(true); b.release(); expect(b.allow()).toBe(true);
  });
});

describe("error classification", () => {
  it("only genuine provider trouble counts", () => {
    for (const c of ["extraction_unavailable", "transcription_timeout", "upstream_rate_limited", "extraction_billing"]) { expect(isTransient(c)).toBe(true); expect(countsAgainstBreaker(c)).toBe(true); expect(fallbackEligible(c)).toBe(true); }
    for (const c of ["extraction_misconfigured", "extraction_model_not_found", "extraction_invalid_json", "extraction_schema_mismatch", "extraction_refused", "empty_transcript", "cancelled", "unsupported_audio", "transcription_rejected"]) { expect(isTransient(c), c).toBe(false); expect(fallbackEligible(c), c).toBe(false); }
  });
  it("an open circuit is a reason to use a backup but not new evidence against the provider", () => {
    expect(fallbackEligible("extraction_circuit_open")).toBe(true); expect(countsAgainstBreaker("extraction_circuit_open")).toBe(false);
  });
});

describe("limiter", () => {
  it("lets work through up to the cap, queues the rest, and hands slots on in order", async () => {
    const l = new Limiter(2, 1000); const a = await l.acquire(), b = await l.acquire();
    expect(l.stats).toEqual({ max: 2, active: 2, queued: 0 });
    const order: string[] = []; const c = l.acquire().then((r) => { order.push("c"); return r; }); const d = l.acquire().then((r) => { order.push("d"); return r; });
    await new Promise((r) => setTimeout(r, 20)); expect(l.stats.queued).toBe(2);
    a(); (await c)(); b(); (await d)();
    expect(order).toEqual(["c", "d"]); expect(l.stats.active).toBe(0);
  });
  it("answers 503 busy when the wait is too long, and a slot released twice is only freed once", async () => {
    const l = new Limiter(1, 30); const r = await l.acquire();
    await expect(l.acquire()).rejects.toMatchObject({ status: 503, code: "busy" });
    r(); r(); expect(l.stats.active).toBe(0);
    const again = await l.acquire(); expect(l.stats.active).toBe(1); again();
  });
});

describe("result cache", () => {
  it("is per user, expires, and stays bounded", () => {
    let t = 0; const c = new ResultCache<number>(1000, 3, () => t);
    c.set("a", "k", 1); expect(c.get("a", "k")).toBe(1); expect(c.get("b", "k")).toBeUndefined();
    t = 1500; expect(c.get("a", "k")).toBeUndefined();
    for (let i = 0; i < 6; i++) c.set("a", `k${i}`, i);
    expect(c.size).toBe(3); expect(c.get("a", "k0")).toBeUndefined(); expect(c.get("a", "k5")).toBe(5);
  });
});

const ev = (o: Partial<UsageEvent> = {}): UsageEvent => ({ user_id: "u1", at: "2026-10-16T10:00:00.000Z", step: "extraction", provider: "openai", ok: true, fallback: false, duration_ms: 100, audio_seconds: 90, ...o });
describe("usage maths", () => {
  it("counts a note once a task draft was returned, and ignores failures and transcription only attempts", () => {
    expect(todayTotals([ev(), ev({ audio_seconds: 30 }), ev({ ok: false }), ev({ step: "transcription" })])).toEqual({ notes: 2, audio_minutes: 2 });
  });
  it("summarises by provider and user, including failures and backups", () => {
    const s = summarize([ev(), ev({ step: "extraction", provider: "groq", input_tokens: 100, output_tokens: 20 }), ev({ step: "extraction", provider: "groq", ok: false, fallback: true }), ev({ user_id: "u2" })]);
    expect(s.totals).toMatchObject({ calls: 4, failures: 1, fallback_calls: 1, notes: 3, input_tokens: 100, output_tokens: 20 });
    expect(s.by_provider.find((p) => p.provider === "groq")).toMatchObject({ calls: 2, failures: 1, fallback_calls: 1 });
    expect(s.by_user.map((u) => u.user_id).sort()).toEqual(["u1", "u2"]);
  });
  it("CSV quotes cells and neutralises spreadsheet formulas", () => {
    const csv = toCsv([ev({ model: '=HYPERLINK("x")', error_code: "a,b" })]);
    expect(csv.split("\n")[0]).toBe("at,user_id,request_id,step,provider,model,ok,error_code,audio_seconds,input_tokens,output_tokens,fallback,duration_ms");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`); expect(csv).toContain('"a,b"');
  });
  it("day boundaries are UTC", () => {
    const d = new Date("2026-10-16T23:30:00Z");
    expect(startOfUtcDay(d)).toBe("2026-10-16T00:00:00.000Z"); expect(nextUtcMidnight(d)).toBe("2026-10-17T00:00:00.000Z");
  });
  it("memory repo filters by time and user", async () => {
    const r = new MemoryUsageRepo(); await r.record(ev()); await r.record(ev({ user_id: "u2", at: "2026-10-10T00:00:00Z" }));
    expect((await r.since("2026-10-15T00:00:00Z")).length).toBe(1); expect((await r.since("2026-10-01T00:00:00Z", "u2")).length).toBe(1);
  });
});

describe("backup provider configuration", () => {
  const keys = { OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "g", GEMINI_API_KEY: "" } as Record<string, string>;
  const main = { transcription: "openai", extraction: "anthropic" } as const;
  it("accepts a valid backup and nothing set means no backup", () => {
    expect(validateFallback(main, { extraction: { provider: "groq", model: "m" } }, keys)).toEqual([]);
    expect(validateFallback(main, {}, keys)).toEqual([]);
  });
  it("explains every way a backup can be wrong", () => {
    expect(validateFallback(main, { extraction: { provider: "gemini", model: "m" } }, keys).join(" ")).toMatch(/GEMINI_API_KEY is required/);
    expect(validateFallback(main, { extraction: { provider: "groq" } }, keys).join(" ")).toMatch(/FALLBACK_EXTRACTION_MODEL is required/);
    expect(validateFallback(main, { extraction: { provider: "anthropic", model: "m" } }, keys).join(" ")).toMatch(/must be a different provider/);
    expect(validateFallback(main, { transcription: { provider: "anthropic", model: "m" } }, keys).join(" ")).toMatch(/cannot do audio transcription/);
    expect(validateFallback(main, { transcription: { provider: "groq" } }, keys).join(" ")).toMatch(/FALLBACK_TRANSCRIPTION_MODEL is required/);
  });
  it("is checked at startup, together with the other settings", () => {
    const e = { ...env, GROQ_API_KEY: "g" } as NodeJS.ProcessEnv;
    expect(() => loadConfig({ ...e, FALLBACK_EXTRACTION_PROVIDER: "groq", FALLBACK_EXTRACTION_MODEL: "m" })).not.toThrow();
    expect(() => loadConfig({ ...e, FALLBACK_EXTRACTION_PROVIDER: "groq" })).toThrow(/FALLBACK_EXTRACTION_MODEL/);
    expect(() => loadConfig({ ...e, FALLBACK_EXTRACTION_PROVIDER: "anthropic", FALLBACK_EXTRACTION_MODEL: "m" })).toThrow(/different provider/);
  });
  it("limits and breaker settings have safe defaults", () => {
    const c = loadConfig(env);
    expect(c).toMatchObject({ BREAKER_FAILURES: 5, BREAKER_COOLDOWN_SECONDS: 30, AI_MAX_CONCURRENCY: 4, AI_QUEUE_TIMEOUT_MS: 15000 });
    expect(c.USER_DAILY_NOTES).toBeUndefined();
    expect(loadConfig({ ...env, USER_DAILY_NOTES: "20", USER_DAILY_AUDIO_MINUTES: "30" }).USER_DAILY_NOTES).toBe(20);
  });
});
