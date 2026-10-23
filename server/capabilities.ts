import type {
  Provenance,
  ShopCapability,
  ShopIdentity,
} from "../shared/types";

/**
 * Buying capabilities of a shop, each with an explicit status and provenance.
 *
 * Hard rule: nothing here is inferred from a shop name, a category, a social
 * handle or the model. A capability whose field is absent from the dataset is
 * reported as `unregistered` (or `unknown`), never as `unsupported`; an
 * explicitly recorded `false` is `unsupported`. The two are different.
 */

export interface ShopCapabilityInput {
  payments: string[];
  fast_delivery: boolean;
  has_hours: boolean;
  identity: ShopIdentity;
}

/**
 * Installment / deferred-payment hints that may appear inside the recorded
 * `payment_options` list. The list is deliberately short and explicit: a
 * provider name that is not here means «no installment recorded», never
 * «the shop does not offer installments».
 */
const INSTALLMENT_HINTS = [
  "atin",
  "kiwi",
  "paykhor",
  "installment",
  "qesht",
  "قسط",
  "قسمت",
  "قسطی",
];

function detectInstallment(payments: string[]): string | null {
  for (const name of payments) {
    const lower = name.toLowerCase();
    if (INSTALLMENT_HINTS.some((hint) => lower.includes(hint))) return name;
  }
  return null;
}

export function shopCapabilities(input: ShopCapabilityInput): ShopCapability[] {
  const installmentProvider = detectInstallment(input.payments);

  const installment: ShopCapability = installmentProvider
    ? {
        key: "installment",
        label: "خرید قسطی",
        status: "recorded",
        source: "seller_reported",
        detail: `خرید قسطی: اعلام فروشنده (${installmentProvider})، تأیید مستقل نشده.`,
      }
    : {
        key: "installment",
        label: "خرید قسطی",
        status: "unregistered",
        source: "unknown",
        detail: "خرید قسطی: در روش‌های ثبت‌شده‌ی پرداخت فروشنده اشاره‌ی مستقیمی به اقساط نیست؛ این به معنی عدم پشتیبانی نیست.",
      };

  const payments: ShopCapability =
    input.payments.length > 0
      ? {
          key: "payments",
          label: "شرایط پرداخت",
          status: "recorded",
          source: "dataset",
          detail: `شرایط پرداخت: ثبت‌شده در دیتاست (${input.payments.slice(0, 4).join("، ")}).`,
        }
      : {
          key: "payments",
          label: "شرایط پرداخت",
          status: "unregistered",
          source: "unknown",
          detail: "شرایط پرداخت: برای این فروشگاه ثبت نشده است.",
        };

  const fastDelivery: ShopCapability = input.fast_delivery
    ? {
        key: "fast_delivery",
        label: "ارسال سریع",
        status: "recorded",
        source: "dataset",
        detail: "ارسال سریع: ثبت‌شده در دیتاست.",
      }
    : {
        key: "fast_delivery",
        label: "ارسال سریع",
        status: "unsupported",
        source: "dataset",
        detail: "ارسال سریع: در دیتاست مشخص شده که این فروشگاه آن را پشتیبانی نمی‌کند.",
      };

  const hours: ShopCapability = input.has_hours
    ? {
        key: "hours",
        label: "ساعت کاری",
        status: "recorded",
        source: "dataset",
        detail: "ساعت کاری: ثبت‌شده در دیتاست؛ ممکن است تغییر کرده باشد.",
      }
    : {
        key: "hours",
        label: "ساعت کاری",
        status: "unregistered",
        source: "unknown",
        detail: "ساعت کاری: برای این فروشگاه ثبت نشده است.",
      };

  const contact: ShopCapability =
    input.identity === "registered"
      ? {
          key: "contact",
          label: "راه تماس ثبت‌شده",
          status: "recorded",
          source: "dataset",
          detail: "راه تماس: وب‌سایت یا اینستاگرام در دیتاست ثبت شده؛ شماره تلفن در این دیتاست معتبر نیست.",
        }
      : {
          key: "contact",
          label: "راه تماس ثبت‌شده",
          status: "unregistered",
          source: "unknown",
          detail: "راه تماس:برای این فروشگاه ثبت نشده است؛ آدرس یا لینک نامعتبری نشان ندهیم.",
        };

  return [
    {
      key: "tebpi",
      label: "پذیرندگی ترب‌پی",
      status: "unregistered",
      source: "unknown",
      detail: "پذیرندگی ترب‌پی: در دیتاست ثبت نشده است؛ پذیرنده‌ی قطعی محسوب نمی‌شود.",
    },
    installment,
    {
      key: "invoice",
      label: "کالابرگ",
      status: "unregistered",
      source: "unknown",
      detail: "کالابرگ: وضعیت نامشخص است؛ در دیتاست فیلد ثبت‌شده‌ای برای آن وجود ندارد.",
    },
    fastDelivery,
    payments,
    hours,
    contact,
  ];
}

/** Persian label for a provenance, used in the UI tooltip only. */
export function provenanceLabel(source: Provenance): string {
  switch (source) {
    case "dataset":
      return "ثبت‌شده در دیتاست";
    case "seller_reported":
      return "اعلام‌شده از طرف فروشنده";
    case "user_reported":
      return "گزارش‌شده توسط کاربر";
    case "verified_integration":
      return "تأییدشده از یکپارچه‌سازی";
    default:
      return "اطلاعات قابل‌اتکا موجود نیست";
  }
}
