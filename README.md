# VoiceSync CRM

Voice note -> Whisper transcript -> Claude structured extraction -> **editable review** -> Supabase -> Kanban board.

```
frontend/  Next.js (App Router, TS strict, Tailwind v4, TanStack Query, React Hook Form + Zod)
backend/   Express + TypeScript API (OpenAI SDK, Anthropic SDK, Zod, Supabase client)
backend/supabase/migrations/0001_crm_tasks.sql
```
Secrets live only in the backend. The browser only holds the public Supabase anon key (for sign-in) and talks to the API over HTTP.

## Pages
- `/` public landing page (no sign in, no JavaScript needed to read it)
- `/login` sign in or create an account
- `/dashboard` recorder, review form, metrics and Kanban board
- `/tasks/:id` task details, editing and delete

Brand files live in `frontend/public`: `logo.png` (for dark backgrounds), `icon.png`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `logo-dark-text.png` (for light backgrounds), and `images/hero.jpg`, `images/hero-mobile.jpg`, `images/og.jpg`. The tab icon and share card are wired up in `frontend/app/layout.tsx`. Set `NEXT_PUBLIC_SITE_URL` to your real address so share previews use full links.

## Documentation
| | |
|---|---|
| `docs/DEPLOYMENT.md` | Going live: Supabase, the API, the web app, HTTPS, monitoring, backups, upgrades, rollback |
| `docs/SECURITY.md` | What is protected, how it was checked, and the known gaps |
| `docs/RUNBOOK.md` | What to do when a provider is down, a key leaks, the database fails, or someone asks to be deleted |
| `docs/PRIVACY.md` | What data goes where, for your own privacy policy |

## Quality checks
`npm run ci` runs what the GitHub workflow runs (`.github/workflows/ci.yml`): lint, secret scan, type checks, all tests (including the database migrations on a real Postgres), colour contrast, and builds. `npm run e2e` adds the real browser tests. `npm run audit` checks dependencies for known vulnerabilities. `npm run loadtest` exercises the API. `npm run staging-check` runs the first run checklist against a real deployment (see `docs/DEPLOYMENT.md`). Node 22 is pinned in `.nvmrc` and `engines`.

## AI providers
Each step uses one provider you choose in `backend/.env`.

| Step | Setting | Options |
|---|---|---|
| Audio to text | `TRANSCRIPTION_PROVIDER` | `openai` or `groq` |
| Text to task | `EXTRACTION_PROVIDER` | `anthropic`, `openai`, `gemini`, `groq`, `openrouter`, `nvidia`, `huggingface` |

- Only the keys for the providers you pick are required. Defaults are `openai` then `anthropic`, so older setups keep working.
- Extraction needs a model ID: `EXTRACTION_MODEL` (or `ANTHROPIC_MODEL` for Anthropic). Groq transcription needs `TRANSCRIPTION_MODEL`. OpenAI transcription defaults to `whisper-1`. There are no other defaults, because model names change.
- Gemini, OpenRouter, NVIDIA and Hugging Face are text only for now. Their speech APIs differ in shape or depend on the model, so they are refused for transcription until each one can be verified. Use `openai` or `groq` for the audio step and any provider for the text step.
- Reasoning models that print a `<think>` block before the answer are handled: that leading block is ignored, and anything else still has to pass the strict task check.
- Clear errors for the two common setup mistakes: a wrong model ID and an unpaid or over limit account.
- If a provider cannot read the recorded audio format, the user gets a clear message before anything is uploaded.
- Everything except Anthropic is called through an OpenAI style chat endpoint. Base URLs are built in (see `backend/src/providers/registry.ts`) and can be replaced with `EXTRACTION_BASE_URL`. Check the URL and model with the provider before relying on it.
- If a provider cannot do a step, the server refuses to start and says why. It never quietly switches to another provider.
- Every answer is checked against the same strict task schema, whichever provider produced it, and you still review it before anything is saved.
- `GET /api/health` shows which providers are active. It never shows keys or model names.
- The review screen tells the user which providers handled the note. See `docs/PRIVACY.md`.

### Provider settings screen (admins only)
Open **Provider settings** from the dashboard (the link only shows for admins) or go to `/settings`.
- Pick the provider and model for each step, **test the connection** for the choice you are about to make, then save. Testing never changes what is active.
- The speech test checks the key and that the model exists, and sends no audio. The text test runs a tiny real extraction and checks it returns a valid task.
- Saving asks for confirmation, because it changes who processes your users' data. New notes use the new choice straight away. Notes already in progress finish with the provider they started on.
- **Keys are never typed in the browser or saved in the database.** The screen only shows whether the server has a key for each provider, and tells you which variable to set if one is missing.
- A choice saved here wins over `backend/.env` until you press **Go back to the server settings**. If a saved choice stops working at startup (for example you removed its key), the server ignores it and says so on this screen.
- **Who is an admin:** set `ADMIN_USER_IDS` to a comma separated list of Supabase user IDs. In `AUTH_MODE=local` the dev user is an admin. Everyone else gets a clear "admins only" message.
- Run `backend/supabase/migrations/0002_app_settings.sql` once. It stores provider names and model names only, and browsers cannot read it.

### Reliability, backups and usage limits
- **Circuit breaker:** after `BREAKER_FAILURES` provider failures in a row (outages, timeouts, rate limits, billing), that provider is paused for `BREAKER_COOLDOWN_SECONDS`, so users get a fast, clear message instead of a long wait. Then one test call decides whether it has recovered. Bad answers, refusals, wrong keys and wrong model IDs never trip it, because they are setup or content problems.
- **Backup provider (optional, explicit):** set `FALLBACK_EXTRACTION_*` and/or `FALLBACK_TRANSCRIPTION_*`. It is used only for provider trouble (down, overloaded, out of credit, or a paused circuit), only once per request, and never for bad answers or setup errors. The review screen says when a backup was used. Without these settings there is no switching at all.
- **Concurrency cap:** `AI_MAX_CONCURRENCY` notes at once. Extra notes wait up to `AI_QUEUE_TIMEOUT_MS`, then get a plain "try again in a moment" message.
- **Safe retries:** the web app sends an `Idempotency-Key` with each recording. If a retry arrives after a dropped connection, the saved result comes back with no new provider call and no new charge. Results are held in memory for 10 minutes only.
- **Daily allowance:** `USER_DAILY_NOTES` and `USER_DAILY_AUDIO_MINUTES` per person, resetting at midnight UTC. A note counts only when a task draft is returned, so failures never use up an allowance. People see "Today: 3 of 20 voice notes" on the dashboard.
- **Usage tracking:** every provider call is recorded (user, step, provider, model, tokens the provider reported, audio seconds, time taken, error code, whether it was a backup). No audio, transcripts or keys are stored. Run `backend/supabase/migrations/0003_usage_events.sql` once. Admins see totals and a per provider table in Provider settings and can download a CSV (`/api/admin/usage.csv`).
- **Not built yet:** money cost estimates (prices change, so only counts and tokens are shown), queueing of very long recordings, and automatic budget caps in currency.

**What is verified:** every adapter passes the same contract tests with a mocked client. None has been run against the real service yet, so try each one with real keys in a test environment first.

## Setup
1. **Supabase**: create a project. Run `backend/supabase/migrations/0001_crm_tasks.sql` in the SQL editor. Copy the project URL, anon key and service-role key.
2. **Keys**: create a key for each provider you chose (see AI providers above) and set the model ID.
3. **Env**: copy the backend block of `.env.example` to `backend/.env` and the frontend block to `frontend/.env.local`.
4. Install and run (two terminals):
```
npm run install:all
npm run dev:api     # http://localhost:8000
npm run dev:web     # http://localhost:3000
```
The server validates env at startup and exits with a clear message if something is missing. It never returns fake results.

**Local dev without sign-in**: `AUTH_MODE=local` (backend) + `NEXT_PUBLIC_AUTH_MODE=local` (frontend) acts as one fixed user. The backend refuses to start with this when `NODE_ENV=production`. You still need a real Supabase project for storage.

## API
All routes except health need `Authorization: Bearer <Supabase access token>`.
| Route | Notes |
|---|---|
| `POST /api/voice-sync` | multipart: `audio`, `timezone`, `reference_date`, `duration_seconds`. Returns `{request_id, transcript, task, status:"awaiting_review", warnings}`. Nothing is saved. Send header `X-Progress: stream` to get newline-delimited JSON events instead: `{"stage":"transcribing"}`, `{"stage":"extracting"}`, then `{"stage":"done","result":{...}}` or `{"stage":"error","error":{code,message,request_id}}` (the web app uses this to show live statuses). Validation errors (bad file, too large, too long) are ordinary JSON error responses. |
| `POST /api/tasks` | Validated again server-side. Send `Idempotency-Key` to make retries safe (200 + `duplicate:true` on replay). |
| `GET /api/tasks` | `search, status, priority, sort(created_at\|follow_up_date\|priority), order, page, page_size` |
| `GET /api/tasks/stats` | Dashboard counts (open, overdue, high priority, due today) + recent activity |
| `GET/PATCH/DELETE /api/tasks/:id` | Scoped to the owner; other users get 404 |
| `GET /api/health` | No secrets; 503 if the database is unreachable |

## Behaviour worth knowing
- **Review before save**: AI output is validated (strict 5-field schema, extra keys rejected, bounded retry on malformed output) and always shown for editing. Relative dates are resolved against the recording date + timezone, and the resolved date is surfaced as a warning to confirm.
- **Audio**: format is detected from file bytes, not the MIME header. Accepted: WebM, Ogg, MP4/M4A, WAV, MP3, FLAC. Chrome/Edge/Firefox record WebM or Ogg; Safari records MP4. Audio is processed in memory and never written to disk or kept. The size limit is enforced by the server. Duration is measured server-side where the container carries duration metadata (WAV, MP3, MP4/M4A, Ogg, FLAC); browser-recorded WebM usually has none, so for WebM the client-reported duration is the fallback (the recorder also stops at the limit, and file size always applies).
- **Transcripts** are stored with tasks only if `STORE_TRANSCRIPTS=true`.
- **Duplicates**: one in-flight voice upload per user (409), idempotency keys on save, buttons disabled while saving.
- Microphone is requested only after clicking Record; all tracks are stopped on stop/unmount.

## Tests
```
npm run test        # backend (299) + frontend (109); no paid API calls, OpenAI/Anthropic are mocked
npm run typecheck
npm run build
npm run contrast    # WCAG contrast check of the UI colour pairs
npm run e2e         # real-browser end-to-end (see below)
```

### Browser end-to-end
`npm run e2e` (add `-- --ui` to watch the tests in Playwright's visual window) builds the frontend in local-auth mode, starts the real Express app with **fake Whisper/Claude and an in-memory database** (`backend/test/e2e-server.ts`), starts the frontend, and drives Chromium with Playwright. Chromium's fake microphone plays `e2e/fixtures/voice-note.wav`, so the real `MediaRecorder` -> upload -> format detection path runs. It also covers the reliability panel and CSV download, and the provider settings flow (test, save, confirm, reload, review screen shows the new provider, non admins refused, no key in any response). It covers: record, transcript, editable review, correction, save, Kanban, status change, reload persistence, delete confirmation, a 390px mobile layout, and a second user being unable to read/modify the task. Install a browser once with `npx --prefix e2e playwright install chromium`, or set `CHROMIUM_PATH`. This does **not** touch real OpenAI, Anthropic or Supabase.

## Troubleshooting
- *Server exits on start*: read the listed missing variables.
- *Mic blocked / not offered*: needs HTTPS or localhost, and site permission.
- *401*: sign in again, or check that frontend and backend use the same Supabase project.
- *CORS error*: set `FRONTEND_ORIGIN` to the exact web origin.
- *503 on tasks/health*: Supabase URL/service key wrong, or the migration was not run.

## Security notes
Service-role key stays server-side; every query filters by `user_id`; RLS policies are included as defense in depth; helmet, CORS allow-list, rate limits and body limits are on; error responses never include stack traces or secrets.
