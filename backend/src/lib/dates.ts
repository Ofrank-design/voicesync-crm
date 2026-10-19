import { isValidIsoDate } from "./schema";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Friday 16 October 2026" from a YYYY-MM-DD date, with no timezone drift. */
export function friendlyDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return `${weekdayOf(isoDate)} ${d} ${MONTHS[m - 1]} ${y}`;
}

export interface DateContext { referenceDate: string; weekday: string; timezone: string }

/** Resolve the reference date: explicit valid reference_date wins, else "today" in the timezone. */
export function buildDateContext(opts: { timezone?: string; referenceDate?: string; appTimezone: string; now?: Date }): DateContext {
  const tz = opts.timezone && isValidTimezone(opts.timezone) ? opts.timezone : opts.appTimezone;
  const ref = opts.referenceDate && isValidIsoDate(opts.referenceDate) ? opts.referenceDate : todayIn(tz, opts.now);
  return { referenceDate: ref, weekday: weekdayOf(ref), timezone: tz };
}
