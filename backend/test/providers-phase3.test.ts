import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { MemorySettingsRepo } from "../src/services/settings-repo";
import { ProviderManager } from "../src/providers/manager";
import { PROVIDERS } from "../src/providers/registry";
import { env, WEBM, bearer } from "./helpers";

const good = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" };
const SECRETS = ["sk-openai-secret", "sk-ant-secret", "gsk-groq-secret"];
const cfgEnv = { ...env, OPENAI_API_KEY: SECRETS[0], ANTHROPIC_API_KEY: SECRETS[1], GROQ_API_KEY: SECRETS[2], ADMIN_USER_IDS: "admin-1, admin-2" } as NodeJS.ProcessEnv;

function setup(over: { env?: Record<string, string>; settings?: MemorySettingsRepo; chat?: unknown; stt?: unknown } = {}) {
  const calls: Array<{ kind: string; base?: string; key: string }> = [];
  const chatMock = over.chat ?? { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: "stop" }] }) } } };
  const sttMock = over.stt ?? { audio: { transcriptions: { create: vi.fn().mockResolvedValue({ text: "Call Daniel on Friday" }) } }, models: { retrieve: vi.fn().mockResolvedValue({ id: "m" }) } };
  const config = loadConfig({ ...cfgEnv, ...over.env } as NodeJS.ProcessEnv);
  const settings = over.settings ?? new MemorySettingsRepo();
  const manager = new ProviderManager(config, settings, {
    chatClient: (base, key) => { calls.push({ kind: "chat", base, key }); return chatMock as never; },
    transcriptionClient: (base, key) => { calls.push({ kind: "stt", base, key }); return sttMock as never; },
  });
  const auth = { authenticate: async (t?: string) => { if (!t || t === "bad") throw Object.assign(new Error("x"), { status: 401, code: "unauthorized" }); return t; } };
  const app = createApp({ config, auth: { authenticate: async (t) => { if (!t || t === "bad") { const { unauthorized } = await import("../src/lib/errors"); throw unauthorized(); } return t; } }, transcriber: manager, extractor: manager, repo: new MemoryTaskRepo(), providerAdmin: { manager } });
  void auth;
  return { app, manager, settings, calls, chatMock: chatMock as any, sttMock: sttMock as any };
}
const admin = bearer("admin-1");
const put = (app: any, body: object, who = admin) => request(app).put("/api/admin/providers").set(who).send(body);
const swapToGroq = { transcription: "groq", transcription_model: "stt-model", extraction: "groq", extraction_model: "llm-model" };

describe("who can see provider settings", () => {
  it("/api/me reports admin status", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/me").set(admin)).body).toEqual({ user_id: "admin-1", is_admin: true });
    expect((await request(app).get("/api/me").set(bearer("admin-2"))).body.is_admin).toBe(true);
    expect((await request(app).get("/api/me").set(bearer("someone"))).body.is_admin).toBe(false);
    expect((await request(app).get("/api/me")).status).toBe(401);
  });
  it("blocks everyone else on every settings route", async () => {
    const { app } = setup(); const user = bearer("someone");
    for (const r of [request(app).get("/api/admin/providers").set(user), put(app, swapToGroq, user), request(app).delete("/api/admin/providers").set(user), request(app).post("/api/admin/providers/test").set(user).send({ step: "extraction" })]) {
      const res = await r; expect(res.status).toBe(403); expect(res.body.error.code).toBe("forbidden");
    }
    expect((await request(app).get("/api/admin/providers")).status).toBe(401);
  });
  it("the local dev user is an admin only in local auth mode", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect((await request(setup().app).get("/api/me").set(bearer(id))).body.is_admin).toBe(false);
    expect((await request(setup({ env: { AUTH_MODE: "local" } }).app).get("/api/me").set(bearer(id))).body.is_admin).toBe(true);
  });
  it("the routes do not exist when the manager is not configured", async () => {
    const { MemoryTaskRepo: R } = await import("../src/services/task-repo");
    const app = createApp({ config: loadConfig(cfgEnv), auth: { authenticate: async (t) => t ?? "x" }, transcriber: { transcribe: async () => "x" }, extractor: { extract: async () => ({ task: good as never, warnings: [] }) }, repo: new R() });
    expect((await request(app).get("/api/admin/providers").set(admin)).status).toBe(404);
    expect((await request(app).get("/api/me").set(admin)).body.is_admin).toBe(false);
  });
});

describe("status screen data", () => {
  it("shows key presence for every provider and never a key", async () => {
    const { app } = setup();
    const r = await request(app).get("/api/admin/providers").set(admin);
    const byId = Object.fromEntries(r.body.providers.map((p: any) => [p.id, p]));
    expect(byId.groq).toMatchObject({ key_set: true, key_env: "GROQ_API_KEY", capabilities: ["transcription", "extraction"] });
    expect(byId.gemini).toMatchObject({ key_set: false, key_env: "GEMINI_API_KEY" });
    expect(r.body.active.extraction.id).toBe("anthropic"); expect(r.body.source).toBe("server");
    for (const s of SECRETS) expect(JSON.stringify(r.body)).not.toContain(s);
  });
});

describe("changing providers while the server runs", () => {
  it("applies the choice, saves it, and the next voice note uses the new provider, key and address", async () => {
    const { app, calls, settings, chatMock, sttMock } = setup();
    const r = await put(app, swapToGroq);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ source: "saved", active: { transcription: { id: "groq", model: "stt-model" }, extraction: { id: "groq", model: "llm-model" } } });
    expect(settings.value).toMatchObject({ transcription: "groq", extraction: "groq", extractionModel: "llm-model" });
    const v = await request(app).post("/api/voice-sync").set(bearer("u1")).attach("audio", WEBM, "a.webm");
    expect(v.status).toBe(200);
    expect(v.body.processed_by).toEqual({ transcription: { id: "groq", label: "Groq" }, extraction: { id: "groq", label: "Groq" } });
    const groq = calls.filter((c) => c.key === SECRETS[2]);
    expect(groq.map((c) => c.base)).toEqual([PROVIDERS.groq.baseURL, PROVIDERS.groq.baseURL]);
    expect(chatMock.chat.completions.create.mock.calls[0][0].model).toBe("llm-model");
    expect(sttMock.audio.transcriptions.create.mock.calls[0][0].model).toBe("stt-model");
    expect((await request(app).get("/api/health")).body.providers.extraction.id).toBe("groq");
  });
  it("refuses a choice whose key is missing and keeps what was working", async () => {
    const { app, manager, settings } = setup();
    const r = await put(app, { transcription: "openai", extraction: "gemini", extraction_model: "m" });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe("invalid_provider_selection");
    expect(r.body.error.details).toEqual(["GEMINI_API_KEY is required because EXTRACTION_PROVIDER is gemini"]);
    expect(manager.summary.extraction.id).toBe("anthropic"); expect(settings.value).toBeNull();
  });
  it("refuses unsupported operations, missing models and malformed bodies", async () => {
    const { app } = setup();
    expect((await put(app, { transcription: "gemini", extraction: "groq", extraction_model: "m" })).body.error.details.join(" ")).toMatch(/cannot transcribe audio here/);
    expect((await put(app, { transcription: "openai", extraction: "groq" })).body.error.details.join(" ")).toMatch(/EXTRACTION_MODEL is required/);
    expect((await put(app, { transcription: "groq", extraction: "openai", extraction_model: "m" })).body.error.details.join(" ")).toMatch(/TRANSCRIPTION_MODEL is required/);
    expect((await put(app, { transcription: "nope", extraction: "groq" })).status).toBe(400);
    expect((await put(app, { transcription: "openai", extraction: "groq", extraction_model: "m", api_key: "sk-x" })).status).toBe(400);   // keys are never accepted from the browser
  });
  it("a failed save changes nothing", async () => {
    const settings = new MemorySettingsRepo(); settings.failNext = true;
    const { app, manager } = setup({ settings });
    const r = await put(app, swapToGroq);
    expect(r.status).toBe(503); expect(manager.summary.extraction.id).toBe("anthropic"); expect(manager.source).toBe("server");
  });
  it("reset goes back to the server settings and clears the saved choice", async () => {
    const { app, settings } = setup();
    await put(app, swapToGroq);
    const r = await request(app).delete("/api/admin/providers").set(admin);
    expect(r.body).toMatchObject({ source: "server", active: { extraction: { id: "anthropic" }, transcription: { id: "openai" } } });
    expect(settings.value).toBeNull();
  });
  it("a note already in flight finishes with the provider it started on", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const slow = { audio: { transcriptions: { create: vi.fn(async () => { await gate; return { text: "old provider text" }; }) } }, models: { retrieve: vi.fn() } };
    const { app } = setup({ stt: slow });
    const inflight = request(app).post("/api/voice-sync").set(bearer("u1")).attach("audio", WEBM, "a.webm").then((r) => r);
    await new Promise((r) => setTimeout(r, 150));
    // switch extraction mid flight (same speech provider, so the pending call keeps its transcriber)
    await put(app, { transcription: "openai", extraction: "groq", extraction_model: "llm-model" });
    release();
    const res = await inflight;
    expect(res.status).toBe(200); expect(res.body.transcript).toBe("old provider text");
  });
});

describe("saved settings at startup", () => {
  it("applies a saved choice that still works", async () => {
    const settings = new MemorySettingsRepo(); settings.value = { transcription: "groq", transcriptionModel: "s", extraction: "groq", extractionModel: "l" };
    const { manager } = setup({ settings }); await manager.init();
    expect(manager.source).toBe("saved"); expect(manager.summary.extraction.id).toBe("groq");
  });
  it("ignores a saved choice whose key was removed, and says why", async () => {
    const settings = new MemorySettingsRepo(); settings.value = { transcription: "openai", extraction: "gemini", extractionModel: "m" };
    const { manager, app } = setup({ settings }); await manager.init();
    expect(manager.source).toBe("server"); expect(manager.summary.extraction.id).toBe("anthropic");
    expect((await request(app).get("/api/admin/providers").set(admin)).body.notice).toMatch(/GEMINI_API_KEY/);
  });
});

describe("connection tests", () => {
  const post = (app: any, body: object) => request(app).post("/api/admin/providers/test").set(admin).send(body);
  it("extraction test runs a real tiny extraction through the chosen provider and reports success", async () => {
    const { app, chatMock } = setup();
    const r = await post(app, { step: "extraction", provider: "groq", model: "llm-model" });
    expect(r.body).toMatchObject({ ok: true, step: "extraction", provider: "groq", label: "Groq" });
    expect(chatMock.chat.completions.create.mock.calls[0][0].model).toBe("llm-model");
  });
  it("reports a model that answers badly as a failed test with a plain message", async () => {
    const chat = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "Sure, here you go!" }, finish_reason: "stop" }] }) } } };
    const r = await post(setup({ chat }).app, { step: "extraction", provider: "groq", model: "m" });
    expect(r.body).toMatchObject({ ok: false, code: "extraction_invalid_json" });
  });
  it.each([[401, "extraction_misconfigured"], [404, "extraction_model_not_found"], [402, "extraction_billing"], [429, "upstream_rate_limited"]])("maps a %s from the provider to %s without leaking", async (status, code) => {
    const chat = { chat: { completions: { create: vi.fn().mockRejectedValue(Object.assign(new Error("raw upstream sk-leak"), { status })) } } };
    const r = await post(setup({ chat }).app, { step: "extraction", provider: "groq", model: "m" });
    expect(r.body).toMatchObject({ ok: false, code }); expect(JSON.stringify(r.body)).not.toMatch(/sk-leak|raw upstream/);
  });
  it("transcription test checks the key and model without sending audio", async () => {
    const { app, sttMock } = setup();
    const r = await post(app, { step: "transcription", provider: "groq", model: "stt-model" });
    expect(r.body).toMatchObject({ ok: true, provider: "groq" }); expect(r.body.message).toMatch(/No audio was sent/);
    expect(sttMock.models.retrieve).toHaveBeenCalledWith("stt-model", expect.anything());
    expect(sttMock.audio.transcriptions.create).not.toHaveBeenCalled();
  });
  it("transcription test explains a wrong model ID", async () => {
    const stt = { audio: { transcriptions: { create: vi.fn() } }, models: { retrieve: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 404 })) } };
    const r = await post(setup({ stt }).app, { step: "transcription", provider: "groq", model: "typo-model" });
    expect(r.body).toMatchObject({ ok: false, code: "transcription_model_not_found" }); expect(r.body.message).toMatch(/model ID/);
  });
  it("explains missing keys and unsupported providers instead of calling anything", async () => {
    const { app, chatMock } = setup();
    const a = await post(app, { step: "extraction", provider: "gemini", model: "m" });
    expect(a.body).toMatchObject({ ok: false, code: "invalid_provider_selection" }); expect(a.body.message).toMatch(/GEMINI_API_KEY/);
    expect((await post(app, { step: "transcription", provider: "gemini", model: "m" })).body.message).toMatch(/cannot transcribe audio here/);
    expect(chatMock.chat.completions.create).not.toHaveBeenCalled();
  });
  it("testing a candidate never changes what is active", async () => {
    const { app, manager } = setup();
    await post(app, { step: "extraction", provider: "groq", model: "m" });
    expect(manager.summary.extraction.id).toBe("anthropic"); expect(manager.source).toBe("server");
  });
  it("tests the active provider when no candidate is given, and rejects bad bodies", async () => {
    const { app } = setup(); await put(app, swapToGroq);
    expect((await post(app, { step: "extraction" })).body).toMatchObject({ ok: true, provider: "groq" });
    expect((await post(app, { step: "other" })).status).toBe(400);
    expect((await post(app, { step: "extraction", key: "sk-x" })).status).toBe(400);
  });
});

describe("browser access (CORS)", () => {
  it("allows every method the web app uses from the configured origin, and nothing from other origins", async () => {
    const { app } = setup();
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const r = await request(app).options("/api/admin/providers").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", method).set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key,x-progress");
      expect(r.headers["access-control-allow-origin"], method).toBe("http://localhost:3000");
      expect(r.headers["access-control-allow-methods"], method).toContain(method);
    }
    const other = await request(app).options("/api/admin/providers").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "PUT");
    expect(other.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });
});
