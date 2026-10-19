import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../lib/errors";

export interface UsageEvent {
  user_id: string; request_id?: string; at: string; step: "transcription" | "extraction"; provider: string; model?: string;
  ok: boolean; error_code?: string; audio_seconds?: number; input_tokens?: number; output_tokens?: number; fallback: boolean; duration_ms: number;
}
export interface UsageRepo { record(e: UsageEvent): Promise<void>; since(iso: string, userId?: string): Promise<UsageEvent[]>; deleteForUser(userId: string): Promise<number> }

export class MemoryUsageRepo implements UsageRepo {
  events: UsageEvent[] = [];
  async record(e: UsageEvent) { this.events.push(e); }
  async since(iso: string, userId?: string) { return this.events.filter((e) => e.at >= iso && (!userId || e.user_id === userId)); }
  async deleteForUser(userId: string) { const n = this.events.length; this.events = this.events.filter((e) => e.user_id !== userId); return n - this.events.length; }
}

const MAX_ROWS = 50_000;
const DB_DOWN = () => new AppError(503, "database_error", "The database is not responding right now. Please try again shortly.");
export class SupabaseUsageRepo implements UsageRepo {
  constructor(private db: SupabaseClient) {}
  async record(e: UsageEvent) { const { error } = await this.db.from("usage_events").insert(e); if (error) throw new AppError(503, "database_error", "The database is not responding right now."); }
  async since(iso: string, userId?: string) {
    let q = this.db.from("usage_events").select("*").gte("at", iso).order("at", { ascending: true }).limit(MAX_ROWS);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q;
    if (error) throw new AppError(503, "database_error", "The database is not responding right now.");
    return (data ?? []) as UsageEvent[];
  }
  async deleteForUser(userId: string) {
    const { data, error } = await this.db.from("usage_events").delete().eq("user_id", userId).select("id");
    if (error) throw DB_DOWN();
    return data?.length ?? 0;
  }
}

export const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
export const nextUtcMidnight = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();

/** A "note" counts once a task draft was returned. Failures are logged but never use up a user's allowance. */
export function todayTotals(events: UsageEvent[]) {
  const ok = events.filter((e) => e.step === "extraction" && e.ok);
  return { notes: ok.length, audio_minutes: Math.round((ok.reduce((s, e) => s + (e.audio_seconds ?? 0), 0) / 60) * 10) / 10 };
}

export function summarize(events: UsageEvent[]) {
  const by = new Map<string, { provider: string; step: string; calls: number; failures: number; fallback_calls: number; input_tokens: number; output_tokens: number; audio_seconds: number }>();
  const users = new Map<string, { user_id: string; notes: number; audio_seconds: number }>();
  for (const e of events) {
    const k = `${e.step}:${e.provider}`;
    const r = by.get(k) ?? { provider: e.provider, step: e.step, calls: 0, failures: 0, fallback_calls: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0 };
    r.calls++; if (!e.ok) r.failures++; if (e.fallback) r.fallback_calls++;
    r.input_tokens += e.input_tokens ?? 0; r.output_tokens += e.output_tokens ?? 0; if (e.step === "transcription") r.audio_seconds += e.audio_seconds ?? 0; by.set(k, r);
    if (e.step === "extraction" && e.ok) { const u = users.get(e.user_id) ?? { user_id: e.user_id, notes: 0, audio_seconds: 0 }; u.notes++; u.audio_seconds += e.audio_seconds ?? 0; users.set(e.user_id, u); }
  }
  const t = todayTotals(events);
  return {
    totals: { calls: events.length, failures: events.filter((e) => !e.ok).length, fallback_calls: events.filter((e) => e.fallback).length, notes: t.notes, audio_minutes: t.audio_minutes, input_tokens: events.reduce((s, e) => s + (e.input_tokens ?? 0), 0), output_tokens: events.reduce((s, e) => s + (e.output_tokens ?? 0), 0) },
    by_provider: [...by.values()].map((r) => ({ ...r, audio_minutes: Math.round((r.audio_seconds / 60) * 10) / 10 })).sort((a, b) => b.calls - a.calls),
    by_user: [...users.values()].map((u) => ({ user_id: u.user_id, notes: u.notes, audio_minutes: Math.round((u.audio_seconds / 60) * 10) / 10 })).sort((a, b) => b.notes - a.notes).slice(0, 50),
  };
}

const COLS = ["at", "user_id", "request_id", "step", "provider", "model", "ok", "error_code", "audio_seconds", "input_tokens", "output_tokens", "fallback", "duration_ms"] as const;
/** CSV with quoting, and a leading apostrophe on cells a spreadsheet could treat as a formula. */
export function toCsv(events: UsageEvent[]): string {
  const cell = (v: unknown) => { let s = v === undefined || v === null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLS.join(","), ...events.map((e) => COLS.map((c) => cell(e[c])).join(","))].join("\n") + "\n";
}
