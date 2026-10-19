import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeApp, bearer } from "./helpers";
import { loadConfig } from "../src/config";
import { env } from "./helpers";

const base = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" };

describe("tasks API", () => {
  it("creates, lists, reads, updates status, deletes", async () => {
    const { app } = makeApp();
    const c = await request(app).post("/api/tasks").set(bearer()).send({ ...base, transcript: "t" });
    expect(c.status).toBe(201);
    expect(c.body.task).toMatchObject({ status: "todo", client_name: "Daniel", follow_up_date: "2026-10-16" });
    const id = c.body.task.id;
    expect((await request(app).get("/api/tasks").set(bearer())).body.total).toBe(1);
    expect((await request(app).get(`/api/tasks/${id}`).set(bearer())).status).toBe(200);
    const p = await request(app).patch(`/api/tasks/${id}`).set(bearer()).send({ status: "in_progress", priority: "high" });
    expect(p.body.task).toMatchObject({ status: "in_progress", priority: "high" });
    expect((await request(app).delete(`/api/tasks/${id}`).set(bearer())).status).toBe(204);
    expect((await request(app).delete(`/api/tasks/${id}`).set(bearer())).status).toBe(404);
  });
  it("re-validates on the server", async () => {
    const { app } = makeApp();
    for (const bad of [{ ...base, client_name: "" }, { ...base, action_item: "  " }, { ...base, priority: "urgent" }, { ...base, follow_up_date: "16/10/2026" }, { ...base, extra: 1 }]) {
      const r = await request(app).post("/api/tasks").set(bearer()).send(bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("validation_error");
    }
  });
  it("is idempotent for a repeated Idempotency-Key", async () => {
    const { app, repo } = makeApp();
    const a = await request(app).post("/api/tasks").set(bearer()).set("Idempotency-Key", "k1").send(base);
    const b = await request(app).post("/api/tasks").set(bearer()).set("Idempotency-Key", "k1").send(base);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.task.id).toBe(a.body.task.id);
    expect(repo.rows).toHaveLength(1);
  });
  it("enforces ownership on every operation", async () => {
    const { app } = makeApp();
    const id = (await request(app).post("/api/tasks").set(bearer("user-a")).send(base)).body.task.id;
    expect((await request(app).get("/api/tasks").set(bearer("user-b"))).body.total).toBe(0);
    expect((await request(app).get(`/api/tasks/${id}`).set(bearer("user-b"))).status).toBe(404);
    expect((await request(app).patch(`/api/tasks/${id}`).set(bearer("user-b")).send({ status: "completed" })).status).toBe(404);
    expect((await request(app).delete(`/api/tasks/${id}`).set(bearer("user-b"))).status).toBe(404);
    expect((await request(app).get(`/api/tasks/${id}`).set(bearer("user-a"))).body.task.status).toBe("todo");
  });
  it("requires auth", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/tasks")).status).toBe(401);
  });
  it("supports search, filters, sorting and pagination", async () => {
    const { app } = makeApp();
    const mk = (o: object) => request(app).post("/api/tasks").set(bearer()).send({ ...base, ...o });
    await mk({ client_name: "Ama", priority: "high", follow_up_date: "2026-10-20" });
    await mk({ client_name: "Kofi", priority: "low", follow_up_date: "2026-10-15" });
    await mk({ client_name: "Esi", priority: "medium", follow_up_date: "" });
    const q = async (s: string) => (await request(app).get(`/api/tasks?${s}`).set(bearer())).body;
    expect((await q("search=kofi")).total).toBe(1);
    expect((await q("priority=high")).items[0].client_name).toBe("Ama");
    expect((await q("sort=priority&order=desc")).items.map((t: any) => t.priority)).toEqual(["high", "medium", "low"]);
    expect((await q("sort=follow_up_date&order=asc")).items.map((t: any) => t.client_name)).toEqual(["Kofi", "Ama", "Esi"]);
    const pg = await q("page=2&page_size=2");
    expect(pg.items).toHaveLength(1);
    expect(pg.total).toBe(3);
    expect((await request(app).get("/api/tasks?page_size=1000").set(bearer())).status).toBe(400);
  });
  it("computes dashboard stats from stored records", async () => {
    const { app } = makeApp();
    const mk = (o: object) => request(app).post("/api/tasks").set(bearer()).send({ ...base, ...o });
    const today = (await request(app).get("/api/tasks/stats?timezone=UTC").set(bearer())).body.today as string;
    await mk({ follow_up_date: "2020-01-01", priority: "high" });
    await mk({ follow_up_date: today });
    const done = (await mk({ follow_up_date: "2020-01-01" })).body.task.id;
    await request(app).patch(`/api/tasks/${done}`).set(bearer()).send({ status: "completed" });
    const s = (await request(app).get("/api/tasks/stats?timezone=UTC").set(bearer())).body;
    expect(s).toMatchObject({ open: 2, overdue: 1, high_priority: 1, due_today: 1 });
  });
  it("rejects invalid patches and bad JSON", async () => {
    const { app } = makeApp();
    const id = (await request(app).post("/api/tasks").set(bearer()).send(base)).body.task.id;
    expect((await request(app).patch(`/api/tasks/${id}`).set(bearer()).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/tasks/${id}`).set(bearer()).send({ status: "done" })).status).toBe(400);
    const r = await request(app).post("/api/tasks").set(bearer()).set("Content-Type", "application/json").send("{bad");
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_json");
  });
  it("clears a follow-up date with an empty string", async () => {
    const { app } = makeApp();
    const id = (await request(app).post("/api/tasks").set(bearer()).send(base)).body.task.id;
    const r = await request(app).patch(`/api/tasks/${id}`).set(bearer()).send({ follow_up_date: "" });
    expect(r.body.task.follow_up_date).toBeNull();
  });
  it("only stores transcripts when enabled", async () => {
    const { app, repo } = makeApp({ env: { STORE_TRANSCRIPTS: "false" } });
    await request(app).post("/api/tasks").set(bearer()).send({ ...base, transcript: "private" });
    expect(repo.rows[0]!.transcript).toBeNull();
  });
});

describe("health and config", () => {
  it("health exposes no secrets", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/key|secret|sk-/i);
  });
  it("fails fast with a clear message on missing credentials", () => {
    expect(() => loadConfig({ ...env, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ ...env, ANTHROPIC_MODEL: "" })).toThrow(/ANTHROPIC_MODEL/);
  });
  it("refuses local auth in production", () => {
    expect(() => loadConfig({ ...env, NODE_ENV: "production", AUTH_MODE: "local" })).toThrow(/production/);
  });
  it("unknown routes return JSON 404", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });
});
