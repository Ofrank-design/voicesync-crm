import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error plain JavaScript script
import { scanText, scanDir, scanDetailed } from "../../scripts/check-secrets.mjs";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { MemoryTaskRepo } from "../src/services/task-repo";
import { unauthorized } from "../src/lib/errors";
import { env, WEBM, bearer } from "./helpers";

// Fake keys are assembled at run time so this file does not trip the scanner it tests.
const fake = { openai: "sk-" + "a1B2c3D4".repeat(5), groq: "gsk_" + "Zy9Xw8Vu".repeat(4), jwt: "eyJ" + "hbGciOiJIUzI1NiIs".repeat(2) + "." + "eyJzdWIiOiIxMjM0NTY3".repeat(2) + "." + "SflKxwRJSMeKKF2QT4fw" };
describe("secret scanner", () => {
  it("finds the kinds of secret that must never be committed, without printing them", () => {
    for (const [name, text] of [["a.ts", `const k = "${fake.openai}"`], ["b.ts", `x = '${fake.groq}'`], ["c.ts", `token: ${fake.jwt}`], ["d.pem", "-----BEGIN " + "PRIVATE KEY-----"], ["e.sh", `export OPENAI_API_KEY=${"x".repeat(24)}`]] as const) {
      const f = scanText(name, text); expect(f.length, name).toBeGreaterThan(0); expect(JSON.stringify(f)).not.toContain(text.slice(12, 30));
    }
  });
  it("is quiet about normal code, short test values, and empty settings", () => {
    expect(scanText("a.ts", 'const a = "sk-test"; OPENAI_API_KEY=\nANTHROPIC_API_KEY=\nconst id = "eyJ"; // fine')).toEqual([]);
    expect(scanText(".env.example", "OPENAI_API_KEY=")).toEqual([]);
  });
  it("lets a line opt out on purpose", () => { expect(scanText("a.ts", `const k = "${fake.openai}"; // secret-scan: allow`)).toEqual([]); });
  it("flags real environment files but not the example", () => {
    expect(scanText(".env", "").length).toBe(1); expect(scanText("backend/.env.local", "").length).toBe(1); expect(scanText("backend/.env.example", "")).toEqual([]);
  });
  it("without git: walks the folder, skips build output, reports file and line, and only notes real .env files", () => {
    const d = mkdtempSync(path.join(tmpdir(), "scan-")); mkdirSync(path.join(d, "src")); mkdirSync(path.join(d, "node_modules"));
    writeFileSync(path.join(d, "src", "x.ts"), `line one\nconst k = "${fake.openai}"\n`); writeFileSync(path.join(d, "node_modules", "y.js"), `"${fake.openai}"`); writeFileSync(path.join(d, ".env"), "OPENAI_API_KEY=whatever");
    const r = scanDetailed(d, { useGit: false });
    expect(r.findings.map((x: any) => `${x.file}:${x.line}`)).toEqual([path.join("src", "x.ts") + ":2"]); expect(r.notes).toEqual([".env"]); expect(r.mode).toBe("folder");
  });
  it("in a git folder: your private .env files are fine while git ignores them, and a committed one is caught", () => {
    const d = mkdtempSync(path.join(tmpdir(), "scan-git-")); const git = (...a: string[]) => execFileSync("git", a, { cwd: d, stdio: "ignore" });
    git("init"); writeFileSync(path.join(d, ".gitignore"), ".env\n.env.local\n"); mkdirSync(path.join(d, "backend"));
    writeFileSync(path.join(d, "backend", ".env"), `OPENAI_API_KEY=${fake.openai}`); writeFileSync(path.join(d, ".env.local"), `OPENAI_API_KEY=${fake.openai}`); writeFileSync(path.join(d, "ok.ts"), "export const a = 1;\n");
    expect(scanDetailed(d).findings).toEqual([]); expect(scanDetailed(d).mode).toBe("git");
    writeFileSync(path.join(d, ".env.production"), "X=1");                                      // not ignored, so it would be committed
    writeFileSync(path.join(d, "leak.ts"), `const k = "${fake.openai}"\n`);
    expect(scanDetailed(d).findings.map((x: any) => x.file).sort()).toEqual([".env.production", "leak.ts"]);
  });
  it("finds nothing in this project", () => { expect(scanDir(path.resolve(__dirname, "../.."))).toEqual([]); });
});

describe("rate limits protect the expensive endpoints", () => {
  const dev = () => createApp({ config: loadConfig({ ...env, NODE_ENV: "development" } as NodeJS.ProcessEnv), auth: { authenticate: async (t) => { if (!t) throw unauthorized(); return t; } }, transcriber: { transcribe: async () => "hi" }, extractor: { extract: async () => ({ task: { client_name: "A", location: "", action_item: "B", follow_up_date: "", priority: "low" }, warnings: [] }) }, repo: new MemoryTaskRepo() });
  it("allows a burst of voice notes, then answers 429 with a plain message and standard headers", async () => {
    const app = dev(); const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(app).post("/api/voice-sync").set(bearer(`u${i}`)).attach("audio", WEBM, "a.webm")).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true); expect(codes.slice(10)).toEqual([429, 429]);
    const limited = await request(app).post("/api/voice-sync").set(bearer("u99")).attach("audio", WEBM, "a.webm");
    expect(limited.body.error).toMatchObject({ code: "rate_limited" }); expect(limited.body.error.message).toMatch(/wait a minute/i); expect(limited.headers["ratelimit-limit"] ?? limited.headers["ratelimit"]).toBeTruthy();
  });
  it("a general request flood is limited too, and the limit does not apply to the health checks' neighbours unfairly", async () => {
    const app = dev(); let limited = 0;
    for (let i = 0; i < 130; i++) if ((await request(app).get("/api/live")).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});
