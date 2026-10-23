import type { InquiryContact, InquiryStatus } from "../shared/types";
import { ageLabel, toman } from "./lib/text";

/**
 * Pure, testable helpers behind the seller-inquiry flow.
 *
 * The app never calls a seller, never sends a message and never claims a
 * reply. It prepares a real draft from recorded data and lets the user choose
 * the channel; only the user can report an outcome, and that report stays
 * local and labelled as user-reported.
 */

function safeHref(raw: string | null | undefined, kind: "website" | "instagram"): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (/^(javascript|data|vbscript):/.test(lower)) return null;
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  if (kind === "instagram") {
    const handle = value
      .replace(/^@/, "")
      .replace(/^instagram\.com\//i, "")
      .replace(/\/+$/, "");
    if (!handle || !/^[A-Za-z0-9._]{1,40}$/.test(handle)) return null;
    return `https://instagram.com/${handle}`;
  }
  // A bare domain: only accept something shaped like a host name.
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) return null;
  return `https://${value}`;
}

export function inquiryContacts(input: {
  website?: string | null;
  instagram?: string | null;
}): InquiryContact[] {
  const contacts: InquiryContact[] = [];
  const website = safeHref(input.website, "website");
  if (website) contacts.push({ kind: "website", label: "وب‌سایت فروشگاه", href: website });
  const instagram = safeHref(input.instagram, "instagram");
  if (instagram) contacts.push({ kind: "instagram", label: "اینستاگرام فروشگاه", href: instagram });
  return contacts;
}

export interface InquiryDraftInput {
  productTitle: string;
  shopName: string;
  price: number;
  changedAt: string | null;
  warranty?: string | null;
}

function daysSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function buildInquiryMessage(input: InquiryDraftInput): string {
  const when = input.changedAt ? ageLabel(daysSince(input.changedAt)) : "تاریخ ثبت نامشخص";
  const lines = [
    "سلام، از طریق ترب‌یار در حال بررسی یک خرید حضوری هستم:",
    "",
    `- کالا: ${input.productTitle}`,
    `- فروشگاه شما: ${input.shopName}`,
    `- قیمت ثبت‌شده در دیتاست: ${toman(input.price)} (${when})`,
  ];
  if (input.warranty) lines.push(`- گارانتی ثبت‌شده: ${input.warranty}`);
  lines.push(
    "",
    "این قیمت ثبت‌شده است و موجودی فعلی را تأیید نمی‌کند. لطفا در مورد موارد زیر پاسخ دهید:",
    "۱. آیا کالا موجود است؟ اگر وجود دارد، چقدر طول می‌کشد؟",
    "۲. قیمت نهایی و شرایط پرداخت حضوری چیست؟",
    "۳. گارانتی و شرایط پس از فروش چیست؟",
    "۴. آیا تحویل فوری یا خرید حضوری امکان‌پذیر است؟",
  );
  return lines.join("\n");
}

export function inquiryStatusLabel(status: InquiryStatus): string {
  switch (status) {
    case "ready":
      return "آماده‌ی تماس";
    case "opened":
      return "کاربر کانال ارتباطی را باز کرده";
    case "awaiting":
      return "منتظر پاسخ";
    case "stock_confirmed":
      return "فروشنده موجودی را تأیید کرده (گزارش کاربر)";
    case "price_reported":
      return "فروشنده قیمت دیگری اعلام کرده (گزارش کاربر)";
    case "not_found":
      return "کالای ناموجود (گزارش کاربر)";
    case "no_response":
      return "فروشنده پاسخ نداده";
    case "failed":
      return "پیگیری ناموفق";
    default:
      return status;
  }
}

/** Human readable next step for an inquiry, used by the contextual engine. */
export function inquiryNextStep(status: InquiryStatus, hasContact: boolean): string {
  if (!hasContact) return "فروشنده‌ی دیگری با راه تماس ثبت‌شده پیدا کن";
  switch (status) {
    case "ready":
      return "کانال ارتباطی را باز کن یا پیام را کپی کن";
    case "opened":
    case "awaiting":
      return "نتیجه‌ی تماس را گزارش کن";
    case "stock_confirmed":
      return "قیمت و گارانتی نهایی را تأیید کن";
    case "price_reported":
      return "قیمت جدید را با دیگر فروشنده‌ها مقایسه کن";
    case "not_found":
      return "جایگزین واقعی در همان دسته پیدا کن";
    case "no_response":
    case "failed":
      return "فروشنده‌ی دیگر با راه تماس ثبت‌شده پیدا کن";
    default:
      return "وضعیت را گزارش کن";
  }
}
