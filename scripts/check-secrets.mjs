#!/usr/bin/env node
// Looks for things that must never be committed: API keys, Supabase JWT keys, private keys, and real .env files.
// Add the comment "secret-scan: allow" to a line that is a harmless fake on purpose.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  ["API key (sk-...)", /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{24,}/],
  ["Groq key", /\bgsk_[A-Za-z0-9]{20,}/],
  ["Google key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}/],
  ["NVIDIA key", /\bnvapi-[A-Za-z0-9_-]{30,}/],
  ["JWT (for example a Supabase key)", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["secret assigned in a file", /^\s*(?:export\s+)?(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|NVIDIA_API_KEY|HUGGINGFACE_API_KEY|HF_TOKEN|SUPABASE_SERVICE_ROLE_KEY|METRICS_TOKEN)\s*=\s*["']?[^\s"'#]{16,}/m],
];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "test-results", "playwright-report", ".git", "coverage"]);
const SKIP_EXT = /\.(png|jpe?g|ico|webp|woff2?|zip|webm|wav|mp3|lock)$/i;
const ENV_FILE = /^\.env(\..+)?$/;

/** Returns a list of findings for one file's text. Never includes the secret itself, only where it was. */
export function scanText(name, text) {
  const out = [];
  if (ENV_FILE.test(path.basename(name)) && path.basename(name) !== ".env.example") out.push({ file: name, line: 0, kind: "environment file that should not be committed" });
  text.split("\n").forEach((line, i) => {
    if (line.includes("secret-scan: allow")) return;
    for (const [kind, re] of PATTERNS) if (re.test(line)) out.push({ file: name, line: i + 1, kind });
  });
  return out;
}
/** Files git would commit: tracked ones plus new ones that are not ignored. Returns null if this is not a git folder. */
function gitFiles(root) {
  try { return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
  catch { return null; }
}
const readable = (p) => { try { return statSync(p).isFile() && statSync(p).size <= 2_000_000; } catch { return false; } };

/**
 * Scans what could end up in a commit.
 * In a git folder that means tracked files and new files that are not ignored, so your private .env files are fine as long as git ignores them.
 * Without git, every file is scanned, and real .env files are reported as notes rather than failures.
 */
export function scanDetailed(root, { useGit = true } = {}) {
  const findings = [], notes = [];
  const files = useGit ? gitFiles(root) : null;
  if (files) {
    for (const rel of files) {
      const e = path.basename(rel);
      if (SKIP_EXT.test(e) || !readable(path.join(root, rel))) continue;
      findings.push(...scanText(rel, ENV_FILE.test(e) ? "" : readFileSync(path.join(root, rel), "utf8")));
    }
    return { findings, notes, mode: "git" };
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(e)) walk(p); continue; }
      const rel = path.relative(root, p);
      if (SKIP_EXT.test(e)) continue;
      if (ENV_FILE.test(e)) { if (e !== ".env.example") notes.push(rel); continue; }
      if (readable(p)) findings.push(...scanText(rel, readFileSync(p, "utf8")));
    }
  };
  walk(root);
  return { findings, notes, mode: "folder" };
}
export const scanDir = (root, opts) => scanDetailed(root, opts).findings;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? ".");
  const { findings: found, notes, mode } = scanDetailed(root);
  if (mode === "folder" && notes.length) console.log(`Note: this is not a git folder, so these environment files were not checked: ${notes.join(", ")}. Run git init and keep them in .gitignore.`);
  if (found.length) { console.error("Possible secrets found:"); for (const f of found) console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.kind}`); process.exit(1); }
  console.log("No secrets found.");
}
