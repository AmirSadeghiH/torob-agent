import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  Globe,
  Instagram,
  MapPin,
  ShoppingBag,
  Truck,
} from "lucide-react";
import type { ShopDetail } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { distanceText, fa, formatToman, openStateText } from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";
import { TehranMap } from "@/components/TehranMap";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";

const DAYS = [
  { key: "sat", label: "شنبه" },
  { key: "sun", label: "یکشنبه" },
  { key: "mon", label: "دوشنبه" },
  { key: "tue", label: "سه‌شنبه" },
  { key: "wed", label: "چهارشنبه" },
  { key: "thu", label: "پنجشنبه" },
  { key: "fri", label: "جمعه" },
] as const;

const WEEKDAY_KEY: Record<string, string> = {
  Sat: "sat", Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri",
};

function todayKey(): string {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    weekday: "short",
  }).format(new Date());
  return WEEKDAY_KEY[short] ?? "sat";
}

export function StorePage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { origin } = useOrigin();
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(todayKey, []);

  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    setStatus("loading");
    api
      .shop(shopId, origin)
      .then((value) => {
        if (!alive) return;
        setShop(value);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setStatus("missing");
        else {
          setError(err instanceof ApiError ? err.message : "فروشگاه بارگذاری نشد.");
          setStatus("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [shopId, origin]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-2/3 animate-pulse rounded bg-card" />
        <div className="h-48 animate-pulse rounded-surface bg-card" />
        <div className="h-64 animate-pulse rounded-surface bg-card" />
      </div>
    );
  }

  if (status !== "ready" || !shop) {
    return (
      <EmptyState
        title={status === "missing" ? "این فروشگاه پیدا نشد" : "فروشگاه بارگذاری نشد"}
        description={error ?? "شناسهٔ فروشگاه را بررسی کنید."}
        action={
          <Link
            to="/stores"
            className="inline-flex h-12 items-center justify-center rounded-control bg-brand px-6 text-base font-semibold text-brand-foreground"
          >
            فهرست فروشگاه‌ها
          </Link>
        }
      />
    );
  }

  const website = shop.website
    ? shop.website.startsWith("http")
      ? shop.website
      : `https://${shop.website}`
    : null;
  const instagram = shop.instagram
    ? shop.instagram.startsWith("http")
      ? shop.instagram
      : `https://instagram.com/${shop.instagram.replace(/^@/, "")}`
    : null;

  const points =
    shop.lat !== null && shop.lon !== null
      ? [
          {
            id: shop.shop_id,
            label: shop.name,
            lat: shop.lat,
            lon: shop.lon,
            kind: "shop" as const,
            distance_m: shop.distance_m,
            meta: shop.neighborhood ?? undefined,
          },
        ]
      : [];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="مسیر صفحه" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          خانه
        </Link>
        <ArrowLeft className="size-3" strokeWidth={1.5} aria-hidden />
        <Link to="/stores" className="hover:text-foreground">
          فروشگاه‌ها
        </Link>
        <ArrowLeft className="size-3" strokeWidth={1.5} aria-hidden />
        <span className="text-foreground">{shop.name}</span>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold sm:text-2xl">{shop.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {shop.neighborhood && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-4" strokeWidth={1.5} aria-hidden />
                    {shop.neighborhood}
                  </span>
                )}
                {shop.distance_m !== null && <span>{distanceText(shop.distance_m)}</span>}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-1 text-xs",
                shop.open_now === true
                  ? "bg-success/15 text-success"
                  : shop.open_now === false
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {openStateText(shop.open_now)}
            </span>
          </div>

          {shop.address && <p className="text-sm leading-7 text-muted-foreground">{shop.address}</p>}

          <p className="rounded-lg bg-secondary p-2 text-xs leading-6 text-muted-foreground">
            {shop.identity === "registered"
              ? "نام و لینک‌های این فروشگاه از فیلدهای ثبت‌شدهٔ دیتاست است؛ تأیید مستقل کسب‌وکار نیست. شمارهٔ تلفن در این دیتاست معتبر نیست و نمایش داده نمی‌شود."
              : "نام این فروشگاه در دیتاست ناشناس شده است؛ شناسهٔ کوتاه داخل نام فقط برای ارجاع پایدار است و شمارهٔ تماس معتبری برای آن وجود ندارد."}
          </p>

          <div className="flex flex-wrap gap-2">
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-control border-line border-border bg-secondary px-3 text-sm hover:bg-accent"
              >
                <Globe className="size-4" strokeWidth={1.5} aria-hidden />
                وب‌سایت
              </a>
            )}
            {instagram && (
              <a
                href={instagram}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-control border-line border-border bg-secondary px-3 text-sm hover:bg-accent"
              >
                <Instagram className="size-4" strokeWidth={1.5} aria-hidden />
                اینستاگرام
              </a>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ShoppingBag className="size-3.5" strokeWidth={1.5} aria-hidden />
              {fa(shop.offer_count)} پیشنهاد ثبت‌شده
            </span>
            {shop.fast_delivery && (
              <span className="inline-flex items-center gap-1 text-success">
                <Truck className="size-3.5" strokeWidth={1.5} aria-hidden />
                ارسال سریع دارد
              </span>
            )}
          </div>

          {shop.categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {shop.categories.map((category) => (
                <Link
                  key={category}
                  to={`/explore?category=${encodeURIComponent(category)}`}
                  className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
                >
                  {category}
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3">
          {points.length > 0 ? (
            <TehranMap points={points} origin={origin} title={`نقشهٔ ${shop.name}`} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-surface border-line border-dashed border-border text-sm text-muted-foreground">
              مختصات این فروشگاه ثبت نشده است.
            </div>
          )}

          <section className="rounded-surface border-line border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4" strokeWidth={1.5} aria-hidden />
              ساعت کاری
            </h2>
            <dl className="mt-2 flex flex-col divide-y divide-border text-xs">
              {DAYS.map((day) => {
                const entry = shop.hours[day.key];
                const text =
                  !entry
                    ? "نامشخص"
                    : entry.status === "closed"
                      ? "تعطیل"
                      : entry.status === "unsupported"
                        ? "اعلام نشده"
                        : entry.shifts.length > 0
                          ? entry.shifts.map((shift) => `${fa(shift.start)} تا ${fa(shift.end)}`).join("، ")
                          : "نامشخص";
                return (
                  <div
                    key={day.key}
                    className={cn(
                      "flex items-center justify-between gap-3 py-2",
                      day.key === today && "font-semibold text-foreground",
                    )}
                  >
                    <dt>{day.label}</dt>
                    <dd className="text-muted-foreground">{text}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">کالاهای قابل مقایسهٔ این فروشگاه</h2>
        {shop.top_products.length === 0 ? (
          <p className="rounded-xl border-line border-dashed border-border p-4 text-sm text-muted-foreground">
            برای این فروشگاه پیشنهادی در داده ثبت نشده است.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-surface border-line border-border bg-card">
            {shop.top_products.map((product) => (
              <Link
                key={product.product_id}
                to={`/p/${product.product_id}`}
                className="flex items-center gap-3 p-3 transition-colors hover:bg-accent"
              >
                <ProductImage src={product.image} alt={product.title} className="size-14 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{product.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {fa(product.offer_count)} فروشنده برای این کالا
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatToman(product.price_at_shop)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-surface border-line border-border bg-card p-4">
        <h2 className="text-sm font-semibold">پرداخت</h2>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">
          {shop.payments.length > 0
            ? `روش‌های ثبت‌شده: ${shop.payments.join("، ")}`
            : "روش پرداخت برای این فروشگاه ثبت نشده است. برای خرید حضوری، نقدی یا کارت‌خوان را از فروشنده بپرسید."}
        </p>
      </section>
    </div>
  );
}
