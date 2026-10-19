import OpenAI, { toFile } from "openai";
import { AppError } from "../lib/errors";
import type { DetectedAudio } from "../lib/audio";

export interface Transcriber {
  transcribe(audio: Buffer, format: DetectedAudio, signal?: AbortSignal): Promise<string>;
  /** Cheap credential and model check that does not transcribe anything. Used by the settings screen. */
  check?(signal?: AbortSignal): Promise<void>;
}

export function createTranscriber(opts: { apiKey: string; model: string; baseURL?: string; timeoutMs?: number; client?: OpenAI }): Transcriber {
  const client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs ?? 60_000, maxRetries: 2 });
  return {
    async check(signal) {
      try { await client.models.retrieve(opts.model, { signal }); } catch (err) { throw mapUpstream(err, "transcription"); }
    },
    async transcribe(audio, format, signal) {
      try {
        // Buffer is sent from memory; no temp files are written, so nothing needs cleanup.
        const file = await toFile(audio, `recording.${format.ext}`, { type: format.mime });
        const res = await client.audio.transcriptions.create({ file, model: opts.model }, { signal });
        const text = (res.text ?? "").trim();
        if (!text) throw new AppError(422, "empty_transcript", "We could not hear any speech in that recording.");
        return text;
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw mapUpstream(err, "transcription");
      }
    },
  };
}

export function mapUpstream(err: unknown, what: string): AppError {
  const status = (err as { status?: number })?.status;
  const name = (err as { name?: string })?.name;
  if (name === "APIUserAbortError" || name === "AbortError") return new AppError(499, "cancelled", "The request was cancelled.");
  if (name === "APIConnectionTimeoutError") return new AppError(504, `${what}_timeout`, `The ${what} service is taking too long. Please try again.`);
  if (status === 429) return new AppError(429, "upstream_rate_limited", `The ${what} service is busy. Try again in a moment.`);
  if (status === 402) return new AppError(502, `${what}_billing`, `The ${what} provider says the account is out of credit or over its plan. Whoever runs the server needs to check billing.`);
  if (status === 404) return new AppError(502, `${what}_model_not_found`, `The ${what} provider could not find that model. Whoever runs the server needs to check the model ID.`);
  if (status === 401 || status === 403) return new AppError(502, `${what}_misconfigured`, `The server could not sign in to the ${what} service. Whoever runs the server needs to check the keys.`);
  if (status === 400 || status === 413 || status === 415) return new AppError(422, `${what}_rejected`, `The ${what} service could not handle that.`);
  return new AppError(502, `${what}_unavailable`, `The ${what} service is having trouble right now. Please try again shortly.`);
}
