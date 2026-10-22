import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, SlidersHorizontal, X } from "lucide-react";
import type { ProductCard, SearchParams } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useAppMeta, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { fa, faNumber, formatToman } from "@/lib/format";
import { ProductCardView, ProductGridSkeleton } from "@/components/ProductCardView";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";

const SORTS = [
  { value: "freshness", label: "تازه‌ترین" },
  { value: "offers", label: "پیشنهاد بیشتر" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
];

const FRESHNESS = [
  { value: "any", label: "همه" },
  { value: "7", label: "۷ روز" },
  { value: "30", label: "۳۰ روز" },
  { value: "90", label: "۹۰ روز" },
];

/** Local chip group: the VibeFarsi ToggleGroup re-measures on every render. */
function ChipRow({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "flex h-11 items-center rounded-control border-line px-3 text-xs transition-colors",
            value === item.value
              ? "border-brand bg-brand text-brand-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ExplorePage() {
  const meta = useAppMeta();
  const { origin } = useOrigin();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const neighborhood = params.get("neighborhood") ?? "";
  const brand = params.get("brand") ?? "";
  const sort = (params.get("sort") ?? "freshness") as NonNullable<SearchParams["sort"]>;
  const maxPrice = Number(params.get("max_price") ?? 0) || null;
  const maxAge = Number(params.get("max_age_days") ?? 0) || null;
  const minOffers = params.get("min_offers") === "2" ? 2 : null;

  const [queryInput, setQueryInput] = useState(q);
  const [showFilters, setShowFilters] = useState(false);
  const [minMillions, setMinMillions] = useState(
    params.get("min_price") ? String(Number(params.get("min_price")) / 1_000_000) : "",
  );
  const [maxMillions, setMaxMillions] = useState(maxPrice ? String(maxPrice / 1_000_000) : "");
  const [items, setItems] = useState<ProductCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signature = params.toString();
  const requestId = useRef(0);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    setPage(1);
    api
      .search(
        {
          q: q || undefined,
          category: category || undefined,
          neighborhood: neighborhood || undefined,
          brand: brand || undefined,
          max_price: maxPrice ?? undefined,
          min_price: Number(params.get("min_price") ?? 0) || undefined,
          min_offers: minOffers ?? undefined,
          max_age_days: maxAge ?? undefined,
          sort,
          page_size: 24,
          page: 1,
        },
        origin,
      )
      .then((result) => {
        if (current !== requestId.current) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (current !== requestId.current) return;
        setError(err instanceof ApiError ? err.message : "نتایج بارگذاری نشد.");
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
  }, [signature, origin]);

  function update(patch: Record<string, string | number | null | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next, { replace: true });
  }

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.search(
        {
          q: q || undefined,
          category: category || undefined,
          neighborhood: neighborhood || undefined,
          brand: brand || undefined,
          max_price: maxPrice ?? undefined,
          min_price: Number(params.get("min_price") ?? 0) || undefined,
          min_offers: minOffers ?? undefined,
          max_age_days: maxAge ?? undefined,
          sort,
          page_size: 24,
          page: page + 1,
        },
        origin,
      );
      setItems((current) => [...current, ...result.items]);
      setPage((value) => value + 1);
    } catch {
      setError("بارگذاری صفحهٔ بعد انجام نشد.");
    } finally {
      setLoadingMore(false);
    }
  }

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (category) chips.push({ key: "category", label: category, clear: () => update({ category: null }) });
    if (brand) chips.push({ key: "brand", label: brand, clear: () => update({ brand: null }) });
    if (neighborhood)
      chips.push({ key: "hood", label: neighborhood, clear: () => update({ neighborhood: null }) });
    if (maxPrice)
      chips.push({ key: "price", label: `تا ${formatToman(maxPrice)}`, clear: () => update({ max_price: null }) });
    if (maxAge) chips.push({ key: "age", label: `قیمت تا ${fa(maxAge)} روز`, clear: () => update({ max_age_days: null }) });
    if (minOffers) chips.push({ key: "offers", label: "دو فروشنده یا بیشتر", clear: () => update({ min_offers: null }) });
    if (q) chips.push({ key: "q", label: `«${q}»`, clear: () => update({ q: null }) });
    return chips;
  }, [category, brand, neighborhood, maxPrice, maxAge, minOffers, q]);

  function applyBudget() {
    const min = Number(minMillions) * 1_000_000;
    const max = Number(maxMillions) * 1_000_000;
    update({
      min_price: Number.isFinite(min) && min > 0 ? min : null,
      max_price: Number.isFinite(max) && max > 0 ? max : null,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">کاوش قیمت‌ها</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading ? "در حال جست‌وجو…" : `${faNumber(total)} کالا در داده پیدا شد`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">فاصله‌ها از {origin.label ?? "فردوسی"}</p>
        </div>

        <SearchInput
          value={queryInput}
          onChange={setQueryInput}
          onSearch={(value) => update({ q: value || null })}
          placeholder="نام کالا، برند یا مدل…"
          debounce={350}
          loading={loading}
        />
      </header>

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => update({ category: null })}
          className={cn(
            "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs transition-colors",
            category === "" ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card hover:bg-accent",
          )}
        >
          همه
        </button>
        {meta.categories.slice(0, 14).map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => update({ category: item.name === category ? null : item.name })}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-full border-line px-3 text-xs transition-colors",
              item.name === category
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            {item.name}
            <span className={item.name === category ? "text-brand-foreground/70" : "text-muted-foreground"}>
              {faNumber(item.product_count)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
          className="gap-2"
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
          فیلترها
          {activeChips.length > 0 && (
            <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground">
              {fa(activeChips.length)}
            </span>
          )}
        </Button>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          <ChipRow
            items={SORTS}
            value={sort}
            onChange={(value) => update({ sort: value })}
            label="ترتیب نتایج"
          />
        </div>
      </div>

      {showFilters && (
        <section className="rise flex flex-col gap-4 rounded-surface border-line border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="min-price" className="text-xs text-muted-foreground">
                حداقل بودجه (میلیون تومان)
              </label>
              <Input
                id="min-price"
                type="number"
                inputMode="numeric"
                dir="ltr"
                min={0}
                value={minMillions}
                onChange={(event) => setMinMillions(event.target.value)}
                placeholder="۰"
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="max-price" className="text-xs text-muted-foreground">
                حداکثر بودجه (میلیون تومان)
              </label>
              <Input
                id="max-price"
                type="number"
                inputMode="numeric"
                dir="ltr"
                min={0}
                value={maxMillions}
                onChange={(event) => setMaxMillions(event.target.value)}
                placeholder="مثلاً ۲۰"
                className="h-11"
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">تازگی قیمت</p>
            <ChipRow
              items={FRESHNESS}
              value={maxAge ? String(maxAge) : "any"}
              onChange={(value) => update({ max_age_days: value === "any" ? null : value })}
              label="حداکثر عمر قیمت"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={minOffers === 2}
              onClick={() => update({ min_offers: minOffers === 2 ? null : "2" })}
              className={cn(
                "flex h-11 items-center rounded-control border-line px-3 text-xs transition-colors",
                minOffers === 2
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              فقط کالاهای چندفروشنده
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">محله</p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => update({ neighborhood: null })}
                className={cn(
                  "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs",
                  neighborhood === "" ? "border-brand bg-brand text-brand-foreground" : "border-border bg-background",
                )}
              >
                همهٔ تهران
              </button>
              {meta.neighborhoods.slice(0, 14).map((hood) => (
                <button
                  key={hood.name}
                  type="button"
                  onClick={() => update({ neighborhood: hood.name === neighborhood ? null : hood.name })}
                  className={cn(
                    "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs",
                    hood.name === neighborhood
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {hood.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="brand" size="lg" onClick={applyBudget}>
              اعمال بودجه
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setMinMillions("");
                setMaxMillions("");
                update({ min_price: null, max_price: null, max_age_days: null, min_offers: null, neighborhood: null });
              }}
            >
              پاک کردن فیلترها
            </Button>
          </div>
        </section>
      )}

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              className="flex h-11 items-center gap-1 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
              aria-label={`حذف فیلتر ${chip.label}`}
            >
              {chip.label}
              <X className="size-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border-line border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <ProductGridSkeleton count={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title={maxPrice ? `در بودجهٔ تا ${formatToman(maxPrice)} چیزی پیدا نشد` : "چیزی با این فیلترها پیدا نشد"}
          description="بودجه را بالاتر ببرید، محله را بردارید یا دستهٔ دیگری را امتحان کنید."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {maxPrice && (
                <Button variant="brand" onClick={() => update({ max_price: Math.max(500_000, Math.ceil((maxPrice * 1.5) / 100_000) * 100_000) })}>
                  افزایش بودجه
                </Button>
              )}
              {maxPrice && (
                <Button variant="secondary" onClick={() => update({ max_price: null })}>
                  حذف فیلتر بودجه
                </Button>
              )}
              <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
                پاک کردن همهٔ فیلترها
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {items.map((product, index) => (
              <ProductCardView key={product.product_id} product={product} eager={index < 4} />
            ))}
          </div>

          {items.length < total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="gap-2"
              >
                {loadingMore ? "در حال بارگذاری…" : "نمایش بیشتر"}
                <ArrowDown className="size-4" strokeWidth={1.5} aria-hidden />
              </Button>
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {fa(items.length)} از {fa(total)} کالا نمایش داده شد
          </p>
        </>
      )}
    </div>
  );
}
