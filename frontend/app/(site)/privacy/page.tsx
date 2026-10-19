import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy", description: "What VoiceSync CRM does with your recordings, text and tasks." };

const items = [
  ["What happens when you record", "Your voice note goes to your VoiceSync server, then to the speech and AI services your administrator chose. After each note, the review screen tells you which services handled it. If a backup service had to step in, it tells you that too."],
  ["What is saved", "Nothing is saved until you review the task and press save. Then the task details are stored: client, place, action, date and priority. Audio recordings are never stored. The words of your note are kept with a task only if your administrator turned that on."],
  ["Usage records", "For each call to an AI service, VoiceSync keeps a short record: who made it, which service and model, how long it took, and how many tokens or seconds of audio were used. These records never contain audio or text."],
  ["Who can see your tasks", "Only you. Every account sees only its own tasks."],
  ["Your choices", "You can download everything stored about you, or delete your account and all of it, at any time."],
  ["The AI services", "Each service has its own rules about how long it keeps data and whether it uses it for training. Your administrator is responsible for choosing services whose terms fit, and for telling you about them."],
] as const;

export default function Privacy() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-12" style={{ color: "#0b1530" }}>
      <Link href="/" className="text-sm underline">Back to the home page</Link>
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Privacy</h1>
      <p className="mt-3 text-slate-700">This page describes how the VoiceSync CRM software handles your data. The organisation that runs this service may add to it.</p>
      <div className="mt-8 space-y-6">
        {items.map(([h, t], i) => (<section key={h} aria-labelledby={`privacy-h-${i}`}><h2 id={`privacy-h-${i}`} className="text-lg font-bold">{h}</h2><p className="mt-1 text-slate-700">{t}</p></section>))}
      </div>
      <p className="mt-8"><Link href="/account" className="font-semibold underline" style={{ color: "#1450c0" }}>Download or delete your data</Link></p>
      {contact && <p className="mt-6 text-slate-700">Questions? Write to <a className="underline" href={`mailto:${contact}`}>{contact}</a>.</p>}
    </main>
  );
}
