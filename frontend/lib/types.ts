export type Priority = "low" | "medium" | "high";
export type Status = "todo" | "in_progress" | "completed";
export interface TaskDraft { client_name: string; location: string; action_item: string; follow_up_date: string; priority: Priority }
export interface Task { id: string; client_name: string; location: string; action_item: string; follow_up_date: string | null; priority: Priority; status: Status; transcript: string | null; created_at: string; updated_at: string }
export interface ProviderInfo { id: string; label: string }
export interface VoiceSyncResult { processed_by?: { transcription: ProviderInfo; extraction: ProviderInfo; fallback_used?: boolean }; request_id: string; transcript: string; task: TaskDraft; status: "awaiting_review"; reference_date: string; timezone: string; warnings: string[] }
export interface Stats { today: string; open: number; overdue: number; high_priority: number; due_today: number; recent: Task[] }
export const STATUS_LABELS: Record<Status, string> = { todo: "To Do", in_progress: "In Progress", completed: "Completed" };
export const STATUSES: Status[] = ["todo", "in_progress", "completed"];

export type ProviderStep = "transcription" | "extraction";
export interface ProviderOption { id: string; label: string; capabilities: ProviderStep[]; key_env: string; key_set: boolean; needs_model: boolean }
export interface ActiveProvider { id: string; label: string; model: string | null }
export interface ProviderStatus {
  source: "server" | "saved"; notice: string | null;
  active: { transcription: ActiveProvider; extraction: ActiveProvider };
  providers: ProviderOption[];
  reliability?: Reliability; concurrency?: { max: number; active: number; queued: number }; limits?: UsageToday["limits"];
}
export interface ProviderTestResult { ok: boolean; step: ProviderStep; provider: string; label: string; ms: number; message: string; code?: string }
export interface ProviderForm { transcription: string; transcription_model: string; extraction: string; extraction_model: string }

export type BreakerState = "closed" | "open" | "half_open";
export interface Reliability { breakers: { transcription: { provider: string; state: BreakerState }; extraction: { provider: string; state: BreakerState } }; backups: { transcription: string | null; extraction: string | null } }
export interface UsageToday { today: { notes: number; audio_minutes: number }; limits: { notes: number | null; audio_minutes: number | null }; resets_at: string }
export interface UsageSummary {
  days: number; limits: UsageToday["limits"];
  totals: { calls: number; failures: number; fallback_calls: number; notes: number; audio_minutes: number; input_tokens: number; output_tokens: number };
  by_provider: Array<{ provider: string; step: ProviderStep; calls: number; failures: number; fallback_calls: number; input_tokens: number; output_tokens: number; audio_minutes: number }>;
}
