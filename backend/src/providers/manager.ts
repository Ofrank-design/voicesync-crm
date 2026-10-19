import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { buildDateContext } from "../lib/dates";
import { currentMeta } from "../lib/request-context";
import type { TaskExtractor } from "../services/task-extractor";
import type { Transcriber } from "../services/transcription";
import type { SettingsRepo } from "../services/settings-repo";
import type { UsageRepo } from "../services/usage-repo";
import type { Metrics } from "../lib/metrics";
import type { Logger } from "../lib/logger";
import { CircuitBreaker } from "../resilience/breaker";
import { countsAgainstBreaker, fallbackEligible } from "../resilience/classify";
import { buildFromSelection, envFromConfig, problemsFor, selectionFromConfig, type BuildHooks, type BuiltProviders, type ProviderSummary, type Selection } from "./index";
import { PROVIDERS, PROVIDER_IDS, keyFor, type ProviderId } from "./registry";

export type Step = "transcription" | "extraction";
export interface TestResult { ok: boolean; step: Step; provider: ProviderId; label: string; ms: number; message: string; code?: string }
export type Builder = (c: Config, s: Selection, h?: BuildHooks) => BuiltProviders;
export interface ManagerExtras { usage?: UsageRepo; now?: () => number; metrics?: Metrics; log?: Logger }
interface Backup { id: ProviderId; model?: string; built: BuiltProviders }

/**
 * Holds the providers that are active right now, lets an admin change them while the server runs, and wraps every call with
 * a circuit breaker, an optional explicit backup provider, and usage recording.
 * Calls in flight keep the provider they started with. Only the choice is stored, never keys.
 */
export class ProviderManager implements Transcriber, TaskExtractor {
  private built!: BuiltProviders;
  private sel!: Selection;
  private src: "server" | "saved" = "server";
  private breakers = new Map<string, CircuitBreaker>();
  private backups: { transcription?: Backup; extraction?: Backup } = {};
  notice: string | null = null;

  constructor(private config: Config, private settings: SettingsRepo, private hooks: BuildHooks = {}, private builder: Builder = buildFromSelection, private extras: ManagerExtras = {}) {
    this.use(selectionFromConfig(config), "server");
    const base = selectionFromConfig(config);
    if (config.FALLBACK_TRANSCRIPTION_PROVIDER) this.backups.transcription = { id: config.FALLBACK_TRANSCRIPTION_PROVIDER, model: config.FALLBACK_TRANSCRIPTION_MODEL, built: builder(config, { ...base, transcription: config.FALLBACK_TRANSCRIPTION_PROVIDER, transcriptionModel: config.FALLBACK_TRANSCRIPTION_MODEL }, hooks) };
    if (config.FALLBACK_EXTRACTION_PROVIDER) this.backups.extraction = { id: config.FALLBACK_EXTRACTION_PROVIDER, model: config.FALLBACK_EXTRACTION_MODEL, built: builder(config, { ...base, extraction: config.FALLBACK_EXTRACTION_PROVIDER, extractionModel: config.FALLBACK_EXTRACTION_MODEL }, hooks) };
  }
  private use(sel: Selection, src: "server" | "saved") { this.built = this.builder(this.config, sel, this.hooks); this.sel = sel; this.src = src; }

  get selection(): Selection { return this.sel; }
  get source() { return this.src; }
  get summary(): ProviderSummary { return this.built.summary; }
  defaults(): Selection { return selectionFromConfig(this.config); }

  // ---- calls, with breaker, backup and usage ----
  transcribe(...a: Parameters<Transcriber["transcribe"]>) { return this.run("transcription", (b) => b.transcriber.transcribe(...a)); }
  extract(...a: Parameters<TaskExtractor["extract"]>) { return this.run("extraction", (b) => b.extractor.extract(...a)); }

  private breaker(step: Step, id: ProviderId) {
    const k = `${step}:${id}`; let b = this.breakers.get(k);
    if (!b) { b = new CircuitBreaker({ failureThreshold: this.config.BREAKER_FAILURES, cooldownMs: this.config.BREAKER_COOLDOWN_SECONDS * 1000, now: this.extras.now }); this.breakers.set(k, b); }
    return b;
  }
  private async run<T>(step: Step, call: (b: BuiltProviders) => Promise<T>): Promise<T> {
    const primary = this.built, sel = this.sel;
    const id = step === "transcription" ? sel.transcription : sel.extraction;
    const model = step === "transcription" ? sel.transcriptionModel : sel.extractionModel;
    try { return await this.attempt(step, id, model, primary, call, false); }
    catch (err) {
      const e = err instanceof AppError ? err : new AppError(500, "internal_error", "Something went wrong on our side. Please try again.");
      const backup = this.backups[step];
      if (backup && backup.id !== id && fallbackEligible(e.code)) {
        const m = currentMeta(); if (m) m.fallbackUsed = true;
        return await this.attempt(step, backup.id, backup.model, backup.built, call, true);
      }
      throw e;
    }
  }
  private async attempt<T>(step: Step, id: ProviderId, model: string | undefined, built: BuiltProviders, call: (b: BuiltProviders) => Promise<T>, fallback: boolean): Promise<T> {
    const br = this.breaker(step, id), t0 = (this.extras.now ?? Date.now)(), meta = currentMeta();
    if (!br.allow()) {
      const e = new AppError(503, `${step}_circuit_open`, `The ${PROVIDERS[id].label} service has been failing, so VoiceSync is pausing it for a moment. Please try again in about ${br.retryInSeconds()} seconds.`);
      await this.record(step, id, model, false, e.code, 0, fallback);
      throw e;
    }
    if (meta) meta.tokens = { input: 0, output: 0 };
    try {
      const v = await call(built);
      br.success();
      if (meta) meta.used[step] = { id, label: PROVIDERS[id].label };
      await this.record(step, id, model, true, undefined, (this.extras.now ?? Date.now)() - t0, fallback);
      return v;
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError(500, "internal_error", "Something went wrong on our side. Please try again.");
      if (countsAgainstBreaker(e.code)) br.failure(); else br.release();
      await this.record(step, id, model, false, e.code, (this.extras.now ?? Date.now)() - t0, fallback);
      throw e;
    }
  }
  private async record(step: Step, id: ProviderId, model: string | undefined, ok: boolean, code: string | undefined, ms: number, fallback: boolean) {
    this.extras.metrics?.inc("ai_calls_total", "Calls to AI providers", { step, provider: id, outcome: ok ? "ok" : (code ?? "error"), fallback: String(fallback) });
    if (ms > 0) this.extras.metrics?.observe("ai_call_duration_seconds", "AI provider call time in seconds", { step, provider: id }, ms / 1000);
    const m = currentMeta(); if (!this.extras.usage || !m?.userId) return;
    try {
      await this.extras.usage.record({
        user_id: m.userId, request_id: m.requestId, at: new Date().toISOString(), step, provider: id, model, ok, error_code: code, fallback, duration_ms: Math.round(ms),
        audio_seconds: m.audioSeconds,
        ...(step === "extraction" ? { input_tokens: m.tokens.input || undefined, output_tokens: m.tokens.output || undefined } : {}),
      });
    } catch { this.extras.log?.warn("could not record usage"); }
  }

  /** Apply a choice saved earlier. If it no longer works (for example a key was removed) the server settings stay in charge. */
  async init() {
    const saved = await this.settings.get();
    if (!saved) return;
    const problems = this.problems(saved);
    if (problems.length) { this.notice = `Saved provider settings were ignored: ${problems.join("; ")}`; return; }
    this.use(saved, "saved");
  }
  private problems(sel: Selection): string[] {
    const p = problemsFor(this.config, sel);
    if (this.backups.transcription?.id === sel.transcription) p.push("The speech provider is also the backup. Choose a different one, or remove FALLBACK_TRANSCRIPTION_PROVIDER.");
    if (this.backups.extraction?.id === sel.extraction) p.push("The task provider is also the backup. Choose a different one, or remove FALLBACK_EXTRACTION_PROVIDER.");
    return p;
  }
  /** Checks the choice the same way startup does and throws a 400 listing every problem. */
  validate(sel: Selection) {
    const problems = this.problems(sel);
    if (problems.length) throw new AppError(400, "invalid_provider_selection", "Those provider settings cannot be used yet.", problems);
  }
  async apply(sel: Selection, userId: string) {
    this.validate(sel);
    const candidate = this.builder(this.config, sel, this.hooks);   // build first so a bad choice never replaces a good one
    await this.settings.save(sel, userId);                           // persist before switching, so a failed save changes nothing
    this.built = candidate; this.sel = sel; this.src = "saved"; this.notice = null;
  }
  async reset() {
    await this.settings.clear();
    this.use(selectionFromConfig(this.config), "server"); this.notice = null;
  }

  /** Runs a real check without changing what is active. Never returns raw provider errors. Not counted against breakers or usage. */
  async test(step: Step, candidate?: Partial<Selection>): Promise<TestResult> {
    const sel: Selection = { ...this.sel, ...candidate };
    const provider = step === "transcription" ? sel.transcription : sel.extraction;
    const base = { step, provider, label: PROVIDERS[provider].label };
    const started = Date.now();
    try {
      this.validate(sel);
      const b = this.builder(this.config, sel, this.hooks);
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20_000);
      try {
        if (step === "transcription") {
          if (!b.transcriber.check) throw new AppError(501, "check_unavailable", "This provider cannot be checked without audio.");
          await b.transcriber.check(ctl.signal);
          return { ...base, ok: true, ms: Date.now() - started, message: "The key works and the model exists. No audio was sent." };
        }
        await b.extractor.extract("Call Test Client tomorrow about the quote.", buildDateContext({ referenceDate: "2026-01-05", timezone: "UTC", appTimezone: "UTC" }), ctl.signal);
        return { ...base, ok: true, ms: Date.now() - started, message: "The model answered with a valid task." };
      } finally { clearTimeout(timer); }
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError(500, "internal_error", "The test could not run.");
      const message = e.code === "invalid_provider_selection" && Array.isArray(e.details) ? (e.details as string[]).join(" ") : e.message;
      return { ...base, ok: false, ms: Date.now() - started, message, code: e.code };
    }
  }

  /** Circuit state of the providers in use, safe for the health endpoint. */
  reliability() {
    const t = this.sel.transcription, e = this.sel.extraction;
    return {
      breakers: { transcription: { provider: t, state: this.breaker("transcription", t).state }, extraction: { provider: e, state: this.breaker("extraction", e).state } },
      backups: { transcription: this.backups.transcription?.id ?? null, extraction: this.backups.extraction?.id ?? null },
    };
  }

  /** What the settings screen shows. Key presence only, never a key. */
  status() {
    const env = envFromConfig(this.config);
    return {
      source: this.src, notice: this.notice,
      active: { transcription: { id: this.sel.transcription, label: PROVIDERS[this.sel.transcription].label, model: this.sel.transcriptionModel ?? null }, extraction: { id: this.sel.extraction, label: PROVIDERS[this.sel.extraction].label, model: this.sel.extractionModel ?? null } },
      server_defaults: this.defaults(),
      providers: PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label, capabilities: PROVIDERS[id].capabilities, key_env: PROVIDERS[id].keyEnv[0]!, key_set: !!keyFor(id, env), needs_model: !(id === "openai") })),
    };
  }
}
