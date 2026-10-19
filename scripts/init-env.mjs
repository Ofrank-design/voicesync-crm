#!/usr/bin/env node
// Creates backend/.env and frontend/.env.local by asking you for each value. Works on Windows, Mac and Linux.
//   node scripts/init-env.mjs            ask questions and create both files (refuses to overwrite existing ones)
//   node scripts/init-env.mjs --force    overwrite existing files
//   node scripts/init-env.mjs --set ADMIN_USER_IDS=your-user-id      change one value in backend/.env later
//   node scripts/init-env.mjs --set NEXT_PUBLIC_SITE_URL=https://x.com --file frontend/.env.local
// Keys you paste are hidden. They are written only to the two files, which git ignores. Nothing is sent anywhere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEXT_PROVIDERS = [
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "gemini", label: "Google Gemini", keyEnv: "GEMINI_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "nvidia", label: "NVIDIA NIM", keyEnv: "NVIDIA_API_KEY" },
  { id: "huggingface", label: "Hugging Face", keyEnv: "HUGGINGFACE_API_KEY" },
];

/** Works out what kind of Supabase key this is, so the secret one never ends up in the website. */
export function keyKind(key) {
  if (!key) return "unknown";
  if (/^sb_secret_/.test(key)) return "secret";
  if (/^sb_publishable_/.test(key)) return "public";
  const m = /^eyJ[\w-]+\.([\w-]+)\.[\w-]+\$/.exec(key);
  if (m) { 
    try { 
      const role = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).role; 
      if (role === "service_role") return "secret"; 
      if (role === "anon") return "public"; 
    } catch { 
      /* not decodable */ 
    } 
  }
  return "unknown";
}

/** Returns a list of plain English problems with the answers. Empty means fine. */
export function validate(a) {
  const p = [];
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\/?\$/.test(a.supabaseUrl ?? "")) p.push("The Supabase project URL should look like https://abcd1234.supabase.co");
  if (!a.anonKey) p.push("The public (anon) key is empty.");
  else if (keyKind(a.anonKey) === "secret") p.push("The key you gave as the PUBLIC key is the SECRET key. Use the anon (publishable) key here. The secret key must never go in the website.");
  if (!a.serviceKey) p.push("The secret (service role) key is empty.");
  else if (keyKind(a.serviceKey) === "public") p.push("The key you gave as the SECRET key is the public one. Copy the service_role (secret) key instead.");
  if (a.anonKey && a.anonKey === a.serviceKey) p.push("The public and secret keys are the same. They are two different keys on the Supabase API page.");
  if (!a.openaiKey && (a.provider !== "openai")) p.push("The OpenAI key is empty (it is used for speech to text).");
  if (!TEXT_PROVIDERS.some((t) => t.id === a.provider)) p.push("Choose one of the listed text providers.");
  if (a.provider !== "openai" && !a.textKey) p.push("The text provider key is empty.");
  if (!a.model) p.push("The model ID is empty. Copy a current one from your provider's models page.");
  for (const [k, v] of Object.entries({ supabaseUrl: a.supabaseUrl, anonKey: a.anonKey, serviceKey: a.serviceKey, openaiKey: a.openaiKey, textKey: a.textKey, model: a.model })) if (/\s|["']/.test(v ?? "")) p.push(`A value contains a space or quote (${k}). Paste it again without quotes.`);
  return p;
}

/** The text of the two files. */
export function buildEnvFiles(a) {
  const t = TEXT_PROVIDERS.find((x) => x.id === a.provider);
  const openaiKey = a.provider === "openai" ? (a.textKey || a.openaiKey) : a.openaiKey;
  const extraction = a.provider === "anthropic" ? [`EXTRACTION_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=${a.textKey}`, `ANTHROPIC_MODEL=${a.model}`]
    : a.provider === "openai" ? [`EXTRACTION_PROVIDER=openai`, `EXTRACTION_MODEL=${a.model}`]
    : [`EXTRACTION_PROVIDER=${a.provider}`, `${t.keyEnv}=${a.textKey}`, `EXTRACTION_MODEL=${a.model}`];
  const backend = ["# Created by scripts/init-env.mjs. Private: never commit or share this file.", "NODE_ENV=development", "API_PORT=8000", "FRONTEND_ORIGIN=http://localhost:3000", "APP_TIMEZONE=UTC", "LOG_LEVEL=debug", "",
    `SUPABASE_URL=${a.supabaseUrl.replace(/\/$/, "")}`, `SUPABASE_SERVICE_ROLE_KEY=${a.serviceKey}`, "AUTH_MODE=supabase", "ADMIN_USER_IDS=", "",
    "TRANSCRIPTION_PROVIDER=openai", `OPENAI_API_KEY=${openaiKey}`, "OPENAI_TRANSCRIPTION_MODEL=whisper-1", "", ...extraction, "", "STORE_TRANSCRIPTS=false", ""].join("\n");
  const frontend = ["# Created by scripts/init-env.mjs", "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000", `NEXT_PUBLIC_SUPABASE_URL=${a.supabaseUrl.replace(/\/$/, "")}`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${a.anonKey}`, "NEXT_PUBLIC_AUTH_MODE=supabase", "NEXT_PUBLIC_SITE_URL=http://localhost:3000", ""].join("\n");
  return { backend, frontend };
}

/** Changes or adds one KEY=VALUE line in an env file's text. */
export function setValue(text, key, value) {
  if (!/^[A-Z][A-Z0-9_]*\$/.test(key)) throw new Error(`"${key}" is not a valid setting name (use capital letters, numbers and underscores).`);
  if (/[\(\r\\)n]/.test(value)) throw new Error("The value cannot contain a line break.");
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, () => `${key}=${value}`) : text.replace(/\n*\$/, "\n") + `${key}=${value}\n`;
}

async function realIo() {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  let muted = false;
  rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); else if (s.includes("\n")) rl.output.write("\n"); };   // hide what you type, keep the line break
  return { ask: (q, { secret = false } = {}) => new Promise((res) => { process.stdout.write(q); muted = secret; rl.question("", (a) => { muted = false; res(a.trim()); }); }), say: (s) => console.log(s), close: () => rl.close() };
}

export async function run(argv, { io, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), } = {}) {
  const force = argv.includes("--force");
  const si = argv.indexOf("--set");
  const files = { backend: path.join(root, "backend", ".env"), frontend: path.join(root, "frontend", ".env.local") };
  if (si >= 0) {
    const [key, ...rest] = (argv[si + 1] ?? "").split("="); const fi = argv.indexOf("--file");
    const target = path.join(root, fi >= 0 ? argv[fi + 1] : "backend/.env");
    if (!key || !rest.length) throw new Error("Usage: --set KEY=VALUE");
    if (!existsSync(target)) throw new Error(`${path.relative(root, target)} does not exist yet. Run this script without --set first.`);
    writeFileSync(target, setValue(readFileSync(target, "utf8"), key, rest.join("=")), "utf8");
    return { changed: path.relative(root, target), key };
  }
  const existing = Object.values(files).filter(existsSync);
  if (existing.length && !force) throw new Error(`These files already exist: ${existing.map((f) => path.relative(root, f)).join(", ")}. Nothing was changed. Use --force to replace them, or --set KEY=VALUE to change one value.`);
  const own = io ?? (await realIo()); const a = {};
  own.say("\nVoiceSync setup. Press Enter after each answer. Keys are hidden as you paste them.\n");
  own.say("From Supabase: Project Settings, API.");
  a.supabaseUrl = await own.ask("1. Project URL (https://....supabase.co): ");
  a.anonKey = await own.ask("2. PUBLIC key (anon or publishable): ", { secret: true });
  a.serviceKey = await own.ask("3. SECRET key (service_role): ", { secret: true });
  
  own.say("\nText provider (picks the task details out of what you said):"); 
  TEXT_PROVIDERS.forEach((t, i) => { own.say(`   ${i + 1}. ${t.label}`); });
  
  const pick = await own.ask("4. Number [1 = Anthropic]: "); a.provider = TEXT_PROVIDERS[(Number(pick || 1) || 0) - 1]?.id;
  a.openaiKey = await own.ask("5. OpenAI key (used for speech to text): ", { secret: true });
  if (a.provider && a.provider !== "openai") {
    a.textKey = await own.ask(`6. ${TEXT_PROVIDERS.find((t) => t.id === a.provider)?.label} key: `, { secret: true });
  }
  a.model = await own.ask("7. Extraction model ID: ");
  
  const problems = validate(a);
  if (problems.length) {
    own.say("\nProblems found with configuration options:\n" + problems.map((p) => `- ${p}`).join("\n") + "\n");
    own.close();
    return;
  }
  
  const generated = buildEnvFiles(a);
  if (!existsSync(path.dirname(files.backend))) mkdirSync(path.dirname(files.backend), { recursive: true });
  if (!existsSync(path.dirname(files.frontend))) mkdirSync(path.dirname(files.frontend), { recursive: true });
  
  writeFileSync(files.backend, generated.backend, "utf8");
  writeFileSync(files.frontend, generated.frontend, "utf8");
  own.say(`\nSuccess! Created files:\n  - backend/.env\n  - frontend/.env.local\n`);
  own.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((err) => {
    console.error("\nError: " + err.message + "\n");
    process.exit(1);
  });
}
