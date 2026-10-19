# Deploying VoiceSync CRM

This guide takes you from a fresh Supabase project to a running, monitored service. Commands and config snippets are **starting points**: they were written carefully but have not been run on a real server from here, so test them in a staging setup first.

## What runs where
| Piece | What it is | Needs |
|---|---|---|
| Web app | Next.js (`frontend/`) | Node 22, port 3000 |
| API | Express (`backend/`) | Node 22, port 8000, outbound internet to your AI providers and Supabase |
| Database and sign in | Supabase | A Supabase project |
| AI providers | Your choice (see README) | A key for each provider you use |

Put both the web app and the API behind HTTPS (a reverse proxy such as Caddy or nginx, or your hosting platform). Browsers will not allow microphone access on plain http, except on localhost.

## 1. Supabase
1. Create a project. Note the project URL, the **anon** key and the **service role** key.
2. Run the migrations **in order** in the SQL editor: `0001_crm_tasks.sql`, `0002_app_settings.sql`, `0003_usage_events.sql`. They are safe to run again. They were tested on a real Postgres in CI (`backend/test/db`), including row level security.
3. In Authentication settings: turn on email confirmation, set a sensible minimum password length, and add your web address to the allowed redirect URLs. Check the session length that suits you.
4. Find your own user ID (Authentication, Users) for `ADMIN_USER_IDS` below.

The service role key bypasses row level security. It lives only in the API's environment. Never put it in the web app, in git, or in a chat.

## Where to host each part
- **The web app** (`frontend/`) can go on **Vercel**. Set the project's **Root Directory** to `frontend`.
- **The API** (`backend/`) must run on a host that keeps a Node server running, such as a small VPS, Render, Railway or Fly.io. **Do not put the API on Vercel's serverless functions.** Voice uploads can be up to 20 MB but serverless request bodies are limited to a few MB, long requests can be cut off, and the safe retries, concurrency cap, rate limits and circuit breakers live in the memory of one running process, which serverless does not keep.
- On a platform that sets `PORT`, the API uses it automatically. Use `/api/ready` as the health check path.

## 2. The API
```bash
cd backend
npm ci
npm run build
NODE_ENV=production node dist/server.js
```
Settings go in `backend/.env` or your platform's secret store. The server checks them at startup and refuses to start with a clear message if something is wrong.

| Setting | Notes |
|---|---|
| `NODE_ENV=production` | Turns on the production checks below |
| `FRONTEND_ORIGIN` | Your real web address, `https://...`. Wildcards, localhost and plain http are refused in production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | URL must be https |
| `AUTH_MODE=supabase` | `local` is refused in production |
| `ADMIN_USER_IDS` | Comma separated user IDs allowed to open Provider settings |
| Provider keys and models | `TRANSCRIPTION_*`, `EXTRACTION_*` and the keys, as in the README. Only the keys you use are needed |
| `TRUST_PROXY` | Number of proxies in front of the API (default 1). Wrong values make rate limits count the proxy instead of each person |
| `LOG_LEVEL` | `info` by default. Logs are one JSON line per event |
| `METRICS_TOKEN` | 24+ characters. Turns on `GET /metrics`. Leave unset to keep it off |
| `AUTH_CACHE_SECONDS` | 30 by default. How long a confirmed sign in is trusted before Supabase is asked again. A signed out or removed person may still get through for up to this long. Set 0 for no cache |
| `SHUTDOWN_TIMEOUT_SECONDS` | 25 by default. How long to let requests finish on shutdown |
| `FALLBACK_*`, `BREAKER_*`, `AI_MAX_CONCURRENCY`, `USER_DAILY_*` | Reliability and limits, see README |
| `STORE_TRANSCRIPTS` | `false` unless you have told your users |

Example reverse proxy (Caddy, handles HTTPS certificates by itself):
```
api.example.com {
    request_body { max_size 25MB }
    reverse_proxy localhost:8000
}
app.example.com {
    reverse_proxy localhost:3000
}
```
Example systemd service (the shutdown settings match the server's 25 second drain):
```
[Service]
WorkingDirectory=/srv/voicesync/backend
EnvironmentFile=/etc/voicesync/api.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
User=voicesync
KillSignal=SIGTERM
TimeoutStopSec=35
NoNewPrivileges=true
```

## 3. The web app
The `NEXT_PUBLIC_*` values are **baked in when you build**, so set them first, then build.
```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
NEXT_PUBLIC_SITE_URL=https://app.example.com \
npm ci && npm run build && npm start
```
`NEXT_PUBLIC_CONTACT_EMAIL` (optional) adds a contact line to the privacy page. A production build refuses `NEXT_PUBLIC_AUTH_MODE=local`. The security headers and content policy are set by `next.config.ts` and use your API and Supabase addresses from these same values.

## 4. First run checklist
**Fastest way: run the automated check.** It does most of the list below against your real deployment and prints PASS, FAIL or skip for each step. It never prints keys, tokens or passwords, creates one test task and deletes it, and never deletes accounts.
```bash
# Create two throwaway accounts in the app first (confirm their emails). Put account A in ADMIN_USER_IDS.
export STAGING_SUPABASE_URL=https://xxxx.supabase.co
export STAGING_SUPABASE_ANON_KEY=...            # the public anon key
export STAGING_A_EMAIL=a@example.com  STAGING_A_PASSWORD=...
export STAGING_B_EMAIL=b@example.com  STAGING_B_PASSWORD=...
npm run staging-check -- --api https://api.example.com --web https://app.example.com \
    --test-providers --audio ./short-note.webm     # last two options make small real provider calls
```
Add `--metrics-token <token>` if you turned metrics on. Fix every FAIL, then do the human checks it cannot do (marked below with a person icon in your head: look at the screen). The script is tested, including that it catches a leaky API, a missing sign in and a key in readiness output.

The manual list:
- [ ] `curl https://api.example.com/api/live` returns `{"status":"ok"}`
- [ ] `curl https://api.example.com/api/ready` returns status `ok` with the database `ok` and your providers named
- [ ] Sign up on the web app, confirm the email, sign in
- [ ] Your user ID is in `ADMIN_USER_IDS`, you can open Provider settings, and **Test connection** passes for both steps
- [ ] (by eye) Record a note with your real voice, check the client, place, date and priority it picked, save, see it on the board, refresh
- [ ] (by eye) The page looks right on your phone, and the microphone permission prompt appears
- [ ] A second account cannot see the first account's tasks
- [ ] Response headers on the web app include `Content-Security-Policy` and `Strict-Transport-Security`
- [ ] `/privacy` loads and says what you intend it to say

## 5. Monitoring
- **Uptime:** point an external monitor at `GET /api/ready` (it returns 503 when the database is down or the server is shutting down). `/api/live` only says the process is up.
- **Logs:** ship stdout to your log service. Every request line has `request_id`, `method`, `route`, `status`, `duration_ms`. A user can quote the `X-Request-Id` from a failed response so you can find the line. Logs never contain audio, transcripts, tokens or keys.
- **Metrics:** with `METRICS_TOKEN` set, scrape `/metrics` with `Authorization: Bearer <token>`. Useful series: `http_requests_total` and `http_request_duration_seconds` (by route and status), `ai_calls_total` (by step, provider, outcome, backup), `ai_call_duration_seconds`, `provider_circuit_state` (0 closed, 1 testing, 2 open), `voice_notes_in_flight`, `voice_notes_queued`.
- **Suggested alerts:** `/api/ready` failing for 2 minutes; `provider_circuit_state == 2` for 5 minutes; 5xx share above 2% for 10 minutes; `voice_notes_queued > 0` for 10 minutes; `ai_calls_total{fallback="true"}` rising (a backup is carrying traffic).
- Provider settings in the app shows circuit state, backups, load and 7 day usage, and exports usage as CSV.

## 6. Backups
Your tasks are the only data worth restoring. Audio is never stored.
- Check what your Supabase plan includes (automatic backups, point in time recovery) and turn on what you need.
- Whatever the plan, also keep your own copy. Example, run on a schedule and store the file somewhere separate:
  `pg_dump "$DATABASE_URL" --schema=public --format=custom --file=voicesync-$(date +%F).dump`
- **A backup you have never restored is a hope, not a backup.** Every quarter, restore the latest dump into a scratch Supabase project (`pg_restore --clean --if-exists --no-owner -d "$SCRATCH_URL" file.dump`), point a staging API at it, and check that tasks appear.
- Usage records grow over time. Prune on your own schedule, for example `delete from public.usage_events where at < now() - interval '90 days';`

## 7. Upgrades and rollback
1. Take a backup. 2. Deploy the new API and web build. 3. Run any new migration. 4. Run the first run checklist.

Rollback: redeploy the previous build. Migrations in this project only add things, so an older build keeps working with a newer database. If a migration itself must be undone, restore from backup, or write and review a reverse script by hand. Never run one untested on production.

## 8. Things to know before you scale out
- Safe retries, the concurrency cap, circuit breakers and rate limits are held **in the memory of one server process**. With several API instances, each applies its own limits and breakers, and a retry that lands on a different instance is processed again. Start with one instance, or put a sticky routing rule in front.
- Daily allowances and usage are stored in the database, so they are shared across instances.
- The content policy allows inline scripts because Next.js needs them. See `docs/SECURITY.md`.
