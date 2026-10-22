import { Minus, Plus, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import type { OfferView } from "@/shared/types";
import { cn } from "@/lib/utils";
import { fa, formatToman, jalaliDateTime } from "@/lib/format";

export function ReliabilityView({ offer, productTitle }: { offer: OfferView; productTitle: string }) {
  const { score, level, label, summary, signals } = offer.reliability;
  const tone =
    level === "high"
      ? { bar: "bg-success", text: "text-success", Icon: ShieldCheck }
      : level === "medium"
        ? { bar: "bg-brand", text: "text-brand", Icon: ShieldCheck }
        : level === "low"
          ? { bar: "bg-warning", text: "text-warning", Icon: ShieldAlert }
          : { bar: "bg-destructive", text: "text-destructive", Icon: ShieldQuestion };

  return (
    <div className="flex flex-col gap-4 rounded-surface border-line border-border bg-card p-4 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-control bg-secondary">
            <tone.Icon className={cn("size-5", tone.text)} strokeWidth={1.5} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {productTitle.length > 44 ? `${productTitle.slice(0, 44)}…` : productTitle}
            </p>
          </div>
        </div>
        <div className="text-end">
          <p className="text-2xl font-bold tabular-nums">{fa(score)}</p>
          <p className="text-xs text-muted-foreground">از ۱۰۰</p>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${score}%` }} />
      </div>

      <p className="text-sm leading-7 text-foreground">{summary}</p>
      <p className="-mt-2 text-xs leading-6 text-muted-foreground">
        این امتیاز فقط تازگی و کامل‌بودن اطلاعات ثبت‌شده را می‌سنجد؛ احتمال آماری صحت قیمت یا واقعی‌بودن فروشگاه نیست.
      </p>

      <dl className="flex flex-col gap-2">
        {signals.map((signal) => (
          <div key={signal.key} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                signal.points > 0
                  ? "bg-success/15 text-success"
                  : signal.points < 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {signal.points > 0 ? (
                <Plus className="size-3" strokeWidth={2} aria-hidden />
              ) : signal.points < 0 ? (
                <Minus className="size-3" strokeWidth={2} aria-hidden />
              ) : (
                <span className="size-1 rounded-full bg-current" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <dt className="font-medium text-foreground">{signal.label}</dt>
              <dd className="leading-6 text-muted-foreground">{signal.detail}</dd>
            </div>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>قیمت ثبت‌شده: {formatToman(offer.price)}</span>
        <span>
          {offer.changed_at ? `آخرین تغییر قیمت: ${jalaliDateTime(offer.changed_at)}` : "زمان به‌روزرسانی نامشخص"}
        </span>
      </div>
    </div>
  );
}
