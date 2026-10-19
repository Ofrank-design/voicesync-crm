import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/config";
import { env } from "./helpers";
import { PROVIDERS, providersFor, validateSelection } from "../src/providers/registry";
import { buildProviders } from "../src/providers";
import { createOpenAICompatibleExtractor, stripReasoning, type ChatClient } from "../src/providers/openai-compatible";
import { createTranscriber, mapUpstream } from "../src/services/transcription";
import { buildDateContext } from "../src/lib/dates";
import { detectAudioFormat, type DetectedAudio } from "../src/lib/audio";
import { WEBM } from "./helpers";

const ctx = buildDateContext({ referenceDate: "2026-10-14", timezone: "UTC", appTimezone: "UTC" });
const good = { client_name: "Daniel", location: "East Legon", action_item: "Call about quotation", follow_up_date: "2026-10-16", priority: "medium" };
const webm: DetectedAudio = { ext: "webm", mime: "audio/webm" };
const sttClient = (...results: any[]) => { const create = vi.fn(); for (const r of results) { if (r instanceof Error) create.mockRejectedValueOnce(r); else create.mockResolvedValueOnce(r); } return { create, client: { audio: { transcriptions: { create } } } as any }; };
const chatWith = (content: unknown) => ({ chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content }, finish_reason: "stop" }] }) } } }) as unknown as ChatClient;
const base = { ...env, OPENAI_API_KEY: "sk-openai", GROQ_API_KEY: "gsk-groq" } as Record<string, string>;

describe.each(providersFor("transcription"))("transcription contract: %s", (id) => {
  const make = (c: ReturnType<typeof sttClient>) => createTranscriber({ apiKey: "k", model: "stt-model", client: c.client });
  it("uploads the audio as a named file with the right type and the chosen model", async () => {
    const c = sttClient({ text: "  Call Daniel on Friday  " });
    expect(await make(c).transcribe(WEBM, webm)).toBe("Call Daniel on Friday");
    const body = c.create.mock.calls[0]![0];
    expect(body.model).toBe("stt-model");
    expect(body.file.name).toBe("recording.webm"); expect(body.file.type).toBe("audio/webm");
  });
  it("treats silence as a clear 422, not a blank task", async () => {
    await expect(make(sttClient({ text: "   " })).transcribe(WEBM, webm)).rejects.toMatchObject({ status: 422, code: "empty_transcript" });
  });
  it("maps upstream failures and never leaks the provider message", async () => {
    for (const [status, code] of [[429, "upstream_rate_limited"], [401, "transcription_misconfigured"], [402, "transcription_billing"], [404, "transcription_model_not_found"], [413, "transcription_rejected"], [503, "transcription_unavailable"]] as const) {
      const e = await make(sttClient(Object.assign(new Error("sk-leak raw body"), { status }))).transcribe(WEBM, webm).catch((x) => x);
      expect(e.code).toBe(code); expect(e.message).not.toMatch(/sk-leak|raw body/);
    }
  });
  it("accepts every audio container the server can detect", () => {
    expect([...(PROVIDERS[id].audioFormats ?? [])].sort()).toEqual(["flac", "mp3", "mp4", "ogg", "wav", "webm"]);
  });
  it("passes cancellation through", async () => {
    const c = sttClient({ text: "hi" }); const ctl = new AbortController();
    await make(c).transcribe(WEBM, webm, ctl.signal);
    expect(c.create.mock.calls[0]![1].signal).toBe(ctl.signal);
  });
});

describe("transcription provider selection", () => {
  it("Groq transcription needs its own key and an explicit model", () => {
    expect(() => loadConfig({ ...env, TRANSCRIPTION_PROVIDER: "groq" })).toThrow(/GROQ_API_KEY/);
    expect(() => loadConfig({ ...base, TRANSCRIPTION_PROVIDER: "groq" } as NodeJS.ProcessEnv)).toThrow(/TRANSCRIPTION_MODEL is required/);
    expect(() => loadConfig({ ...base, TRANSCRIPTION_PROVIDER: "groq", TRANSCRIPTION_MODEL: "stt-model" } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it("OpenAI keeps its default speech model", () => {
    expect(validateSelection({ transcription: "openai", extraction: "anthropic", extractionModel: "m" }, { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" })).toEqual([]);
  });
  it("providers without an audio integration are refused, not silently swapped", () => {
    for (const p of ["gemini", "openrouter", "nvidia", "huggingface", "anthropic"]) expect(() => loadConfig({ ...base, TRANSCRIPTION_PROVIDER: p } as NodeJS.ProcessEnv)).toThrow(/cannot transcribe audio here. Supported: openai, groq/);
  });
  it("validates a custom speech base URL", () => {
    expect(() => loadConfig({ ...base, TRANSCRIPTION_PROVIDER: "groq", TRANSCRIPTION_MODEL: "m", TRANSCRIPTION_BASE_URL: "groq.internal" } as NodeJS.ProcessEnv)).toThrow(/TRANSCRIPTION_BASE_URL/);
  });
  it("Groq uses its own base URL, key and model, and mixes freely with any extraction provider", async () => {
    const seen: Array<[string | undefined, string]> = []; const stt = sttClient({ text: "hello there" });
    const b = buildProviders(loadConfig({ ...base, TRANSCRIPTION_PROVIDER: "groq", TRANSCRIPTION_MODEL: "stt-model", EXTRACTION_PROVIDER: "openai", EXTRACTION_MODEL: "m" } as NodeJS.ProcessEnv), { transcriptionClient: (u, k) => { seen.push([u, k]); return stt.client; }, chatClient: () => chatWith(JSON.stringify(good)) });
    expect(await b.transcriber.transcribe(WEBM, webm)).toBe("hello there");
    expect(seen).toEqual([[PROVIDERS.groq.baseURL, "gsk-groq"]]);
    expect(stt.create.mock.calls[0]![0].model).toBe("stt-model");
    expect(b.summary.transcription).toEqual({ id: "groq", label: "Groq" });
  });
  it("OpenAI transcription uses the SDK default endpoint and the default model", async () => {
    const seen: Array<[string | undefined, string]> = []; const stt = sttClient({ text: "x" });
    const b = buildProviders(loadConfig(env), { transcriptionClient: (u, k) => { seen.push([u, k]); return stt.client; } });
    await b.transcriber.transcribe(WEBM, webm);
    expect(seen[0]![0]).toBeUndefined(); expect(stt.create.mock.calls[0]![0].model).toBe("whisper-1");
  });
  it("rejects an audio container the provider does not accept before uploading anything", async () => {
    const stt = sttClient({ text: "x" });
    const b = buildProviders(loadConfig(env), { transcriptionClient: () => stt.client });
    await expect(b.transcriber.transcribe(WEBM, { ext: "aac" as never, mime: "audio/aac" })).rejects.toMatchObject({ status: 415, code: "unsupported_audio" });
    expect(stt.create).not.toHaveBeenCalled();
  });
  it("the container detector only yields formats the providers accept", () => {
    const samples: Buffer[] = [WEBM, Buffer.concat([Buffer.from("OggS"), Buffer.alloc(20)]), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(20)]), Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(20)]), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]), Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(20)])];
    for (const s of samples) expect(PROVIDERS.groq.audioFormats).toContain(detectAudioFormat(s)!.ext);
  });
});

describe("real world quirks of OpenAI style providers", () => {
  const run = (content: unknown) => createOpenAICompatibleExtractor({ apiKey: "k", baseURL: "https://x/v1", model: "m", client: chatWith(content), maxAttempts: 1 }).extract("t", ctx);
  it("ignores a leading <think> block from reasoning models", async () => {
    expect((await run("<think>The user wants Friday, which is the 16th...</think>\n" + JSON.stringify(good))).task).toEqual(good);
    expect((await run("  <THINK>\nmulti\nline\n</THINK>" + JSON.stringify(good))).task.client_name).toBe("Daniel");
  });
  it("only strips a complete block at the start, so broken answers still fail", async () => {
    expect(stripReasoning("answer <think>x</think>")).toBe("answer <think>x</think>");
    expect(stripReasoning("<think>never closed " + JSON.stringify(good))).toContain("<think>");
    await expect(run("<think>never closed " + JSON.stringify(good))).rejects.toMatchObject({ code: "extraction_invalid_json" });
    await expect(run("<think>ok</think> sure! " + JSON.stringify(good))).rejects.toMatchObject({ code: "extraction_invalid_json" });
  });
  it("accepts content delivered as a list of text parts", async () => {
    expect((await run([{ type: "text", text: JSON.stringify(good).slice(0, 20) }, { type: "text", text: JSON.stringify(good).slice(20) }])).task).toEqual(good);
  });
  it("treats a non text content value as an invalid answer, not a crash", async () => {
    await expect(run({ weird: true })).rejects.toMatchObject({ code: "extraction_invalid_json" });
  });
  it("gives actionable errors for the two most common wiring mistakes", () => {
    expect(mapUpstream(Object.assign(new Error("x"), { status: 404 }), "extraction")).toMatchObject({ code: "extraction_model_not_found", message: expect.stringMatching(/model ID/) });
    expect(mapUpstream(Object.assign(new Error("x"), { status: 402 }), "extraction")).toMatchObject({ code: "extraction_billing", message: expect.stringMatching(/billing/) });
  });
});
