import OpenAI from "openai";
import { createExtractorFromCompletion, type TaskExtractor } from "../services/task-extractor";
import { noteTokens } from "../lib/request-context";

/** Minimal shape of the chat completions client, so tests can pass a mock. */
export interface ChatClient {
  chat: { completions: { create(body: any, opts?: any): Promise<{ choices: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> | null; refusal?: string | null }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }> } };
}

export interface OpenAICompatibleOptions {
  apiKey: string; baseURL: string; model: string;
  tokenParam?: "max_tokens" | "max_completion_tokens";
  /** Ask the endpoint for JSON mode. Off by default because support varies by provider and model. */
  jsonMode?: boolean; maxAttempts?: number; timeoutMs?: number; client?: ChatClient;
}

/** Some providers return content as a list of parts instead of one string. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}
/**
 * Reasoning models served by several of these providers print their thinking in a leading <think> block before the answer.
 * Only a complete block at the very start is removed, and nothing else is touched, so a broken answer still fails validation.
 */
export const stripReasoning = (t: string) => t.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");

/** Extraction through any chat completions endpoint that follows the OpenAI request shape. */
export function createOpenAICompatibleExtractor(o: OpenAICompatibleOptions): TaskExtractor {
  const client: ChatClient = o.client ?? (new OpenAI({ apiKey: o.apiKey, baseURL: o.baseURL, timeout: o.timeoutMs ?? 30_000, maxRetries: 2 }) as unknown as ChatClient);
  return createExtractorFromCompletion(async (system, user, signal) => {
    const body: Record<string, unknown> = { model: o.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], [o.tokenParam ?? "max_tokens"]: 1500 };
    if (o.jsonMode) body.response_format = { type: "json_object" };
    const res = await client.chat.completions.create(body, { signal });
    noteTokens(res.usage?.prompt_tokens, res.usage?.completion_tokens);
    const choice = res.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") return { text: "", refused: true };
    return { text: stripReasoning(textOf(choice?.message?.content)) };
  }, { maxAttempts: o.maxAttempts });
}
