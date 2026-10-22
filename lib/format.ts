import type { FreshnessLevel } from "@/shared/types";
import { formatJalali } from "@/lib/jalali";
import { fa, faNumber, formatToman } from "@/lib/utils";

export { fa, faNumber, formatToman };

export const FRESHNESS_LABEL: Record<FreshnessLevel, string> = {
  fresh: "قیمت تازه",
  recent: "قیمت کم‌خطر",
  stale: "قیمت قدیمی",
  old: "قیمت کهنه",
  unknown: "بدون تاریخ قیمت",
};

export const FRESHNESS_CLASS: Record<FreshnessLevel, string> = {
  fresh: "text-success",
  recent: "text-success",
  stale: "text-warning",
  old: "text-destructive",
  unknown: "text-muted-foreground",
};

export const FRESHNESS_DOT: Record<FreshnessLevel, string> = {
  fresh: "bg-success",
  recent: "bg-success",
  stale: "bg-warning",
  old: "bg-destructive",
  unknown: "bg-muted-foreground",
};

export function ageText(days: number | null): string {
  if (days === null) return "تاریخ نامشخص";
  if (days <= 0) return "همین امروز";
  if (days === 1) return "۱ روز پیش";
  if (days < 30) return `${fa(days)} روز پیش`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "۱ ماه پیش" : `${fa(months)} ماه پیش`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "۱ سال پیش" : `${fa(years)} سال پیش`;
}

export function moneyShort(value: number): string {
  if (value >= 1_000_000_000) {
    return `${fa((value / 1_000_000_000).toFixed(1)).replace(".", "٫")} میلیارد تومان`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const text = millions >= 10 ? fa(Math.round(millions)) : fa(millions.toFixed(1)).replace(".", "٫");
    return `${text} میلیون تومان`;
  }
  return formatToman(value);
}

export function distanceText(meters: number | null): string {
  if (meters === null) return "فاصله نامشخص";
  if (meters < 950) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50);
    return `${faNumber(rounded)} متر`;
  }
  const km = Math.round((meters / 1000) * 10) / 10;
  const text = Number.isInteger(km) ? fa(km) : fa(km.toFixed(1)).replace(".", "٫");
  return `${text} کیلومتر`;
}

export function jalaliDate(iso: string | null): string {
  if (!iso) return "نامشخص";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "نامشخص";
  return formatJalali(date);
}

export function jalaliDateTime(iso: string | null): string {
  if (!iso) return "نامشخص";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "نامشخص";
  const time = new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatJalali(date)}، ساعت ${time}`;
}

export function openStateText(openNow: boolean | null): string {
  if (openNow === null) return "ساعت کاری نامشخص";
  return openNow ? "الان باز است" : "الان بسته است";
}
