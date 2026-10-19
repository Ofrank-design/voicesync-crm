#!/usr/bin/env node
// Runs the "first run checklist" from docs/DEPLOYMENT.md against a real deployment and prints PASS, FAIL or SKIP for each step.
// It never prints keys, tokens or passwords. It creates a couple of test tasks and deletes them again. It never deletes accounts.
//
//   node scripts/staging-check.mjs --api https://api.example.com --web https://app.example.com [--audio ./note.webm] [--test-providers] [--metrics-token XXXX]
//
// Sign in with two throwaway test accounts (create them in the app first), via environment variables:
//   STAGING_SUPABASE_URL  STAGING_SUPABASE_ANON_KEY  STAGING_A_EMAIL  STAGING_A_PASSWORD  STAGING_B_EMAIL  STAGING_B_PASSWORD
// Account A should be listed in ADMIN_USER_IDS if you want the admin checks to run. Or skip sign in and pass tokens directly:
//   STAGING_TOKEN_A  STAGING_TOKEN_B
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEYISH = /\bsk-[A-Za-z0-9_-]{16,}|\bgsk_[A-Za-z0-9]{16,}|\bAIza[0-9A-Za-z_-]{30,}|\bhf_[A-Za-z0-9]{20,}|\bnvapi-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./;

/** Signs in with email and password through Supabase's auth API. The error never repeats the password. */
export async function signIn(supabaseUrl, anonKey, email, password, f = fetch) {
  let res;
  try { res = await f(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); }
  catch { throw new Error("could not reach Supabase to sign in (check STAGING_SUPABASE_URL)"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`sign in failed for ${email}: ${body.error_description ?? body.msg ?? res.status} (is the email confirmed?)`);
  return body.access_token;
}

export async function runChecks(o, f = fetch) {
  const api = o.api.replace(/\/$/, ""), web = o.web?.replace(/\/$/, "");
  const results = []; const log = o.log ?? (() => {});
  const run = async (name, fn) => {
    try { const r = await fn(); const out = r === "skip" ? { name, status: "SKIP" } : r?.skip ? { name, status: "SKIP", note: r.skip } : { name, status: "PASS", note: typeof r === "string" ? r : undefined }; results.push(out); }
    catch (e) { results.push({ name, status: "FAIL", note: String(e.message ?? e).slice(0, 300) }); }
    const r = results.at(-1); log(r);
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg); };
  const get = (url, headers = {}, init = {}) => f(url, { headers, ...init });
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const json = async (r) => r.json().catch(() => ({}));
  let tokenA = o.tokenA, tokenB = o.tokenB, a, b, made;

  await run("API is up (liveness)", async () => { const r = await get(`${api}/api/live`); assert(r.status === 200, `status ${r.status}`); });
  await run("API is ready: database ok, providers named", async () => {
    const r = await get(`${api}/api/ready`); const t = await r.text(); assert(r.status === 200, `status ${r.status}: ${t.slice(0, 120)}`);
    const j = JSON.parse(t); assert(j.status === "ok" && j.services?.database === "ok", "database not ok"); assert(!KEYISH.test(t), "readiness output looks like it contains a key");
    return `transcription ${j.providers?.transcription?.id ?? "?"}, extraction ${j.providers?.extraction?.id ?? "?"}`;
  });
  await run("API response headers", async () => {
    const r = await get(`${api}/api/live`); const h = r.headers;
    assert(h.get("x-content-type-options") === "nosniff", "missing nosniff"); assert(!h.get("x-powered-by"), "x-powered-by is exposed"); assert(h.get("x-request-id"), "missing x-request-id");
    if (api.startsWith("https://")) assert(h.get("strict-transport-security"), "missing HSTS on https");
  });
  await run("API refuses requests without a sign in", async () => {
    const none = await get(`${api}/api/tasks`); const junk = await get(`${api}/api/tasks`, auth("not-a-real-token"));
    assert(none.status === 401, `no token gave ${none.status}`); assert(junk.status === 401, `bad token gave ${junk.status}`);
  });
  await run("CORS: web address allowed, strangers not", async () => {
    if (!web) return { skip: "no --web given" };
    const ask = (origin) => get(`${api}/api/tasks`, { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" }, { method: "OPTIONS" });
    const good = await ask(new URL(web).origin), bad = await ask("https://evil.example");
    assert(good.headers.get("access-control-allow-origin") === new URL(web).origin, "your web address is not allowed (check FRONTEND_ORIGIN)");
    assert(bad.headers.get("access-control-allow-origin") !== "https://evil.example", "a stranger's origin is allowed");
  });
  await run("Web app: pages and security headers", async () => {
    if (!web) return { skip: "no --web given" };
    const r = await get(`${web}/`); assert(r.status === 200, `home status ${r.status}`);
    const csp = r.headers.get("content-security-policy") ?? ""; assert(csp.includes("frame-ancestors 'none'"), "no content security policy (is this a production build?)");
    assert(r.headers.get("x-frame-options") === "DENY", "missing frame protection"); if (web.startsWith("https://")) assert(r.headers.get("strict-transport-security"), "missing HSTS");
    assert(csp.includes(new URL(api).origin), "content policy does not allow your API address (NEXT_PUBLIC_API_BASE_URL at build time?)");
    for (const p of ["/privacy", "/robots.txt", "/sitemap.xml"]) assert((await get(`${web}${p}`)).status === 200, `${p} did not load`);
    assert((await get(`${web}/no-such-page-here`)).status === 404, "missing pages do not return 404");
  });

  if (!tokenA || !tokenB) {
    await run("Sign in with the two test accounts", async () => {
      if (!o.supabaseUrl || !o.anonKey || !o.emailA || !o.emailB) return { skip: "no test account details given" };
      tokenA = await signIn(o.supabaseUrl, o.anonKey, o.emailA, o.passA, f); tokenB = await signIn(o.supabaseUrl, o.anonKey, o.emailB, o.passB, f);
    });
  }
  if (!tokenA || !tokenB) { results.push({ name: "Account checks", status: "SKIP", note: "need two test accounts or tokens" }); log(results.at(-1)); return results; }

  await run("Two different people are recognised", async () => {
    const ra = await get(`${api}/api/me`, auth(tokenA)), rb = await get(`${api}/api/me`, auth(tokenB));
    assert(ra.status === 200 && rb.status === 200, `status ${ra.status} and ${rb.status}`); a = await json(ra); b = await json(rb);
    assert(a.user_id && b.user_id && a.user_id !== b.user_id, "both accounts resolve to the same person");
  });
  await run("Person A can create a task, and a repeated save does not duplicate", async () => {
    const body = JSON.stringify({ client_name: "Staging check", location: "Test", action_item: "Safe to delete", follow_up_date: "", priority: "low" });
    const key = `staging-${Date.now()}`; const h = { ...auth(tokenA), "Content-Type": "application/json", "Idempotency-Key": key };
    const r1 = await get(`${api}/api/tasks`, h, { method: "POST", body }), r2 = await get(`${api}/api/tasks`, h, { method: "POST", body });
    assert(r1.status === 201, `first save gave ${r1.status}`); made = (await json(r1)).task; assert(r2.status === 200 && (await json(r2)).duplicate === true, "the repeated save was not recognised as a duplicate");
  });
  await run("Person B cannot see or touch Person A's task", async () => {
    assert(made?.id, "no task to test with");
    const list = await json(await get(`${api}/api/tasks?search=Staging%20check`, auth(tokenB))); assert(!(list.items ?? []).some((t) => t.id === made.id), "B can see A's task in the list");
    for (const [m, extra] of [["GET", {}], ["PATCH", { body: JSON.stringify({ status: "completed" }), headers: { "Content-Type": "application/json" } }], ["DELETE", {}]]) {
      const r = await get(`${api}/api/tasks/${made.id}`, { ...auth(tokenB), ...(extra.headers ?? {}) }, { method: m, body: extra.body }); assert(r.status === 404, `B got ${r.status} on ${m}`);
    }
    const exp = await (await get(`${api}/api/me/export`, auth(tokenB))).text(); assert(!exp.includes(made.id), "B's data download contains A's task");
    const still = await get(`${api}/api/tasks/${made.id}`, auth(tokenA)); assert(still.status === 200, "A's task was changed or removed");
  });
  await run("Normal people cannot use admin routes", async () => {
    const who = a?.is_admin ? b : a; const t = a?.is_admin ? tokenB : tokenA;
    if (who?.is_admin) return { skip: "both accounts are admins" };
    assert((await get(`${api}/api/admin/providers`, auth(t))).status === 403, "a non admin can open provider settings");
  });
  await run("Admin: provider settings show status without secrets", async () => {
    if (!a?.is_admin) return { skip: "account A is not in ADMIN_USER_IDS" };
    const r = await get(`${api}/api/admin/providers`, auth(tokenA)); const t = await r.text(); assert(r.status === 200, `status ${r.status}`); assert(!KEYISH.test(t), "the response looks like it contains a key");
    const j = JSON.parse(t); const missing = j.providers.filter((p) => !p.key_set && [j.active.transcription.id, j.active.extraction.id].includes(p.id)); assert(missing.length === 0, `active provider has no key: ${missing.map((p) => p.key_env).join(", ")}`);
    return `active: ${j.active.transcription.label} and ${j.active.extraction.label}`;
  });
  await run("Admin: Test connection passes for both steps (makes tiny real calls)", async () => {
    if (!o.testProviders) return { skip: "add --test-providers to run (costs a few tokens)" };
    if (!a?.is_admin) return { skip: "account A is not an admin" };
    const msgs = [];
    for (const step of ["transcription", "extraction"]) { const j = await json(await get(`${api}/api/admin/providers/test`, { ...auth(tokenA), "Content-Type": "application/json" }, { method: "POST", body: JSON.stringify({ step }) })); assert(j.ok, `${step}: ${j.message ?? "failed"} (${j.code ?? "no code"})`); msgs.push(`${step} ${j.label} ${j.ms} ms`); }
    return msgs.join(", ");
  });
  await run("Real voice note: transcript, task draft, providers named, safe retry", async () => {
    if (!o.audio) return { skip: "add --audio ./short-note.webm (or .wav, .mp3, .m4a) to run" };
    const mime = /\.wav$/i.test(o.audio) ? "audio/wav" : /\.mp3$/i.test(o.audio) ? "audio/mpeg" : /\.(m4a|mp4)$/i.test(o.audio) ? "audio/mp4" : "audio/webm";
    const bytes = o.audioBytes ?? readFileSync(o.audio); const key = `staging-note-${Date.now()}`;
    const send = () => { const form = new FormData(); form.append("audio", new Blob([bytes], { type: mime }), `note.${mime.split("/")[1]}`); form.append("timezone", "UTC"); return get(`${api}/api/voice-sync`, { ...auth(tokenA), "Idempotency-Key": key }, { method: "POST", body: form }); };
    const t0 = Date.now(); const r = await send(); const j = await json(r); assert(r.status === 200, `status ${r.status}: ${j.error?.message ?? ""}`);
    assert(j.transcript?.trim(), "empty transcript"); assert(j.task && "client_name" in j.task && "priority" in j.task, "no task draft"); assert(j.processed_by?.transcription?.label && j.processed_by?.extraction?.label, "providers not named");
    const again = await send(); assert(again.headers.get("idempotent-replay") === "true", "a retry with the same key was processed again");
    return `${((Date.now() - t0) / 1000).toFixed(1)} s, ${j.transcript.split(/\s+/).length} words, by ${j.processed_by.transcription.label} then ${j.processed_by.extraction.label}${j.processed_by.fallback_used ? " (BACKUP USED)" : ""}; check the draft by eye: client "${j.task.client_name}", date "${j.task.follow_up_date}"`;
  });
  await run("Metrics are protected", async () => {
    const open = await get(`${api}/metrics`); assert(open.status === 404 || open.status === 401, `metrics answered ${open.status} without a token`);
    if (!o.metricsToken) return "off or protected";
    const withTok = await get(`${api}/metrics`, auth(o.metricsToken)); assert(withTok.status === 200, `metrics with token gave ${withTok.status}`);
    const t = await withTok.text(); assert(t.includes("http_requests_total") && !KEYISH.test(t), "metrics output unexpected");
  });
  await run("Clean up the test task", async () => { if (!made?.id) return { skip: "nothing to remove" }; const r = await get(`${api}/api/tasks/${made.id}`, auth(tokenA), { method: "DELETE" }); assert(r.status === 204, `status ${r.status}`); });
  return results;
}

function parseArgs(argv) {
  const g = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const e = process.env;
  return { api: g("api"), web: g("web"), audio: g("audio"), testProviders: argv.includes("--test-providers"), metricsToken: g("metrics-token"),
    supabaseUrl: e.STAGING_SUPABASE_URL, anonKey: e.STAGING_SUPABASE_ANON_KEY, emailA: e.STAGING_A_EMAIL, passA: e.STAGING_A_PASSWORD, emailB: e.STAGING_B_EMAIL, passB: e.STAGING_B_PASSWORD, tokenA: e.STAGING_TOKEN_A, tokenB: e.STAGING_TOKEN_B };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.api) { console.error("Usage: node scripts/staging-check.mjs --api https://api.example.com [--web https://app.example.com] [--audio ./note.webm] [--test-providers]"); process.exit(2); }
  const icon = { PASS: "PASS", FAIL: "FAIL", SKIP: "skip" };
  const results = await runChecks({ ...o, log: (r) => console.log(`${icon[r.status].padEnd(4)}  ${r.name}${r.note ? `\n        ${r.note}` : ""}`) });
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${n("PASS")} passed, ${n("FAIL")} failed, ${n("SKIP")} skipped.`);
  if (n("FAIL")) console.log("Fix the FAIL lines first. docs/RUNBOOK.md and docs/DEPLOYMENT.md explain most of them.");
  process.exit(n("FAIL") ? 1 : 0);
}
