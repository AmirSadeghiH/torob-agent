import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronLeft,
  MapPin,
  Plus,
  Sparkles,
  ShieldCheck,
  Store,
} from "lucide-react";
import type { ProductDetail } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useBasket, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import {
  FRESHNESS_CLASS,
  FRESHNESS_DOT,
  FRESHNESS_LABEL,
  ageText,
  distanceText,
  fa,
  formatToman,
  jalaliDate,
} from "@/lib/format";
import { ProductImage } from "@/components/ProductImage";
import { ProductCardView } from "@/components/ProductCardView";
import { OfferRow } from "@/components/OfferRow";
import { ReliabilityView } from "@/components/ReliabilityView";
import { TehranMap } from "@/components/TehranMap";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Accordion } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

function DetailSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Skeleton className="aspect-4/3 w-full rounded-surface" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

export function ProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { origin } = useOrigin();
  const basket = useBasket();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [showAllOffers, setShowAllOffers] = useState(false);

  useEffect(() => {
    if (!productId) return;
    let alive = true;
    setStatus("loading");
    api
      .product(productId, origin)
      .then((value) => {
        if (!alive) return;
        setProduct(value);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setStatus("missing");
        else {
          setError(err instanceof ApiError ? err.message : "کالا بارگذاری نشد.");
          setStatus("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [productId, origin]);

  const best = product?.offers[0] ?? null;
  const inPlan = product ? basket.hasProduct(product.product_id) : false;
  const shopsOnMap = useMemo(() => {
    if (!product) return [];
    const seen = new Set<string>();
    return product.offers
      .filter((offer) => {
        if (seen.has(offer.shop.shop_id)) return false;
        seen.add(offer.shop.shop_id);
        return true;
      })
      .slice(0, 10)
      .map((offer) => ({
        id: offer.shop.shop_id,
        label: offer.shop.name,
        lat: offer.shop.lat ?? 0,
        lon: offer.shop.lon ?? 0,
        kind: "shop" as const,
        distance_m: offer.shop.distance_m,
        meta: formatToman(offer.price),
      }))
      .filter((point) => point.lat !== 0 && point.lon !== 0);
  }, [product]);

  const specSections = useMemo(() => {
    if (!product) return [];
    const map = new Map<string, { key: string; value: string }[]>();
    for (const spec of product.specs) {
      const section = spec.section || "مشخصات";
      if (!map.has(section)) map.set(section, []);
      const list = map.get(section)!;
      if (list.length < 60) list.push({ key: spec.key, value: spec.value });
    }
    return [...map.entries()].map(([section, rows]) => ({ section, rows }));
  }, [product]);

  if (status === "loading") return <DetailSkeleton />;
  if (status === "missing") {
    return (
      <EmptyState
        title="این کالا در داده نیست"
        description="ممکن است شناسه اشتباه باشد یا کالا از دیتاست حذف شده باشد."
        action={
          <Button size="lg" variant="brand" onClick={() => navigate("/explore")}>
            رفتن به کاوش
          </Button>
        }
      />
    );
  }
  if (status === "error" || !product) {
    return (
      <EmptyState
        title="کالا بارگذاری نشد"
        description={error ?? "دوباره تلاش کنید."}
        action={
          <Button size="lg" variant="brand" onClick={() => window.location.reload()}>
            تلاش دوباره
          </Button>
        }
      />
    );
  }

  function addBest() {
    if (!product || !best) return;
    basket.add({
      offer_id: best.offer_id,
      product_id: product.product_id,
      title: product.title,
      price: best.price,
      image: product.image,
      shop_id: best.shop.shop_id,
      shop_name: best.shop.name,
      neighborhood: best.shop.neighborhood,
    });
  }

  const visibleOffers = showAllOffers ? product.offers : product.offers.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="مسیر صفحه" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          خانه
        </Link>
        <ChevronLeft className="size-3" strokeWidth={1.5} aria-hidden />
        <Link to={`/explore?category=${encodeURIComponent(product.category)}`} className="hover:text-foreground">
          {product.category}
        </Link>
        <ChevronLeft className="size-3" strokeWidth={1.5} aria-hidden />
        <span className="line-clamp-1 text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-surface border-line border-border bg-card shadow-surface">
            <ProductImage src={product.image} alt={product.title} eager className="aspect-4/3" />
            {product.images.length > 1 && (
              <div className="flex gap-2 p-3">
                {product.images.slice(0, 3).map((image, index) => (
                  <ProductImage
                    key={image}
                    src={image}
                    alt={`${product.title}، تصویر ${fa(index + 1)}`}
                    className="size-16 rounded-lg"
                  />
                ))}
              </div>
            )}
          </div>

          {specSections.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">مشخصات کالا</h2>
              <Accordion
                multiple
                defaultOpen={specSections[0] ? [specSections[0].section] : []}
                items={specSections.map((section) => ({
                  id: section.section,
                  title: section.section,
                  content: (
                    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                      {section.rows.map((row) => (
                        <div key={`${section.section}-${row.key}`} className="flex justify-between gap-3 border-b border-border/60 py-1 text-xs last:border-0">
                          <dt className="shrink-0 text-muted-foreground">{row.key}</dt>
                          <dd className="text-end text-foreground">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ),
                }))}
              />
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-4 shadow-surface lg:sticky lg:top-20">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link
                to={`/explore?category=${encodeURIComponent(product.category)}`}
                className="rounded-full bg-secondary px-2 py-1 hover:text-foreground"
              >
                {product.category}
              </Link>
              {product.brand && (
                <Link
                  to={`/explore?brand=${encodeURIComponent(product.brand)}&category=${encodeURIComponent(product.category)}`}
                  className="rounded-full bg-secondary px-2 py-1 hover:text-foreground"
                >
                  {product.brand}
                </Link>
              )}
            </div>

            <h1 className="text-xl font-bold leading-8 sm:text-2xl">{product.title}</h1>

            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-muted-foreground">از</span>
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {product.min_price === null ? "—" : formatToman(product.min_price)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {product.offer_count > 1 && product.max_price !== null
                  ? `تا ${formatToman(product.max_price)} در ${fa(product.offer_count)} فروشگاه`
                  : "یک پیشنهاد ثبت‌شده"}
              </p>
            </div>

            {best && (
              <p className={cn("flex items-center gap-2 text-xs", FRESHNESS_CLASS[best.freshness])}>
                <span className={cn("size-2 rounded-full", FRESHNESS_DOT[best.freshness])} aria-hidden />
                {FRESHNESS_LABEL[best.freshness]} · {ageText(best.age_days)}
                <span className="text-muted-foreground">({jalaliDate(best.changed_at)})</span>
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-control border-line border-border bg-background/60 p-2">
                <p className="text-xs text-muted-foreground">کمترین</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {product.market.min === null ? "—" : formatToman(product.market.min)}
                </p>
              </div>
              <div className="rounded-control border-line border-border bg-background/60 p-2">
                <p className="text-xs text-muted-foreground">میانه</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {product.market.median === null ? "—" : formatToman(product.market.median)}
                </p>
              </div>
              <div className="rounded-control border-line border-border bg-background/60 p-2">
                <p className="text-xs text-muted-foreground">اختلاف</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {product.market.spread_percent === null ? "—" : `${fa(product.market.spread_percent)}٪`}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button variant={inPlan ? "secondary" : "brand"} size="lg" onClick={addBest} disabled={!best} className="w-full gap-2">
                {inPlan ? <Check className="size-4" strokeWidth={2} aria-hidden /> : <Plus className="size-4" strokeWidth={2} aria-hidden />}
                {inPlan ? "در برنامهٔ خرید" : "افزودن ارزان‌ترین پیشنهاد"}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="w-full gap-2"
                onClick={() =>
                  navigate(
                    `/?ask=${encodeURIComponent("قیمت این کالا چقدر قابل اتکاست؟")}&product=${product.product_id}`,
                  )
                }
              >
                <Sparkles className="size-4 text-brand" strokeWidth={1.5} aria-hidden />
                پرسیدن از دستیار
              </Button>
            </div>

            {best && (
              <>
                <Separator />
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">ارزان‌ترین فروشنده</p>
                  <Link to={`/s/${best.shop.shop_id}`} className="flex items-center gap-1.5 text-sm font-medium hover:text-brand">
                    <Store className="size-4" strokeWidth={1.5} aria-hidden />
                    {best.shop.name}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {best.shop.neighborhood && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" strokeWidth={1.5} aria-hidden />
                        {best.shop.neighborhood}
                      </span>
                    )}
                    {best.shop.distance_m !== null && <span>{distanceText(best.shop.distance_m)}</span>}
                  </p>
                </div>
              </>
            )}

            <p className="rounded-control bg-secondary p-3 text-xs leading-6 text-muted-foreground">
              قیمت ثبت‌شدهٔ دیتاست است، نه قیمت فعلی یا موجودی زنده. تاریخ آخرین تغییر قیمت کنار پیشنهادها آمده است؛ برای اطمینان، قیمت و موجودی را از منبع دیگری بررسی کنید.
            </p>
          </section>
        </aside>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">مقایسهٔ فروشگاه‌ها</h2>
          <p className="text-xs text-muted-foreground">
            {fa(product.offers.length)} پیشنهاد، {fa(product.market.fresh_offers)} قیمت تازه
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {visibleOffers.map((offer) => (
            <OfferRow
              key={offer.offer_id}
              offer={offer}
              productTitle={product.title}
              isBest={offer.offer_id === product.offers[0]?.offer_id}
            />
          ))}
        </div>
        {product.offers.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAllOffers((value) => !value)}
            className="flex h-11 w-fit items-center gap-1 text-sm text-brand hover:underline"
          >
            {showAllOffers ? "نمایش کمتر" : `نمایش همهٔ ${fa(product.offers.length)} پیشنهاد`}
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </section>

      {best && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">این قیمت چقدر قابل اتکاست؟</h2>
            <ReliabilityView offer={best} productTitle={product.title} />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">فروشگاه‌ها روی نقشه</h2>
            {shopsOnMap.length > 0 ? (
              <TehranMap points={shopsOnMap} origin={origin} title="فروشگاه‌های این کالا" />
            ) : (
              <div className="flex h-full items-center justify-center rounded-surface border-line border-dashed border-border p-6 text-sm text-muted-foreground">
                مختصات فروشگاه‌ها ثبت نشده است.
              </div>
            )}
          </div>
        </section>
      )}

      {product.alternatives.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">جایگزین‌های نزدیک</h2>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <BadgeCheck className="size-3.5" strokeWidth={1.5} aria-hidden />
              همان دسته، بازهٔ قیمت نزدیک
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {product.alternatives.slice(0, 6).map((alternative) => (
              <ProductCardView key={alternative.product_id} product={alternative} />
            ))}
          </div>
        </section>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" strokeWidth={1.5} aria-hidden />
        این امتیاز فقط تازگی و کامل‌بودن اطلاعات ثبت‌شده را می‌سنجد: سن قیمت، فیلدهای ثبت‌شده، گارانتی و جایگاه قیمت میان قیمت‌های ثبت‌شده. نه موجودی را تأیید می‌کند و نه صحت فروشنده را.
      </p>
    </div>
  );
}
