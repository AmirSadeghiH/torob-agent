import type { FreshnessLevel } from "../../shared/types";

export const DAY_MS = 86_400_000;

export function ageDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

export function freshnessOf(iso: string | null, now = Date.now()): FreshnessLevel {
  const days = ageDays(iso, now);
  if (days === null) return "unknown";
  if (days <= 7) return "fresh";
  if (days <= 30) return "recent";
  if (days <= 90) return "stale";
  return "old";
}

export const FRESHNESS_TEXT: Record<FreshnessLevel, string> = {
  fresh: "قیمت تازه",
  recent: "قیمت کم‌خطر",
  stale: "قیمت قدیمی",
  old: "قیمت کهنه",
  unknown: "بدون تاریخ قیمت",
};

/** UI tone per freshness level, used for badges and map/list accents. */
export const FRESHNESS_TONE: Record<FreshnessLevel, "good" | "warn" | "bad" | "neutral"> = {
  fresh: "good",
  recent: "good",
  stale: "warn",
  old: "bad",
  unknown: "neutral",
};

export function isoDaysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString();
}
