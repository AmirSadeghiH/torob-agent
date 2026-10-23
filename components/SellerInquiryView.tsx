import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, Globe, Instagram } from "lucide-react";
import type { Block, InquiryStatus } from "@/shared/types";
import { cn } from "@/lib/utils";
import { distanceText, fa, formatToman } from "@/lib/format";
import { safeExternalHref } from "@/lib/links";

type InquiryBlock = Extract<Block, { type: "seller_inquiry" }>;
type FollowupBlock = Extract<Block, { type: "seller_followup" }>;

/** The statuses a user can report after contacting a seller. */
const FOLLOWUPS: { status: InquiryStatus; label: string }[] = [
  { status: "awaiting", label: "در انتظار پاسخ" },
  { status: "no_response", label: "پاسخ نرسید" },
  { status: "stock_confirmed", label: "موجود است" },
  { status: "not_found", label: "یافته نشد" },
  { status: "price_reported", label: "قیمت گزارش شد" },
  { status: "failed", label: "خراب شد" },
];

const STATUS_LABEL: Record<InquiryStatus, string> = {
  ready: "آماده",
  opened: "باز شد",
  awaiting: "در انتظار پاسخ",
  stock_confirmed: "موجود است",
  price_reported: "قیمت گزارش شد",
  not_found: "یافته نشد",
  no_response: "پاسخ نرسید",
  failed: "خراب شد",
};

interface SellerInquiryViewProps {
  block: InquiryBlock;
  reported?: InquiryStatus | null;
  onReport?: (status: InquiryStatus) => void;
}

/**
 * The seller-inquiry panel.
 *
 * Torobyar never contacts a seller itself: it shows the recorded channels, the
 * draft message and a copy action, and the user decides. Follow-up status is
 * reported by the user and is labelled as such — it is never presented as a
 * Torobyar verification.
 */
export function SellerInquiryView({ block, reported, onReport }: SellerInquiryViewProps) {
  const [copied, setCopied] = useState(false);
  const { offer, contacts, message, product_title } = block;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-4 shadow-surface">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">{block.title}</h3>
          {block.subtitle && <p className="mt-1 text-xs text-muted-foreground">{block.subtitle}</p>}
        </div>
        <Link
          to={`/p/${block.product_id}`}
          className="text-xs text-brand hover:underline"
        >
          {product_title}
        </Link>
      </header>

      <OfferSummary offer={offer} />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">راه‌های تماس ثبت‌شده</p>
        {contacts.length === 0 ? (
          <p className="rounded-control border border-dashed border-border bg-secondary/40 p-3 text-xs leading-6 text-muted-foreground">
            این فروشنده در دیتاست راه تماس معتبر (وب‌سایت یا اینستاگرام) ثبت‌شده ندارد.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {contacts.map((contact) => {
              const href = safeExternalHref(contact.href);
              if (!href) return null;
              return (
                <a
                  key={`${contact.kind}-${href}`}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-11 items-center gap-1.5 rounded-full border-line border-border bg-background px-3 text-xs shadow-control transition-colors hover:border-brand/30 hover:bg-accent"
                >
                  {contact.kind === "website" ? (
                    <Globe className="size-3.5" strokeWidth={1.5} aria-hidden />
                  ) : (
                    <Instagram className="size-3.5" strokeWidth={1.5} aria-hidden />
                  )}
                  {contact.label}
                  <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
                </a>
              );
            })}
          </div>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          ترب‌یار خودکار پیام نمی‌فرستد و شماره‌ی تلفنی را نمایش نمی‌دهد؛ فقط کانال‌های ثبت‌شده در
          دیتاست داده می‌شود.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">پیام آماده</p>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-8 items-center gap-1 rounded-full border-line border-border bg-card px-2.5 text-xs transition-colors hover:border-brand/30 hover:bg-accent"
          >
            {copied ? (
              <Check className="size-3.5 text-success" strokeWidth={1.5} aria-hidden />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />
            )}
            {copied ? "کپی شد" : "کپی کردن"}
          </button>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-control border-line border-border bg-secondary/40 p-3 font-sans text-xs leading-7">
          {message}
        </pre>
      </div>

      {onReport && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">
            وضعیت نتیجه (خبرهٔ شما، نه تأیید ترب‌یار)
          </p>
          <div className="flex flex-wrap gap-2">
            {FOLLOWUPS.map((followup) => (
              <button
                key={followup.status}
                type="button"
                onClick={() => onReport(followup.status)}
                className={cn(
                  "inline-flex h-10 items-center rounded-full border px-3 text-xs transition-colors",
                  reported === followup.status
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-background hover:bg-accent",
                )}
              >
                {followup.label}
              </button>
            ))}
          </div>
          {reported && (
            <p className="text-xs text-muted-foreground">
              وضعیت ثبت‌شده توسط شما: {STATUS_LABEL[reported]}. این وضعیت از شما پرسیده شده و
              ترب‌یار آن را تأیید نکرده است.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function OfferSummary({ offer }: { offer: InquiryBlock["offer"] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border-line border-border bg-secondary/30 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{offer.shop.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {offer.shop.neighborhood && <span>{offer.shop.neighborhood}</span>}
          {offer.shop.distance_m !== null && <span>{distanceText(offer.shop.distance_m)}</span>}
          {offer.age_days !== null && <span>{fa(offer.age_days)} روز پیش</span>}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-base font-bold tabular-nums text-brand">
          {formatToman(offer.price)}
        </span>
      </div>
    </div>
  );
}

/** The follow-up card: what the user reported, and the channel to re-open. */
export function SellerFollowupView({ block }: { block: FollowupBlock }) {
  return (
    <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-4 shadow-surface">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">{block.title}</h3>
          {block.subtitle && <p className="mt-1 text-xs text-muted-foreground">{block.subtitle}</p>}
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
          {STATUS_LABEL[block.status]} — خبرهٔ شما
        </span>
      </header>

      <p className="text-xs leading-6 text-muted-foreground">
        کالا: {block.product_title} · فروشنده: {block.shop_name} · قیمت گزارش‌شده:{" "}
        {formatToman(block.price)}
      </p>
      {block.note && <p className="text-xs leading-6 text-muted-foreground">{block.note}</p>}

      {block.contacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {block.contacts.map((contact) => {
            const href = safeExternalHref(contact.href);
            if (!href) return null;
            return (
              <a
                key={`${contact.kind}-${href}`}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-11 items-center gap-1.5 rounded-full border-line border-border bg-background px-3 text-xs shadow-control transition-colors hover:border-brand/30 hover:bg-accent"
              >
                {contact.kind === "website" ? (
                  <Globe className="size-3.5" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Instagram className="size-3.5" strokeWidth={1.5} aria-hidden />
                )}
                {contact.label}
                <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
