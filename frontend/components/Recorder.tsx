"use client";
import { useEffect } from "react";
import { Mic, Pause, Play, RotateCcw, Send, Square, Trash2 } from "lucide-react";
import { useRecorder, type RecorderError } from "@/lib/useRecorder";
import { Button, Card, ErrorMessage } from "./ui";

export const RECORDER_ERRORS: Record<Exclude<RecorderError, null>, string> = {
  unsupported: "Your browser cannot record audio. Try a recent version of Chrome, Edge, Firefox or Safari, on https or localhost.",
  denied: "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.",
  "no-microphone": "We could not find a microphone. Plug one in and try again.",
  interrupted: "The recording was cut off, most likely because the microphone was unplugged or switched off. Anything captured so far is kept below.",
  empty: "That recording came out empty. Please try again.",
  "too-large": "The recording reached the size limit, so it stopped.",
  unknown: "We could not start the recording. Please try again.",
};
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface RecorderProps {
  maxSeconds?: number; maxMB?: number; busy?: boolean; progress?: { label: string; pct?: number } | null;
  onSubmit: (blob: Blob, seconds: number) => void; onCancelProcessing?: () => void; onRecordingChange?: (recording: boolean) => void;
}

export function Recorder({ maxSeconds = 300, maxMB = 20, busy, progress, onSubmit, onCancelProcessing, onRecordingChange }: RecorderProps) {
  const r = useRecorder({ maxSeconds, maxBytes: maxMB * 1024 * 1024 });
  const nearLimit = r.seconds >= maxSeconds * 0.8 && r.state !== "stopped";
  const active = r.state === "recording" || r.state === "paused";
  useEffect(() => { onRecordingChange?.(active); }, [active, onRecordingChange]);

  return (
    <Card className="space-y-4" >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Voice note</h2>
        <span className="font-mono text-sm tabular-nums"><span className="sr-only">Recording time </span>{fmt(r.seconds)} / {fmt(maxSeconds)}</span>
      </div>

      {!r.supported && <ErrorMessage>{RECORDER_ERRORS.unsupported}</ErrorMessage>}
      {r.error && <ErrorMessage>{RECORDER_ERRORS[r.error]}</ErrorMessage>}

      {active && (
        <div className="flex h-10 items-center gap-1" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => <span key={i} className="w-1 rounded bg-[#1f6bff] transition-[height]" style={{ height: `${6 + Math.max(0, r.level * 34 * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7))))}px`, opacity: r.state === "paused" ? 0.3 : 1 }} />)}
        </div>
      )}
      <p className="sr-only" role="status">{r.state === "recording" ? "Recording" : r.state === "paused" ? "Paused" : ""}</p>
      {nearLimit && <p className="text-sm text-amber-800">You are close to the {fmt(maxSeconds)} limit. Recording stops on its own when it gets there.</p>}
      {active && <p className="text-xs text-slate-500">{(r.bytes / 1048576).toFixed(1)} MB of {maxMB} MB</p>}

      {r.state === "stopped" && r.previewUrl && (
        <div className="space-y-2">{/* biome-ignore lint/a11y/useMediaCaption: this is the person's own recording played back before sending, and the transcript is shown right after */}
          <audio controls src={r.previewUrl} className="w-full" aria-label="Recording preview" /><p className="text-xs text-slate-500">{fmt(r.seconds)} · {(r.bytes / 1048576).toFixed(2)} MB</p></div>
      )}

      {progress && (
        <div role="status" className="space-y-1">
          <p className="text-sm">{progress.label}</p>
          <div className="h-2 overflow-hidden rounded bg-slate-200"><div className={`h-full bg-[#1f6bff] ${progress.pct === undefined ? "w-1/3 animate-pulse" : ""}`} style={progress.pct !== undefined ? { width: `${progress.pct}%` } : undefined} /></div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(r.state === "idle" || r.state === "requesting") && !busy && <Button onClick={r.start} loading={r.state === "requesting"} disabled={!r.supported}><Mic className="h-4 w-4" aria-hidden />Record voice note</Button>}
        {active && <>
          <Button variant="danger" onClick={r.stop}><Square className="h-4 w-4" aria-hidden />Stop</Button>
          {r.canPause && (r.state === "recording" ? <Button variant="secondary" onClick={r.pause}><Pause className="h-4 w-4" aria-hidden />Pause</Button> : <Button variant="secondary" onClick={r.resume}><Play className="h-4 w-4" aria-hidden />Resume</Button>)}
        </>}
        {r.state === "stopped" && r.blob && !busy && <>
          <Button onClick={() => onSubmit(r.blob!, r.seconds)}><Send className="h-4 w-4" aria-hidden />Send note</Button>
          <Button variant="secondary" onClick={() => { r.reset(); r.start(); }}><RotateCcw className="h-4 w-4" aria-hidden />Record again</Button>
          <Button variant="ghost" onClick={r.reset}><Trash2 className="h-4 w-4" aria-hidden />Discard</Button>
        </>}
        {busy && onCancelProcessing && <Button variant="secondary" onClick={onCancelProcessing}>Cancel</Button>}
      </div>
    </Card>
  );
}
