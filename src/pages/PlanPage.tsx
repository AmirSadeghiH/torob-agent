import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ClipboardCopy, Route, ShoppingBag, Trash2, X } from "lucide-react";
import type { Plan } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useBasket, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { fa, formatToman } from "@/lib/format";
import { PlanView } from "@/components/PlanView";
import { TehranMap } from "@/components/TehranMap";
import { ProductImage } from "@/components/ProductImage";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function PlanPage() {
  const basket = useBasket();
  const { origin } = useOrigin();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const signature = useMemo(
    () => basket.items.map((item) => item.offer_id).sort().join("|"),
    [basket.items],
  );
  const [builtFor, setBuiltFor] = useState<string | null>(null);

  useEffect(() => {
    if (builtFor !== null && builtFor !== `${signature}@${origin.lat},${origin.lon}`) {
      setPlan(null);
      setBuiltFor(null);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ساختن برنامه انجام نشد.");
    } finally {
      setBuilding(false);
    }
  }

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
      `زمان تقریبی: ${fa(plan.visit_minutes)} دقیقه`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("کپی کردن در مرورگر مجاز نشد.");
    }
  }

  const mapPoints = useMemo(
    () =>
      plan
        ? plan.stops
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
            }))
        : [],
    [plan],
  );

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
            مسیر از {origin.label ?? "فردوسی"} شروع می‌شود و ایست‌ها را به ترتیب نزدیک‌ترین مرتب می‌کند.
            برای تغییر نقطهٔ شروع، از بالای صفحه محله را عوض کنید.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">نقشهٔ مسیر</h2>
          {plan && mapPoints.length > 0 ? (
            <TehranMap
              points={mapPoints}
              origin={origin}
              routeOrder={plan.stops.map((stop) => stop.shop.shop_id)}
              title="مسیر خرید"
            />
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-surface border-line border-dashed border-border p-6 text-center">
              <Route className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-sm text-muted-foreground">
                پس از چیدن مسیر، ایست‌ها با شماره روی نقشه نمایش داده می‌شوند.
              </p>
            </div>
          )}
        </section>
      </div>

      {plan && (
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
              {copied ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : <ClipboardCopy className="size-3.5" strokeWidth={1.5} aria-hidden />}
              {copied ? "کپی شد" : "کپی برنامه"}
            </button>
          </div>
          <PlanView plan={plan} />
        </section>
      )}
    </div>
  );
}
