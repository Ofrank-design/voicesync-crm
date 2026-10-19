# Runbook: when something goes wrong

Keep this open during an incident. Each section says what you will see, what to check, and what to do. "Provider settings" is the admin screen at `/settings`.

## First two minutes, any incident
1. `GET /api/ready`: is the API up, is the database ok, which providers are active, what is each circuit doing?
2. Open Provider settings: Reliability (circuit state, backups, load) and Usage (failures by provider).
3. Take a failed request's `X-Request-Id` and search your logs for it. Every line for that request carries it.
4. Write down the time you started. You will want a timeline afterwards.

## AI provider is down, slow or out of credit
**You will see:** users get "the service is having trouble" messages; `ai_calls_total` failures rise; Reliability shows a circuit "Paused after repeated errors"; people see "pausing it for a moment" with a number of seconds.
**Do:**
1. Check the provider's own status page and your account's credit.
2. Use **Test connection** in Provider settings for the failing step.
3. If it is a real outage and you have another provider with a key: choose it in Provider settings, test it, save. New notes use it at once. Tell your users which provider handles their data now (the review screen shows it).
4. If a backup (`FALLBACK_*`) is configured it is already carrying traffic. Check `ai_calls_total{fallback="true"}` and watch its credit.
5. Billing problems show as `..._billing` errors. Add credit, then **Test connection**. The circuit closes by itself after one good call.
**Afterwards:** consider configuring a backup so the next outage is invisible.

## A provider key was exposed
Treat it as stolen.
1. Create a new key at the provider. Update the API's environment. Restart the API.
2. Revoke the old key at the provider.
3. Download the usage CSV (Provider settings) and look for calls you do not recognise in the period of exposure. Check the provider's own usage page too.
4. If it was the **Supabase service role key**: rotate it in Supabase, update the API, restart. Then review recent rows and sign ins.
5. Find how it leaked (a log, a chat, a commit). Run `npm run secrets` and check git history.

## Database is unreachable
**You will see:** `/api/ready` returns 503 with `database: unavailable`; task screens show "the database is not responding".
1. Check Supabase's status and your project's health in its dashboard.
2. Nothing is lost by waiting: failed saves keep the review screen open, and retrying the same save will not create duplicates.
3. If the project is damaged, restore from backup (`docs/DEPLOYMENT.md`, section 6).
4. When it recovers, `/api/ready` returns 200 by itself. No restart is needed.

## Error rates or slowness are climbing
1. Is it one route or all? `http_request_duration_seconds` and `http_requests_total` by route and status.
2. All routes slow, `/api/ready` fine: the server is busy. Check CPU and memory, and `voice_notes_queued`. A queue that never empties means notes are slower than arrivals: raise `AI_MAX_CONCURRENCY` only if the provider allows it.
3. Only voice notes slow: look at `ai_call_duration_seconds` per provider.
4. Many 429 responses: rate limit or daily allowance. Check `USER_DAILY_*` and whether `TRUST_PROXY` is right (a wrong value makes everyone share one limit).
5. Many 401 responses right after a deploy: check the Supabase URL and that the web app's anon key matches the same project.

## People say dates or details are wrong
The AI proposes, a person reviews. Look at one example: the review screen shows the date it worked out and from which day. Common causes: the person's phone timezone, or an unusual phrase. If a pattern appears, note the provider and model (usage CSV) and try another model with **Test connection** and a few real recordings.

## Someone asks for their data or wants to be deleted
- They can do it themselves at `/account` (download, or delete everything including their login).
- If they cannot sign in, an admin can do it. Find the ID: `select id from auth.users where email = 'person@example.com';` Then, in the SQL editor: `delete from public.crm_tasks where user_id = '<id>'; delete from public.usage_events where user_id = '<id>';` and delete the user in Authentication, Users.
- Remember copies the AI providers may hold under their own terms, and your backups.

## Bad deploy: roll back
1. Redeploy the previous API and web builds. The server drains in up to `SHUTDOWN_TIMEOUT_SECONDS`, and `/api/ready` returns 503 while it drains so your load balancer stops sending traffic.
2. Migrations only add things, so the older build works with the newer database.
3. Run the first run checklist. Write down what failed and add a test for it.

## Restore from backup (practice this)
1. Create a scratch Supabase project. Run the three migrations.
2. `pg_restore --clean --if-exists --no-owner -d "$SCRATCH_URL" voicesync-YYYY-MM-DD.dump`
3. Point a staging API at it and confirm tasks appear for a known account.
4. Record how long it took. That is your real recovery time.

## After any incident
Write three lines: what happened, what you changed, what test or alert would have caught it sooner. Add that alert or test.
