import type { Reliability, ReliabilitySignal } from "../shared/types";
import { ageDays } from "./lib/freshness";
import { fa, toman } from "./lib/text";

export interface ReliabilityShop {
  phone: string | null;
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
 * Transparent 0–100 confidence score for one offer.
 * Every point is attributable to a signal the UI prints, so the number is
 * never a black box: freshness, shop reachability, warranty, price sanity.
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

  if (input.shop.phone) {
    add({
      key: "phone",
      label: "تماس مستقیم",
      detail: "شمارهٔ فروشگاه ثبت شده؛ می‌توانید موجودی را تلفنی بپرسید.",
      tone: "good",
      points: 8,
    });
  } else {
    add({
      key: "phone",
      label: "تماس مستقیم",
      detail: "شماره‌ای برای این فروشگاه ثبت نشده است.",
      tone: "warn",
      points: 0,
    });
  }

  if (input.shop.has_hours) {
    add({
      key: "hours",
      label: "ساعت کاری",
      detail: "ساعت کاری فروشگاه اعلام شده است.",
      tone: "good",
      points: 6,
    });
  }
  if (input.shop.has_website || input.shop.has_instagram) {
    add({
      key: "presence",
      label: "حضور آنلاین",
      detail: "فروشگاه وب‌سایت یا اینستاگرام دارد.",
      tone: "good",
      points: 4,
    });
  }
  if (input.shop.has_address) {
    add({
      key: "address",
      label: "نشانی",
      detail: "نشانی دقیق برای مراجعهٔ حضوری موجود است.",
      tone: "good",
      points: 3,
    });
  }

  if (input.warranty) {
    add({
      key: "warranty",
      label: "گارانتی",
      detail: `شرایط گارانتی: ${input.warranty}`,
      tone: "good",
      points: 6,
    });
  } else {
    add({
      key: "warranty",
      label: "گارانتی",
      detail: "گارانتی برای این پیشنهاد ثبت نشده است.",
      tone: "neutral",
      points: 0,
    });
  }

  if (input.description) {
    add({
      key: "description",
      label: "توضیح فروشنده",
      detail: "فروشنده توضیح تکمیلی برای این پیشنهاد نوشته است.",
      tone: "good",
      points: 2,
    });
  }

  const { median, second_min, offer_count } = input.market;
  if (second_min !== null && second_min > 0 && input.price < second_min * 0.6) {
    add({
      key: "price_low",
      label: "اختلاف قیمت",
      detail: `این پیشنهاد ${toman(second_min - input.price)} از ارزان‌ترین گزینهٔ بعدی کمتر است؛ پیش از پرداخت، اصالت و موجودی را بررسی کنید.`,
      tone: "warn",
      points: -12,
    });
  } else if (median !== null && median > 0 && input.price > median * 1.35) {
    add({
      key: "price_high",
      label: "اختلاف قیمت",
      detail: "قیمت به‌طور محسوس بالاتر از میانهٔ همین کالا در بازار است.",
      tone: "warn",
      points: -8,
    });
  } else if (median !== null) {
    add({
      key: "price_band",
      label: "بازهٔ قیمت",
      detail: "قیمت در محدودهٔ معمول همین کالا در بازار است.",
      tone: "good",
      points: 4,
    });
  }

  if (offer_count >= 4) {
    add({
      key: "competition",
      label: "تعداد پیشنهاد",
      detail: `${fa(offer_count)} فروشگاه این کالا را عرضه می‌کنند؛ قیمت با بازار مقایسه‌پذیر است.`,
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
      ? "اطلاعات قابل اتکا"
      : level === "medium"
        ? "نسبتاً قابل اتکا"
        : level === "low"
          ? "نیازمند تماس"
          : "کم‌اطلاعات";

  const summary =
    level === "high"
      ? "قیمت تازه است و فروشگاه راه تماس دارد؛ برای رفتن، فقط موجودی را تأیید کنید."
      : level === "medium"
        ? "اطلاعات اصلی موجود است، اما تأیید تلفنی موجودی و قیمت را جا نیندازید."
        : "پیش از رفتن حتماً تماس بگیرید؛ اطلاعات این پیشنهاد ناقص یا قدیمی است.";

  return { score, level, label, summary, signals };
}
