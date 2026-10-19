import type { MetadataRoute } from "next";
const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${base}/`, changeFrequency: "monthly", priority: 1 }, { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 }];
}
