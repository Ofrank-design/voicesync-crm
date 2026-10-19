import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg px-5 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#1450c0" }}>Page not found</p>
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight">We could not find that page</h1>
      <p className="mt-3 text-slate-700">It may have moved, or the address may have a typo.</p>
      <div className="mt-8 flex justify-center gap-3"><Link href="/" className="rounded-lg bg-[#1f6bff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a5fe6]">Go to the home page</Link><Link href="/dashboard" className="rounded-lg border border-[#dbe1ea] bg-white px-4 py-2 text-sm font-semibold">Open the dashboard</Link></div>
    </main>
  );
}
