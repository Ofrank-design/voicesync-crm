import type OpenAI from "openai";
import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { createExtractor, type TaskExtractor } from "../services/task-extractor";
import { createTranscriber, type Transcriber } from "../services/transcription";
import { createOpenAICompatibleExtractor, type ChatClient } from "./openai-compatible";
import { PROVIDERS, keyFor, providersFor, validateSelection, type ProviderId } from "./registry";

export interface ProviderInfo { id: ProviderId; label: string }
/** Safe to show to users and to return from the health endpoint: names only, never keys or models. */
export interface ProviderSummary { transcription: ProviderInfo; extraction: ProviderInfo }
export interface ProviderHealth extends ProviderSummary { configured: boolean; supported: { transcription: ProviderId[]; extraction: ProviderId[] } }

export interface BuiltProviders { transcriber: Transcriber; extractor: TaskExtractor; summary: ProviderSummary }
export interface BuildHooks { chatClient?: (baseURL: string, apiKey: string) => ChatClient; transcriptionClient?: (baseURL: string | undefined, apiKey: string) => OpenAI }

const info = (id: ProviderId): ProviderInfo => ({ id, label: PROVIDERS[id].label });
export const envFromConfig = (c: Config): Record<string, string | undefined> => ({
  OPENAI_API_KEY: c.OPENAI_API_KEY, ANTHROPIC_API_KEY: c.ANTHROPIC_API_KEY, GEMINI_API_KEY: c.GEMINI_API_KEY, GROQ_API_KEY: c.GROQ_API_KEY,
  OPENROUTER_API_KEY: c.OPENROUTER_API_KEY, NVIDIA_API_KEY: c.NVIDIA_API_KEY, HUGGINGFACE_API_KEY: c.HUGGINGFACE_API_KEY, HF_TOKEN: c.HF_TOKEN,
});
export const extractionModelFrom = (c: Config) => c.EXTRACTION_MODEL ?? (c.EXTRACTION_PROVIDER === "anthropic" ? c.ANTHROPIC_MODEL : undefined);

/** Builds only the selected providers. A provider's key is read only when that provider is selected. */
export function buildProviders(config: Config, hooks: BuildHooks = {}): BuiltProviders {
  const env = envFromConfig(config);
  const tId = config.TRANSCRIPTION_PROVIDER, eId = config.EXTRACTION_PROVIDER;
  const tKey = keyFor(tId, env), eKey = keyFor(eId, env), model = extractionModelFrom(config);
  if (!tKey || !eKey || !model) throw new Error("Provider configuration is incomplete. Run loadConfig first, it checks this.");

  const tSpec = PROVIDERS[tId];
  const tBase = config.TRANSCRIPTION_BASE_URL ?? (tId === "openai" ? undefined : tSpec.baseURL);
  const tModel = config.TRANSCRIPTION_MODEL ?? (tId === "openai" ? config.OPENAI_TRANSCRIPTION_MODEL : undefined);
  if (!tModel) throw new Error("Provider configuration is incomplete. Run loadConfig first, it checks this.");
  const inner = createTranscriber({ apiKey: tKey, model: tModel, baseURL: tBase, client: hooks.transcriptionClient?.(tBase, tKey) });
  // Refuse formats this provider does not accept, with a clear message, before any audio is uploaded.
  const transcriber: Transcriber = {
    check: (signal) => inner.check?.(signal) ?? Promise.resolve(),
    transcribe(audio, format, signal) {
      if (!tSpec.audioFormats?.includes(format.ext)) return Promise.reject(new AppError(415, "unsupported_audio", `${tSpec.label} cannot read ${format.ext.toUpperCase()} audio. Try recording again in a different format.`));
      return inner.transcribe(audio, format, signal);
    },
  };

  let extractor: TaskExtractor;
  if (eId === "anthropic") extractor = createExtractor({ apiKey: eKey, model });
  else {
    const spec = PROVIDERS[eId];
    const baseURL = config.EXTRACTION_BASE_URL ?? spec.baseURL!;
    extractor = createOpenAICompatibleExtractor({ apiKey: eKey, baseURL, model, tokenParam: spec.tokenParam, jsonMode: config.EXTRACTION_JSON_MODE, client: hooks.chatClient?.(baseURL, eKey) });
  }
  return { transcriber, extractor, summary: { transcription: info(tId), extraction: info(eId) } };
}

export interface Selection { transcription: ProviderId; transcriptionModel?: string; extraction: ProviderId; extractionModel?: string }

/** The provider choice that comes from the server environment. */
export function selectionFromConfig(c: Config): Selection {
  return {
    transcription: c.TRANSCRIPTION_PROVIDER, transcriptionModel: c.TRANSCRIPTION_MODEL ?? (c.TRANSCRIPTION_PROVIDER === "openai" ? c.OPENAI_TRANSCRIPTION_MODEL : undefined),
    extraction: c.EXTRACTION_PROVIDER, extractionModel: extractionModelFrom(c),
  };
}
/** Same checks loadConfig runs at startup, for a choice made in the settings screen. Returns plain English problems. */
export function problemsFor(c: Config, s: Selection): string[] {
  return validateSelection({ transcription: s.transcription, transcriptionModel: s.transcriptionModel, extraction: s.extraction, extractionModel: s.extractionModel }, envFromConfig(c));
}
/** Builds providers for a choice made at runtime. Keys still come from the server environment, never from the caller. */
export function buildFromSelection(c: Config, s: Selection, hooks: BuildHooks = {}): BuiltProviders {
  return buildProviders({ ...c, TRANSCRIPTION_PROVIDER: s.transcription, TRANSCRIPTION_MODEL: s.transcriptionModel, EXTRACTION_PROVIDER: s.extraction, EXTRACTION_MODEL: s.extractionModel }, hooks);
}

export function providerHealth(summary: ProviderSummary): ProviderHealth {
  return { ...summary, configured: true, supported: { transcription: providersFor("transcription"), extraction: providersFor("extraction") } };
}
