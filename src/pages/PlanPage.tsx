import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bike,
  Car,
  Check,
  ClipboardCopy,
  Footprints,
  Loader2,
  RefreshCw,
  Route,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import type { Plan, RoutePlan, TravelMode } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useBasket, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { fa, formatToman } from "@/lib/format";
import { PlanView, TRAVEL_MODE_LABEL, durationText, providerLabel } from "@/components/PlanView";
import { TehranMap } from "@/components/TehranMap";
import { ProductImage } from "@/components/ProductImage";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const MODES: { value: TravelMode; label: string; Icon: typeof Car }[] = [
  { value: "walk", label: "پیاده", Icon: Footprints },
  { value: "car", label: "خودرو", Icon: Car },
  { value: "motorcycle", label: "موتور", Icon: Bike },
];

export function PlanPage() {
  const basket = useBasket();
  const { origin } = useOrigin();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [mode, setMode] = useState<TravelMode>("walk");
  const [optimize, setOptimize] = useState(true);
  const [returnToOrigin, setReturnToOrigin] = useState(false);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const routeSeq = useRef(0);

  const signature = useMemo(
    () => basket.items.map((item) => item.offer_id).sort().join("|"),
    [basket.items],
  );
  const [builtFor, setBuiltFor] = useState<string | null>(null);

  useEffect(() => {
    if (builtFor !== null && builtFor !== `${signature}@${origin.lat},${origin.lon}`) {
      setPlan(null);
      setBuiltFor(null);
      setRoute(null);
      setRouteError(null);
      routeSeq.current += 1;
    }
  }, [signature, origin, builtFor]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; neighborhood: string | null; items: typeof basket.items }>();
    for (const item of basket.items) {
      if (!map.has(item.shop_id)) {
        map.set(item.shop_id, { name: item.shop_name, neighborhood: item.neighborhood, items: [] });
      }
      map.get(item.shop_id)!.items.push(item);
    }
    return [...map.entries()].map(([shopId, value]) => ({ shopId, ...value }));
  }, [basket.items]);

  const loadRoute = useCallback(
    async (target: Plan) => {
      const ids = target.stops.map((stop) => stop.shop.shop_id);
      if (ids.length === 0) return;
      const seq = ++routeSeq.current;
      setRouting(true);
      setRouteError(null);
      try {
        const result = await api.route(ids, target.origin, mode, {
          optimize,
          return_to_origin: returnToOrigin,
        });
        if (seq !== routeSeq.current) return;
        setRoute(result);
      } catch (err) {
        if (seq !== routeSeq.current) return;
        setRoute(null);
        setRouteError(err instanceof ApiError ? err.message : "مسیریابی انجام نشد.");
      } finally {
        if (seq === routeSeq.current) setRouting(false);
      }
    },
    [mode, optimize, returnToOrigin],
  );

  // A route is refetched only when the plan, mode or options actually change —
  // never on pan/zoom.
  useEffect(() => {
    if (!plan) return;
    void loadRoute(plan);
  }, [plan, loadRoute]);

  async function build() {
    if (basket.items.length === 0) return;
    setBuilding(true);
    setError(null);
    try {
      const result = await api.plan(
        basket.items.map((item) => item.offer_id),
        origin,
      );
      setPlan(result);
      setBuiltFor(`${signature}@${origin.lat},${origin.lon}`);
      setSelectedShopId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساختن برنامه انجام نشد.");
    } finally {
      setBuilding(false);
    }
  }

  /**    * When the routing service reorders the stops, the list must follow the
    * routed order so badge numbers match the map markers.
   */
  const displayPlan = useMemo<Plan | null>(() => {
    if (!plan) return null;
    if (!route || route.stops.length !== plan.stops.length) return plan;
    const byId = new Map(plan.stops.map((stop) => [stop.shop.shop_id, stop]));
    const stops: Plan["stops"] = [];
    route.stops.forEach((routed, index) => {
      const stop = byId.get(routed.shop_id);
      if (!stop) return;
      stops.push({
        ...stop,
        order: index + 1,
        distance_from_prev_m: routed.distance_from_prev_m ?? stop.distance_from_prev_m,
        leg_minutes:
          routed.duration_from_prev_s === null
            ? stop.leg_minutes
            : Math.max(1, Math.round(routed.duration_from_prev_s / 60)),
      });
    });
    return stops.length === plan.stops.length ? { ...plan, stops } : plan;
  }, [plan, route]);

  async function copyPlan() {
    if (!plan) return;
    const lines = [
      "هم‌خرید — برنامهٔ خرید حضوری",
      `شروع: ${origin.label ?? "فردوسی"}`,
      "",
      ...plan.stops.map(
        (stop) =>
          `${fa(stop.order)}) ${stop.shop.name}${stop.shop.neighborhood ? ` — ${stop.shop.neighborhood}` : ""}\n` +
          stop.items.map((item) => `   • ${item.title} — ${formatToman(item.price)}`).join("\n"),
      ),
      "",
      `جمع: ${formatToman(plan.total)}`,
      route
        ? `مسیر ${TRAVEL_MODE_LABEL[route.mode]}: ${Math.round(route.distance_m / 100) / 10} کیلومتر، ${durationText(
            route.duration_s,
          )} (${providerLabel(route.provider)})`
        : `تخمین زمان (بر پایهٔ فاصلهٔ خط مستقیم): ${fa(plan.visit_minutes)} دقیقه`,
      route
        ? `مسافت و زمان از سرویس مسیریابی ${providerLabel(route.provider)} است.`
        : "فاصله‌ها خط مستقیم بین مختصات‌اند و مسیر خیابان نیستند.",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("کپی کردن در مرورگر مجاز نشد.");
    }
  }

  const mapPoints = useMemo(() => {
    if (!displayPlan) return [];
    return displayPlan.stops
      .filter((stop) => stop.shop.lat !== null && stop.shop.lon !== null)
      .map((stop) => ({
        id: stop.shop.shop_id,
        label: stop.shop.name,
        lat: stop.shop.lat!,
        lon: stop.shop.lon!,
        kind: "shop" as const,
        distance_m: stop.shop.distance_m,
        meta: stop.shop.neighborhood ?? undefined,
        order: stop.order,
      }));
  }, [displayPlan]);

  if (basket.items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-xl font-bold sm:text-2xl">برنامهٔ خرید</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            اقلامی که می‌خواهید حضوری ببینید را اینجا جمع کنید تا مسیرشان را بچینم.
          </p>
        </header>
        <EmptyState
          icon={ShoppingBag}
          title="سبد برنامه خالی است"
          description="از کارت هر کالا دکمهٔ + را بزنید یا از دستیار بخواهید گزینه‌های نزدیک هم را پیدا کند."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to="/explore"
                className="inline-flex h-12 items-center rounded-control bg-brand px-6 text-base font-semibold text-brand-foreground"
              >
                کاوش کالاها
              </Link>
              <Link
                to="/"
                className="inline-flex h-12 items-center rounded-control border-line border-border bg-secondary px-6 text-base font-medium"
              >
                پرسیدن از دستیار
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">برنامهٔ خرید</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fa(basket.items.length)} قلم در {fa(groups.length)} فروشگاه · شروع از{" "}
            {origin.label ?? "فردوسی"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {confirmClear ? (
            <>
              <button
                type="button"
                onClick={() => {
                  basket.clear();
                  setPlan(null);
                  setRoute(null);
                  setConfirmClear(false);
                }}
                className="flex h-11 items-center rounded-control bg-destructive px-3 text-xs font-medium text-white"
              >
                بله، پاک کن
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex h-11 items-center rounded-control border-line border-border px-3 text-xs"
              >
                انصراف
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="flex h-11 items-center gap-1.5 rounded-control px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
              پاک کردن سبد
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-4">
          <h2 className="text-sm font-semibold">اقلام سبد</h2>
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.shopId} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Link to={`/s/${group.shopId}`} className="text-sm font-medium hover:text-brand">
                    {group.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{group.neighborhood}</span>
                </div>
                <ul className="flex flex-col divide-y divide-border rounded-lg border-line border-border">
                  {group.items.map((item) => (
                    <li key={item.offer_id} className="flex items-center gap-2 p-2">
                      <ProductImage src={item.image} alt={item.title} className="size-10 shrink-0 rounded-md" />
                      <Link to={`/p/${item.product_id}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand">
                        {item.title}
                      </Link>
                      <span className="shrink-0 text-sm tabular-nums">{formatToman(item.price)}</span>
                      <button
                        type="button"
                        onClick={() => basket.remove(item.offer_id)}
                        aria-label={`حذف ${item.title} از برنامه`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <X className="size-4" strokeWidth={1.5} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-sm">
              جمع سبد: <span className="font-bold tabular-nums">{formatToman(basket.total)}</span>
            </p>
            <Button variant="brand" size="lg" onClick={() => void build()} disabled={building} className="gap-2">
              <Route className="size-4" strokeWidth={2} aria-hidden />
              {building ? "در حال چیدن مسیر…" : plan ? "چیدن دوبارهٔ مسیر" : "چیدن مسیر خرید"}
            </Button>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <p className="text-xs leading-6 text-muted-foreground">
            چیدمان از {origin.label ?? "فردوسی"} شروع می‌شود. مسافت و زمان سفر از سرویس مسیریابی نقشه
            (Map.ir یا Neshan)
            گرفته می‌شود و زمان حضور در فروشگاه جدا حساب می‌شود. برای تغییر نقطهٔ شروع، از بالای صفحه محله را
            عوض کنید.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">نقشهٔ مسیر</h2>
            {route && (
              <p className="text-xs text-muted-foreground">
                {TRAVEL_MODE_LABEL[route.mode]} · {durationText(route.duration_s)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-surface border-line border-border bg-card p-3">
            <div
              role="group"
              aria-label="حالت سفر"
              className="grid grid-cols-3 gap-1 rounded-control border-line border-border p-1"
            >
              {MODES.map(({ value, label, Icon }) => {
                const active = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(value)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
                      active ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.5} aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={optimize}
                disabled={mode === "walk"}
                onClick={() => setOptimize((value) => !value)}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-control border-line border-border px-3 text-xs",
                  optimize && mode !== "walk" ? "border-brand text-brand" : "text-muted-foreground",
                  mode === "walk" && "cursor-not-allowed opacity-50",
                )}
              >
                <Check className="size-3.5" strokeWidth={2} aria-hidden />
                بهینه‌سازی ترتیب ایست‌ها
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={returnToOrigin}
                onClick={() => setReturnToOrigin((value) => !value)}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-control border-line border-border px-3 text-xs",
                  returnToOrigin ? "border-brand text-brand" : "text-muted-foreground",
                )}
              >
                <RefreshCw className="size-3.5" strokeWidth={2} aria-hidden />
                برگشت به مبدأ
              </button>
            </div>

            {mode === "walk" && (
              <p className="text-[11px] leading-5 text-muted-foreground">
                برای پیاده‌روی، مسیرها با سرویس پیاده گرفته می‌شوند؛ سرویس بهینه‌سازی رسمی فقط برای
                خودرو/موتور است، بنابراین ترتیب ایست‌ها تخمینی است.
              </p>
            )}
          </div>

          {displayPlan && mapPoints.length > 0 ? (
            <div className="relative">
              <TehranMap
                points={mapPoints}
                origin={origin}
                routeOrder={
                  route
                    ? route.stops.map((stop) => stop.shop_id)
                    : displayPlan.stops.map((stop) => stop.shop.shop_id)
                }
                route={route ? { geometry: route.geometry, mode: route.mode } : null}
                selectedId={selectedShopId}
                onSelect={setSelectedShopId}
                size="tall"
                showDetail={false}
                title="مسیر خرید"
              />
              {routing && (
                <p className="pointer-events-none absolute top-3 start-3 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow">
                  <Loader2 className="size-3.5 animate-spin text-brand" strokeWidth={2} aria-hidden />
                  در حال گرفتن مسیر خیابانی…
                </p>
              )}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-surface border-line border-dashed border-border p-6 text-center">
              <Route className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-sm text-muted-foreground">
                پس از چیدن مسیر، ایست‌ها با شماره روی نقشه نمایش داده می‌شوند.
              </p>
            </div>
          )}

          {routeError && (
            <div className="flex flex-wrap items-start gap-2 rounded-surface border-line border-warning/40 bg-warning/10 p-3 text-xs leading-6 text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <p className="min-w-0 flex-1" role="alert">
                {routeError} برنامهٔ خرید بدون مسیر خیابانی نمایش داده می‌شود؛ خط مستقیم جای مسیر جا زده
                نمی‌شود.
              </p>
              {plan && (
                <button
                  type="button"
                  onClick={() => void loadRoute(plan)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-control border-line border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <RefreshCw className="size-3.5" strokeWidth={2} aria-hidden />
                  تلاش دوباره
                </button>
              )}
            </div>
          )}

          {route && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <RouteFact label="مسافت مسیر" value={`${fa((route.distance_m / 1000).toFixed(1)).replace(".", "٫")} کیلومتر`} />
              <RouteFact label="زمان سفر" value={durationText(route.duration_s)} />
              <RouteFact label="ایست‌ها" value={fa(route.stops.length)} />
              <RouteFact label="ترتیب" value={route.optimization === "tsp" ? "بهینه‌شده" : "تخمینی"} />
            </div>
          )}

          {route && (route.warnings.length > 0 || route.excluded.length > 0) && (
            <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3 text-[11px] leading-5 text-muted-foreground">
              {route.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              {route.excluded.map((item) => (
                <p key={item.shop_id}>{item.reason}</p>
              ))}
              <p>{route.optimization_note}</p>
            </div>
          )}
        </section>
      </div>

      {displayPlan && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">برنامهٔ پیشنهادی</h2>
            <button
              type="button"
              onClick={() => void copyPlan()}
              className={cn(
                "flex h-11 items-center gap-1.5 rounded-control border-line border-border px-3 text-xs",
                copied ? "text-success" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {copied ? (
                <Check className="size-3.5" strokeWidth={2} aria-hidden />
              ) : (
                <ClipboardCopy className="size-3.5" strokeWidth={1.5} aria-hidden />
              )}
              {copied ? "کپی شد" : "کپی برنامه"}
            </button>
          </div>
          <PlanView
            plan={displayPlan}
            route={route}
            selectedShopId={selectedShopId}
            onSelectStop={setSelectedShopId}
          />
        </section>
      )}
    </div>
  );
}

function RouteFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border-line border-border bg-card p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
