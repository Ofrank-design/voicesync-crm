import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { Config } from "./config";
import { AppError, badRequest, notFound } from "./lib/errors";
import { detectAudioFormat } from "./lib/audio";
import { buildDateContext, todayIn } from "./lib/dates";
import { ListQuerySchema, TaskCreateSchema, TaskPatchSchema } from "./lib/schema";
import { requireAuth, type Authenticator } from "./auth";
import type { Transcriber } from "./services/transcription";
import type { TaskExtractor } from "./services/task-extractor";
import type { TaskRepo } from "./services/task-repo";
import { probeDuration as defaultProbe, type DurationProbe } from "./lib/duration";
import { providerHealth, type ProviderSummary } from "./providers";
import type { ProviderManager } from "./providers/manager";
import { PROVIDER_IDS } from "./providers/registry";
import { Limiter } from "./resilience/limiter";
import { makeLogger, silentLogger, type Logger } from "./lib/logger";
import { Metrics } from "./lib/metrics";
import type { Lifecycle } from "./lib/lifecycle";
import { createHash, timingSafeEqual } from "node:crypto";
import { ResultCache } from "./resilience/idempotency";
import { newMeta, runWithMeta } from "./lib/request-context";
import { nextUtcMidnight, startOfUtcDay, summarize, todayTotals, toCsv, type UsageRepo } from "./services/usage-repo";

export interface Deps { config: Config; auth: Authenticator; transcriber: Transcriber; extractor: TaskExtractor; repo: TaskRepo; probeDuration?: DurationProbe; providers?: ProviderSummary; providerAdmin?: { manager: ProviderManager }; usage?: UsageRepo; accounts?: { deleteUser(userId: string): Promise<void> }; logger?: Logger; metrics?: Metrics; lifecycle?: Lifecycle }

export function createApp({ config, auth, transcriber, extractor, repo, probeDuration = defaultProbe, providers, providerAdmin, usage, accounts, logger, metrics: metricsIn, lifecycle }: Deps) {
  const log = logger ?? (config.NODE_ENV === "test" ? silentLogger : makeLogger(config.LOG_LEVEL ?? "info"));
  const metrics = metricsIn ?? new Metrics();
  const summary = (): ProviderSummary | undefined => providerAdmin?.manager.summary ?? providers;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: config.FRONTEND_ORIGIN, allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Progress"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
  app.use((req, res, next) => { req.requestId = randomUUID(); res.setHeader("X-Request-Id", req.requestId); next(); });
  // One structured log line and a metric per request. Never the query string, body, headers or user content.
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : "unmatched";
      const quiet = route === "/api/live" || route === "/api/ready" || route === "/metrics";
      (quiet ? log.debug : log.info)("request", { request_id: req.requestId, method: req.method, route, status: res.statusCode, duration_ms: Math.round(ms), user_id: req.userId });
      if (!quiet) { metrics.inc("http_requests_total", "HTTP requests handled", { method: req.method, route, status: String(res.statusCode) }); metrics.observe("http_request_duration_seconds", "HTTP request time in seconds", { method: req.method, route }, ms / 1000); }
    });
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  if (config.NODE_ENV !== "test") app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "You are going a little fast. Please wait a moment and try again." } } }));
  const heavyLimit = rateLimit({ windowMs: 60_000, limit: config.NODE_ENV === "test" ? 1000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "That is a lot of notes at once. Please wait a minute and try again." } } });

  const maxBytes = Math.floor(config.MAX_AUDIO_SIZE_MB * 1024 * 1024);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 10 } });
  const authed = requireAuth(auth);

  // Liveness: the process is up. Readiness: it can do real work (and is not shutting down). Point uptime monitors at /api/ready.
  app.get("/api/live", (_req, res) => { res.json({ status: "ok" }); });
  const readiness = async (_req: Request, res: Response) => {
    if (lifecycle?.draining) return void res.status(503).json({ status: "draining" });
    let database: "ok" | "unavailable" = "ok";
    try { await repo.ping(); } catch { database = "unavailable"; }
    res.status(database === "ok" ? 200 : 503).json({ status: database === "ok" ? "ok" : "degraded", services: { database }, ...(summary() ? { providers: { ...providerHealth(summary()!), ...(providerAdmin ? { reliability: providerAdmin.manager.reliability() } : {}) } } : {}), auth_mode: config.AUTH_MODE });
  };
  app.get("/api/ready", readiness);
  app.get("/api/health", readiness);

  const inFlight = new Set<string>();
  const limiter = new Limiter(config.AI_MAX_CONCURRENCY, config.AI_QUEUE_TIMEOUT_MS);
  metrics.gauge("voice_notes_in_flight", "Voice notes being processed now", () => [[{}, limiter.stats.active]]);
  metrics.gauge("voice_notes_queued", "Voice notes waiting for a slot", () => [[{}, limiter.stats.queued]]);
  metrics.gauge("provider_circuit_state", "Circuit breaker state per provider: 0 closed, 1 half open, 2 open", () => {
    const r = providerAdmin?.manager.reliability(); if (!r) return [];
    const n = { closed: 0, half_open: 1, open: 2 } as const;
    return (["transcription", "extraction"] as const).map((st) => [{ step: st, provider: r.breakers[st].provider }, n[r.breakers[st].state]] as [Record<string, string>, number]);
  });
  metrics.gauge("process_uptime_seconds", "Seconds since the server started", () => [[{}, Math.round(process.uptime())]]);
  metrics.gauge("process_resident_memory_bytes", "Memory in use by the server", () => [[{}, process.memoryUsage().rss]]);
  if (config.METRICS_TOKEN) {
    const digest = (v: string) => createHash("sha256").update(v).digest();
    app.get("/metrics", (req, res) => {
      const given = (req.header("authorization") ?? "").replace(/^Bearer /i, "");
      if (!timingSafeEqual(digest(given), digest(config.METRICS_TOKEN!))) return void res.status(401).type("text/plain").send("unauthorized\n");
      res.type("text/plain; version=0.0.4").send(metrics.render());
    });
  }
  const results = new ResultCache<Record<string, unknown>>();
  const limits = { notes: config.USER_DAILY_NOTES || null, audio_minutes: config.USER_DAILY_AUDIO_MINUTES || null };
  /** Spend control. Counts successful notes only, so a failed attempt never uses up someone's allowance. */
  async function enforceDailyLimits(userId: string) {
    if (!usage || (!limits.notes && !limits.audio_minutes)) return;
    const t = todayTotals(await usage.since(startOfUtcDay(), userId));
    if (limits.notes && t.notes >= limits.notes) throw new AppError(429, "daily_limit_reached", `You have used all ${limits.notes} of today's voice notes. The count starts again at midnight UTC.`);
    if (limits.audio_minutes && t.audio_minutes >= limits.audio_minutes) throw new AppError(429, "daily_limit_reached", `You have used your ${limits.audio_minutes} minutes of audio for today. The count starts again at midnight UTC.`);
  }
  app.post("/api/voice-sync", authed, heavyLimit, upload.single("audio"), async (req, res) => {
    const userId = req.userId!;
    if (inFlight.has(userId)) throw new AppError(409, "duplicate_submission", "Your last note is still being processed. Give it a moment.");
    const file = req.file;
    if (!file || file.size === 0) throw badRequest("empty_audio", "That recording is empty.");
    const format = detectAudioFormat(file.buffer);
    if (!format) throw new AppError(415, "unsupported_audio", "We could not read that audio file. Use WebM, Ogg, MP4, M4A, WAV, MP3 or FLAC.");
    const reported = req.body?.duration_seconds ? Number(req.body.duration_seconds) : undefined;
    if (reported !== undefined && (!Number.isFinite(reported) || reported < 0)) throw badRequest("invalid_duration", "The recording length is not valid.");
    // Server-measured duration wins; the client value is only a fallback for containers without duration metadata.
    const measured = await probeDuration(file.buffer, format.mime);
    const dur = measured ?? reported;
    if (dur !== undefined && dur > config.MAX_RECORDING_SECONDS + 1) throw new AppError(413, "recording_too_long", `That recording is longer than the ${config.MAX_RECORDING_SECONDS} second limit.`);

    const ctx = buildDateContext({ timezone: req.body?.timezone, referenceDate: req.body?.reference_date, appTimezone: config.APP_TIMEZONE });
    const streaming = req.header("x-progress") === "stream";
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    const send = (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + "\n"); };
    const startStream = () => { res.status(200).setHeader("Content-Type", "application/x-ndjson"); res.setHeader("Cache-Control", "no-store"); res.flushHeaders(); };

    // A retry with the same Idempotency-Key gets the saved result back. No provider is called and nothing is counted again.
    const idemKey = req.header("idempotency-key")?.slice(0, 120);
    const saved = idemKey ? results.get(userId, idemKey) : undefined;
    if (saved) {
      res.setHeader("Idempotent-Replay", "true");
      if (streaming) { startStream(); send({ stage: "done", result: saved }); res.end(); } else res.json(saved);
      return;
    }
    await enforceDailyLimits(userId);                 // 429 before any provider is called
    const release = await limiter.acquire();          // 503 "busy" if the queue is too long
    const meta = newMeta({ userId, requestId: req.requestId, audioSeconds: dur });
    if (streaming) startStream();
    inFlight.add(userId);
    try {
      await runWithMeta(meta, async () => {
        if (streaming) send({ stage: "transcribing" });
        const transcript = await transcriber.transcribe(file.buffer, format, ac.signal);
        if (streaming) send({ stage: "extracting" });
        const { task, warnings } = await extractor.extract(transcript, ctx, ac.signal);
        const base = summary();
        const processed_by = base ? { transcription: meta.used.transcription ?? base.transcription, extraction: meta.used.extraction ?? base.extraction, ...(meta.fallbackUsed ? { fallback_used: true } : {}) } : undefined;
        const result: Record<string, unknown> = { request_id: req.requestId, transcript, task, status: "awaiting_review", reference_date: ctx.referenceDate, timezone: ctx.timezone, warnings, ...(processed_by ? { processed_by } : {}) };
        if (idemKey) results.set(userId, idemKey, result);
        if (streaming) { send({ stage: "done", result }); res.end(); } else res.json(result);
      });
    } catch (err) {
      if (!streaming) throw err; // regular JSON error path
      const e = err instanceof AppError ? err : new AppError(500, "internal_error", "Something went wrong on our side. Please try again.");
      if (!(err instanceof AppError)) log.error("unhandled error", { request_id: req.requestId, error: String((err as Error)?.message).slice(0, 200) });
      send({ stage: "error", error: { code: e.code, message: e.message, request_id: req.requestId } });
      res.end();
    } finally {
      release();
      inFlight.delete(userId);
      file.buffer = Buffer.alloc(0); // drop audio from memory; nothing was written to disk
    }
  });

  // ---- your data: download everything, or delete it ----
  const accountLimit = rateLimit({ windowMs: 60_000, limit: config.NODE_ENV === "test" ? 1000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "Please wait a minute and try again." } } });
  app.get("/api/me/export", authed, accountLimit, async (req, res) => {
    const [tasks, events] = await Promise.all([repo.exportAll(req.userId!), usage ? usage.since("1970-01-01T00:00:00.000Z", req.userId!) : Promise.resolve([])]);
    res.setHeader("Content-Disposition", 'attachment; filename="voicesync-my-data.json"'); res.setHeader("Cache-Control", "no-store");
    res.json({ exported_at: new Date().toISOString(), user_id: req.userId, tasks, usage: events });
  });
  app.delete("/api/me", authed, accountLimit, async (req, res) => {
    if (req.body?.confirm !== "DELETE") throw badRequest("confirmation_required", 'Type DELETE to confirm. This cannot be undone.');
    const uid = req.userId!;
    const tasks = await repo.deleteAll(uid);
    const usageRows = usage ? await usage.deleteForUser(uid) : 0;
    let account = false;
    if (accounts) { try { await accounts.deleteUser(uid); account = true; } catch { throw new AppError(502, "account_not_removed", "Your tasks and usage records were deleted, but we could not remove your login. Please ask the person who runs this service to remove it."); } }
    audit(req, "account.deleted", { tasks, usage: usageRows, account });
    res.json({ deleted: { tasks, usage: usageRows, account } });
  });

  app.get("/api/usage", authed, async (req, res) => {
    const t = usage ? todayTotals(await usage.since(startOfUtcDay(), req.userId!)) : { notes: 0, audio_minutes: 0 };
    res.json({ today: t, limits, resets_at: nextUtcMidnight() });
  });

  app.post("/api/tasks", authed, async (req, res) => {
    const input = TaskCreateSchema.parse(req.body);
    if (!config.STORE_TRANSCRIPTS) delete input.transcript;
    const key = req.header("idempotency-key")?.slice(0, 120);
    const { task, created } = await repo.create(req.userId!, input, key);
    res.status(created ? 201 : 200).json({ task, duplicate: !created });
  });

  app.get("/api/tasks/stats", authed, async (req, res) => {
    const tz = typeof req.query.timezone === "string" ? req.query.timezone : config.APP_TIMEZONE;
    const ctx = buildDateContext({ timezone: tz, appTimezone: config.APP_TIMEZONE });
    res.json({ today: todayIn(ctx.timezone), ...(await repo.stats(req.userId!, todayIn(ctx.timezone))) });
  });

  app.get("/api/tasks", authed, async (req, res) => {
    const q = ListQuerySchema.parse(req.query);
    const { items, total } = await repo.list(req.userId!, q);
    res.json({ items, total, page: q.page, page_size: q.page_size });
  });

  app.get("/api/tasks/:id", authed, async (req, res) => {
    const t = await repo.get(req.userId!, String(req.params.id));
    if (!t) throw notFound();
    res.json({ task: t });
  });

  app.patch("/api/tasks/:id", authed, async (req, res) => {
    const patch = TaskPatchSchema.parse(req.body);
    const t = await repo.update(req.userId!, String(req.params.id), patch);
    if (!t) throw notFound();
    res.json({ task: t });
  });

  app.delete("/api/tasks/:id", authed, async (req, res) => {
    if (!(await repo.remove(req.userId!, String(req.params.id)))) throw notFound();
    res.status(204).end();
  });

  // ---- who am I, and provider settings (admins only) ----
  const adminIds = (config.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const isAdmin = (uid: string) => adminIds.includes(uid) || (config.AUTH_MODE === "local" && uid === config.LOCAL_DEV_USER_ID);
  const adminOnly = (req: Request, _res: Response, next: NextFunction) => { if (!providerAdmin) return next(new AppError(404, "not_found", "That address does not exist.")); if (!isAdmin(req.userId!)) return next(new AppError(403, "forbidden", "Only admins can change provider settings.")); next(); };
  const adminLimit = rateLimit({ windowMs: 60_000, limit: config.NODE_ENV === "test" ? 1000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message: "That is a lot of tests at once. Please wait a minute and try again." } } });
  const SelectionBody = z.object({ transcription: z.enum(PROVIDER_IDS), transcription_model: z.string().trim().max(200).optional(), extraction: z.enum(PROVIDER_IDS), extraction_model: z.string().trim().max(200).optional() }).strict();
  const TestBody = z.object({ step: z.enum(["transcription", "extraction"]), provider: z.enum(PROVIDER_IDS).optional(), model: z.string().trim().max(200).optional() }).strict();
  const audit = (req: Request, evt: string, extra: object = {}) => log.info(evt, { audit: true, by: req.userId, request_id: req.requestId, ...extra });

  app.get("/api/me", authed, (req, res) => { res.json({ user_id: req.userId, is_admin: !!providerAdmin && isAdmin(req.userId!) }); });
  app.get("/api/admin/providers", authed, adminOnly, (_req, res) => { const m = providerAdmin!.manager; res.json({ ...m.status(), reliability: m.reliability(), concurrency: limiter.stats, limits }); });
  const days = (q: unknown, dflt: number) => Math.min(90, Math.max(1, Number.parseInt(String(q ?? ""), 10) || dflt));
  const sinceDays = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  app.get("/api/admin/usage", authed, adminOnly, async (req, res) => {
    const n = days(req.query.days, 7);
    res.json({ days: n, ...(summarize(usage ? await usage.since(sinceDays(n)) : [])), limits });
  });
  app.get("/api/admin/usage.csv", authed, adminOnly, async (req, res) => {
    const n = days(req.query.days, 30);
    res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="voicesync-usage-${n}d.csv"`); res.setHeader("Cache-Control", "no-store");
    res.send(toCsv(usage ? await usage.since(sinceDays(n)) : []));
  });
  app.put("/api/admin/providers", authed, adminOnly, async (req, res) => {
    const b = SelectionBody.parse(req.body); const m = providerAdmin!.manager;
    await m.apply({ transcription: b.transcription, transcriptionModel: b.transcription_model || undefined, extraction: b.extraction, extractionModel: b.extraction_model || undefined }, req.userId!);
    audit(req, "providers.changed", { transcription: b.transcription, extraction: b.extraction });
    res.json(m.status());
  });
  app.delete("/api/admin/providers", authed, adminOnly, async (req, res) => { const m = providerAdmin!.manager; await m.reset(); audit(req, "providers.reset"); res.json(m.status()); });
  app.post("/api/admin/providers/test", authed, adminOnly, adminLimit, async (req, res) => {
    const b = TestBody.parse(req.body); const m = providerAdmin!.manager; const cur = m.selection;
    const cand = b.step === "transcription"
      ? (b.provider ? { transcription: b.provider, transcriptionModel: b.model || undefined } : { transcriptionModel: b.model || cur.transcriptionModel })
      : (b.provider ? { extraction: b.provider, extractionModel: b.model || undefined } : { extractionModel: b.model || cur.extractionModel });
    res.json(await m.test(b.step, cand));
  });

  app.use((_req, _res, next) => next(new AppError(404, "not_found", "That address does not exist.")));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if (err instanceof ZodError) e = new AppError(400, "validation_error", "Some details need fixing.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    else if (err instanceof multer.MulterError) e = err.code === "LIMIT_FILE_SIZE" ? new AppError(413, "file_too_large", `That file is bigger than the ${config.MAX_AUDIO_SIZE_MB} MB limit.`) : badRequest("upload_error", "That upload did not work.");
    else if ((err as { type?: string })?.type === "entity.parse.failed") e = badRequest("invalid_json", "We could not read that request.");
    else { e = new AppError(500, "internal_error", "Something went wrong on our side. Please try again."); log.error("unhandled error", { request_id: req.requestId, error: String((err as Error)?.message).slice(0, 200) }); }
    if (e.status === 499) return void res.end();
    res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details, request_id: req.requestId } });
  });

  return app;
}
