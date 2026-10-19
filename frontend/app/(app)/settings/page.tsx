"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ProviderForm, ProviderOption, ProviderStatus, ProviderStep, ProviderTestResult } from "@/lib/types";
import { Button, Card, ConfirmDialog, ErrorMessage, Spinner } from "@/components/ui";
import { ReliabilityPanel } from "@/components/ReliabilityPanel";

const STEP_TEXT: Record<ProviderStep, { title: string; hint: string }> = {
  transcription: { title: "Speech to text", hint: "Turns the recording into text." },
  extraction: { title: "Text to task", hint: "Picks the client, place, action, date and priority out of the text." },
};
const field = "w-full rounded-lg border border-[#dbe1ea] bg-white px-3 py-2 text-sm";

function StepCard({ step, providers, provider, model, onProvider, onModel }: { step: ProviderStep; providers: ProviderOption[]; provider: string; model: string; onProvider: (v: string) => void; onModel: (v: string) => void }) {
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const options = providers.filter((p) => p.capabilities.includes(step));
  const current = options.find((p) => p.id === provider);
  const test = useMutation({
    mutationFn: () => api.testProvider({ step, provider, model: model.trim() || undefined }),
    onMutate: () => setResult(null), onSuccess: setResult,
    onError: (e) => setResult({ ok: false, step, provider, label: current?.label ?? provider, ms: 0, message: e instanceof ApiError ? e.message : "The test could not run." }),
  });
  const id = `step-${step}`;
  return (
    <Card className="space-y-3" >
      <fieldset aria-labelledby={`${id}-t`} className="m-0 min-w-0 space-y-3 border-0 p-0">
        <div><h2 id={`${id}-t`} className="text-base font-semibold">{STEP_TEXT[step].title}</h2><p className="text-sm text-slate-600">{STEP_TEXT[step].hint}</p></div>
        <div><label htmlFor={`${id}-p`} className="text-sm font-medium">Provider</label>
          <select id={`${id}-p`} className={field} value={provider} onChange={(e) => { onProvider(e.target.value); setResult(null); }}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        <div><label htmlFor={`${id}-m`} className="text-sm font-medium">Model</label>
          <input id={`${id}-m`} className={field} value={model} onChange={(e) => { onModel(e.target.value); setResult(null); }} placeholder={current && !current.needs_model && step === "transcription" ? "Leave blank to use the built in default" : "Model name from your provider"} autoComplete="off" spellCheck={false} /></div>
        {current && (current.key_set
          ? <p className="flex items-center gap-1 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" aria-hidden />The server has a key for {current.label}.</p>
          : <p role="alert" className="flex items-start gap-1 text-sm text-red-900"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />No key for {current.label} yet. Add {current.key_env} to the server environment and restart the server.</p>)}
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending} disabled={!current?.key_set}>Test connection</Button>
          {test.isPending && <span className="text-sm text-slate-600">Checking…</span>}
        </div>
        {result && (
          <p role="status" className={result.ok ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" : "rounded-lg bg-red-50 p-3 text-sm text-red-900"}>
            {result.ok ? `It works with ${result.label}${result.ms ? ` (${(result.ms / 1000).toFixed(1)} seconds)` : ""}. ` : `That did not work. `}{result.message}
          </p>
        )}
      </fieldset>
    </Card>
  );
}

const formFrom = (s: ProviderStatus): ProviderForm => ({ transcription: s.active.transcription.id, transcription_model: s.active.transcription.model ?? "", extraction: s.active.extraction.id, extraction_model: s.active.extraction.model ?? "" });

export default function ProviderSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-providers"], queryFn: api.adminProviders, retry: false });
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setForm(formFrom(q.data)); }, [q.data]);

  const done = (s: ProviderStatus) => { qc.setQueryData(["admin-providers"], s); setConfirm(null); setSaved(true); qc.invalidateQueries({ queryKey: ["me"] }); };
  const save = useMutation({ mutationFn: (f: ProviderForm) => api.saveProviders(f), onSuccess: done });
  const reset = useMutation({ mutationFn: api.resetProviders, onSuccess: done });

  if (q.isLoading) return <main id="main" className="mx-auto max-w-3xl p-8"><Spinner label="Getting provider settings…" /></main>;
  if (q.isError) {
    const forbidden = q.error instanceof ApiError && q.error.status === 403;
    return (
      <main id="main" className="mx-auto max-w-3xl space-y-4 p-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to dashboard</Link>
        <ErrorMessage onRetry={forbidden ? undefined : () => q.refetch()}>{forbidden ? "Only admins can change provider settings. Ask an admin to add your user ID to ADMIN_USER_IDS on the server." : (q.error as Error).message}</ErrorMessage>
      </main>
    );
  }
  const status = q.data!;
  if (!form) return null;
  const changed = JSON.stringify(form) !== JSON.stringify(formFrom(status));
  const keyOk = (id: string) => status.providers.find((p) => p.id === id)?.key_set;
  const canSave = changed && !!keyOk(form.transcription) && !!keyOk(form.extraction);
  const label = (id: string) => status.providers.find((p) => p.id === id)?.label ?? id;
  const set = (patch: Partial<ProviderForm>) => { setForm({ ...form, ...patch }); setSaved(false); };

  return (
    <main id="main" className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to dashboard</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Provider settings</h1>
        <p className="text-sm text-slate-600">Choose which services handle your voice notes. Keys are never typed here. They stay in the server environment, out of the browser.</p>
      </header>

      <Card><h2 className="text-base font-semibold">Active right now</h2>
        <p className="mt-1 text-sm" data-testid="active-now">Speech to text: <strong>{status.active.transcription.label}</strong>. Text to task: <strong>{status.active.extraction.label}</strong>.</p>
        <p className="text-xs text-slate-600">{status.source === "saved" ? "These were set in this screen." : "These come from the server settings."}</p>
        {status.notice && <p role="alert" className="mt-2 text-sm text-amber-900">{status.notice}</p>}
      </Card>

      <StepCard step="transcription" providers={status.providers} provider={form.transcription} model={form.transcription_model} onProvider={(v) => set({ transcription: v, transcription_model: "" })} onModel={(v) => set({ transcription_model: v })} />
      <StepCard step="extraction" providers={status.providers} provider={form.extraction} model={form.extraction_model} onProvider={(v) => set({ extraction: v, extraction_model: "" })} onModel={(v) => set({ extraction_model: v })} />

      {save.isError && <ErrorMessage>{save.error instanceof ApiError && Array.isArray(save.error.details) ? (save.error.details as string[]).join(" ") : (save.error as Error).message}</ErrorMessage>}
      {reset.isError && <ErrorMessage>{(reset.error as Error).message}</ErrorMessage>}
      {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Saved. New voice notes will use these providers.</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirm("save")} disabled={!canSave}>Save changes</Button>
        {status.source === "saved" && <Button variant="secondary" onClick={() => setConfirm("reset")}>Go back to the server settings</Button>}
      </div>
      <p className="text-xs text-slate-600">Changing providers changes who sees your users&apos; recordings and text. Read each provider&apos;s data terms first, and test the connection before you save.</p>

      <ReliabilityPanel status={status} />

      <ConfirmDialog open={confirm === "save"} title="Change providers?" body={`New voice notes will be handled by ${label(form.transcription)} for speech and ${label(form.extraction)} for the task details. This changes who processes your users' data.`} confirmLabel="Change providers" busy={save.isPending} onConfirm={() => save.mutate(form)} onCancel={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "reset"} title="Go back to the server settings?" body="The choice saved in this screen will be removed, and the providers set in the server environment will be used again." confirmLabel="Go back" busy={reset.isPending} onConfirm={() => reset.mutate()} onCancel={() => setConfirm(null)} />
    </main>
  );
}
