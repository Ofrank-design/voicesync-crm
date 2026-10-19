# Security overview

This is an honest summary of what protects VoiceSync CRM, how each protection was checked, and what is still open. It is not a certification or a penetration test.

## What is protected and how
| Risk | Protection | How it was checked |
|---|---|---|
| One person reading or changing another's tasks | Every API query is filtered by the signed in user. Row level security is on in the database as a second layer | API tests with two users on every route. Real Postgres tests (`backend/test/db`): another user's rows are invisible and cannot be updated, deleted, or reassigned |
| Anonymous access | Every data route needs a valid Supabase session. The database has no policy for anonymous users | API tests (401 on every route). Database tests |
| Browser reading provider keys or the service role key | Keys exist only in the API's environment. The settings screen never accepts or returns a key | Tests scan responses for key values. The secret scanner runs in CI |
| Admin features used by normal users | Provider settings, usage and metrics need an admin ID | Tests: 403 on every admin route |
| Forged or stolen web tokens | Tokens are verified by Supabase, not just decoded. A short cache (default 30 seconds) trades a small delay in noticing a signed out user for speed | Unit tests of the cache. **Not tested against a real Supabase** |
| Hostile transcripts steering the AI | The transcript is passed as data, output must match a strict schema with no extra fields, and a person reviews before saving | Tests with injected instructions and malformed output |
| Cross site requests | CORS allows only your web address. Production refuses wildcard, localhost and plain http | Tests, including a browser check with a stranger's origin |
| Clickjacking, content sniffing, outside scripts | Content security policy, frame blocking, nosniff, strict referrer policy, microphone limited to your own pages | Unit tests of the policy and real response headers in the browser tests. The full workflow runs with no policy violations |
| Abuse and runaway cost | Rate limits, upload size and length limits, one note at a time per person, a global concurrency cap, daily allowances, circuit breakers | Tests for each. A load test of the API layer (below) |
| Leaking data through logs | Logs redact keys, tokens, transcripts and audio, never log query strings or bodies, and never show users raw provider errors | Tests that run a note through and search all log output |
| Data kept longer than needed | Audio is never stored. Transcripts are off by default. People can download and delete their data | Tests, and a browser test of download then delete |
| Dependency vulnerabilities | Exact versions from lock files, weekly checks, CI fails on high or critical findings | `npm audit`: 0 known vulnerabilities at the time of writing |
| Committed secrets | A scanner for key patterns and `.env` files runs in CI | Tests of the scanner; the project scans clean |

## Known gaps and trade offs
1. **No test against a real Supabase.** The database rules were tested on real Postgres, and the API against stand ins. Run the first run checklist in `docs/DEPLOYMENT.md` on staging, including the two account check.
2. **Content policy allows inline scripts.** Next.js needs them. This blocks outside scripts, framing and plugins, but not injected inline script. Per request nonces would tighten it.
3. **Sign in cache window.** After sign out or removal, a token can still work for up to `AUTH_CACHE_SECONDS` (30 by default).
4. **Limits live in server memory.** With several API instances, each applies its own rate limits, breakers and retry memory. Daily allowances are shared (they are in the database).
5. **No multi factor sign in** is built in. Supabase offers it; it has not been wired or tested here.
6. **The admin role is a list of user IDs** in an environment variable. There is no role management screen.
7. **Provider data terms are outside this software's control.** Each AI provider decides how long it keeps data. See `docs/PRIVACY.md`.
8. **No penetration test, no formal threat model review, no compliance audit** (for example SOC 2 or GDPR assessment) has been done. The privacy page describes the software, and is not legal advice. Have your own lawyer write your privacy policy and terms.
9. **Containers, WAF and DDoS protection** are not included. Use your host's or a CDN's.

## Load test (API layer only)
`npm run loadtest` against the real API with an in memory database and simulated AI providers (200 ms per step), 24 at once, one run on a small sandbox: 600 task creations at about 400 requests per second (p95 126 ms, no errors), 600 list calls at about 550 per second (p95 78 ms), 60 voice notes with the concurrency cap at 4: all succeeded, they queued instead of failing, and the server stayed healthy. **This does not measure Supabase or real AI provider speed.** Repeat it against staging with real settings before launch.

## Reporting a problem
Tell the person or team who runs your deployment. Operators: set `NEXT_PUBLIC_CONTACT_EMAIL` so the privacy page shows a contact address, and decide who answers it.
