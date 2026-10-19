import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { AppError, unauthorized } from "../src/lib/errors";
import type { Transcriber } from "../src/services/transcription";
import type { TaskExtractor } from "../src/services/task-extractor";

export const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
export const env = {
  NODE_ENV: "test", OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "x", ANTHROPIC_MODEL: "test-model",
  SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "x", MAX_AUDIO_SIZE_MB: "1", MAX_RECORDING_SECONDS: "60",
  STORE_TRANSCRIPTS: "true",
} as NodeJS.ProcessEnv;

export function makeApp(over: { transcriber?: Transcriber; extractor?: TaskExtractor; env?: Record<string, string> } = {}) {
  const repo = new MemoryTaskRepo();
  const transcriber: Transcriber = over.transcriber ?? { transcribe: async () => "Call Daniel in East Legon on Friday about the revised quotation" };
  const extractor: TaskExtractor = over.extractor ?? {
    extract: async () => ({ task: { client_name: "Daniel", location: "East Legon", action_item: "Call about the revised quotation", follow_up_date: "2026-10-16", priority: "medium" }, warnings: [] }),
  };
  const config = loadConfig({ ...env, ...over.env });
  // Token == user id, "bad" is rejected.
  const auth = { authenticate: async (t?: string) => { if (!t || t === "bad") throw unauthorized(); return t; } };
  return { app: createApp({ config, auth, transcriber, extractor, repo }), repo };
}
export const bearer = (u = "user-a") => ({ Authorization: `Bearer ${u}` });
export { AppError };
