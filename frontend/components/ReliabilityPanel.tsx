"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { BreakerState, ProviderStatus } from "@/lib/types";
import { Button, Card, ErrorMessage, Spinner } from "./ui";

const STATE_TEXT: Record<BreakerState, string> = { closed: "Working normally", open: "Paused after repeated errors", half_open: "Checking whether it has recovered" };

export function ReliabilityPanel({ status }: { status: ProviderStatus }) {
  const label = (id: string | null) => (id ? status.providers.find((p) => p.id === id)?.label ?? id : "None set");
  const usage = useQuery({ queryKey: ["admin-usage", 7], queryFn: () => api.adminUsage(7), retry: false });
  const [csvError, setCsvError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = status.reliability, c = status.concurrency, l = status.limits;

  async function download() {
    setBusy(true); setCsvError(null);
    try {
      const url = URL.createObjectURL(await api.usageCsv(30));
      const a = document.createElement("a"); a.href = url; a.download = "voicesync-usage.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setCsvError(e instanceof ApiError ? e.message : "The download did not work. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <Card className="space-y-5">
      <section aria-labelledby="rel-h" className="space-y-2">
        <h2 id="rel-h" className="text-base font-semibold">Reliability</h2>
        {r ? (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]" data-testid="reliability">
            <dt className="text-slate-600">Speech to text</dt><dd>{label(r.breakers.transcription.provider)}: <strong>{STATE_TEXT[r.breakers.transcription.state]}</strong></dd>
            <dt className="text-slate-600">Speech backup</dt><dd>{label(r.backups.transcription)}</dd>
            <dt className="text-slate-600">Text to task</dt><dd>{label(r.breakers.extraction.provider)}: <strong>{STATE_TEXT[r.breakers.extraction.state]}</strong></dd>
            <dt className="text-slate-600">Task backup</dt><dd>{label(r.backups.extraction)}</dd>
            {c && <><dt className="text-slate-600">Processing now</dt><dd>{c.active} of {c.max} at once, {c.queued} waiting</dd></>}
            {l && <><dt className="text-slate-600">Daily allowance</dt><dd>{[l.notes ? `${l.notes} voice notes` : null, l.audio_minutes ? `${l.audio_minutes} minutes of audio` : null].filter(Boolean).join(" and ") || "No limit set"} per person</dd></>}
          </dl>
        ) : <p className="text-sm text-slate-600">No reliability data yet.</p>}
        <p className="text-xs text-slate-600">A backup is only used when the main provider is down, overloaded or out of credit, and the person who sent the note is told when it happens. Set one with the FALLBACK settings on the server.</p>
      </section>

      <section aria-labelledby="use-h" className="space-y-2">
        <h2 id="use-h" className="text-base font-semibold">Usage, last 7 days</h2>
        {usage.isLoading && <Spinner label="Getting usage…" />}
        {usage.isError && <ErrorMessage onRetry={() => usage.refetch()}>{(usage.error as Error).message}</ErrorMessage>}
        {usage.data && (usage.data.totals.calls === 0 ? <p className="text-sm text-slate-600">No voice notes have been processed in this period.</p> : (
          <>
            <p className="text-sm" data-testid="usage-totals">{usage.data.totals.notes} voice notes, {usage.data.totals.audio_minutes} minutes of audio. {usage.data.totals.calls} provider calls, {usage.data.totals.failures} failed, {usage.data.totals.fallback_calls} on a backup. {usage.data.totals.input_tokens.toLocaleString("en-GB")} tokens in, {usage.data.totals.output_tokens.toLocaleString("en-GB")} tokens out.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Usage by provider</caption>
                <thead><tr className="border-b border-[#dbe1ea] text-xs uppercase tracking-wide text-slate-600"><th scope="col" className="py-1 pr-3">Provider</th><th scope="col" className="pr-3">Step</th><th scope="col" className="pr-3">Calls</th><th scope="col" className="pr-3">Failed</th><th scope="col" className="pr-3">Backup</th><th scope="col" className="pr-3">Tokens in</th><th scope="col" className="pr-3">Tokens out</th><th scope="col">Minutes</th></tr></thead>
                <tbody>{usage.data.by_provider.map((p) => (
                  <tr key={`${p.step}-${p.provider}`} className="border-b border-[#eef1f6]"><th scope="row" className="py-1 pr-3 font-medium">{label(p.provider)}</th><td className="pr-3">{p.step === "transcription" ? "Speech" : "Task"}</td><td className="pr-3">{p.calls}</td><td className="pr-3">{p.failures}</td><td className="pr-3">{p.fallback_calls}</td><td className="pr-3">{p.input_tokens}</td><td className="pr-3">{p.output_tokens}</td><td>{p.audio_minutes}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ))}
        <div className="flex items-center gap-3"><Button variant="secondary" onClick={download} loading={busy}><Download className="h-4 w-4" aria-hidden />Download usage as CSV</Button><span className="text-xs text-slate-600">Last 30 days. No audio or transcripts are included.</span></div>
        {csvError && <ErrorMessage>{csvError}</ErrorMessage>}
      </section>
    </Card>
  );
}
