import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { A, B, MIGRATIONS, as, freshDb, insertTask, migrationFiles, task } from "./helpers";

let db: PGlite;
beforeAll(async () => { db = await freshDb(); }, 120_000);

describe("migrations on a real Postgres", () => {
  it("apply cleanly in order and can be run again without errors", async () => {
    for (const f of migrationFiles()) await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    expect(migrationFiles()).toEqual(["0001_crm_tasks.sql", "0002_app_settings.sql", "0003_usage_events.sql"]);
  });
  it("create the expected tables and indexes", async () => {
    const t = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public'")).rows.map((r) => r.tablename).sort();
    expect(t).toEqual(["app_settings", "crm_tasks", "usage_events"]);
    const idx = (await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public'")).rows.map((r) => r.indexname);
    for (const i of ["crm_tasks_user_idx", "crm_tasks_user_status", "crm_tasks_user_priority", "crm_tasks_user_followup", "crm_tasks_idem", "usage_events_at_idx", "usage_events_user_at_idx"]) expect(idx).toContain(i);
  });
  it("every table has row level security switched on (static guard for future migrations)", async () => {
    const sql = migrationFiles().map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8")).join("\n");
    const created = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]!);
    expect(created.length).toBeGreaterThan(0);
    for (const t of created) expect(sql, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, "i"));
    const rls = (await db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'")).rows;
    for (const r of rls) expect(r.relrowsecurity, r.relname).toBe(true);
  });
  it("never grant access to the anonymous role by policy", async () => {
    const pol = (await db.query<{ tablename: string; roles: string[] }>("select tablename, roles from pg_policies where schemaname='public'")).rows;
    for (const p of pol) expect(p.roles.map(String).join(","), p.tablename).not.toMatch(/anon/);
    expect(pol.every((p) => p.tablename === "crm_tasks")).toBe(true);   // app_settings and usage_events have no browser policies at all
  });
});

describe("crm_tasks row level security", () => {
  it("lets a user create and read only their own tasks", async () => {
    await insertTask(db, { user: A }, task(A, { client_name: "A task" }));
    await insertTask(db, { user: B }, task(B, { client_name: "B task" }));
    expect((await as(db, { user: A }, "select client_name from public.crm_tasks")).map((r) => r.client_name)).toEqual(["A task"]);
    expect((await as(db, { user: B }, "select client_name from public.crm_tasks")).map((r) => r.client_name)).toEqual(["B task"]);
  });
  it("refuses to create a task for someone else", async () => {
    await expect(insertTask(db, { user: A }, task(B))).rejects.toThrow(/row-level security/);
  });
  it("cannot read, change or delete another user's task, even by id", async () => {
    const [b] = await as(db, "service_role", "select id from public.crm_tasks where user_id=$1", [B]);
    expect(await as(db, { user: A }, "select * from public.crm_tasks where id=$1", [b.id])).toHaveLength(0);
    expect(await as(db, { user: A }, "update public.crm_tasks set client_name='hacked' where id=$1 returning id", [b.id])).toHaveLength(0);
    expect(await as(db, { user: A }, "delete from public.crm_tasks where id=$1 returning id", [b.id])).toHaveLength(0);
    expect((await as(db, "service_role", "select client_name from public.crm_tasks where id=$1", [b.id]))[0]!.client_name).toBe("B task");
  });
  it("cannot move a task to another user by editing user_id", async () => {
    await expect(as(db, { user: A }, "update public.crm_tasks set user_id=$1 where user_id=$2", [B, A])).rejects.toThrow(/row-level security/);
  });
  it("can update and delete its own tasks", async () => {
    const [r] = await insertTask(db, { user: A }, task(A, { client_name: "temp" }));
    expect((await as(db, { user: A }, "update public.crm_tasks set status='completed' where id=$1 returning status", [r.id]))[0]!.status).toBe("completed");
    expect(await as(db, { user: A }, "delete from public.crm_tasks where id=$1 returning id", [r.id])).toHaveLength(1);
  });
  it("shows nothing to a signed in request with no user, and nothing to anonymous visitors", async () => {
    expect(await as(db, "anon", "select * from public.crm_tasks")).toHaveLength(0);
    await expect(insertTask(db, "anon", task(A))).rejects.toThrow(/row-level security/);
    expect(await as(db, { user: "00000000-0000-4000-8000-000000000000" }, "select * from public.crm_tasks")).toHaveLength(0);
  });
  it("the service role (used by the API) sees everything and the API must filter by user itself", async () => {
    expect((await as(db, "service_role", "select count(*)::int as n from public.crm_tasks"))[0]!.n).toBeGreaterThanOrEqual(2);
  });
});

describe("crm_tasks data rules", () => {
  const svc = (t: Record<string, unknown>) => insertTask(db, "service_role", t);
  it("fills sensible defaults", async () => {
    const [r] = await svc({ user_id: A, client_name: "D", action_item: "x" });
    expect(r).toMatchObject({ location: "", priority: "medium", status: "todo", follow_up_date: null, transcript: null, idempotency_key: null });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/); expect(new Date(r.created_at).getTime()).toBeGreaterThan(0);
  });
  it("derives a sortable priority rank", async () => {
    const rows = await Promise.all(["low", "medium", "high"].map((p) => svc({ user_id: A, client_name: p, action_item: "x", priority: p })));
    expect(rows.map((r) => r[0].priority_rank)).toEqual([1, 2, 3]);
    await expect(as(db, "service_role", "update public.crm_tasks set priority_rank=9")).rejects.toThrow();   // generated column cannot be written
  });
  it.each([
    [{ priority: "urgent" }, /check constraint/], [{ status: "done" }, /check constraint/], [{ client_name: "" }, /check constraint/],
    [{ action_item: "" }, /check constraint/], [{ client_name: "x".repeat(201) }, /check constraint/], [{ location: "x".repeat(301) }, /check constraint/], [{ follow_up_date: "2026-02-31" }, /out of range|invalid/],
  ])("rejects bad data %j", async (bad, msg) => { await expect(svc({ user_id: A, client_name: "ok", action_item: "ok", ...bad })).rejects.toThrow(msg as RegExp); });
  it("refreshes updated_at on every change", async () => {
    const [r] = await svc({ user_id: A, client_name: "T", action_item: "x" });
    await new Promise((x) => setTimeout(x, 15));
    const [u] = await as(db, "service_role", "update public.crm_tasks set status='in_progress' where id=$1 returning updated_at, created_at", [r.id]);
    expect(new Date(u.updated_at).getTime()).toBeGreaterThan(new Date(r.updated_at).getTime()); expect(u.created_at).toEqual(r.created_at);
  });
  it("enforces one idempotency key per user, but not across users or for empty keys", async () => {
    await svc({ user_id: A, client_name: "i", action_item: "x", idempotency_key: "k1" });
    await expect(svc({ user_id: A, client_name: "i2", action_item: "x", idempotency_key: "k1" })).rejects.toThrow(/duplicate key/);
    await expect(svc({ user_id: B, client_name: "i3", action_item: "x", idempotency_key: "k1" })).resolves.toBeTruthy();
    await svc({ user_id: A, client_name: "n1", action_item: "x" }); await svc({ user_id: A, client_name: "n2", action_item: "x" });
  });
});

describe("tables only the API may touch", () => {
  it.each(["app_settings", "usage_events"])("%s is invisible and read only for browsers, anonymous or signed in", async (t) => {
    const cols = t === "app_settings" ? "(key, value) values ('providers','{}')" : "(user_id, step, provider, ok) values ($1,'extraction','x',true)";
    const params = t === "app_settings" ? [] : [A];
    await as(db, "service_role", `insert into public.${t} ${cols}`, params);
    for (const who of ["anon", { user: A }] as const) {
      expect(await as(db, who, `select * from public.${t}`), t).toHaveLength(0);
      await expect(as(db, who, `insert into public.${t} ${cols}`, params)).rejects.toThrow(/row-level security/);
      expect(await as(db, who, `delete from public.${t} returning 1`)).toHaveLength(0);
    }
    expect((await as(db, "service_role", `select count(*)::int n from public.${t}`))[0]!.n).toBe(1);
  });
  it("app_settings holds one row per key and usage_events checks its values", async () => {
    await expect(as(db, "service_role", "insert into public.app_settings (key, value) values ('providers','{}')")).rejects.toThrow(/duplicate key/);
    await expect(as(db, "service_role", "insert into public.usage_events (user_id, step, provider, ok) values ($1,'other','x',true)", [A])).rejects.toThrow(/check constraint/);
    const [e] = await as(db, "service_role", "insert into public.usage_events (user_id, step, provider, ok) values ($1,'transcription','openai',true) returning fallback, duration_ms, at", [A]);
    expect(e).toMatchObject({ fallback: false, duration_ms: 0 }); expect(e.at).toBeTruthy();
  });
});
