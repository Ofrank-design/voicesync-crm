import { z } from "zod";
import { PROVIDER_IDS, validateSelection, validateFallback } from "./providers/registry";

const optStr = z.string().optional().transform((v) => (v ? v : undefined));
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(8000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("UTC"),
  MAX_AUDIO_SIZE_MB: z.coerce.number().positive().default(20),
  MAX_RECORDING_SECONDS: z.coerce.number().positive().default(300),
  // Which provider handles each step. Defaults keep the original setup (OpenAI Whisper, then Anthropic).
  TRANSCRIPTION_PROVIDER: z.enum(PROVIDER_IDS).default("openai"),
  EXTRACTION_PROVIDER: z.enum(PROVIDER_IDS).default("anthropic"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("whisper-1"),
  // Keys are optional here. Only the keys of the SELECTED providers are required (checked below).
  OPENAI_API_KEY: optStr, ANTHROPIC_API_KEY: optStr, GEMINI_API_KEY: optStr, GROQ_API_KEY: optStr,
  OPENROUTER_API_KEY: optStr, NVIDIA_API_KEY: optStr, HUGGINGFACE_API_KEY: optStr, HF_TOKEN: optStr,
  ANTHROPIC_MODEL: optStr,
  TRANSCRIPTION_MODEL: optStr,
  TRANSCRIPTION_BASE_URL: optStr.refine((v) => v === undefined || /^https?:\/\//.test(v), "TRANSCRIPTION_BASE_URL must be a full http or https URL"),
  EXTRACTION_MODEL: optStr,
  EXTRACTION_BASE_URL: optStr.refine((v) => v === undefined || /^https?:\/\//.test(v), "EXTRACTION_BASE_URL must be a full http or https URL"),
  EXTRACTION_JSON_MODE: bool,
  // Comma separated Supabase user IDs allowed to change provider settings. In AUTH_MODE=local the dev user is always an admin.
  ADMIN_USER_IDS: optStr,
  // Operations
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),   // how many reverse proxies sit in front of the API
  METRICS_TOKEN: optStr,                                   // enables GET /metrics for Prometheus when set
  AUTH_CACHE_SECONDS: z.coerce.number().min(0).default(30),
  SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().positive().default(25),
  // Optional backup providers, used only when the main one is down, overloaded or out of credit. Never silent: the user is told.
  FALLBACK_TRANSCRIPTION_PROVIDER: z.enum(PROVIDER_IDS).optional(), FALLBACK_TRANSCRIPTION_MODEL: optStr,
  FALLBACK_EXTRACTION_PROVIDER: z.enum(PROVIDER_IDS).optional(), FALLBACK_EXTRACTION_MODEL: optStr,
  // Resilience and limits
  BREAKER_FAILURES: z.coerce.number().int().min(1).default(5),
  BREAKER_COOLDOWN_SECONDS: z.coerce.number().positive().default(30),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  AI_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(0).default(15000),
  USER_DAILY_NOTES: z.coerce.number().int().min(0).optional(),
  USER_DAILY_AUDIO_MINUTES: z.coerce.number().min(0).optional(),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  AUTH_MODE: z.enum(["supabase", "local"]).default("supabase"),
  LOCAL_DEV_USER_ID: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),
  STORE_TRANSCRIPTS: bool,
  AUDIO_RETENTION_ENABLED: bool,
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env): Config {
  // Hosting platforms (Render, Railway, Fly and others) tell the app which port to use in PORT. API_PORT wins if both are set.
  const env = { ...input, ...(input.API_PORT || !input.PORT ? {} : { API_PORT: input.PORT }) };
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${/received undefined/.test(i.message) ? "is required but not set" : i.message}`);
    throw new Error(`Invalid server configuration:\n${lines.join("\n")}`);
  }
  const cfg = parsed.data;
  const problems = validateSelection(
    { transcription: cfg.TRANSCRIPTION_PROVIDER, transcriptionModel: cfg.TRANSCRIPTION_MODEL, extraction: cfg.EXTRACTION_PROVIDER, extractionModel: cfg.EXTRACTION_MODEL ?? (cfg.EXTRACTION_PROVIDER === "anthropic" ? cfg.ANTHROPIC_MODEL : undefined) },
    { OPENAI_API_KEY: cfg.OPENAI_API_KEY, ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY, GEMINI_API_KEY: cfg.GEMINI_API_KEY, GROQ_API_KEY: cfg.GROQ_API_KEY, OPENROUTER_API_KEY: cfg.OPENROUTER_API_KEY, NVIDIA_API_KEY: cfg.NVIDIA_API_KEY, HUGGINGFACE_API_KEY: cfg.HUGGINGFACE_API_KEY, HF_TOKEN: cfg.HF_TOKEN },
  );
  problems.push(...validateFallback(
    { transcription: cfg.TRANSCRIPTION_PROVIDER, extraction: cfg.EXTRACTION_PROVIDER },
    { transcription: cfg.FALLBACK_TRANSCRIPTION_PROVIDER && { provider: cfg.FALLBACK_TRANSCRIPTION_PROVIDER, model: cfg.FALLBACK_TRANSCRIPTION_MODEL }, extraction: cfg.FALLBACK_EXTRACTION_PROVIDER && { provider: cfg.FALLBACK_EXTRACTION_PROVIDER, model: cfg.FALLBACK_EXTRACTION_MODEL } },
    { OPENAI_API_KEY: cfg.OPENAI_API_KEY, ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY, GEMINI_API_KEY: cfg.GEMINI_API_KEY, GROQ_API_KEY: cfg.GROQ_API_KEY, OPENROUTER_API_KEY: cfg.OPENROUTER_API_KEY, NVIDIA_API_KEY: cfg.NVIDIA_API_KEY, HUGGINGFACE_API_KEY: cfg.HUGGINGFACE_API_KEY, HF_TOKEN: cfg.HF_TOKEN },
  ));
  if (problems.length) throw new Error(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  if (cfg.NODE_ENV === "production") {
    const prod: string[] = [];
    if (/[*]/.test(cfg.FRONTEND_ORIGIN) || !/^https:\/\//.test(cfg.FRONTEND_ORIGIN) || /localhost|127\.0\.0\.1/.test(cfg.FRONTEND_ORIGIN)) prod.push("FRONTEND_ORIGIN must be your real https address in production (no wildcard, no localhost, no plain http)");
    if (!/^https:\/\//.test(cfg.SUPABASE_URL)) prod.push("SUPABASE_URL must be an https address in production");
    if (cfg.METRICS_TOKEN && cfg.METRICS_TOKEN.length < 24) prod.push("METRICS_TOKEN must be at least 24 characters");
    if (prod.length) throw new Error(`Invalid server configuration:\n${prod.map((p) => `  - ${p}`).join("\n")}`);
  }
  if (cfg.NODE_ENV === "production" && cfg.AUTH_MODE === "local") {
    throw new Error("AUTH_MODE=local is a development shortcut and is refused when NODE_ENV=production");
  }
  if (cfg.AUDIO_RETENTION_ENABLED) {
    throw new Error("AUDIO_RETENTION_ENABLED=true is not implemented; recordings are never stored");
  }
  return cfg;
}
