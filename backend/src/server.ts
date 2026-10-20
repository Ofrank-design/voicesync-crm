import "dotenv/config";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { ProviderManager } from "./providers/manager";
import { SupabaseSettingsRepo } from "./services/settings-repo";
import { SupabaseUsageRepo } from "./services/usage-repo";
import { SupabaseTaskRepo } from "./services/task-repo";
import { cachedAuthenticator, localAuthenticator, supabaseAuthenticator } from "./auth";
import { makeLogger } from "./lib/logger";
import { Metrics } from "./lib/metrics";
import { Lifecycle, installShutdown } from "./lib/lifecycle";

const config = (() => { try { return loadConfig(); } catch (e) { console.error((e as Error).message); return process.exit(1); } })();

const repo = new SupabaseTaskRepo(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const log = makeLogger(config.LOG_LEVEL ?? "info");
const auth = config.AUTH_MODE === "local" ? localAuthenticator(config.LOCAL_DEV_USER_ID) : cachedAuthenticator(supabaseAuthenticator(repo.client), { ttlMs: config.AUTH_CACHE_SECONDS * 1000 });
if (config.AUTH_MODE === "local") log.warn("AUTH_MODE=local: every request acts as one dev user. Never use this in production.");
if (config.STORE_TRANSCRIPTS) log.warn("STORE_TRANSCRIPTS is on: transcripts are saved with tasks. Make sure your privacy notice says so.");

async function main() {
  const usage = new SupabaseUsageRepo(repo.client);
  const accounts = config.AUTH_MODE === "local" ? undefined : { deleteUser: async (id: string) => { const { error } = await repo.client.auth.admin.deleteUser(id); if (error) throw new Error("could not delete user"); } };
  const metrics = new Metrics(); const lifecycle = new Lifecycle();
  const manager = new ProviderManager(config, new SupabaseSettingsRepo(repo.client), {}, undefined, { usage, metrics, log });
  try { await manager.init(); } catch { log.warn("Could not read saved provider settings. Using the server settings."); }
  if (manager.notice) log.warn(manager.notice);
  const s = manager.summary;
  log.info("providers", { transcription: s.transcription.id, extraction: s.extraction.id, source: manager.source });
  const app = createApp({ config, auth, repo, transcriber: manager, extractor: manager, providerAdmin: { manager }, usage, accounts, logger: log, metrics, lifecycle });
  const server = app.listen(config.API_PORT, () => log.info("listening", { port: config.API_PORT }));
  server.requestTimeout = 150_000; server.headersTimeout = 30_000; server.keepAliveTimeout = 65_000;
  installShutdown({ server, lifecycle, log, timeoutMs: config.SHUTDOWN_TIMEOUT_SECONDS * 1000 });
}
void main();
