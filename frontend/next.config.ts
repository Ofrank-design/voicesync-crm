import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// A production build with the development "no sign in" mode switched on would ship an app with no login. Refuse to build it.
if (isProd && process.env.NEXT_PUBLIC_AUTH_MODE === "local" && process.env.VOICESYNC_ALLOW_LOCAL_BUILD !== "1") {
  throw new Error("NEXT_PUBLIC_AUTH_MODE=local is for development only and cannot be used in a production build.");
}
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const https = site.startsWith("https://");
// Only Supabase gets a websocket allowance (it is used for realtime). Your own API is plain https.
const originsOf = (u?: string, ws = false) => { if (!u) return []; try { const x = new URL(u); return [x.origin, ...(ws && x.protocol === "https:" ? [`wss://${x.host}`] : [])]; } catch { return []; } };

/**
 * Browser side protection. The policy only lets the page talk to itself, your API and Supabase, blocks framing,
 * plugins and outside scripts. 'unsafe-inline' is needed because Next.js writes small inline scripts and styles;
 * moving to per request nonces would tighten this further. Development skips the policy (hot reload needs eval).
 */
const csp = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob:", "font-src 'self' data:",
  `connect-src 'self' ${[...originsOf(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"), ...originsOf(process.env.NEXT_PUBLIC_SUPABASE_URL, true)].join(" ")}`.trim(),
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", ...(https ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    }];
  },
};
export default nextConfig;
