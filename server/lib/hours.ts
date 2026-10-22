import type { DayHours } from "../../shared/types";

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  sat: "شنبه",
  sun: "یکشنبه",
  mon: "دوشنبه",
  tue: "سه‌شنبه",
  wed: "چهارشنبه",
  thu: "پنجشنبه",
  fri: "جمعه",
};

/** Current weekday and minute-of-day in Tehran, no DST. */
export function tehranNow(now = new Date()): { day: DayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const map: Record<string, DayKey> = {
    Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
  };
  const day = map[weekday] ?? "sat";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { day, minutes: hour * 60 + minute };
}

function toMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function dayHours(raw: Record<string, unknown> | null, day: DayKey): DayHours | null {
  if (!raw) return null;
  const entry = raw[day];
  if (!entry || typeof entry !== "object") return null;
  const data = entry as { status?: unknown; shifts?: unknown };
  const status =
    data.status === "declared" || data.status === "closed" || data.status === "unsupported"
      ? data.status
      : "unknown";
  const shifts = Array.isArray(data.shifts)
    ? data.shifts
        .map((s) => {
          const shift = s as { start_time?: string; end_time?: string };
          if (!shift.start_time || !shift.end_time) return null;
          const start = toMinutes(shift.start_time);
          const end = toMinutes(shift.end_time);
          if (start === null || end === null || start === end) return null;
          return { start: shift.start_time.slice(0, 5), end: shift.end_time.slice(0, 5), startM: start, endM: end };
        })
        .filter((s): s is { start: string; end: string; startM: number; endM: number } => s !== null)
    : [];
  return {
    status,
    shifts: shifts.map((s) => ({ start: s.start, end: s.end })),
  };
}

export function openNow(hours: DayHours | null, minutes: number): boolean | null {
  if (!hours || hours.status === "closed") return hours?.status === "closed" ? false : null;
  if (hours.status !== "declared" || hours.shifts.length === 0) return null;
  return hours.shifts.some((s) => {
    const start = toMinutes(s.start);
    const end = toMinutes(s.end);
    if (start === null || end === null) return false;
    if (end > start) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end; // overnight shift
  });
}
