import { Link } from "react-router-dom";
import { Check, MapPin, Phone, Plus, ShieldCheck, Store } from "lucide-react";
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
        "flex flex-col gap-3 rounded-xl border-line p-3 transition-colors",
        isBest ? "border-brand/60 bg-brand/5" : "border-border bg-background/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold tabular-nums">{formatToman(offer.price)}</span>
            {isBest && (
              <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-foreground">
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
          {offer.shop.phone && (
            <span dir="ltr" className="tabular-nums">
              {fa(offer.shop.phone)}
            </span>
          )}
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
        {offer.shop.phone ? (
          <a
            href={`tel:${offer.shop.phone}`}
            aria-label={`تماس با ${offer.shop.name}`}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-control border-line border-border bg-secondary px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Phone className="size-4" strokeWidth={1.5} aria-hidden />
            تماس برای تأیید موجودی
          </a>
        ) : (
          <span className="flex h-11 flex-1 items-center justify-center rounded-control border-line border-border text-xs text-muted-foreground">
            شمارهٔ تماس ثبت نشده
          </span>
        )}
        <button
          type="button"
          onClick={add}
          aria-label={inPlan ? "در برنامهٔ خرید" : "افزودن به برنامهٔ خرید"}
          className={cn(
            "flex size-11 items-center justify-center rounded-control border-line transition-colors",
            inPlan
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border bg-secondary text-foreground hover:bg-accent",
          )}
        >
          {inPlan ? <Check className="size-4" strokeWidth={2} aria-hidden /> : <Plus className="size-4" strokeWidth={2} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
