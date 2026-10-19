"use client";
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1.25rem", color: "#0b1530" }}>
      <h1>Something went wrong</h1><p>The page could not load. Your tasks are safe.</p>
      <button type="button" onClick={reset} style={{ background: "#1f6bff", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 600 }}>Try again</button>
    </body></html>
  );
}
