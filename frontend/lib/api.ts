import { getAccessToken } from "./auth";
import type { Priority, ProviderForm, UsageSummary, UsageToday, ProviderStatus, ProviderStep, ProviderTestResult, Stats, Status, Task, TaskDraft, VoiceSyncResult } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function headers(extra: Record<string, string> = {}) {
  const t = await getAccessToken();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}
async function toError(res: Response): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? `Something went wrong (code ${res.status}). Please try again.`, body?.error?.details);
}
async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: init.signal ?? ctl.signal, headers: await headers(init.body ? { "Content-Type": "application/json", ...(init.headers as Record<string, string>) } : (init.headers as Record<string, string>)) });
    if (!res.ok) throw await toError(res);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === "AbortError") throw new ApiError(0, "timeout", "That took too long. Check your connection and try again.");
    throw new ApiError(0, "network", "We could not reach the server. Check your connection and try again.");
  } finally { clearTimeout(timer); }
}

export interface ListParams { search?: string; status?: Status | ""; priority?: Priority | ""; sort?: string; order?: "asc" | "desc"; page?: number; page_size?: number }
const qs = (p: Record<string, unknown>) => { const u = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== "") u.set(k, String(v)); }); const s = u.toString(); return s ? `?${s}` : ""; };

export const api = {
  listTasks: (p: ListParams = {}) => request<{ items: Task[]; total: number }>(`/api/tasks${qs({ page_size: 100, ...p })}`),
  stats: (timezone: string) => request<Stats>(`/api/tasks/stats${qs({ timezone })}`),
  getTask: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (t: TaskDraft & { transcript?: string }, idempotencyKey: string) => request<{ task: Task; duplicate: boolean }>("/api/tasks", { method: "POST", body: JSON.stringify(t), headers: { "Idempotency-Key": idempotencyKey } }),
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "created_at" | "updated_at" | "transcript" | "follow_up_date">> & { follow_up_date?: string }) => request<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  usage: () => request<UsageToday>("/api/usage"),
  adminUsage: (days = 7) => request<UsageSummary>(`/api/admin/usage?days=${days}`),
  usageCsv: async (days = 30): Promise<Blob> => {
    let res: Response;
    try { res = await fetch(`${BASE}/api/admin/usage.csv?days=${days}`, { headers: await headers() }); } catch { throw new ApiError(0, "network", "We could not reach the server. Check your connection and try again."); }
    if (!res.ok) throw await toError(res);
    return res.blob();
  },
  exportData: async (): Promise<Blob> => {
    let res: Response;
    try { res = await fetch(`${BASE}/api/me/export`, { headers: await headers() }); } catch { throw new ApiError(0, "network", "We could not reach the server. Check your connection and try again."); }
    if (!res.ok) throw await toError(res);
    return res.blob();
  },
  deleteAccount: () => request<{ deleted: { tasks: number; usage: number; account: boolean } }>("/api/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }),
  me: () => request<{ user_id: string; is_admin: boolean }>("/api/me"),
  adminProviders: () => request<ProviderStatus>("/api/admin/providers"),
  saveProviders: (f: ProviderForm) => request<ProviderStatus>("/api/admin/providers", { method: "PUT", body: JSON.stringify(f) }),
  resetProviders: () => request<ProviderStatus>("/api/admin/providers", { method: "DELETE" }),
  testProvider: (b: { step: ProviderStep; provider?: string; model?: string }) => request<ProviderTestResult>("/api/admin/providers/test", { method: "POST", body: JSON.stringify(b) }, 30000),
};

export type Stage = "transcribing" | "extracting";

/** Incrementally parse NDJSON progress events. Returns the number of characters consumed. */
export function parseProgressStream(text: string, consumed: number, on: { stage: (s: Stage) => void; done: (r: VoiceSyncResult) => void; error: (e: ApiError) => void }): number {
  let pos = consumed;
  for (;;) {
    const nl = text.indexOf("\n", pos);
    if (nl < 0) return pos;
    const line = text.slice(pos, nl).trim(); pos = nl + 1;
    if (!line) continue;
    let ev: any; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.stage === "transcribing" || ev.stage === "extracting") on.stage(ev.stage);
    else if (ev.stage === "done") on.done(ev.result as VoiceSyncResult);
    else if (ev.stage === "error") on.error(new ApiError(502, ev.error?.code ?? "processing_failed", ev.error?.message ?? "We could not process that note."));
  }
}

/** Upload with progress, server-reported stages and cancellation (fetch can't report upload progress). */
export async function uploadVoiceNote(blob: Blob, meta: { durationSeconds: number; timezone: string; referenceDate: string; idempotencyKey?: string }, cb: { onUpload: (pct: number) => void; onStage: (s: Stage) => void }, signal: AbortSignal, timeoutMs = 120000): Promise<VoiceSyncResult> {
  const token = await getAccessToken();
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("audio", blob, `recording.${ext}`);
  form.append("timezone", meta.timezone);
  form.append("reference_date", meta.referenceDate);
  form.append("duration_seconds", String(Math.round(meta.durationSeconds)));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false, consumed = 0;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    xhr.open("POST", `${BASE}/api/voice-sync`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("X-Progress", "stream");
    if (meta.idempotencyKey) xhr.setRequestHeader("Idempotency-Key", meta.idempotencyKey);
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => e.lengthComputable && cb.onUpload(Math.round((e.loaded / e.total) * 100));
    const handlers = { stage: cb.onStage, done: (r: VoiceSyncResult) => finish(() => resolve(r)), error: (e: ApiError) => finish(() => reject(e)) };
    xhr.onprogress = () => { if (xhr.status === 200) consumed = parseProgressStream(xhr.responseText, consumed, handlers); };
    xhr.onload = () => {
      if (xhr.status === 200) { consumed = parseProgressStream(xhr.responseText, consumed, handlers); finish(() => reject(new ApiError(502, "incomplete_response", "The server stopped before it finished. Please try again."))); return; }
      let body: any = null; try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      finish(() => reject(new ApiError(xhr.status, body?.error?.code ?? "http_error", body?.error?.message ?? `The upload did not work (code ${xhr.status}). Please try again.`)));
    };
    xhr.onerror = () => finish(() => reject(new ApiError(0, "network", "We could not reach the server. Check your connection and try again.")));
    xhr.ontimeout = () => finish(() => reject(new ApiError(0, "timeout", "That took too long to process. Please try again.")));
    xhr.onabort = () => finish(() => reject(new ApiError(0, "cancelled", "Cancelled.")));
    signal.addEventListener("abort", () => xhr.abort());
    if (signal.aborted) return xhr.abort();
    xhr.send(form);
  });
}
