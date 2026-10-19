"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-slate-700">That page hit a problem. Your tasks are safe. Try again, and if it keeps happening, tell the person who runs this service.</p>
      <div className="mt-8 flex justify-center gap-3"><button type="button" onClick={reset} className="rounded-lg bg-[#1f6bff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a5fe6]">Try again</button><Link href="/" className="rounded-lg border border-[#dbe1ea] bg-white px-4 py-2 text-sm font-semibold">Go to the home page</Link></div>
    </main>
  );
}
