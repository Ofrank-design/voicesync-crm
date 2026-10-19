#!/usr/bin/env node
// Simple load test for the API. Usage: node scripts/loadtest.mjs [--url http://localhost:8000] [--token-prefix load-user] [--tasks 400] [--notes 40] [--concurrency 16]
// Each simulated person uses their own token. Against a real server, use real tokens or AUTH_MODE settings that allow this.
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("url", "http://localhost:8000"), PREFIX = arg("token-prefix", "load-user");
const TASKS = Number(arg("tasks", 400)), NOTES = Number(arg("notes", 40)), CONC = Number(arg("concurrency", 16));
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Uint8Array(2048).fill(1)]);

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
async function pool(n, conc, fn) {
  const lat = [], status = {}; let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) {
      const i = next++; if (i >= n) return;
      const t0 = performance.now();
      try { const r = await fn(i); status[r.status] = (status[r.status] ?? 0) + 1; await r.arrayBuffer(); }
      catch { status.network_error = (status.network_error ?? 0) + 1; }
      lat.push(performance.now() - t0);
    }
  }));
  return { lat: lat.sort((a, b) => a - b), status };
}
const show = (name, n, wall, { lat, status }) => console.log(`${name.padEnd(22)} n=${String(n).padEnd(5)} ${(n / (wall / 1000)).toFixed(0).padStart(5)} req/s   p50 ${pct(lat, 50).toFixed(0).padStart(5)} ms   p95 ${pct(lat, 95).toFixed(0).padStart(5)} ms   p99 ${pct(lat, 99).toFixed(0).padStart(5)} ms   max ${(lat.at(-1) ?? 0).toFixed(0).padStart(5)} ms   status ${JSON.stringify(status)}`);
const auth = (i) => ({ Authorization: `Bearer ${PREFIX}-${i}` });
const body = (i) => JSON.stringify({ client_name: `Client ${i}`, location: "Accra", action_item: "Call back", follow_up_date: "2026-12-01", priority: "medium" });

const run = async (name, n, fn) => { const t0 = performance.now(); const r = await pool(n, CONC, fn); show(name, n, performance.now() - t0, r); return r; };
console.log(`Target ${URL_}  concurrency ${CONC}\n`);
await run("create task", TASKS, (i) => fetch(`${URL_}/api/tasks`, { method: "POST", headers: { ...auth(i % 20), "Content-Type": "application/json" }, body: body(i) }));
await run("list tasks", TASKS, (i) => fetch(`${URL_}/api/tasks?page_size=50`, { headers: auth(i % 20) }));
await run("dashboard numbers", Math.floor(TASKS / 2), (i) => fetch(`${URL_}/api/tasks/stats`, { headers: auth(i % 20) }));
await run("readiness check", TASKS, () => fetch(`${URL_}/api/ready`));
await run("voice notes", NOTES, (i) => { const f = new FormData(); f.append("audio", new Blob([webm], { type: "audio/webm" }), "a.webm"); f.append("duration_seconds", "5"); return fetch(`${URL_}/api/voice-sync`, { method: "POST", headers: auth(100 + i), body: f }); });
