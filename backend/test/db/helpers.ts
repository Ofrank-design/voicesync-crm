import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
export const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";

/** The parts of Supabase the migrations rely on: the three API roles, auth.uid(), and the default table grants Supabase applies. */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
export const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const f of migrationFiles()) await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  return db;
}
/** Run a query the way the API would see it: as the given Postgres role, with the Supabase JWT subject set. */
export async function as<T = any>(db: PGlite, who: "anon" | "service_role" | { user: string }, sql: string, params: unknown[] = []): Promise<T[]> {
  const role = typeof who === "string" ? who : "authenticated";
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${typeof who === "string" ? "" : who.user}', false); set role ${role};`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
export const task = (user: string, over: Record<string, unknown> = {}) => ({ user_id: user, client_name: "Ama", location: "Osu", action_item: "Send invoice", ...over });
export const insertTask = (db: PGlite, who: Parameters<typeof as>[1], t: Record<string, unknown>) =>
  as(db, who, `insert into public.crm_tasks (${Object.keys(t).join(",")}) values (${Object.keys(t).map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(t));
