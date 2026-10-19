"use client";
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { LogOut, Search, Settings } from "lucide-react";
import { api, ApiError, uploadVoiceNote } from "@/lib/api";
import { AUTH_MODE, supabase } from "@/lib/auth";
import { todayLocal, userTimezone, formatDateOnly } from "@/lib/dates";
import type { Priority, Status, Task, VoiceSyncResult } from "@/lib/types";
import type { ReviewValues } from "@/lib/schema";
import { BrandLogo } from "@/components/BrandLogo";
import { Recorder } from "@/components/Recorder";
import { ReviewForm } from "@/components/ReviewForm";
import { KanbanBoard } from "@/components/Kanban";
import { MetricsRow } from "@/components/Metrics";
import { StageIndicator, type FlowStage } from "@/components/StageIndicator";
import { Button, Card, EmptyState, ErrorMessage, Spinner } from "@/components/ui";

type Flow =
  | { stage: "idle" }
  | { stage: "uploading"; pct: number }
  | { stage: "transcribing" }
  | { stage: "extracting" }
  | { stage: "review"; result: VoiceSyncResult; key: string }
  | { stage: "saving"; result: VoiceSyncResult; key: string }
  | { stage: "completed" }
  | { stage: "failed"; message: string };

const MAX_SECONDS = Number(process.env.NEXT_PUBLIC_MAX_RECORDING_SECONDS ?? 300);
const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_AUDIO_SIZE_MB ?? 20);

export default function Dashboard() {
  const qc = useQueryClient();
  const tz = userTimezone();
  const [flow, setFlow] = useState<Flow>({ stage: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ search: string; priority: Priority | ""; status: Status | "" }>({ search: "", priority: "", status: "" });
  const abort = useRef<AbortController | null>(null);
  const [recording, setRecording] = useState(false);
  const sendKey = useRef<{ blob: Blob; key: string } | null>(null);   // same recording, same key, so a retry never pays twice

  const tasks = useQuery({ queryKey: ["tasks", filters], queryFn: () => api.listTasks({ ...filters, sort: "created_at", order: "asc" }) });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.stats(tz) });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage, retry: false });
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["stats"] }); qc.invalidateQueries({ queryKey: ["usage"] }); }, [qc]);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => api.updateTask(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snap = qc.getQueriesData<{ items: Task[]; total: number }>({ queryKey: ["tasks"] });
      for (const [k, v] of snap) if (v) qc.setQueryData(k, { ...v, items: v.items.map((t) => (t.id === id ? { ...t, status } : t)) });
      return { snap };
    },
    onError: (_e, _v, ctx) => { for (const [k, v] of ctx?.snap ?? []) qc.setQueryData(k, v); },
    onSettled: refresh,
  });

  async function submitAudio(blob: Blob, seconds: number) {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    if (sendKey.current?.blob !== blob) sendKey.current = { blob, key: crypto.randomUUID() };
    setFlow({ stage: "uploading", pct: 0 });
    try {
      const result = await uploadVoiceNote(blob, { durationSeconds: seconds, timezone: tz, referenceDate: todayLocal(), idempotencyKey: sendKey.current.key },
        { onUpload: (pct) => setFlow((f) => (f.stage === "uploading" ? { stage: "uploading", pct } : f)), onStage: (st) => setFlow({ stage: st }) }, ctl.signal);
      setFlow({ stage: "review", result, key: crypto.randomUUID() });
    } catch (e) {
      if (e instanceof ApiError && e.code === "cancelled") return setFlow({ stage: "idle" });
      setFlow({ stage: "failed", message: e instanceof ApiError ? e.message : "Something did not work. Please try again." });
    }
  }

  async function confirm(v: ReviewValues) {
    if (flow.stage !== "review") return; // blocks double-click while saving
    const { result, key } = flow;
    setSaveError(null); setFlow({ stage: "saving", result, key });
    try {
      await api.createTask({ ...v, transcript: result.transcript }, key); // same key on retry => no duplicate
      refresh(); setFlow({ stage: "completed" });
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "We could not save that task. Please try again.");
      setFlow({ stage: "review", result, key });
    }
  }

  const busy = flow.stage === "uploading" || flow.stage === "transcribing" || flow.stage === "extracting";
  const progress = flow.stage === "uploading" ? { label: `Sending your note… ${flow.pct}%`, pct: flow.pct } : flow.stage === "transcribing" ? { label: "Listening to your note…" } : flow.stage === "extracting" ? { label: "Picking out the details…" } : null;
  const s = stats.data;
  const indicator: FlowStage = flow.stage === "review" ? "awaiting review" : flow.stage === "idle" && recording ? "recording" : flow.stage;

  return (
    <main id="main" className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex items-center justify-between">
        <h1><a href="/" aria-label="VoiceSync CRM home"><BrandLogo /></a></h1>
        <div className="flex items-center gap-1">
          <Link href="/account" className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-100">Your data</Link>
          {me.data?.is_admin && <Link href="/settings" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-100"><Settings className="h-4 w-4" aria-hidden />Provider settings</Link>}
          {AUTH_MODE !== "local" && <Button variant="ghost" onClick={() => supabase().auth.signOut()}><LogOut className="h-4 w-4" aria-hidden />Sign out</Button>}
        </div>
      </header>

      <MetricsRow stats={s} loading={stats.isLoading} />
      {usage.data && (usage.data.limits.notes || usage.data.limits.audio_minutes) && (
        <p className="text-sm text-slate-600" data-testid="allowance">
          {usage.data.limits.notes ? `Today: ${usage.data.today.notes} of ${usage.data.limits.notes} voice notes. ` : ""}
          {usage.data.limits.audio_minutes ? `Audio today: ${usage.data.today.audio_minutes} of ${usage.data.limits.audio_minutes} minutes. ` : ""}The count starts again at midnight UTC.
        </p>
      )}
      {stats.isError && <ErrorMessage onRetry={() => stats.refetch()}>We could not load your numbers.</ErrorMessage>}

      <StageIndicator stage={indicator} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {flow.stage === "review" || flow.stage === "saving" ? (
            <ReviewForm transcript={flow.result.transcript} processedBy={flow.result.processed_by} warnings={flow.result.warnings} saving={flow.stage === "saving"} error={saveError}
              initial={{ ...flow.result.task }} onConfirm={confirm} onCancel={() => { setFlow({ stage: "idle" }); setSaveError(null); }} />
          ) : (
            <>
              <Recorder maxSeconds={MAX_SECONDS} maxMB={MAX_MB} busy={busy} progress={progress} onSubmit={submitAudio} onCancelProcessing={() => abort.current?.abort()} onRecordingChange={setRecording} />
              {flow.stage === "failed" && <ErrorMessage>{flow.message} Your recording is still here, so you can send it again.</ErrorMessage>}
              {flow.stage === "completed" && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Task saved to your board.</p>}
            </>
          )}
        </div>
        <Card>
          <h2 className="text-base font-semibold">Recent activity</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {s?.recent.length ? s.recent.map((t) => <li key={t.id}><span className="font-medium">{t.client_name}</span> · {t.action_item}<br /><span className="text-xs text-slate-500">{formatDateOnly(t.follow_up_date)} · {t.status.replace("_", " ")}</span></li>) : <li className="text-slate-500">No activity yet.</li>}
          </ul>
        </Card>
      </div>

      <section aria-label="Task board" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-48"><label htmlFor="search" className="sr-only">Search tasks</label><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input id="search" type="search" placeholder="Search by client, place or action" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="w-full rounded-lg border border-[#dbe1ea] bg-white py-2 pl-9 pr-3 text-sm" /></div>
          <div><label htmlFor="f-pri" className="sr-only">Priority filter</label><select id="f-pri" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value as Priority | "" })} className="rounded-lg border border-[#dbe1ea] bg-white px-3 py-2 text-sm"><option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
          <div><label htmlFor="f-st" className="sr-only">Status filter</label><select id="f-st" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Status | "" })} className="rounded-lg border border-[#dbe1ea] bg-white px-3 py-2 text-sm"><option value="">All statuses</option><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="completed">Completed</option></select></div>
        </div>
        {tasks.isLoading ? <Spinner label="Getting your tasks…" />
          : tasks.isError ? <ErrorMessage onRetry={() => tasks.refetch()}>{(tasks.error as Error).message}</ErrorMessage>
          : tasks.data!.items.length === 0 && !filters.search && !filters.priority && !filters.status ? <EmptyState title="No tasks yet" hint="Record a voice note to create your first task." />
          : <KanbanBoard tasks={tasks.data!.items} today={stats.data?.today} onMove={(id, status) => move.mutate({ id, status })} />}
        {move.isError && <ErrorMessage>That change did not go through, so the task is back where it was.</ErrorMessage>}
      </section>
    </main>
  );
}
