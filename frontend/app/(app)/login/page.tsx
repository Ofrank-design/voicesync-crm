"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AUTH_MODE, supabase } from "@/lib/auth";
import { BrandLogo } from "@/components/BrandLogo";
import { Button, Card, ErrorMessage } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in"); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [info, setInfo] = useState<string | null>(null);
  if (AUTH_MODE === "local") return <main className="p-8">You are running in local mode, so there is nothing to sign in to. <a className="underline" href="/dashboard">Go to dashboard</a></main>;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
    const sb = supabase();
    const { data, error } = mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) router.replace("/dashboard"); else setInfo("Check your email to confirm your account, then sign in.");
  }
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-sm items-center p-4">
      <Card className="w-full space-y-4">
        <h1><BrandLogo /></h1>
        <form onSubmit={submit} className="space-y-3">
          <div><label htmlFor="email" className="text-sm font-medium">Email</label><input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-[#dbe1ea] px-3 py-2 text-sm" /></div>
          <div><label htmlFor="pw" className="text-sm font-medium">Password</label><input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-[#dbe1ea] px-3 py-2 text-sm" /></div>
          {err && <ErrorMessage>{err}</ErrorMessage>}{info && <p role="status" className="text-sm text-emerald-800">{info}</p>}
          <Button type="submit" loading={busy} className="w-full">{mode === "in" ? "Sign in" : "Create account"}</Button>
        </form>
        <button type="button" className="text-sm underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}</button>
        <p className="text-xs text-slate-600">See how we handle your data in the <a className="underline" href="/privacy">privacy notes</a>.</p>
      </Card>
    </main>
  );
}
