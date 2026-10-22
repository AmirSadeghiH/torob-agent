import { Link } from "react-router-dom";
import { Clock, MapPin, Store } from "lucide-react";
import type { StoreCard } from "@/shared/types";
import { cn } from "@/lib/utils";
import { distanceText, fa, openStateText } from "@/lib/format";

interface StoreCardViewProps {
  store: StoreCard;
  compact?: boolean;
}

export function StoreCardView({ store, compact = false }: StoreCardViewProps) {
  return (
    <article className="relative flex flex-col gap-2 rounded-surface border-line border-border bg-card p-4 shadow-surface transition-[box-shadow,border-color] duration-(--motion) ease-motion hover:border-brand/30 hover:shadow-float">
      <Link
        to={`/s/${store.shop_id}`}
        className="absolute inset-0 z-20 rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`فروشگاه ${store.name}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{store.name}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {store.neighborhood && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" strokeWidth={1.5} aria-hidden />
                {store.neighborhood}
              </span>
            )}
            {store.distance_m !== null && <span>{distanceText(store.distance_m)}</span>}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            store.open_now === true
              ? "bg-success/10 text-success"
              : store.open_now === false
                ? "bg-destructive/10 text-destructive"
                : "bg-secondary text-muted-foreground",
          )}
        >
          {openStateText(store.open_now)}
        </span>
      </div>

      {!compact && store.address && (
        <p className="line-clamp-2 text-xs leading-6 text-muted-foreground">{store.address}</p>
      )}

      {store.categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {store.categories.slice(0, 3).map((category) => (
            <span key={category} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {category}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Store className="size-3.5" strokeWidth={1.5} aria-hidden />
          {new Intl.NumberFormat("fa-IR").format(store.matched_offers ?? store.offer_count)} پیشنهاد ثبت‌شده
        </p>
      </div>

      {store.hours_today && store.hours_today.shifts.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" strokeWidth={1.5} aria-hidden />
          امروز {store.hours_today.shifts.map((s) => `${fa(s.start)} تا ${fa(s.end)}`).join("، ")}
        </p>
      )}
    </article>
  );
}
