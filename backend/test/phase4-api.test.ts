import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { MemorySettingsRepo } from "../src/services/settings-repo";
import { MemoryUsageRepo } from "../src/services/usage-repo";
import { ProviderManager } from "../src/providers/manager";
import { unauthorized } from "../src/lib/errors";
import { env, WEBM, bearer } from "./helpers";

const good = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" };
const KEY = { openai: "sk-openai", groq: "gsk-groq", anthropic: "sk-ant" };
const err = (status: number) => Object.assign(new Error("raw upstream sk-leak"), { status });
const ok = (usage?: object) => ({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: "stop" }], ...(usage ? { usage } : {}) });
const chat = () => ({ chat: { completions: { create: vi.fn().mockResolvedValue(ok({ prompt_tokens: 120, completion_tokens: 30 })) } } });
const stt = () => ({ audio: { transcriptions: { create: vi.fn().mockResolvedValue({ text: "Call Daniel on Friday" }) } }, models: { retrieve: vi.fn() } });

/** Primary: OpenAI for both steps. Optional backups on Groq. Every provider call goes to a mock chosen by the key it was built with. */
function setup(over: { env?: Record<string, string>; clock?: { t: number } } = {}) {
  const chats = { [KEY.openai]: chat(), [KEY.groq]: chat() }, stts = { [KEY.openai]: stt(), [KEY.groq]: stt() };
  const usage = new MemoryUsageRepo(); const clock = over.clock ?? { t: 0 };
  const config = loadConfig({ ...env, OPENAI_API_KEY: KEY.openai, GROQ_API_KEY: KEY.groq, ADMIN_USER_IDS: "admin-1", EXTRACTION_PROVIDER: "openai", EXTRACTION_MODEL: "primary-model", BREAKER_FAILURES: "3", BREAKER_COOLDOWN_SECONDS: "30", ...over.env } as NodeJS.ProcessEnv);
  const manager = new ProviderManager(config, new MemorySettingsRepo(), { chatClient: (_u, k) => chats[k] as never, transcriptionClient: (_u, k) => stts[k] as never }, undefined, { usage, now: () => clock.t });
  const app = createApp({ config, auth: { authenticate: async (t) => { if (!t) throw unauthorized(); return t; } }, transcriber: manager, extractor: manager, repo: new MemoryTaskRepo(), providerAdmin: { manager }, usage });
  const note = (who = "u1", extra: Record<string, string> = {}, key?: string) => { let r = request(app).post("/api/voice-sync").set(bearer(who)); if (key) r = r.set("Idempotency-Key", key); for (const [k, v] of Object.entries(extra)) r = r.field(k, v); return r.attach("audio", WEBM, "a.webm"); };
  return { app, manager, usage, chats, stts, clock, note, primaryChat: chats[KEY.openai]!.chat.completions.create, backupChat: chats[KEY.groq]!.chat.completions.create, primaryStt: stts[KEY.openai]!.audio.transcriptions.create, backupStt: stts[KEY.groq]!.audio.transcriptions.create };
}
const BACKUP = { FALLBACK_EXTRACTION_PROVIDER: "groq", FALLBACK_EXTRACTION_MODEL: "backup-model", FALLBACK_TRANSCRIPTION_PROVIDER: "groq", FALLBACK_TRANSCRIPTION_MODEL: "backup-stt" };

describe("backup providers (explicit, bounded, disclosed)", () => {
  it("uses the backup only when the main provider is struggling, and says so", async () => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValue(err(503));
    const r = await s.note();
    expect(r.status).toBe(200);
    expect(r.body.processed_by).toEqual({ transcription: { id: "openai", label: "OpenAI" }, extraction: { id: "groq", label: "Groq" }, fallback_used: true });
    expect(s.backupChat.mock.calls[0]![0].model).toBe("backup-model");
    const ev = s.usage.events.filter((e) => e.step === "extraction");
    expect(ev.map((e) => [e.provider, e.ok, e.fallback])).toEqual([["openai", false, false], ["groq", true, true]]);
  });
  it.each([[429, "upstream_rate_limited"], [402, "extraction_billing"], [504, "extraction_unavailable"]])("a %s from the main provider moves to the backup", async (status) => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValue(err(status));
    expect((await s.note()).body.processed_by.fallback_used).toBe(true);
  });
  it("never switches without a configured backup", async () => {
    const s = setup(); s.primaryChat.mockRejectedValue(err(503));
    const r = await s.note();
    expect(r.status).toBe(502); expect(r.body.error.code).toBe("extraction_unavailable"); expect(s.backupChat).not.toHaveBeenCalled();
  });
  it.each([[401, "extraction_misconfigured"], [404, "extraction_model_not_found"]])("a %s is a setup problem, so it is shown and not hidden behind a backup", async (status, code) => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValue(err(status));
    const r = await s.note(); expect(r.body.error.code).toBe(code); expect(s.backupChat).not.toHaveBeenCalled();
  });
  it("bad answers and refusals are not retried on another provider", async () => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockResolvedValue({ choices: [{ message: { content: "not json" }, finish_reason: "stop" }] });
    expect((await s.note()).body.error.code).toBe("extraction_invalid_json"); expect(s.backupChat).not.toHaveBeenCalled();
  });
  it("is bounded to one backup: if that fails too the user gets a clear error", async () => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValue(err(503)); s.backupChat.mockRejectedValue(err(503));
    const r = await s.note(); expect(r.status).toBe(502); expect(s.primaryChat).toHaveBeenCalledTimes(1); expect(s.backupChat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r.body)).not.toMatch(/sk-leak|raw upstream/);
  });
  it("speech has its own backup", async () => {
    const s = setup({ env: BACKUP }); s.primaryStt.mockRejectedValue(err(503));
    const r = await s.note();
    expect(r.body.processed_by).toMatchObject({ transcription: { id: "groq" }, extraction: { id: "openai" }, fallback_used: true });
    expect(s.backupStt.mock.calls[0]![0].model).toBe("backup-stt");
  });
  it("a normal note reports no backup", async () => {
    const r = await setup({ env: BACKUP }).note(); expect(r.body.processed_by.fallback_used).toBeUndefined();
  });
  it("refuses a main provider choice that equals the backup", async () => {
    const s = setup({ env: BACKUP });
    const r = await request(s.app).put("/api/admin/providers").set(bearer("admin-1")).send({ transcription: "openai", extraction: "groq", extraction_model: "m" });
    expect(r.status).toBe(400); expect(r.body.error.details.join(" ")).toMatch(/also the backup/);
  });
});

describe("circuit breaker in the API", () => {
  it("stops calling a failing provider, tells the user how long, and recovers after a good probe", async () => {
    const s = setup(); s.primaryChat.mockRejectedValue(err(503));
    for (let i = 0; i < 3; i++) expect((await s.note()).body.error.code).toBe("extraction_unavailable");
    expect(s.primaryChat).toHaveBeenCalledTimes(3);
    const open = await s.note();
    expect(open.status).toBe(503); expect(open.body.error.code).toBe("extraction_circuit_open"); expect(open.body.error.message).toMatch(/pausing it.*about \d+ seconds/);
    expect(s.primaryChat).toHaveBeenCalledTimes(3);                                  // no new call while open
    expect((await request(s.app).get("/api/health")).body.providers.reliability.breakers.extraction.state).toBe("open");
    s.clock.t = 31_000; s.primaryChat.mockResolvedValue(ok());
    expect((await s.note()).status).toBe(200);                                       // the probe succeeds
    expect((await request(s.app).get("/api/health")).body.providers.reliability.breakers.extraction.state).toBe("closed");
  });
  it("user and setup errors never open the circuit", async () => {
    const s = setup(); s.primaryChat.mockResolvedValue({ choices: [{ message: { content: "nope" }, finish_reason: "stop" }] });
    for (let i = 0; i < 6; i++) await s.note();
    expect((await request(s.app).get("/api/health")).body.providers.reliability.breakers.extraction.state).toBe("closed");
  });
  it("an open circuit sends traffic to the backup straight away", async () => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValue(err(503));
    for (let i = 0; i < 3; i++) await s.note();
    const before = s.primaryChat.mock.calls.length;
    const r = await s.note(); expect(r.body.processed_by.extraction.id).toBe("groq"); expect(s.primaryChat.mock.calls.length).toBe(before);
  });
  it("health shows circuit state and backups, never keys", async () => {
    const h = (await request(setup({ env: BACKUP }).app).get("/api/health")).body;
    expect(h.providers.reliability.backups).toEqual({ transcription: "groq", extraction: "groq" });
    expect(JSON.stringify(h)).not.toMatch(/sk-|gsk-|key/i);
  });
});

describe("usage tracking", () => {
  it("records tokens, audio seconds, timing and the user for every provider call", async () => {
    const s = setup(); await s.note("u1", { duration_seconds: "42" });
    const [t, e] = s.usage.events;
    expect(t).toMatchObject({ user_id: "u1", step: "transcription", provider: "openai", ok: true, audio_seconds: 42, fallback: false });
    expect(e!.audio_seconds).toBe(42);
    expect(e).toMatchObject({ step: "extraction", provider: "openai", model: "primary-model", ok: true, input_tokens: 120, output_tokens: 30 });
    expect(t!.request_id).toBeTruthy(); expect(JSON.stringify(s.usage.events)).not.toMatch(/Daniel|Call/);   // no transcript content
  });
  it("records failures with their error code but no raw provider text", async () => {
    const s = setup(); s.primaryChat.mockRejectedValue(err(429)); await s.note();
    expect(s.usage.events.at(-1)).toMatchObject({ step: "extraction", ok: false, error_code: "upstream_rate_limited" });
    expect(JSON.stringify(s.usage.events)).not.toMatch(/sk-leak/);
  });
  it("connection tests are not counted", async () => {
    const s = setup(); await request(s.app).post("/api/admin/providers/test").set(bearer("admin-1")).send({ step: "extraction" });
    expect(s.usage.events).toHaveLength(0);
  });
});

describe("daily limits", () => {
  it("stops a user at their limit before any provider is called, and others are unaffected", async () => {
    const s = setup({ env: { USER_DAILY_NOTES: "2" } });
    expect((await s.note("u1")).status).toBe(200); expect((await s.note("u1")).status).toBe(200);
    const calls = s.primaryChat.mock.calls.length;
    const r = await s.note("u1");
    expect(r.status).toBe(429); expect(r.body.error.code).toBe("daily_limit_reached"); expect(r.body.error.message).toMatch(/all 2 of today's voice notes.*midnight UTC/);
    expect(s.primaryChat.mock.calls.length).toBe(calls);
    expect((await s.note("u2")).status).toBe(200);
  });
  it("failed notes do not use up the allowance, and yesterday does not count", async () => {
    const s = setup({ env: { USER_DAILY_NOTES: "1" } });
    s.primaryChat.mockRejectedValueOnce(err(503)); expect((await s.note("u1")).status).toBe(502);
    expect((await s.note("u1")).status).toBe(200);
    expect((await s.note("u1")).status).toBe(429);
    for (const e of s.usage.events) e.at = "2026-01-01T00:00:00.000Z";
    expect((await s.note("u1")).status).toBe(200);
  });
  it("can limit audio minutes", async () => {
    const s = setup({ env: { USER_DAILY_AUDIO_MINUTES: "1" } });
    expect((await s.note("u1", { duration_seconds: "50" })).status).toBe(200); expect((await s.note("u1", { duration_seconds: "50" })).status).toBe(200);
    expect((await s.note("u1", { duration_seconds: "10" })).body.error.message).toMatch(/1 minutes of audio/);
  });
  it("/api/usage shows today's numbers and the limits", async () => {
    const s = setup({ env: { USER_DAILY_NOTES: "5" } }); await s.note("u1", { duration_seconds: "60" });
    const r = await request(s.app).get("/api/usage").set(bearer("u1"));
    expect(r.body).toMatchObject({ today: { notes: 1, audio_minutes: 1 }, limits: { notes: 5, audio_minutes: null } }); expect(r.body.resets_at).toMatch(/T00:00:00/);
    expect((await request(s.app).get("/api/usage")).status).toBe(401);
    expect((await request(s.app).get("/api/usage").set(bearer("someone-else"))).body.today.notes).toBe(0);
  });
});

describe("safe retries of the same voice note", () => {
  it("returns the saved result without calling providers or counting it again", async () => {
    const s = setup({ env: { USER_DAILY_NOTES: "1" } });
    const a = await s.note("u1", {}, "k1"), b = await s.note("u1", {}, "k1");
    expect(b.status).toBe(200); expect(b.headers["idempotent-replay"]).toBe("true"); expect(b.body).toEqual(a.body);
    expect(s.primaryChat).toHaveBeenCalledTimes(1); expect(s.primaryStt).toHaveBeenCalledTimes(1);
    expect(s.usage.events).toHaveLength(2);                                           // one transcription, one extraction
  });
  it("is per user, and a failed first try is not saved", async () => {
    const s = setup();
    await s.note("u1", {}, "k1"); await s.note("u2", {}, "k1");
    expect(s.primaryChat).toHaveBeenCalledTimes(2);
    s.primaryChat.mockRejectedValueOnce(err(503)); expect((await s.note("u3", {}, "k9")).status).toBe(502);
    expect((await s.note("u3", {}, "k9")).status).toBe(200);
  });
  it("replays on the streaming endpoint too", async () => {
    const s = setup(); await s.note("u1", {}, "ks");
    const r = await request(s.app).post("/api/voice-sync").set(bearer("u1")).set("Idempotency-Key", "ks").set("X-Progress", "stream").buffer(true).parse((res, cb) => { let d = ""; res.on("data", (c: Buffer) => (d += c)); res.on("end", () => cb(null, d)); }).attach("audio", WEBM, "a.webm");
    const lines = (r.body as string).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.stage)).toEqual(["done"]); expect(s.primaryChat).toHaveBeenCalledTimes(1);
  });
});

describe("concurrency cap", () => {
  it("queues the next note and finishes it when a slot frees up", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const s = setup({ env: { AI_MAX_CONCURRENCY: "1" } });
    s.primaryStt.mockImplementationOnce(async () => { await gate; return { text: "slow" }; });
    const first = s.note("u1").then((r) => r);
    await new Promise((r) => setTimeout(r, 120));
    const second = s.note("u2").then((r) => r);
    await new Promise((r) => setTimeout(r, 120)); release();
    expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  });
  it("answers busy when the wait runs out, as a normal JSON error", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const s = setup({ env: { AI_MAX_CONCURRENCY: "1", AI_QUEUE_TIMEOUT_MS: "60" } });
    s.primaryStt.mockImplementationOnce(async () => { await gate; return { text: "slow" }; });
    const first = s.note("u1").then((r) => r); await new Promise((r) => setTimeout(r, 120));
    const busy = await s.note("u2");
    expect(busy.status).toBe(503); expect(busy.body.error.code).toBe("busy"); expect(busy.body.error.message).toMatch(/try again in a moment/);
    release(); expect((await first).status).toBe(200);
    expect((await s.note("u2")).status).toBe(200);                                   // the line is clear again
  });
});

describe("admin usage and reliability views", () => {
  it("are admin only", async () => {
    const s = setup();
    for (const p of ["/api/admin/usage", "/api/admin/usage.csv"]) expect((await request(s.app).get(p).set(bearer("someone"))).status).toBe(403);
  });
  it("summarise the last days by provider and user", async () => {
    const s = setup({ env: BACKUP }); s.primaryChat.mockRejectedValueOnce(err(503)); await s.note("u1", { duration_seconds: "60" }); await s.note("u2", { duration_seconds: "30" });
    const r = (await request(s.app).get("/api/admin/usage?days=7").set(bearer("admin-1"))).body;
    expect(r.days).toBe(7); expect(r.totals).toMatchObject({ notes: 2, failures: 1, fallback_calls: 1, input_tokens: 240 });
    expect(r.by_provider.find((p: any) => p.provider === "groq" && p.step === "extraction")).toMatchObject({ calls: 1, fallback_calls: 1 });
    expect(r.by_user).toHaveLength(2);
    expect((await request(s.app).get("/api/admin/usage?days=9999").set(bearer("admin-1"))).body.days).toBe(90);
  });
  it("exports CSV with no transcripts or keys", async () => {
    const s = setup(); await s.note("u1");
    const r = await request(s.app).get("/api/admin/usage.csv").set(bearer("admin-1"));
    expect(r.headers["content-type"]).toMatch(/text\/csv/); expect(r.headers["content-disposition"]).toMatch(/attachment; filename="voicesync-usage-30d\.csv"/);
    expect(r.text.split("\n")[0]).toContain("user_id,request_id,step,provider"); expect(r.text.trim().split("\n")).toHaveLength(3);
    expect(r.text).not.toMatch(/Daniel|sk-|gsk-/);
  });
  it("the provider status includes circuit state, backups, concurrency and limits", async () => {
    const r = (await request(setup({ env: { ...BACKUP, USER_DAILY_NOTES: "9" } }).app).get("/api/admin/providers").set(bearer("admin-1"))).body;
    expect(r.reliability).toMatchObject({ breakers: { extraction: { provider: "openai", state: "closed" } }, backups: { extraction: "groq" } });
    expect(r.concurrency).toMatchObject({ max: 4, active: 0 }); expect(r.limits).toEqual({ notes: 9, audio_minutes: null });
  });
});
