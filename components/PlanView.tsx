import { Link } from "react-router-dom";
import { AlertTriangle, Car, Clock, Footprints, MapPin, Route, Wallet } from "lucide-react";
import type { Plan, RoutePlan, TravelMode } from "@/shared/types";
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

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  walk: "پیاده",
  car: "خودرو",
  motorcycle: "موتور",
};

export function durationText(seconds: number | null): string {
  if (seconds === null) return "زمان نامشخص";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${fa(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${fa(hours)} ساعت` : `${fa(hours)} ساعت و ${fa(rest)} دقیقه`;
}

export function providerLabel(provider: RoutePlan["provider"]): string {
  return provider === "mapir" ? "Map.ir" : "Neshan";
}

const OPTIMIZATION_LABEL: Record<RoutePlan["optimization"], string> = {
  tsp: "ترتیب بهینه‌شده",
  nearest: "ترتیب نزدیک‌ترین (تخمین)",
  fixed: "ترتیب انتخابی",
};

interface PlanViewProps {
  plan: Plan;
  route?: RoutePlan | null;
  selectedShopId?: string | null;
  onSelectStop?: (shopId: string) => void;
  children?: React.ReactNode;
}

export function PlanView({
  plan,
  route = null,
  selectedShopId = null,
  onSelectStop,
  children,
}: PlanViewProps) {
  const routeByStop = new Map((route?.stops ?? []).map((stop) => [stop.shop_id, stop]));
  const ModeIcon = route?.mode === "walk" ? Footprints : Car;
  const hasRoute = Boolean(route && route.geometry.length > 1);

  return (
    <div className="flex flex-col gap-4 rounded-surface border-line border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Route} label="ایست" value={fa(route?.stops.length ?? plan.stops.length)} />
        <Stat
          icon={MapPin}
          label={hasRoute ? "مسافت مسیر" : "فاصلهٔ خط مستقیم"}
          value={distanceText(route?.distance_m ?? plan.total_distance_m)}
        />
        <Stat
          icon={Clock}
          label={hasRoute ? "زمان سفر" : "تخمین پیاده‌روی"}
          value={durationText(hasRoute ? (route?.duration_s ?? null) : plan.walk_minutes * 60)}
        />
        <Stat icon={Wallet} label="جمع سبد" value={formatToman(plan.total)} />
      </div>

      {route && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-foreground">
            <ModeIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
            {TRAVEL_MODE_LABEL[route.mode]}
            {route.return_to_origin && " · برگشت به مبدأ"}
          </span>
          <span>· {OPTIMIZATION_LABEL[route.optimization]}</span>
          <span>· منبع مسیر: {providerLabel(route.provider)}</span>
          {plan.visit_minutes > 0 && (
            <span>
              · خرید در فروشگاه‌ها حدود {fa(Math.max(1, plan.visit_minutes - plan.walk_minutes))} دقیقه (جدا از
              زمان سفر)
            </span>
          )}
        </div>
      )}

      <ol className="flex flex-col gap-4">
        {plan.stops.map((stop, index) => {
          const routed = routeByStop.get(stop.shop.shop_id);
          const active = selectedShopId === stop.shop.shop_id;
          const distance = routed?.distance_from_prev_m ?? stop.distance_from_prev_m;
          const routedLeg = Boolean(routed && routed.distance_from_prev_m !== null);
          return (
            <li
              key={stop.shop.shop_id}
              className={cn(
                "grid grid-cols-[auto_1fr] gap-3 rounded-lg transition-colors",
                active && "bg-accent/60",
              )}
            >
              <div className="flex flex-col items-center">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                  {fa(stop.order)}
                </span>
                {index < plan.stops.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
              </div>

              <div className="min-w-0 pb-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {onSelectStop ? (
                      <button
                        type="button"
                        onClick={() => onSelectStop(stop.shop.shop_id)}
                        className="block max-w-full truncate text-start font-semibold hover:text-brand"
                        aria-pressed={active}
                      >
                        {stop.shop.name}
                      </button>
                    ) : (
                      <Link to={`/s/${stop.shop.shop_id}`} className="block truncate font-semibold hover:text-brand">
                        {stop.shop.name}
                      </Link>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {stop.shop.neighborhood && <span>{stop.shop.neighborhood}</span>}
                      {distance !== null && (
                        <span>
                          · {distanceText(distance)}{" "}
                          {routedLeg ? (index === 0 ? "تا این ایست" : "از ایست قبل") : index === 0 ? "از نقطهٔ شروع" : "از ایست قبل"}
                        </span>
                      )}
                      {routed?.duration_from_prev_s != null && (
                        <span>· {durationText(routed.duration_from_prev_s)} سفر</span>
                      )}
                      {!routedLeg && stop.leg_minutes !== null && (
                        <span>· تخمین {fa(stop.leg_minutes)} دقیقه پیاده</span>
                      )}
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
          );
        })}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {plan.warnings.map((warning) => (
          <p key={warning} className="flex items-start gap-2 text-xs leading-6 text-warning">
            <AlertTriangle className="mt-1 size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            {warning}
          </p>
        ))}
        <p className="text-xs leading-6 text-muted-foreground">
          {hasRoute
            ? `${route?.optimization_note ?? ""} مسافت و زمان از مسیریابی ${providerLabel(
                route!.provider,
              )} برای حالت «${
                TRAVEL_MODE_LABEL[route!.mode]
              }» آمده است؛ زمان حضور در فروشگاه جدا حساب می‌شود.`
            : "فاصله‌ها خط مستقیم بین مختصات‌اند و زمان‌ها تخمینی؛ مسیر خیابانی فقط از سرویس مسیریابی گرفته می‌شود."}
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
