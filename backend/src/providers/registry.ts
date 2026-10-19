/**
 * Static capability registry. One entry per provider VoiceSync can talk to.
 * Capabilities are what this codebase implements, not a claim about what the vendor offers.
 * Audio transcription is wired for OpenAI and Groq, which both expose an OpenAI style /audio/transcriptions endpoint.
 * Gemini, OpenRouter, NVIDIA and Hugging Face are not wired for audio: their speech APIs have different shapes or depend on
 * the model and deployment, so they are left out until each one can be verified.
 * Base URLs are the vendors' OpenAI compatible endpoints. Verify them (and your model IDs) against each vendor's
 * current docs, and override with EXTRACTION_BASE_URL for self hosted or region specific deployments.
 */
export const PROVIDER_IDS = ["openai", "anthropic", "gemini", "groq", "openrouter", "nvidia", "huggingface"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type Capability = "transcription" | "extraction";
export type AudioExt = "webm" | "ogg" | "wav" | "mp4" | "mp3" | "flac";
/** Containers the server can detect (see lib/audio.ts). Both transcription providers accept all of them. */
const ALL_AUDIO: readonly AudioExt[] = ["webm", "ogg", "wav", "mp4", "mp3", "flac"];

export interface ProviderSpec {
  label: string;
  capabilities: readonly Capability[];
  /** Environment variables that can hold the key, first one wins. */
  keyEnv: readonly string[];
  /** Audio containers this provider accepts for transcription. Only set when it can transcribe. */
  audioFormats?: readonly AudioExt[];
  /** OpenAI compatible base URL. Absent for providers with their own SDK. */
  baseURL?: string;
  /** Name of the output token limit parameter the chat endpoint expects. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: { label: "OpenAI", capabilities: ["transcription", "extraction"], audioFormats: ALL_AUDIO, keyEnv: ["OPENAI_API_KEY"], baseURL: "https://api.openai.com/v1", tokenParam: "max_completion_tokens" },
  anthropic: { label: "Anthropic", capabilities: ["extraction"], keyEnv: ["ANTHROPIC_API_KEY"] },
  gemini: { label: "Google Gemini", capabilities: ["extraction"], keyEnv: ["GEMINI_API_KEY"], baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", tokenParam: "max_tokens" },
  groq: { label: "Groq", capabilities: ["transcription", "extraction"], audioFormats: ALL_AUDIO, keyEnv: ["GROQ_API_KEY"], baseURL: "https://api.groq.com/openai/v1", tokenParam: "max_tokens" },
  openrouter: { label: "OpenRouter", capabilities: ["extraction"], keyEnv: ["OPENROUTER_API_KEY"], baseURL: "https://openrouter.ai/api/v1", tokenParam: "max_tokens" },
  nvidia: { label: "NVIDIA NIM", capabilities: ["extraction"], keyEnv: ["NVIDIA_API_KEY"], baseURL: "https://integrate.api.nvidia.com/v1", tokenParam: "max_tokens" },
  huggingface: { label: "Hugging Face", capabilities: ["extraction"], keyEnv: ["HUGGINGFACE_API_KEY", "HF_TOKEN"], baseURL: "https://router.huggingface.co/v1", tokenParam: "max_tokens" },
};

export const providersFor = (cap: Capability): ProviderId[] => PROVIDER_IDS.filter((id) => PROVIDERS[id].capabilities.includes(cap));

type Env = Record<string, string | undefined>;
/** First non empty key among the provider's env variables. Reads only what the caller passes in. */
export function keyFor(id: ProviderId, env: Env): string | undefined {
  for (const name of PROVIDERS[id].keyEnv) { const v = env[name]; if (v) return v; }
  return undefined;
}

export interface ProviderSelection { transcription: ProviderId; extraction: ProviderId; extractionModel?: string; transcriptionModel?: string }
/**
 * Checks the chosen providers and returns a list of plain English problems.
 * Only the keys for the SELECTED providers are required, never the others.
 */
export function validateSelection(sel: ProviderSelection, env: Env): string[] {
  const problems: string[] = [];
  if (!PROVIDERS[sel.transcription].capabilities.includes("transcription"))
    problems.push(`TRANSCRIPTION_PROVIDER=${sel.transcription} cannot transcribe audio here. Supported: ${providersFor("transcription").join(", ")}`);
  if (!PROVIDERS[sel.extraction].capabilities.includes("extraction"))
    problems.push(`EXTRACTION_PROVIDER=${sel.extraction} cannot extract tasks here. Supported: ${providersFor("extraction").join(", ")}`);
  const needs: Array<[ProviderId, string]> = [[sel.transcription, "TRANSCRIPTION_PROVIDER"], [sel.extraction, "EXTRACTION_PROVIDER"]];
  const seen = new Set<string>();
  for (const [id, why] of needs) {
    if (!keyFor(id, env)) {
      const name = PROVIDERS[id].keyEnv[0]!;
      if (!seen.has(name)) problems.push(`${name} is required because ${why} is ${id}`);
      seen.add(name);
    }
  }
  // OpenAI has a built in default (whisper-1); every other transcription provider needs an explicit model.
  if (sel.transcription !== "openai" && !sel.transcriptionModel) problems.push(`TRANSCRIPTION_MODEL is required because TRANSCRIPTION_PROVIDER is ${sel.transcription} (set a speech model that provider serves)`);
  if (!sel.extractionModel) problems.push(sel.extraction === "anthropic" ? "ANTHROPIC_MODEL is required because EXTRACTION_PROVIDER is anthropic (set a currently supported model)" : `EXTRACTION_MODEL is required because EXTRACTION_PROVIDER is ${sel.extraction} (set a model ID that provider serves)`);
  return problems;
}

export interface FallbackSelection { transcription?: { provider: ProviderId; model?: string }; extraction?: { provider: ProviderId; model?: string } }
/** Checks the optional backup providers. A backup must be able to do the step, have a key, have a model, and differ from the main provider. */
export function validateFallback(main: ProviderSelection, fb: FallbackSelection, env: Env): string[] {
  const problems: string[] = [];
  const one = (step: Capability, f: { provider: ProviderId; model?: string } | undefined, mainId: ProviderId, name: string) => {
    if (!f) return;
    if (!PROVIDERS[f.provider].capabilities.includes(step)) problems.push(`${name}_PROVIDER=${f.provider} cannot do ${step === "transcription" ? "audio transcription" : "task extraction"} here. Supported: ${providersFor(step).join(", ")}`);
    if (!keyFor(f.provider, env)) problems.push(`${PROVIDERS[f.provider].keyEnv[0]} is required because ${name}_PROVIDER is ${f.provider}`);
    if (!f.model && !(step === "transcription" && f.provider === "openai")) problems.push(`${name}_MODEL is required because ${name}_PROVIDER is ${f.provider}`);
    if (f.provider === mainId) problems.push(`${name}_PROVIDER must be a different provider from the main ${step} provider (${mainId})`);
  };
  one("transcription", fb.transcription, main.transcription, "FALLBACK_TRANSCRIPTION");
  one("extraction", fb.extraction, main.extraction, "FALLBACK_EXTRACTION");
  return problems;
}
