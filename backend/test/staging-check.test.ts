import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error plain JavaScript script
import { runChecks, signIn } from "../../scripts/staging-check.mjs";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { MemorySettingsRepo } from "../src/services/settings-repo";
import { ProviderManager } from "../src/providers/manager";
import { unauthorized } from "../src/lib/errors";
import { env, WEBM } from "./helpers";

const good = { client_name: "Daniel", location: "Osu", action_item: "Call", follow_up_date: "2026-10-16", priority: "medium" };
const serve = async (app: http.RequestListener) => { const s = http.createServer(app); await new Promise<void>((r) => s.listen(0, r)); return { url: `http://localhost:${(s.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => s.close(() => r())) }; };
function realApp(over: { repo?: MemoryTaskRepo } = {}) {
  const config = loadConfig({ ...env, ADMIN_USER_IDS: "admin-a" } as NodeJS.ProcessEnv);
  const manager = new ProviderManager(config, new MemorySettingsRepo(), {}, ((_c: unknown, s: any) => ({ transcriber: { transcribe: async () => "call daniel", check: async () => {} }, extractor: { extract: async () => ({ task: good as never, warnings: [] }) }, summary: { transcription: { id: s.transcription, label: "OpenAI" }, extraction: { id: s.extraction, label: "Anthropic" } } })) as never);
  return createApp({ config, auth: { authenticate: async (t) => { if (!t || !["admin-a", "person-b", "admin-a-SECRETTOKEN", "b-SECRETTOKEN"].includes(t)) throw unauthorized(); return t; } }, transcriber: manager, extractor: manager, repo: over.repo ?? new MemoryTaskRepo(), providerAdmin: { manager } });
}
const by = (rs: any[], part: string) => rs.find((r) => r.name.includes(part));

describe("staging checklist script", () => {
  it("passes against a correct deployment, and tells you what each step found", async () => {
    const s = await serve(realApp());
    try {
      const rs = await runChecks({ api: s.url, tokenA: "admin-a", tokenB: "person-b", testProviders: true, audio: "note.webm", audioBytes: WEBM });
      expect(rs.filter((r: any) => r.status === "FAIL"), JSON.stringify(rs.filter((r: any) => r.status === "FAIL"))).toEqual([]);
      for (const part of ["liveness", "ready", "Two different", "cannot see or touch", "Normal people", "Admin: provider settings", "Test connection", "Real voice note", "clean up"]) expect(by(rs, part) ?? by(rs, part.toLowerCase()) ?? by(rs, "Clean up"), part).toMatchObject({ status: expect.stringMatching(/PASS|SKIP/) });
      expect(by(rs, "Real voice note")).toMatchObject({ status: "PASS" }); expect(by(rs, "Real voice note").note).toMatch(/by OpenAI then Anthropic/);
      expect(by(rs, "Test connection").status).toBe("PASS"); expect(by(rs, "Person B").status).toBe("PASS");
      expect(by(rs, "Web app").status).toBe("SKIP");   // no --web given
    } finally { await s.close(); }
  });
  it("skips the expensive steps unless asked", async () => {
    const s = await serve(realApp());
    try { const rs = await runChecks({ api: s.url, tokenA: "admin-a", tokenB: "person-b" }); expect(by(rs, "Test connection").status).toBe("SKIP"); expect(by(rs, "Real voice note").status).toBe("SKIP"); } finally { await s.close(); }
  });
  it("catches a deployment where one person can see another's tasks", async () => {
    const leaky = new MemoryTaskRepo(); const real = leaky.list.bind(leaky);
    leaky.list = (_u: string, q: any) => real("shared", q) as never;                       // a bug: everyone is treated as the same user
    leaky.create = (async (_u: string, i: any, k?: string) => MemoryTaskRepo.prototype.create.call(leaky, "shared", i, k)) as never;
    const s = await serve(realApp({ repo: leaky }));
    try { const rs = await runChecks({ api: s.url, tokenA: "admin-a", tokenB: "person-b" }); expect(by(rs, "Person B").status).toBe("FAIL"); expect(by(rs, "Person B").note).toMatch(/can see/); } finally { await s.close(); }
  });
  it("catches an API that answers without a sign in", async () => {
    const open = (req: http.IncomingMessage, res: http.ServerResponse) => { res.setHeader("Content-Type", "application/json"); res.end(req.url?.includes("/live") ? '{"status":"ok"}' : "[]"); };
    const s = await serve(open);
    try { const rs = await runChecks({ api: s.url }); expect(by(rs, "without a sign in").status).toBe("FAIL"); expect(by(rs, "headers").status).toBe("FAIL"); } finally { await s.close(); }
  });
  it("catches a key leaking into the readiness output", async () => {
    const leak = (_q: http.IncomingMessage, res: http.ServerResponse) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ status: "ok", services: { database: "ok" }, oops: "sk-" + "Ab1".repeat(10) })); };
    const s = await serve(leak);
    try { expect(by(await runChecks({ api: s.url }), "ready").note).toMatch(/contains a key/); } finally { await s.close(); }
  });
  it("never prints tokens or passwords", async () => {
    const lines: string[] = []; const s = await serve(realApp());
    try { await runChecks({ api: s.url, tokenA: "admin-a-SECRETTOKEN", tokenB: "b-SECRETTOKEN", log: (r: any) => lines.push(JSON.stringify(r)) }); } finally { await s.close(); }
    expect(lines.join("\n")).not.toMatch(/SECRETTOKEN/);
  });
});

describe("sign in helper", () => {
  const reply = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it("returns the access token and sends the anon key", async () => {
    const f = reply(200, { access_token: "tok123" }); expect(await signIn("https://x.supabase.co/", "anon", "a@b.c", "pw", f)).toBe("tok123");
    expect(f.mock.calls[0]![0]).toBe("https://x.supabase.co/auth/v1/token?grant_type=password"); expect((f.mock.calls[0]![1] as any).headers.apikey).toBe("anon");
  });
  it("explains a failed sign in without repeating the password", async () => {
    await expect(signIn("https://x.supabase.co", "anon", "a@b.c", "hunter2", reply(400, { error_description: "Email not confirmed" }))).rejects.toThrow(/sign in failed for a@b\.c: Email not confirmed/);
    const e = await signIn("https://x.supabase.co", "anon", "a@b.c", "hunter2", reply(400, {})).catch((x: Error) => x); expect(e.message).not.toContain("hunter2");
  });
  it("explains an unreachable Supabase", async () => { await expect(signIn("https://x", "k", "a@b.c", "p", vi.fn(async () => { throw new Error("ENOTFOUND"); }))).rejects.toThrow(/could not reach Supabase/); });
});
