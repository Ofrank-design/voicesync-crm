import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { MemoryUsageRepo } from "../src/services/usage-repo";
import { makeLogger } from "../src/lib/logger";
import { unauthorized } from "../src/lib/errors";
import { env, bearer } from "./helpers";

const task = (name: string) => ({ client_name: name, location: "Osu", action_item: "Call", follow_up_date: "2026-10-16", priority: "medium", transcript: `private words from ${name}` });
function setup(accounts?: { deleteUser: (id: string) => Promise<void> }) {
  const repo = new MemoryTaskRepo(), usage = new MemoryUsageRepo(), lines: string[] = [];
  const app = createApp({ config: loadConfig({ ...env, STORE_TRANSCRIPTS: "true" }), auth: { authenticate: async (t) => { if (!t) throw unauthorized(); return t; } }, transcriber: { transcribe: async () => "x" }, extractor: { extract: async () => ({ task: task("x") as never, warnings: [] }) }, repo, usage, accounts, logger: makeLogger("debug", (l) => lines.push(l)) });
  const add = (who: string, name: string) => request(app).post("/api/tasks").set(bearer(who)).send(task(name));
  const ev = (u: string) => usage.record({ user_id: u, at: new Date().toISOString(), step: "extraction", provider: "openai", ok: true, fallback: false, duration_ms: 5 });
  return { app, repo, usage, lines, add, ev };
}

describe("download my data", () => {
  it("returns everything the person owns, and only theirs, as a file", async () => {
    const s = setup(); await s.add("u1", "Ama"); await s.add("u1", "Kofi"); await s.add("u2", "Esi"); await s.ev("u1"); await s.ev("u2");
    const r = await request(s.app).get("/api/me/export").set(bearer("u1"));
    expect(r.status).toBe(200); expect(r.headers["content-disposition"]).toBe('attachment; filename="voicesync-my-data.json"'); expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body.user_id).toBe("u1"); expect(r.body.tasks.map((t: any) => t.client_name)).toEqual(["Ama", "Kofi"]); expect(r.body.usage).toHaveLength(1); expect(r.body.exported_at).toMatch(/T/);
    expect(JSON.stringify(r.body)).not.toMatch(/Esi|u2/);
  });
  it("needs a signed in person and works with nothing stored", async () => {
    const s = setup(); expect((await request(s.app).get("/api/me/export")).status).toBe(401);
    expect((await request(s.app).get("/api/me/export").set(bearer("nobody"))).body).toMatchObject({ tasks: [], usage: [] });
  });
});

describe("delete my account and data", () => {
  it("asks for the word DELETE and does nothing without it", async () => {
    const s = setup(); await s.add("u1", "Ama");
    for (const body of [{}, { confirm: "delete" }, { confirm: true }]) { const r = await request(s.app).delete("/api/me").set(bearer("u1")).send(body); expect(r.status).toBe(400); expect(r.body.error.code).toBe("confirmation_required"); }
    expect(s.repo.rows).toHaveLength(1);
  });
  it("removes their tasks, usage records and login, and leaves everyone else alone", async () => {
    const deleteUser = vi.fn(async () => {}); const s = setup({ deleteUser });
    await s.add("u1", "Ama"); await s.add("u1", "Kofi"); await s.add("u2", "Esi"); await s.ev("u1"); await s.ev("u2");
    const r = await request(s.app).delete("/api/me").set(bearer("u1")).send({ confirm: "DELETE" });
    expect(r.body).toEqual({ deleted: { tasks: 2, usage: 1, account: true } });
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(s.repo.rows.map((t) => t.client_name)).toEqual(["Esi"]); expect(s.usage.events.map((e) => e.user_id)).toEqual(["u2"]);
    expect((await request(s.app).get("/api/me/export").set(bearer("u1"))).body.tasks).toEqual([]);
  });
  it("works without an account system (local mode) and says the login was not touched", async () => {
    const s = setup(); await s.add("u1", "Ama");
    expect((await request(s.app).delete("/api/me").set(bearer("u1")).send({ confirm: "DELETE" })).body.deleted).toEqual({ tasks: 1, usage: 0, account: false });
  });
  it("is honest if the login could not be removed after the data was", async () => {
    const s = setup({ deleteUser: async () => { throw new Error("boom"); } }); await s.add("u1", "Ama");
    const r = await request(s.app).delete("/api/me").set(bearer("u1")).send({ confirm: "DELETE" });
    expect(r.status).toBe(502); expect(r.body.error.code).toBe("account_not_removed"); expect(r.body.error.message).toMatch(/tasks and usage records were deleted/); expect(s.repo.rows).toHaveLength(0);
  });
  it("is logged as an audit entry with counts only, never the content", async () => {
    const s = setup({ deleteUser: async () => {} }); await s.add("u1", "Ama");
    await request(s.app).delete("/api/me").set(bearer("u1")).send({ confirm: "DELETE" });
    const e = s.lines.map((l) => JSON.parse(l)).find((l) => l.msg === "account.deleted");
    expect(e).toMatchObject({ audit: true, by: "u1", tasks: 1, account: true }); expect(s.lines.join()).not.toMatch(/private words/);
  });
  it("needs a signed in person", async () => { expect((await request(setup().app).delete("/api/me").send({ confirm: "DELETE" })).status).toBe(401); });
});
