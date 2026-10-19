import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const description = "Record a quick voice note after a meeting and VoiceSync turns it into a task with the client, place, action and date. You check it before it is saved.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "VoiceSync CRM", template: "%s | VoiceSync CRM" },
  description,
  applicationName: "VoiceSync CRM",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
  openGraph: { title: "VoiceSync CRM", description, siteName: "VoiceSync CRM", type: "website", images: [{ url: "/images/og.jpg", width: 1200, height: 630, alt: "Someone recording a voice note while a task board fills in on a screen beside them" }] },
  twitter: { card: "summary_large_image", title: "VoiceSync CRM", description, images: ["/images/og.jpg"] },
};
export const viewport: Viewport = { themeColor: "#0a1330", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
