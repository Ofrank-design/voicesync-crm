/** Date-only helpers. Never parse YYYY-MM-DD with new Date(str) in local time: it shifts across timezones. */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function formatDateOnly(iso: string | null): string {
  if (!iso) return "No date set";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export const isOverdue = (due: string | null, status: string, today = todayLocal()) => !!due && status !== "completed" && due < today;
export const userTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
