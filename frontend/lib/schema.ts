import { z } from "zod";

export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const reviewSchema = z.object({
  client_name: z.string().trim().min(1, "Add a client name").max(200),
  location: z.string().max(300),
  action_item: z.string().trim().min(1, "Add what needs to happen").max(1000),
  follow_up_date: z.string().refine((v) => v === "" || isValidIsoDate(v), "Pick a real date"),
  priority: z.enum(["low", "medium", "high"]),
});
export type ReviewValues = z.infer<typeof reviewSchema>;
