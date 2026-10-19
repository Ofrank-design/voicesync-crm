"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "stopped";
export type RecorderError = "unsupported" | "denied" | "no-microphone" | "interrupted" | "empty" | "too-large" | "unknown" | null;

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export function pickMimeType(MR: { isTypeSupported(t: string): boolean } | undefined): string | undefined {
  if (!MR) return undefined;
  return CANDIDATES.find((t) => MR.isTypeSupported(t));
}
export function isRecordingSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface RecorderOptions { maxSeconds: number; maxBytes: number }

export function useRecorder({ maxSeconds, maxBytes }: RecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError>(null);
  const [seconds, setSeconds] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const started = useRef(0);
  const elapsed = useRef(0);
  const bytesRef = useRef(0);
  const stopping = useRef(false);
  const mounted = useRef(true);

  const release = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    for (const t of stream.current?.getTracks() ?? []) t.stop();
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
  }, []);

  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    if (rec.current && rec.current.state !== "inactive") { rec.current.ondataavailable = null; rec.current.onstop = null; try { rec.current.stop(); } catch { /* already stopped */ } }
    release();
  }; }, [release]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const reset = useCallback(() => {
    release(); chunks.current = []; bytesRef.current = 0; elapsed.current = 0; stopping.current = false;
    setBlob(null); setPreviewUrl(null); setSeconds(0); setBytes(0); setLevel(0); setError(null); setState("idle");
  }, [release]);

  const stop = useCallback(() => { if (rec.current && rec.current.state !== "inactive") { stopping.current = true; rec.current.stop(); } }, []);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) { setError("unsupported"); return; }
    reset(); setState("requesting");
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      const n = (e as DOMException).name;
      setError(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "no-microphone" : "unknown");
      setState("idle"); return;
    }
    if (!mounted.current) { for (const t of s.getTracks()) t.stop(); return; }
    stream.current = s;
    const mimeType = pickMimeType(MediaRecorder);
    let r: MediaRecorder;
    try { r = new MediaRecorder(s, mimeType ? { mimeType } : undefined); } catch { release(); setError("unsupported"); setState("idle"); return; }
    rec.current = r;
    r.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.current.push(e.data); bytesRef.current += e.data.size; setBytes(bytesRef.current);
      if (bytesRef.current >= maxBytes) { setError("too-large"); stop(); }
    };
    r.onerror = () => { setError("interrupted"); stop(); };
    r.onstop = () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      const type = r.mimeType || mimeType || "audio/webm";
      const b = new Blob(chunks.current, { type });
      release();
      if (!mounted.current) return;
      if (b.size === 0) { setError("empty"); setState("idle"); return; }
      setBlob(b); setPreviewUrl(URL.createObjectURL(b)); setState("stopped");
    };
    // The browser may end the mic (unplugged device, OS revoke).
    s.getAudioTracks().forEach((t) => { t.onended = () => { if (!stopping.current) { setError("interrupted"); stop(); } }; });

    try {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (AC) {
        const ac: AudioContext = new AC(); ctx.current = ac;
        const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(s).connect(an);
        const data = new Uint8Array(an.frequencyBinCount);
        const tick = () => { an.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 64)); raf.current = requestAnimationFrame(tick); };
        tick();
      }
    } catch { /* level meter is optional */ }

    r.start(1000);
    started.current = Date.now(); elapsed.current = 0;
    setState("recording");
    timer.current = setInterval(() => {
      const total = elapsed.current + (r.state === "recording" ? (Date.now() - started.current) / 1000 : 0);
      setSeconds(total);
      if (total >= maxSeconds) stop();
    }, 200);
  }, [maxBytes, maxSeconds, release, reset, stop]);

  const canPause = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype?.pause === "function";
  const pause = useCallback(() => { const r = rec.current; if (r?.state === "recording") { elapsed.current += (Date.now() - started.current) / 1000; r.pause(); setState("paused"); } }, []);
  const resume = useCallback(() => { const r = rec.current; if (r?.state === "paused") { started.current = Date.now(); r.resume(); setState("recording"); } }, []);

  return { state, error, seconds, bytes, level, blob, previewUrl, start, stop, pause, resume, reset, canPause, supported: typeof window === "undefined" ? true : isRecordingSupported() };
}
