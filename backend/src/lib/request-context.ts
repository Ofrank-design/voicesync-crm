import { AsyncLocalStorage } from "node:async_hooks";

export interface ProviderRef { id: string; label: string }
/** Per request facts that providers and usage tracking share without changing every function signature. */
export interface RequestMeta {
  userId?: string; requestId?: string; audioSeconds?: number;
  used: { transcription?: ProviderRef; extraction?: ProviderRef };
  fallbackUsed: boolean;
  tokens: { input: number; output: number };   // for the attempt in progress
}
const als = new AsyncLocalStorage<RequestMeta>();
export const newMeta = (init: Partial<RequestMeta> = {}): RequestMeta => ({ used: {}, fallbackUsed: false, tokens: { input: 0, output: 0 }, ...init });
export const runWithMeta = <T>(meta: RequestMeta, fn: () => T): T => als.run(meta, fn);
export const currentMeta = () => als.getStore();
/** Adapters call this with the token counts a provider reports. Adds up across retries inside one attempt. */
export function noteTokens(input?: number, output?: number) {
  const m = als.getStore(); if (!m) return;
  if (Number.isFinite(input)) m.tokens.input += input!;
  if (Number.isFinite(output)) m.tokens.output += output!;
}
