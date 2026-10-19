import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { EventEmitter } from "node:events";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { cachedAuthenticator } from "../src/auth";
import { makeLogger, redact } from "../src/lib/logger";
import { Metrics } from "../src/lib/metrics";
import { Lifecycle, installShutdown } from "../src/lib/lifecycle";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { MemorySettingsRepo } from "../src/services/settings-repo";
import { MemoryUsageRepo } from "../src/services/usage-repo";
import { ProviderManager } from "../src/providers/manager";
import { unauthorized } from "../src/lib/errors";
import { env, WEBM, bearer } from "./helpers";

describe("logger", () => {
  it("writes one JSON object per line and filters by level", () => {
    const lines: string[] = []; const log = makeLogger("warn", (l) => lines.push(l));
    log.info("quiet"); log.warn("careful", { a: 1 }); log.error("bad");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["careful", "bad"]);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "warn", a: 1 }); expect(JSON.parse(lines[0]!).ts).toMatch(/T/);
  });
  it("redacts anything that could be a secret or what someone said, at any depth", () => {
    const out = redact({ ok: 1, Authorization: "Bearer abc", nested: { api_key: "sk-1", list: [{ transcript: "private words" }], fine: "x" }, OPENAI_API_KEY: "sk-2", audio: "bytes" }) as any;
    expect(out).toEqual({ ok: 1, Authorization: "[redacted]", nested: { api_key: "[redacted]", list: [{ transcript: "[redacted]" }], fine: "x" }, OPENAI_API_KEY: "[redacted]", audio: "[redacted]" });
  });
  it("silent level writes nothing", () => { const l: string[] = []; makeLogger("silent", (x) => l.push(x)).error("x"); expect(l).toEqual([]); });
});

describe("metrics registry", () => {
  it("renders counters, histograms and gauges in Prometheus text format with escaped labels", () => {
    const m = new Metrics();
    m.inc("things_total", "Things", { route: '/a"b', status: "200" }); m.inc("things_total", "Things", { route: '/a"b', status: "200" }, 2);
    m.observe("took_seconds", "Time", { route: "/x" }, 0.3); m.observe("took_seconds", "Time", { route: "/x" }, 20);
    m.gauge("depth", "Depth", () => [[{ q: "a" }, 7]]);
    const t = m.render();
    expect(t).toContain("# TYPE things_total counter"); expect(t).toContain('things_total{route="/a\\"b",status="200"} 3');
    expect(t).toContain('took_seconds_bucket{route="/x",le="0.5"} 1'); expect(t).toContain('took_seconds_bucket{route="/x",le="+Inf"} 2'); expect(t).toContain('took_seconds_count{route="/x"} 2');
    expect(t).toContain('depth{q="a"} 7');
  });
});

describe("graceful shutdown", () => {
  const rig = (closeImpl?: (cb: (e?: Error) => void) => void) => {
    const proc = new EventEmitter() as unknown as NodeJS.Process; const exit = vi.fn(); const lifecycle = new Lifecycle();
    const server = { close: vi.fn((cb?: (e?: Error) => void) => (closeImpl ?? ((c) => c()))(cb!)) };
    const lines: string[] = []; const stop = installShutdown({ server, lifecycle, log: makeLogger("debug", (l) => lines.push(l)), exit, proc, timeoutMs: 50 });
    return { proc, exit, server, lifecycle, lines, stop };
  };
  it("marks the server as draining, stops accepting, and exits cleanly once requests finish", () => {
    const r = rig(); r.proc.emit("SIGTERM");
    expect(r.lifecycle.draining).toBe(true); expect(r.server.close).toHaveBeenCalledTimes(1); expect(r.exit).toHaveBeenCalledWith(0);
  });
  it("ignores a second signal", () => { const r = rig(); r.proc.emit("SIGTERM"); r.proc.emit("SIGINT"); expect(r.server.close).toHaveBeenCalledTimes(1); });
  it("exits with a failure code if requests do not finish in time", async () => {
    const r = rig(() => { /* never calls back */ }); r.proc.emit("SIGTERM");
    await new Promise((x) => setTimeout(x, 90)); expect(r.exit).toHaveBeenCalledWith(1); expect(r.lines.join()).toMatch(/shutdown timed out/);
  });
  it("logs and exits non zero on a crash", () => {
    const r = rig(); r.proc.emit("unhandledRejection", new Error("boom"));
    expect(r.exit).toHaveBeenCalledWith(1); expect(r.lines.join()).toMatch(/unhandled rejection/);
  });
});

describe("auth cache", () => {
  const inner = () => { const f = vi.fn(async (t?: string) => { if (!t || t === "bad") throw unauthorized(); return `user-of-${t}`; }); return { f, a: { authenticate: f } }; };
  it("calls the identity service once per token within the time window, then asks again", async () => {
    let t = 0; const { f, a } = inner(); const c = cachedAuthenticator(a, { ttlMs: 30_000, now: () => t });
    expect(await c.authenticate("t1")).toBe("user-of-t1"); expect(await c.authenticate("t1")).toBe("user-of-t1"); expect(f).toHaveBeenCalledTimes(1);
    expect(await c.authenticate("t2")).toBe("user-of-t2"); expect(f).toHaveBeenCalledTimes(2);
    t = 31_000; await c.authenticate("t1"); expect(f).toHaveBeenCalledTimes(3);
  });
  it("never caches a failure, and a missing token is passed through", async () => {
    const { f, a } = inner(); const c = cachedAuthenticator(a, { ttlMs: 30_000 });
    await expect(c.authenticate("bad")).rejects.toMatchObject({ status: 401 }); await expect(c.authenticate("bad")).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(2); await expect(c.authenticate(undefined)).rejects.toBeDefined();
  });
  it("can be switched off, and stays bounded", async () => {
    const { f, a } = inner(); const off = cachedAuthenticator(a, { ttlMs: 0 }); await off.authenticate("x"); await off.authenticate("x"); expect(f).toHaveBeenCalledTimes(2);
    const small = cachedAuthenticator(inner().a, { ttlMs: 30_000, max: 2 }); for (const t of ["a", "b", "c"]) await small.authenticate(t);
  });
});

describe("production configuration checks", () => {
  const prod = { ...env, NODE_ENV: "production", FRONTEND_ORIGIN: "https://app.example.com", SUPABASE_URL: "https://x.supabase.co" } as NodeJS.ProcessEnv;
  it("accepts a proper production setup", () => { expect(() => loadConfig(prod)).not.toThrow(); });
  it.each([["wildcard origin", { FRONTEND_ORIGIN: "*" }], ["plain http origin", { FRONTEND_ORIGIN: "http://app.example.com" }], ["localhost origin", { FRONTEND_ORIGIN: "https://localhost:3000" }], ["http Supabase", { SUPABASE_URL: "http://x.supabase.co" }], ["short metrics token", { METRICS_TOKEN: "short" }]])("refuses %s", (_n, bad) => {
    expect(() => loadConfig({ ...prod, ...bad } as NodeJS.ProcessEnv)).toThrow(/Invalid server configuration/);
  });
  it("does not get in the way of local development", () => { expect(() => loadConfig({ ...env, FRONTEND_ORIGIN: "http://localhost:3000" })).not.toThrow(); });
  it("has safe operational defaults", () => { expect(loadConfig(env)).toMatchObject({ TRUST_PROXY: 1, AUTH_CACHE_SECONDS: 30, SHUTDOWN_TIMEOUT_SECONDS: 25 }); expect(loadConfig(env).METRICS_TOKEN).toBeUndefined(); });
});

const good = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" };
function build(over: Record<string, string> = {}, extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const lines: string[] = []; const metrics = new Metrics(); const lifecycle = new Lifecycle();
  const config = loadConfig({ ...env, ADMIN_USER_IDS: "admin-1", ...over } as NodeJS.ProcessEnv);
  const log = makeLogger("debug", (l) => lines.push(l));
  const manager = new ProviderManager(config, new MemorySettingsRepo(), {}, ((_c: unknown, s: any) => ({ transcriber: { transcribe: async () => "my secret words about Daniel" }, extractor: { extract: async () => ({ task: good as never, warnings: [] }) }, summary: { transcription: { id: s.transcription, label: "OpenAI" }, extraction: { id: s.extraction, label: "Anthropic" } } })) as never, { usage: new MemoryUsageRepo(), metrics, log });
  const app = createApp({ config, auth: { authenticate: async (t) => { if (!t) throw unauthorized(); return t; } }, transcriber: manager, extractor: manager, repo: new MemoryTaskRepo(), providerAdmin: { manager }, usage: new MemoryUsageRepo(), logger: log, metrics, lifecycle, ...extra });
  return { app, lines, metrics, lifecycle, parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe("request logs", () => {
  it("log method, route pattern, status, timing and request id, and nothing else about the request", async () => {
    const { app, parsed } = build();
    const created = await request(app).post("/api/tasks").set(bearer("u1")).send({ ...good, transcript: "private words" });
    await request(app).get(`/api/tasks/${created.body.task.id}?secret=1`).set(bearer("u1"));
    const reqs = parsed().filter((l) => l.msg === "request");
    const get = reqs.find((l) => l.method === "GET")!;
    expect(get).toMatchObject({ route: "/api/tasks/:id", status: 200, user_id: "u1" }); expect(get.request_id).toBeTruthy(); expect(get.duration_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(reqs)).not.toMatch(/secret=1|private words|Bearer|Authorization/i); expect(JSON.stringify(reqs)).not.toContain(created.body.task.id);
  });
  it("groups unknown paths under one route so logs and metrics stay small", async () => {
    const { app, parsed } = build(); await request(app).get("/api/does-not-exist/123");
    expect(parsed().find((l) => l.msg === "request")).toMatchObject({ route: "unmatched", status: 404 });
  });
  it("never logs transcripts, tokens or keys when a voice note is processed", async () => {
    const { app, lines } = build({ OPENAI_API_KEY: "sk-test-key-12345" }, { auth: { authenticate: async (t) => { if (!t) throw unauthorized(); return "user-1"; } } });
    await request(app).post("/api/voice-sync").set(bearer("tok-abc-123")).attach("audio", WEBM, "a.webm");
    expect(lines.join("\n")).not.toMatch(/secret words|tok-abc-123|sk-test-key|Bearer/);
  });
  it("logs unexpected errors with the request id but sends the user a generic message", async () => {
    const { app, parsed } = build({}, { repo: Object.assign(new MemoryTaskRepo(), { list: async () => { throw new Error("db password=hunter2 exploded"); } }) });
    const r = await request(app).get("/api/tasks").set(bearer("u1"));
    expect(r.status).toBe(500); expect(JSON.stringify(r.body)).not.toMatch(/hunter2/);
    const err = parsed().find((l) => l.msg === "unhandled error")!; expect(err.request_id).toBe(r.headers["x-request-id"]);
  });
  it("audit entries are marked and carry who changed providers, not what", async () => {
    const { app, parsed } = build({ GROQ_API_KEY: "g" });
    await request(app).put("/api/admin/providers").set(bearer("admin-1")).send({ transcription: "openai", extraction: "groq", extraction_model: "m" });
    expect(parsed().find((l) => l.audit)).toMatchObject({ msg: "providers.changed", by: "admin-1", extraction: "groq" });
  });
});

describe("metrics endpoint", () => {
  it("does not exist unless a token is configured", async () => { expect((await request(build().app).get("/metrics")).status).toBe(404); });
  it("needs the token", async () => {
    const { app } = build({ METRICS_TOKEN: "m".repeat(32) });
    expect((await request(app).get("/metrics")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer wrong")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", `Bearer ${"m".repeat(32)}`)).status).toBe(200);
  });
  it("reports traffic, AI calls, circuit state and load, with no people or content in the labels", async () => {
    const { app } = build({ METRICS_TOKEN: "m".repeat(32) });
    await request(app).post("/api/tasks").set(bearer("user-xyz")).send(good);
    await request(app).post("/api/voice-sync").set(bearer("user-xyz")).attach("audio", WEBM, "a.webm");
    const t = (await request(app).get("/metrics").set("Authorization", `Bearer ${"m".repeat(32)}`)).text;
    expect(t).toContain('http_requests_total{method="POST",route="/api/tasks",status="201"} 1');
    expect(t).toMatch(/http_request_duration_seconds_count\{method="POST",route="\/api\/voice-sync"\} 1/);
    expect(t).toContain('ai_calls_total{fallback="false",outcome="ok",provider="openai",step="transcription"} 1');
    expect(t).toContain('provider_circuit_state{provider="anthropic",step="extraction"} 0'); expect(t).toContain("voice_notes_in_flight 0"); expect(t).toContain("process_uptime_seconds");
    expect(t).not.toMatch(/user-xyz|secret words|Bearer/); expect(t).not.toMatch(/route="\/metrics"/);
  });
});

describe("liveness and readiness", () => {
  it("live is always ok", async () => { expect((await request(build().app).get("/api/live")).body).toEqual({ status: "ok" }); });
  it("ready and health agree, and say 503 when the database is down", async () => {
    const down = Object.assign(new MemoryTaskRepo(), { ping: async () => { throw new Error("down"); } });
    const { app } = build({}, { repo: down });
    for (const p of ["/api/ready", "/api/health"]) { const r = await request(app).get(p); expect(r.status).toBe(503); expect(r.body).toMatchObject({ status: "degraded", services: { database: "unavailable" } }); }
    expect((await request(build().app).get("/api/ready")).status).toBe(200);
  });
  it("tells the load balancer to stop sending traffic while shutting down, but stays live", async () => {
    const { app, lifecycle } = build(); lifecycle.draining = true;
    expect((await request(app).get("/api/ready")).body).toEqual({ status: "draining" }); expect((await request(app).get("/api/ready")).status).toBe(503);
    expect((await request(app).get("/api/live")).status).toBe(200);
  });
});

describe("port from the hosting platform", () => {
  it("uses PORT when API_PORT is not set, prefers API_PORT when both are, and defaults to 8000", () => {
    expect(loadConfig({ ...env, PORT: "10000" } as NodeJS.ProcessEnv).API_PORT).toBe(10000);
    expect(loadConfig({ ...env, PORT: "10000", API_PORT: "9000" } as NodeJS.ProcessEnv).API_PORT).toBe(9000);
    expect(loadConfig(env).API_PORT).toBe(8000);
  });
});
