"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AUTH_MODE, supabase } from "@/lib/auth";
import { goHome } from "@/lib/nav";
import { Button, Card, ErrorMessage, useEscape } from "@/components/ui";

export default function Account() {
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  useEscape(asking, () => setAsking(false));

  async function download() {
    setBusy("export"); setError(null); setDone(null);
    try {
      const url = URL.createObjectURL(await api.exportData());
      const a = document.createElement("a"); a.href = url; a.download = "voicesync-my-data.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setDone("Your data was downloaded.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "The download did not work. Please try again."); }
    finally { setBusy(null); }
  }
  async function remove() {
    setBusy("delete"); setError(null);
    try {
      await api.deleteAccount();
      if (AUTH_MODE !== "local") await supabase().auth.signOut();
      goHome();
    } catch (e) { setError(e instanceof ApiError ? e.message : "The deletion did not work. Please try again."); setBusy(null); setAsking(false); }
  }

  return (
    <main id="main" className="mx-auto max-w-2xl space-y-5 p-4 md:p-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" aria-hidden />Back to dashboard</Link>
      <header><h1 className="text-2xl font-semibold">Your data</h1><p className="text-sm text-slate-600">See what is stored about you, or remove it. Read how we handle data in the <Link className="underline" href="/privacy">privacy notes</Link>.</p></header>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {done && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p>}

      <Card className="space-y-3"><h2 className="text-base font-semibold">Download your data</h2>
        <p className="text-sm text-slate-600">A file with all of your tasks and your usage records. It never includes recordings, because those are not stored.</p>
        <Button variant="secondary" onClick={download} loading={busy === "export"}><Download className="h-4 w-4" aria-hidden />Download my data</Button></Card>

      <Card className="space-y-3"><h2 className="text-base font-semibold">Delete your account and data</h2>
        <p className="text-sm text-slate-600">This removes every task and usage record of yours, and your login. It cannot be undone. Download your data first if you want a copy.</p>
        <Button variant="danger" onClick={() => { setAsking(true); setTyped(""); }}><Trash2 className="h-4 w-4" aria-hidden />Delete my account and data</Button></Card>

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-t" aria-describedby="del-b" className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <h2 id="del-t" className="text-lg font-semibold">Delete everything?</h2>
            <p id="del-b" className="text-sm text-slate-600">All your tasks, usage records and your login will be removed for good.</p>
            <div><label htmlFor="del-i" className="text-sm font-medium">Type DELETE to confirm</label>{/* biome-ignore lint/a11y/noAutofocus: the field sits in a dialog that was just opened, so focus must move into it */}
            <input id="del-i" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full rounded-lg border border-[#dbe1ea] px-3 py-2 text-sm" /></div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAsking(false)}>Cancel</Button><Button variant="danger" onClick={remove} loading={busy === "delete"} disabled={typed !== "DELETE"}>Delete everything</Button></div>
          </div>
        </div>
      )}
    </main>
  );
}
