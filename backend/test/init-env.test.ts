import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
// @ts-expect-error plain JavaScript script
import { buildEnvFiles, validate, keyKind, setValue, run, TEXT_PROVIDERS } from "../../scripts/init-env.mjs";
import { loadConfig } from "../src/config";

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.c2lnbmF0dXJl`;
const good = { supabaseUrl: "https://abcd1234.supabase.co/", anonKey: jwt("anon"), serviceKey: jwt("service_role"), openaiKey: "openai-key-value", provider: "anthropic", textKey: "text-key-value", model: "model-x" };
const scripted = (answers: string[]) => { const asked: Array<{ q: string; secret: boolean }> = []; let i = 0; return { asked, io: { say: () => {}, ask: async (q: string, o: { secret?: boolean } = {}) => { asked.push({ q, secret: !!o.secret }); return answers[i++] ?? ""; }, close: () => {} } }; };

describe("key mix up protection", () => {
  it("recognises public and secret Supabase keys in both formats", () => {
    expect(keyKind(jwt("anon"))).toBe("public"); expect(keyKind(jwt("service_role"))).toBe("secret");
    expect(keyKind("sb_publishable_abc")).toBe("public"); expect(keyKind("sb_secret_abc")).toBe("secret"); expect(keyKind("something")).toBe("unknown");
  });
  it("refuses the secret key in the website's slot and the public key in the server's slot", () => {
    expect(validate({ ...good, anonKey: jwt("service_role"), serviceKey: jwt("anon") }).join(" ")).toMatch(/PUBLIC key is the SECRET key.*SECRET key is the public one/s);
  });
  it("catches the same key pasted twice, a bad URL, empty values, quotes and an unknown provider", () => {
    expect(validate({ ...good, serviceKey: good.anonKey }).join(" ")).toMatch(/are the same/);
    expect(validate({ ...good, supabaseUrl: "http://x" }).join(" ")).toMatch(/should look like https/);
    expect(validate({ ...good, model: "" }).join(" ")).toMatch(/model ID is empty/); expect(validate({ ...good, openaiKey: '"abc"' }).join(" ")).toMatch(/space or quote/);
    expect(validate({ ...good, provider: "nope" }).join(" ")).toMatch(/Choose one of the listed/); expect(validate({ ...good, textKey: "" }).join(" ")).toMatch(/text provider key is empty/);
    expect(validate(good)).toEqual([]);
  });
});

describe("generated files", () => {
  it.each(TEXT_PROVIDERS.map((t: { id: string }) => t.id))("the backend file for %s is accepted by the real server configuration check", (id: string) => {
    const f = buildEnvFiles({ ...good, provider: id, textKey: id === "openai" ? "" : "text-key-value" });
    const cfg = loadConfig({ ...parse(f.backend) } as NodeJS.ProcessEnv);
    expect(cfg.EXTRACTION_PROVIDER).toBe(id); expect(cfg.SUPABASE_URL).toBe("https://abcd1234.supabase.co"); expect(cfg.AUTH_MODE).toBe("supabase"); expect(cfg.NODE_ENV).toBe("development");
  });
  it("puts the right key in the right file and never the secret key in the website file", () => {
    const f = buildEnvFiles(good); const web = parse(f.frontend), api = parse(f.backend);
    expect(web.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(good.anonKey); expect(f.frontend).not.toContain(good.serviceKey); expect(f.frontend).not.toContain(good.openaiKey);
    expect(api.SUPABASE_SERVICE_ROLE_KEY).toBe(good.serviceKey); expect(Object.keys(web).every((k) => k.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });
  it("with OpenAI as the text provider, one OpenAI key is enough", () => {
    const api = parse(buildEnvFiles({ ...good, provider: "openai", textKey: "", openaiKey: "the-one-key" }).backend);
    expect(api.OPENAI_API_KEY).toBe("the-one-key"); expect(api.EXTRACTION_PROVIDER).toBe("openai"); expect(api.EXTRACTION_MODEL).toBe("model-x");
  });
});

describe("the script", () => {
  const dir = () => mkdtempSync(path.join(tmpdir(), "initenv-"));
  const answers = [good.supabaseUrl, good.anonKey, good.serviceKey, "1", good.openaiKey, good.textKey, good.model];
  it("asks in order, hides every key, and creates both files with the exact names", async () => {
    const root = dir(), s = scripted(answers);
    const r = await run([], { io: s.io, root });
    expect(r.created.map((p: string) => p.replace(/\\/g, "/"))).toEqual(["backend/.env", "frontend/.env.local"]);
    expect(existsSync(path.join(root, "backend", ".env"))).toBe(true); expect(existsSync(path.join(root, "backend", ".env.txt"))).toBe(false);
    expect(s.asked.filter((a) => a.secret).map((a) => a.q.split(".")[0]).join()).toBe("2,3,5,6"); expect(s.asked.find((a) => /Project URL/.test(a.q))!.secret).toBe(false);
    expect(readFileSync(path.join(root, "backend", ".env"), "utf8")).not.toMatch(/^\uFEFF/);
  });
  it("writes nothing if an answer is wrong, and says why", async () => {
    const root = dir(); await expect(run([], { io: scripted([good.supabaseUrl, jwt("service_role"), jwt("anon"), "1", good.openaiKey, good.textKey, good.model]).io, root })).rejects.toThrow(/Nothing was written[\s\S]*SECRET key/);
    expect(existsSync(path.join(root, "backend", ".env"))).toBe(false);
  });
  it("never overwrites existing files unless told to", async () => {
    const root = dir(); await run([], { io: scripted(answers).io, root });
    writeFileSync(path.join(root, "backend", ".env"), "MY=CHANGES\n");
    await expect(run([], { io: scripted(answers).io, root })).rejects.toThrow(/already exist[\s\S]*Nothing was changed/); expect(readFileSync(path.join(root, "backend", ".env"), "utf8")).toBe("MY=CHANGES\n");
    await run(["--force"], { io: scripted(answers).io, root }); expect(readFileSync(path.join(root, "backend", ".env"), "utf8")).toContain("SUPABASE_URL=");
  });
  it("--set changes one value later, such as the admin ID, and keeps the rest", async () => {
    const root = dir(); await run([], { io: scripted(answers).io, root });
    const r = await run(["--set", "ADMIN_USER_IDS=abc-123"], { root }); expect(r).toMatchObject({ key: "ADMIN_USER_IDS" });
    const api = parse(readFileSync(path.join(root, "backend", ".env"), "utf8")); expect(api.ADMIN_USER_IDS).toBe("abc-123"); expect(api.SUPABASE_URL).toBe("https://abcd1234.supabase.co");
    await run(["--set", "NEXT_PUBLIC_SITE_URL=https://x.com", "--file", "frontend/.env.local"], { root }); expect(parse(readFileSync(path.join(root, "frontend", ".env.local"), "utf8")).NEXT_PUBLIC_SITE_URL).toBe("https://x.com");
  });
  it("--set adds a missing setting, rejects bad names, and needs the files to exist", async () => {
    expect(setValue("A=1\n", "B", "2")).toBe("A=1\nB=2\n"); expect(setValue("A=1\n", "A", "9")).toBe("A=9\n"); expect(setValue("A=1", "A", "x=y")).toBe("A=x=y");
    expect(() => setValue("", "bad name", "1")).toThrow(/not a valid setting name/); expect(() => setValue("", "A", "1\n2")).toThrow(/line break/);
    await expect(run(["--set", "A=1"], { root: dir() })).rejects.toThrow(/does not exist yet/);
  });
});
