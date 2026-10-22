import { Link } from "react-router-dom";
import { Check, MapPin, Plus, ShieldCheck, Store } from "lucide-react";
import type { OfferView } from "@/shared/types";
import { useBasket } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import {
  FRESHNESS_CLASS,
  FRESHNESS_DOT,
  FRESHNESS_LABEL,
  ageText,
  distanceText,
  fa,
  formatToman,
} from "@/lib/format";

export function ReliabilityMeter({ offer }: { offer: OfferView }) {
  const { score, level, label } = offer.reliability;
  const bar =
    level === "high" ? "bg-success" : level === "medium" ? "bg-brand" : level === "low" ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`اعتبار اطلاعات ${new Intl.NumberFormat("fa-IR").format(score)} از ۱۰۰`}
      >
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

interface OfferRowProps {
  offer: OfferView;
  productTitle: string;
  isBest?: boolean;
}

export function OfferRow({ offer, productTitle, isBest = false }: OfferRowProps) {
  const basket = useBasket();
  const inPlan = basket.items.some((item) => item.offer_id === offer.offer_id);

  function add() {
    basket.add({
      offer_id: offer.offer_id,
      product_id: offer.product_id,
      title: productTitle,
      price: offer.price,
      image: null,
      shop_id: offer.shop.shop_id,
      shop_name: offer.shop.name,
      neighborhood: offer.shop.neighborhood,
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-surface border-line p-4 transition-colors",
        isBest ? "border-brand/30 bg-brand/5" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold tabular-nums text-foreground">{formatToman(offer.price)}</span>
            {isBest && (
              <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-foreground shadow-control">
                کمترین قیمت
              </span>
            )}
          </div>
          <p className={cn("mt-1 flex items-center gap-1 text-xs", FRESHNESS_CLASS[offer.freshness])}>
            <span className={cn("size-1.5 rounded-full", FRESHNESS_DOT[offer.freshness])} aria-hidden />
            {FRESHNESS_LABEL[offer.freshness]}، {ageText(offer.age_days)}
          </p>
        </div>
        <ReliabilityMeter offer={offer} />
      </div>

      <div className="flex flex-col gap-1">
        <Link
          to={`/s/${offer.shop.shop_id}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-foreground hover:text-brand"
        >
          <Store className="size-4" strokeWidth={1.5} aria-hidden />
          {offer.shop.name}
        </Link>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {offer.shop.neighborhood && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" strokeWidth={1.5} aria-hidden />
              {offer.shop.neighborhood}
            </span>
          )}
          {offer.shop.distance_m !== null && <span>{distanceText(offer.shop.distance_m)}</span>}
        </p>
      </div>

      {offer.warranty && (
        <p className="flex items-center gap-1 text-xs text-success">
          <ShieldCheck className="size-3.5" strokeWidth={1.5} aria-hidden />
          {offer.warranty}
        </p>
      )}
      {offer.description && (
        <p className="line-clamp-2 text-xs leading-6 text-muted-foreground">{offer.description}</p>
      )}

      <div className="flex items-center gap-2">
        <span className="flex flex-1 items-center text-xs leading-6 text-muted-foreground">
          قیمت ثبت‌شده است؛ موجودی و قیمت روز را از منبع دیگری بررسی کنید.
        </span>
        <button
          type="button"
          onClick={add}
          aria-label={inPlan ? "در برنامهٔ خرید" : "افزودن به برنامهٔ خرید"}
          className={cn(
            "flex size-11 items-center justify-center rounded-full border-line transition-colors",
            inPlan
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border bg-card text-foreground hover:border-brand/40 hover:bg-accent hover:text-brand",
          )}
        >
          {inPlan ? <Check className="size-4" strokeWidth={2} aria-hidden /> : <Plus className="size-4" strokeWidth={2} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
