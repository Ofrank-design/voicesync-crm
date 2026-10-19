import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ListQuery, TaskCreate, TaskPatch, TaskRecord } from "../lib/schema";
import { AppError } from "../lib/errors";

export interface Stats { open: number; overdue: number; high_priority: number; due_today: number; recent: TaskRecord[] }
export interface TaskRepo {
  create(userId: string, input: TaskCreate, idempotencyKey?: string): Promise<{ task: TaskRecord; created: boolean }>;
  list(userId: string, q: ListQuery): Promise<{ items: TaskRecord[]; total: number }>;
  get(userId: string, id: string): Promise<TaskRecord | null>;
  update(userId: string, id: string, patch: TaskPatch): Promise<TaskRecord | null>;
  remove(userId: string, id: string): Promise<boolean>;
  stats(userId: string, today: string): Promise<Stats>;
  ping(): Promise<void>;
  /** Everything one person owns, for their data download. */
  exportAll(userId: string): Promise<TaskRecord[]>;
  /** Removes everything one person owns. Returns how many tasks were deleted. */
  deleteAll(userId: string): Promise<number>;
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 } as const;
const now = () => new Date().toISOString();
const toRecord = (userId: string, i: TaskCreate): TaskRecord => ({
  id: randomUUID(), user_id: userId, client_name: i.client_name, location: i.location, action_item: i.action_item,
  follow_up_date: i.follow_up_date || null, priority: i.priority, status: "todo", transcript: i.transcript ?? null,
  created_at: now(), updated_at: now(),
});

function computeStats(all: TaskRecord[], today: string): Stats {
  const open = all.filter((t) => t.status !== "completed");
  return {
    open: open.length,
    overdue: open.filter((t) => t.follow_up_date && t.follow_up_date < today).length,
    high_priority: open.filter((t) => t.priority === "high").length,
    due_today: open.filter((t) => t.follow_up_date === today).length,
    recent: [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5),
  };
}

/** In-memory implementation used by automated tests (no network). */
export class MemoryTaskRepo implements TaskRepo {
  rows: TaskRecord[] = [];
  private keys = new Map<string, string>();
  async create(userId: string, input: TaskCreate, key?: string) {
    if (key) {
      const existing = this.keys.get(`${userId}:${key}`);
      if (existing) return { task: this.rows.find((r) => r.id === existing)!, created: false };
    }
    const rec = toRecord(userId, input);
    this.rows.push(rec);
    if (key) this.keys.set(`${userId}:${key}`, rec.id);
    return { task: rec, created: true };
  }
  async list(userId: string, q: ListQuery) {
    let r = this.rows.filter((t) => t.user_id === userId);
    if (q.status) r = r.filter((t) => t.status === q.status);
    if (q.priority) r = r.filter((t) => t.priority === q.priority);
    if (q.search) { const s = q.search.toLowerCase(); r = r.filter((t) => `${t.client_name} ${t.location} ${t.action_item}`.toLowerCase().includes(s)); }
    const dir = q.order === "asc" ? 1 : -1;
    r.sort((a, b) => {
      if (q.sort === "priority") return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * dir;
      const av = (q.sort === "follow_up_date" ? a.follow_up_date : a.created_at) ?? "9999";
      const bv = (q.sort === "follow_up_date" ? b.follow_up_date : b.created_at) ?? "9999";
      return av.localeCompare(bv) * dir;
    });
    return { total: r.length, items: r.slice((q.page - 1) * q.page_size, q.page * q.page_size) };
  }
  async get(userId: string, id: string) { return this.rows.find((t) => t.id === id && t.user_id === userId) ?? null; }
  async update(userId: string, id: string, patch: TaskPatch) {
    const t = await this.get(userId, id);
    if (!t) return null;
    const { follow_up_date, ...rest } = patch;
    Object.assign(t, rest);
    if (follow_up_date !== undefined) t.follow_up_date = follow_up_date || null;
    t.updated_at = now();
    return t;
  }
  async remove(userId: string, id: string) {
    const i = this.rows.findIndex((t) => t.id === id && t.user_id === userId);
    if (i < 0) return false;
    this.rows.splice(i, 1);
    return true;
  }
  async stats(userId: string, today: string) { return computeStats(this.rows.filter((t) => t.user_id === userId), today); }
  async ping() {}
  async exportAll(userId: string) { return this.rows.filter((t) => t.user_id === userId).map((t) => ({ ...t })); }
  async deleteAll(userId: string) { const n = this.rows.length; this.rows = this.rows.filter((t) => t.user_id !== userId); return n - this.rows.length; }
}

/** Supabase implementation. Uses the service-role key server-side only; every query is scoped by user_id. */
export class SupabaseTaskRepo implements TaskRepo {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string, db?: SupabaseClient) {
    this.db = db ?? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  get client() { return this.db; }
  private fail(error: { message: string }): never {
    throw new AppError(503, "database_error", "The database is not responding right now. Please try again shortly.", undefined);
  }
  async create(userId: string, input: TaskCreate, key?: string) {
    if (key) {
      const { data, error } = await this.db.from("crm_tasks").select("*").eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
      if (error) this.fail(error);
      if (data) return { task: data as TaskRecord, created: false };
    }
    const row = { ...toRecord(userId, input), idempotency_key: key ?? null } as Record<string, unknown>;
    delete row.id; delete row.created_at; delete row.updated_at;
    const { data, error } = await this.db.from("crm_tasks").insert(row).select("*").single();
    if (error) {
      // Unique violation on (user_id, idempotency_key): a concurrent duplicate won the race.
      if (error.code === "23505" && key) {
        const { data: ex } = await this.db.from("crm_tasks").select("*").eq("user_id", userId).eq("idempotency_key", key).single();
        if (ex) return { task: ex as TaskRecord, created: false };
      }
      this.fail(error);
    }
    return { task: data as TaskRecord, created: true };
  }
  async list(userId: string, q: ListQuery) {
    let qb = this.db.from("crm_tasks").select("*", { count: "exact" }).eq("user_id", userId);
    if (q.status) qb = qb.eq("status", q.status);
    if (q.priority) qb = qb.eq("priority", q.priority);
    if (q.search) {
      const s = q.search.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
      if (s) qb = qb.or(`client_name.ilike.%${s}%,location.ilike.%${s}%,action_item.ilike.%${s}%`);
    }
    qb = qb.order(q.sort === "priority" ? "priority_rank" : q.sort, { ascending: q.order === "asc", nullsFirst: false });
    const from = (q.page - 1) * q.page_size;
    const { data, error, count } = await qb.range(from, from + q.page_size - 1);
    if (error) this.fail(error);
    return { items: (data ?? []) as TaskRecord[], total: count ?? 0 };
  }
  async get(userId: string, id: string) {
    const { data, error } = await this.db.from("crm_tasks").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) this.fail(error);
    return (data as TaskRecord) ?? null;
  }
  async update(userId: string, id: string, patch: TaskPatch) {
    const body: Record<string, unknown> = { ...patch };
    if (patch.follow_up_date !== undefined) body.follow_up_date = patch.follow_up_date || null;
    const { data, error } = await this.db.from("crm_tasks").update(body).eq("user_id", userId).eq("id", id).select("*").maybeSingle();
    if (error) this.fail(error);
    return (data as TaskRecord) ?? null;
  }
  async remove(userId: string, id: string) {
    const { data, error } = await this.db.from("crm_tasks").delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) this.fail(error);
    return (data?.length ?? 0) > 0;
  }
  async stats(userId: string, today: string) {
    const { data, error } = await this.db.from("crm_tasks").select("*").eq("user_id", userId).limit(5000);
    if (error) this.fail(error);
    return computeStats((data ?? []) as TaskRecord[], today);
  }
  async exportAll(userId: string) {
    const { data, error } = await this.db.from("crm_tasks").select("*").eq("user_id", userId).order("created_at", { ascending: true }).limit(50000);
    if (error) this.fail(error);
    return (data ?? []) as TaskRecord[];
  }
  async deleteAll(userId: string) {
    const { data, error } = await this.db.from("crm_tasks").delete().eq("user_id", userId).select("id");
    if (error) this.fail(error);
    return data?.length ?? 0;
  }
  async ping() {
    const { error } = await this.db.from("crm_tasks").select("id", { head: true, count: "exact" }).limit(1);
    if (error) this.fail(error);
  }
}
