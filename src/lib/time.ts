/*
 * Schedule times are stored as a local calendar day ("YYYY-MM-DD") plus minutes
 * after midnight at the track. That keeps every comparison in track-local terms
 * and makes "delay everything by 20 minutes" a plain integer shift.
 */

export type ZonedNow = { day: string; minutes: number; seconds: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** The wall-clock day and time at the track for a given instant. */
export function zoned(date: Date, tz: string): ZonedNow {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(date)) p[part.type] = part.value;
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
  };
}

/** Milliseconds to add to a real instant so the track clock reads `day` at `minutes`. */
export function offsetToReach(day: string, minutes: number, tz: string, from = new Date()): number {
  const cur = zoned(from, tz);
  const dayDiff = daysBetween(cur.day, day);
  return (dayDiff * 1440 + (minutes - cur.minutes)) * 60000 - cur.seconds * 1000;
}

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export function addDays(day: string, n: number): string {
  const d = noon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 86400000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekdayIndex(day: string): number {
  return noon(day).getUTCDay();
}

export function addBusinessDays(day: string, n: number): string {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const w = weekdayIndex(d);
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

const dayFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
const fWeekday = dayFmt({ weekday: "long" });
const fWeekdayShort = dayFmt({ weekday: "short" });
const fMonthDay = dayFmt({ month: "short", day: "numeric" });
const fLong = dayFmt({ weekday: "long", month: "long", day: "numeric" });
const fFull = dayFmt({ month: "long", day: "numeric", year: "numeric" });

export const weekday = (day: string) => fWeekday.format(noon(day));
export const weekdayShort = (day: string) => fWeekdayShort.format(noon(day));
export const monthDay = (day: string) => fMonthDay.format(noon(day));
export const dayLong = (day: string) => fLong.format(noon(day));
export const dayFull = (day: string) => fFull.format(noon(day));

export function dateRange(start: string, end: string): string {
  if (start === end) return dayFull(start);
  const a = noon(start);
  const b = noon(end);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const year = b.getUTCFullYear();
  if (sameMonth) return `${dayFmt({ month: "long" }).format(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${year}`;
  return `${fMonthDay.format(a)} – ${fMonthDay.format(b)}, ${year}`;
}

/** 495 → { time: "8:15", period: "AM" } */
export function clockParts(min: number): { time: string; period: "AM" | "PM" } {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { time: `${h12}:${mm}`, period: h24 < 12 ? "AM" : "PM" };
}

export function clock(min: number): string {
  const p = clockParts(min);
  return `${p.time} ${p.period}`;
}

/** "8:15–8:45 AM" or "11:40 AM–12:00 PM" */
export function clockRange(a: number, b: number): string {
  const pa = clockParts(a);
  const pb = clockParts(b);
  return pa.period === pb.period ? `${pa.time}–${pb.time} ${pb.period}` : `${pa.time} ${pa.period}–${pb.time} ${pb.period}`;
}

/** "HH:MM" (24h, for <input type="time">) ↔ minutes */
export function toTimeInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
export function fromTimeInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Seconds → "12:41" under an hour, "1h 24m" beyond. */
export function countdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "15, 10 and 5 minutes", longest first, from a region's reminder settings. Null when there are none. */
export function leadTimes(offsets: number[] | null | undefined): string | null {
  const list = [...new Set(offsets ?? [])].sort((a, b) => b - a);
  if (!list.length) return null;
  const last = list[list.length - 1];
  return `${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ` : ""}${last} minute${list.length === 1 && last === 1 ? "" : "s"}`;
}

export function duration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function relativeTime(then: Date | string, now: Date | number = Date.now()): string {
  const t = typeof then === "string" ? new Date(then).getTime() : then.getTime();
  const n = typeof now === "number" ? now : now.getTime();
  const s = Math.round((n - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const d = Math.round(s / 86400);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

export function dateTime(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function dateOnly(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(date);
}
