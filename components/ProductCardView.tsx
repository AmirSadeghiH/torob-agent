import { Link } from "react-router-dom";
import { Check, Plus, Store } from "lucide-react";
import type { ProductCard } from "@/shared/types";
import { useBasket } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import {
  FRESHNESS_CLASS,
  FRESHNESS_DOT,
  FRESHNESS_LABEL,
  ageText,
  distanceText,
  formatToman,
} from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";

interface ProductCardViewProps {
  product: ProductCard;
  layout?: "grid" | "list";
  eager?: boolean;
  onAdded?: () => void;
}

export function ProductCardView({ product, layout = "grid", eager, onAdded }: ProductCardViewProps) {
  const basket = useBasket();
  const inPlan = basket.hasProduct(product.product_id);
  const best = product.best;
  const isList = layout === "list";

  function addToPlan() {
    if (!best) return;
    basket.add({
      offer_id: best.offer_id,
      product_id: product.product_id,
      title: product.title,
      price: best.price,
      image: product.image,
      shop_id: best.shop_id,
      shop_name: best.shop_name,
      neighborhood: best.neighborhood,
    });
    onAdded?.();
  }

  return (
    <article
      className={cn(
        "group relative flex overflow-hidden rounded-surface border-line border-border bg-card shadow-surface transition-[box-shadow,border-color] duration-(--motion) ease-motion hover:border-brand/30 hover:shadow-float",
        isList ? "gap-3 p-3" : "flex-col",
      )}
    >
      <Link
        to={`/p/${product.product_id}`}
        className="absolute inset-0 z-20 rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`${product.title}، ${product.min_price ? formatToman(product.min_price) : "بدون قیمت"}`}
      />
      <div className={cn("relative shrink-0", isList ? "w-24" : "w-full")}>
        <ProductImage
          src={product.image}
          alt={product.title}
          eager={eager}
          className={cn(isList ? "aspect-square rounded-control" : "aspect-4/3")}
        />
        {product.offer_count > 1 && (
          <span className="absolute start-2 top-2 rounded-full border-line border-border bg-card/95 px-2 py-0.5 text-xs font-medium text-foreground shadow-control backdrop-blur">
            {new Intl.NumberFormat("fa-IR").format(product.offer_count)} فروشگاه
          </span>
        )}
      </div>

      <div className={cn("relative z-10 flex min-w-0 flex-1 flex-col gap-2", isList ? "" : "p-3")}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {product.brand && <span className="truncate">{product.brand}</span>}
          {product.brand && <span aria-hidden>·</span>}
          <span className="truncate">{product.category}</span>
        </div>

        <h3 className={cn("font-medium leading-7 text-foreground", isList ? "line-clamp-2 text-sm" : "line-clamp-2")}>
          {product.title}
        </h3>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            {product.min_price !== null ? (
              <p className="flex items-baseline gap-1">
                {product.offer_count > 1 && (
                  <span className="text-xs text-muted-foreground">از</span>
                )}
                <span className="text-lg font-bold tabular-nums text-foreground">{formatToman(product.min_price)}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">قیمت ثبت نشده</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {best && (
                <>
                  <span className={cn("inline-flex items-center gap-1", FRESHNESS_CLASS[best.freshness])}>
                    <span className={cn("size-1.5 rounded-full", FRESHNESS_DOT[best.freshness])} aria-hidden />
                    {FRESHNESS_LABEL[best.freshness]}، {ageText(best.age_days)}
                  </span>
                  {best.distance_m !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Store className="size-3" strokeWidth={1.5} aria-hidden />
                      {distanceText(best.distance_m)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={addToPlan}
            disabled={!best}
            aria-label={inPlan ? "در برنامهٔ خرید" : "افزودن به برنامهٔ خرید"}
            className={cn(
              "relative z-30 flex size-11 shrink-0 items-center justify-center rounded-full border-line transition-colors",
              inPlan
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card text-foreground hover:border-brand/40 hover:bg-accent hover:text-brand",
              "disabled:opacity-40",
            )}
          >
            {inPlan ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <Plus className="size-4" strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-surface border-line border-border bg-card">
          <div className="aspect-4/3 animate-pulse bg-secondary" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-full animate-pulse rounded bg-secondary" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}
