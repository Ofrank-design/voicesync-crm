"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AUTH_MODE, supabase } from "@/lib/auth";
import { Spinner } from "./ui";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5000, retry: 1, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={qc}><AuthGate>{children}</AuthGate></QueryClientProvider>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter(); const path = usePathname();
  const [ready, setReady] = useState(AUTH_MODE === "local");
  useEffect(() => {
    if (AUTH_MODE === "local") return;
    let cancelled = false;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => { if (cancelled) return; if (!data.session && path !== "/login") router.replace("/login"); else setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { if (!session && path !== "/login") router.replace("/login"); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [path, router]);
  if (!ready && path !== "/login") return <main className="p-8"><Spinner label="Loading…" /></main>;
  return <>{children}</>;
}
