import type { Reliability, ReliabilitySignal } from "../shared/types";
import { ageDays } from "./lib/freshness";
import { fa, toman } from "./lib/text";

export interface ReliabilityShop {
  has_hours: boolean;
  has_website: boolean;
  has_instagram: boolean;
  has_address: boolean;
  has_coords: boolean;
}

export interface ReliabilityInput {
  price: number;
  changed_at: string | null;
  warranty: string | null;
  description: string | null;
  shop: ReliabilityShop;
  market: {
    min: number | null;
    median: number | null;
    second_min: number | null;
    offer_count: number;
  };
  now?: number;
}

/**
 * Transparent 0–100 score for how fresh and complete the *record* is.
 * It says nothing about real stock, a real seller or a verified price: only
 * dataset signals the UI prints (price age, registered fields, warranty,
 * price position within the recorded range).
 */
export function scoreOffer(input: ReliabilityInput): Reliability {
  const signals: ReliabilitySignal[] = [];
  let score = 32;
  const add = (signal: ReliabilitySignal) => {
    signals.push(signal);
    score += signal.points;
  };
  const days = ageDays(input.changed_at, input.now);

  if (days === null) {
    add({
      key: "freshness",
      label: "تاریخ قیمت",
      detail: "زمان آخرین تغییر قیمت ثبت نشده است.",
      tone: "warn",
      points: 0,
    });
  } else if (days <= 7) {
    add({
      key: "freshness",
      label: "تازگی قیمت",
      detail: `قیمت ${days === 0 ? "همین امروز" : `${fa(days)} روز پیش`} ثبت شده است.`,
      tone: "good",
      points: 26,
    });
  } else if (days <= 30) {
    add({
      key: "freshness",
      label: "تازگی قیمت",
      detail: `قیمت ${fa(days)} روز پیش ثبت شده؛ پیش از رفتن، تأیید بگیرید.`,
      tone: "good",
      points: 19,
    });
  } else if (days <= 90) {
    add({
      key: "freshness",
      label: "تازگی قیمت",
      detail: `قیمت حدود ${fa(Math.round(days / 30))} ماه پیش ثبت شده و ممکن است تغییر کرده باشد.`,
      tone: "warn",
      points: 9,
    });
  } else {
    add({
      key: "freshness",
      label: "تازگی قیمت",
      detail: `قیمت بیش از ${fa(Math.floor(days / 30))} ماه پیش ثبت شده؛ آن را فقط به‌عنوان تخمین ببینید.`,
      tone: "bad",
      points: 1,
    });
  }

  if (input.shop.has_hours) {
    add({
      key: "hours",
      label: "ساعت کاری ثبت‌شده",
      detail: "ساعت کاری اعلام‌شده در دیتاست موجود است؛ ممکن است تغییر کرده باشد.",
      tone: "good",
      points: 6,
    });
  }
  if (input.shop.has_website || input.shop.has_instagram) {
    add({
      key: "presence",
      label: "صفحهٔ ثبت‌شده",
      detail: "وب‌سایت یا اینستاگرام در دیتاست ثبت شده است؛ به معنی تأیید مستقل فروشگاه نیست.",
      tone: "good",
      points: 4,
    });
  }
  if (input.shop.has_address) {
    add({
      key: "address",
      label: "نشانی ثبت‌شده",
      detail: "نشانی متنی در دیتاست ثبت شده است.",
      tone: "good",
      points: 3,
    });
  }

  if (input.warranty) {
    add({
      key: "warranty",
      label: "گارانتی ثبت‌شده",
      detail: `شرایط گارانتی در پیشنهاد ثبت شده است: ${input.warranty}`,
      tone: "good",
      points: 6,
    });
  } else {
    add({
      key: "warranty",
      label: "گارانتی",
      detail: "شرایط گارانتی برای این پیشنهاد ثبت نشده است؛ یعنی نبودِ گارانتی ثابت نمی‌شود.",
      tone: "neutral",
      points: 0,
    });
  }

  if (input.description) {
    add({
      key: "description",
      label: "توضیح ثبت‌شده",
      detail: "برای این پیشنهاد توضیح تکمیلی ثبت شده است.",
      tone: "good",
      points: 2,
    });
  }

  const { median, second_min, offer_count } = input.market;
  if (second_min !== null && second_min > 0 && input.price < second_min * 0.6) {
    add({
      key: "price_low",
      label: "اختلاف قیمت",
      detail: `این پیشنهاد ${toman(second_min - input.price)} از ارزان‌ترین قیمت ثبت‌شدهٔ بعدی کمتر است؛ چنین اختلافی معمولاً به بررسی بیشتر نیاز دارد.`,
      tone: "warn",
      points: -12,
    });
  } else if (median !== null && median > 0 && input.price > median * 1.35) {
    add({
      key: "price_high",
      label: "اختلاف قیمت",
      detail: "قیمت به‌طور محسوس بالاتر از میانهٔ قیمت‌های ثبت‌شدهٔ همین کالا است.",
      tone: "warn",
      points: -8,
    });
  } else if (median !== null) {
    add({
      key: "price_band",
      label: "بازهٔ قیمت",
      detail: "قیمت در محدودهٔ قیمت‌های ثبت‌شدهٔ همین کالا است.",
      tone: "good",
      points: 4,
    });
  }

  if (offer_count >= 4) {
    add({
      key: "competition",
      label: "تعداد پیشنهاد",
      detail: `${fa(offer_count)} پیشنهاد ثبت‌شده برای این کالا وجود دارد؛ مقایسه بر همین داده‌ها است.`,
      tone: "good",
      points: 4,
    });
  } else if (offer_count === 1) {
    add({
      key: "competition",
      label: "تعداد پیشنهاد",
      detail: "این تنها پیشنهاد ثبت‌شده برای این کالا است.",
      tone: "neutral",
      points: -2,
    });
  }

  score = Math.max(5, Math.min(96, Math.round(score)));
  const level: Reliability["level"] =
    score >= 76 ? "high" : score >= 58 ? "medium" : score >= 38 ? "low" : "unknown";
  const label =
    level === "high"
      ? "اطلاعات تازه و کامل"
      : level === "medium"
        ? "اطلاعات نسبتاً کامل"
        : level === "low"
          ? "اطلاعات ناقص"
          : "کم‌اطلاعات";

  const summary =
    level === "high"
      ? "تاریخ قیمت تازه است و بیشتر فیلدهای اطلاعاتی ثبت شده‌اند؛ این وضعیت تأیید موجودی یا صحت قیمت نیست."
      : level === "medium"
        ? "بخشی از اطلاعات ثبت شده است؛ قیمت و موجودی را از منبع دیگری بررسی کنید."
        : "اطلاعات این پیشنهاد ناقص یا قدیمی است؛ بدون بررسی بیشتر به آن تکیه نکنید.";

  return { score, level, label, summary, signals };
}
