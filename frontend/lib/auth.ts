"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === "local" ? "local" : "supabase";
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase is not set up yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or set NEXT_PUBLIC_AUTH_MODE=local for development.");
    client = createClient(url, key);
  }
  return client;
}
export async function getAccessToken(): Promise<string | null> {
  if (AUTH_MODE === "local") return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}
