import { Link } from "react-router-dom";
import { AlertTriangle, Clock, MapPin, Route, Wallet } from "lucide-react";
import type { Plan } from "@/shared/types";
import { cn } from "@/lib/utils";
import {
  FRESHNESS_CLASS,
  FRESHNESS_DOT,
  ageText,
  distanceText,
  fa,
  formatToman,
} from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";

export function PlanView({ plan, children }: { plan: Plan; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-surface border-line border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Route} label="ایست" value={fa(plan.stops.length)} />
        <Stat icon={MapPin} label="فاصلهٔ خط مستقیم" value={distanceText(plan.total_distance_m)} />
        <Stat icon={Clock} label="تخمین زمان" value={`${fa(plan.visit_minutes)} دقیقه`} />
        <Stat icon={Wallet} label="جمع سبد" value={formatToman(plan.total)} />
      </div>

      <ol className="flex flex-col gap-4">
        {plan.stops.map((stop, index) => (
          <li key={stop.shop.shop_id} className="grid grid-cols-[auto_1fr] gap-3">
            <div className="flex flex-col items-center">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                {fa(stop.order)}
              </span>
              {index < plan.stops.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
            </div>

            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/s/${stop.shop.shop_id}`}
                    className="block truncate font-semibold hover:text-brand"
                  >
                    {stop.shop.name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {stop.shop.neighborhood && <span>{stop.shop.neighborhood}</span>}
                    {stop.distance_from_prev_m !== null && (
                      <span>
                        · {distanceText(stop.distance_from_prev_m)}{" "}
                        {index === 0 ? "از نقطهٔ شروع" : "از ایست قبل"}
                      </span>
                    )}
                    {stop.leg_minutes !== null && <span>· تخمین {fa(stop.leg_minutes)} دقیقه پیاده</span>}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatToman(stop.subtotal)}</p>
              </div>

              <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border-line border-border">
                {stop.items.map((item) => (
                  <li key={item.offer_id} className="flex items-center gap-3 p-2">
                    <ProductImage src={item.image} alt={item.title} className="size-10 shrink-0 rounded-md" />
                    <Link to={`/p/${item.product_id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand">
                      {item.title}
                    </Link>
                    <span className={cn("flex shrink-0 items-center gap-1 text-xs", FRESHNESS_CLASS[item.freshness])}>
                      <span className={cn("size-1.5 rounded-full", FRESHNESS_DOT[item.freshness])} aria-hidden />
                      {ageText(item.age_days)}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{formatToman(item.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {plan.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-2 text-xs leading-6 text-warning">
            <AlertTriangle className="mt-1 size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            {warning}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          جمع {fa(plan.item_count)} قلم در {fa(plan.stops.length)} فروشگاه؛ ایست‌ها به ترتیب نزدیک‌ترین چیده
          شده‌اند. فاصله‌ها خط مستقیم بین مختصات و زمان‌ها تخمینی بر پایهٔ پیاده‌روی با سرعت ثابت است، نه
          مسیریابی خیابانی.
        </p>
      </div>

      {children}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
