#!/usr/bin/env node
// Browser end to end run, for Windows, Mac and Linux.
// Builds the website in a test mode, starts the test API (fake AI, in memory data) and the website, runs Playwright, then stops everything.
//   npm run e2e                 run all browser tests
//   npm run e2e -- --ui         open Playwright's visual UI (servers stay up until you close it)
//   npm run e2e -- -g "landing" run only tests whose name matches
// Needs a browser once:  npx --prefix e2e playwright install chromium     (or set CHROMIUM_PATH)
// It never uses your real keys or your real .env files.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const children = [];

const inUse = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); });
const waitFor = async (url, what, ms = 60_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`${what} did not start within ${ms / 1000} seconds. Check the messages above.`); };

/** Starts a server in its own process group so the whole tree can be stopped later. */
function start(name, args, cwd, env = {}) {
  const child = spawn("npx", args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: win, detached: !win });
  let tail = ""; for (const s of [child.stdout, child.stderr]) s.on("data", (d) => { tail = (tail + d).slice(-3000); });
  child.on("exit", (code) => { if (!stopping) console.error(`\n${name} stopped unexpectedly (code ${code}). Last output:\n${tail}`); });
  children.push(child); return child;
}
let stopping = false;
function stopAll() {
  stopping = true;
  for (const c of children) {
    try { if (win) spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-c.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopAll(); process.exit(130); });

async function main() {
  for (const port of [3000, 8000]) if (await inUse(port)) throw new Error(`Port ${port} is already in use. Close whatever is running there (another dev server?) and try again.`);

  execFileSync(process.execPath, [path.join(ROOT, "e2e", "fixtures", "make-audio.mjs")], { stdio: "ignore" });   // the fake microphone sound

  if (process.env.SKIP_BUILD !== "1") {
    console.log("Building the website in test mode (about a minute)...");
    try { execFileSync("npx", ["next", "build"], { cwd: path.join(ROOT, "frontend"), stdio: "inherit", shell: win, env: { ...process.env, VOICESYNC_ALLOW_LOCAL_BUILD: "1", NEXT_PUBLIC_AUTH_MODE: "local", NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000" } }); }
    catch { throw new Error("The website build failed. Fix the errors above first."); }
  }
  console.log("Starting the test API and the website...");
  start("test API", ["tsx", "test/e2e-server.ts"], path.join(ROOT, "backend"), { FRONTEND_ORIGIN: "http://localhost:3000" });
  start("website", ["next", "start", "-p", "3000"], path.join(ROOT, "frontend"));
  await waitFor("http://localhost:8000/api/live", "The test API");
  await waitFor("http://localhost:3000/", "The website");

  console.log("Running the browser tests...\n");
  const code = await new Promise((resolve) => {
    const p = spawn("npx", ["playwright", "test", ...process.argv.slice(2)], { cwd: path.join(ROOT, "e2e"), stdio: "inherit", shell: win });
    p.on("exit", (c) => resolve(c ?? 1));
  });
  return code;
}

main().then((code) => { stopAll(); process.exit(code); }).catch((e) => { console.error(`\n${e.message}`); stopAll(); process.exit(1); });
