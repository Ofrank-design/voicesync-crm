/**
 * Controlled backend for browser end-to-end tests.
 * Real Express app, real auth middleware, real validation and in-memory persistence.
 * Only Whisper and Claude are replaced by deterministic fakes, so no paid API calls are made.
 * Auth: bearer token == user id; requests with no token act as "browser-user".
 */
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { unauthorized } from "../src/lib/errors";
import { MemorySettingsRepo } from "../src/services/settings-repo";
import { MemoryUsageRepo } from "../src/services/usage-repo";
import { ProviderManager } from "../src/providers/manager";
import { PROVIDERS } from "../src/providers/registry";
import { buildWarnings } from "../src/services/task-extractor";
import type { Transcriber } from "../src/services/transcription";
import type { TaskExtractor } from "../src/services/task-extractor";

const config = loadConfig({
  NODE_ENV: "test", OPENAI_API_KEY: "e2e-secret-openai", ANTHROPIC_API_KEY: "e2e-secret-anthropic", ANTHROPIC_MODEL: "e2e-model",
  SUPABASE_URL: "http://localhost:1", SUPABASE_SERVICE_ROLE_KEY: "fake", STORE_TRANSCRIPTS: "true", GROQ_API_KEY: "e2e-secret-groq", ADMIN_USER_IDS: "browser-user", USER_DAILY_NOTES: "50",
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000", API_PORT: process.env.API_PORT ?? "8000",
  MAX_RECORDING_SECONDS: "60", MAX_AUDIO_SIZE_MB: "10", AI_MAX_CONCURRENCY: process.env.AI_MAX_CONCURRENCY ?? "4",
});

const delay = Number(process.env.E2E_AI_DELAY_MS ?? 0);   // simulate slow providers for load tests
const wait = () => (delay ? new Promise((r) => setTimeout(r, delay)) : undefined);
const transcriber: Transcriber = {
  async check() {},
  async transcribe(audio) {
    await wait();
    if (audio.length < 200) throw new Error("fixture too small");
    return "Call Daniel in East Legon on Friday about the revised quotation";
  },
};

function nextWeekday(ref: string, target: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  do dt.setUTCDate(dt.getUTCDate() + 1); while (dt.getUTCDay() !== target);
  return dt.toISOString().slice(0, 10);
}
const extractor: TaskExtractor = {
  async extract(_t, ctx) {
    await wait();
    const task = { client_name: "Daniel", location: "East Legon", action_item: "Call about the revised quotation", follow_up_date: nextWeekday(ctx.referenceDate, 5), priority: "medium" as const };
    return { task, warnings: buildWarnings(task, ctx) };
  },
};

// E2E_STRICT_TOKENS="a,b" accepts only those tokens (like a real identity service). Otherwise any token, or none, is accepted.
const strict = process.env.E2E_STRICT_TOKENS?.split(",");
const auth = { authenticate: async (t?: string) => { if (strict) { if (!t || !strict.includes(t)) throw unauthorized(); return t; } return t || "browser-user"; } };
// Real provider manager, fake providers: any choice "builds" the same deterministic fakes but is labelled with the chosen provider.
const builder = (_c: unknown, s: { transcription: keyof typeof PROVIDERS; extraction: keyof typeof PROVIDERS }) => ({
  transcriber, extractor,
  summary: { transcription: { id: s.transcription, label: PROVIDERS[s.transcription].label }, extraction: { id: s.extraction, label: PROVIDERS[s.extraction].label } },
});
const usage = new MemoryUsageRepo();
const manager = new ProviderManager(config, new MemorySettingsRepo(), {}, builder as never, { usage });
const app = createApp({ config, auth, transcriber: manager, extractor: manager, repo: new MemoryTaskRepo(), providerAdmin: { manager }, usage });
app.listen(config.API_PORT, () => console.log(`e2e API on :${config.API_PORT}`));
