import { describe, it, expect } from "vitest";
import { SupabaseTaskRepo } from "../src/services/task-repo";

/** Minimal chainable stand-in for the Supabase query builder: records calls, resolves with a canned result. */
function fakeDb(result: { data?: any; error?: any; count?: number }, calls: any[]) {
  const builder: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") return (res: any) => res({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null });
      return (...args: any[]) => { calls.push([prop, ...args]); return builder; };
    },
  });
  return { from: (t: string) => { calls.push(["from", t]); return builder; } } as any;
}
const input = { client_name: "Daniel", location: "", action_item: "Call", follow_up_date: "", priority: "high" as const, transcript: "t" };

describe("SupabaseTaskRepo (stubbed client)", () => {
  it("scopes every read by user_id", async () => {
    const calls: any[] = [];
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ data: [], count: 0 }, calls));
    await repo.list("u1", { sort: "created_at", order: "desc", page: 1, page_size: 50 });
    expect(calls).toContainEqual(["eq", "user_id", "u1"]);
    expect(calls).toContainEqual(["range", 0, 49]);
  });
  it("sorts by the generated priority_rank column", async () => {
    const calls: any[] = [];
    await new SupabaseTaskRepo("http://x", "k", fakeDb({ data: [], count: 0 }, calls)).list("u", { sort: "priority", order: "desc", page: 1, page_size: 10 });
    expect(calls.find((c) => c[0] === "order")?.[1]).toBe("priority_rank");
  });
  it("sanitizes search input used in the PostgREST or() filter", async () => {
    const calls: any[] = [];
    await new SupabaseTaskRepo("http://x", "k", fakeDb({ data: [], count: 0 }, calls)).list("u", { search: "a,b)%(c", sort: "created_at", order: "asc", page: 1, page_size: 10 });
    const or = calls.find((c) => c[0] === "or")?.[1] as string;
    expect(or).toContain("client_name.ilike.%a b c%");
    expect(or).not.toMatch(/\),|%\(/);
  });
  it("inserts with user_id, null date for blank, idempotency key, and no client-supplied id", async () => {
    const calls: any[] = [];
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ data: { id: "1", client_name: "Daniel" } }, calls));
    const r = await repo.create("u1", input, undefined);
    const row = calls.find((c) => c[0] === "insert")?.[1];
    expect(row).toMatchObject({ user_id: "u1", follow_up_date: null, priority: "high", status: "todo", idempotency_key: null });
    expect(row.id).toBeUndefined();
    expect(r.created).toBe(true);
  });
  it("returns the existing row when an idempotency key repeats", async () => {
    const calls: any[] = [];
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ data: { id: "existing" } }, calls));
    const r = await repo.create("u1", input, "key-1");
    expect(r).toMatchObject({ created: false, task: { id: "existing" } });
    expect(calls.some((c) => c[0] === "insert")).toBe(false);
  });
  it("scopes update and delete by user_id and converts '' date to null", async () => {
    const calls: any[] = [];
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ data: { id: "1" } }, calls));
    await repo.update("u1", "1", { follow_up_date: "" });
    expect(calls.find((c) => c[0] === "update")?.[1]).toEqual({ follow_up_date: null });
    expect(calls).toContainEqual(["eq", "user_id", "u1"]);
    const c2: any[] = [];
    await new SupabaseTaskRepo("http://x", "k", fakeDb({ data: [{ id: "1" }] }, c2)).remove("u1", "1");
    expect(c2).toContainEqual(["eq", "user_id", "u1"]);
  });
  it("maps database failures to a safe 503 without leaking the message", async () => {
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ error: { message: "connection refused to 10.0.0.5", code: "08006" } }, []));
    await expect(repo.list("u", { sort: "created_at", order: "desc", page: 1, page_size: 10 })).rejects.toMatchObject({ status: 503, code: "database_error", message: "The database is not responding right now. Please try again shortly." });
    await expect(repo.ping()).rejects.toMatchObject({ status: 503 });
  });
  it("update/remove report 'not found' as null/false", async () => {
    const repo = new SupabaseTaskRepo("http://x", "k", fakeDb({ data: null }, []));
    expect(await repo.update("u", "nope", { status: "completed" })).toBeNull();
    expect(await new SupabaseTaskRepo("http://x", "k", fakeDb({ data: [] }, [])).remove("u", "nope")).toBe(false);
  });
});
