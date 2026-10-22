import { useEffect, useMemo, useState } from "react";
import { ArrowDown, MapPin, Store } from "lucide-react";
import type { StoreCard } from "@/shared/types";
import { api, ApiError } from "@/lib/api";
import { useAppMeta, useOrigin } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { fa, faNumber } from "@/lib/format";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StoreCardView } from "@/components/StoreCardView";
import { TehranMap } from "@/components/TehranMap";

const SORTS = [
  { value: "distance", label: "نزدیک‌ترین" },
  { value: "offers", label: "بیشترین پیشنهاد" },
  { value: "name", label: "حروف الفبا" },
] as const;

export function StoresPage() {
  const meta = useAppMeta();
  const { origin } = useOrigin();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("distance");
  const [items, setItems] = useState<StoreCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .shops(
        {
          q: applied || undefined,
          neighborhood: neighborhood || undefined,
          sort,
          page: 1,
          page_size: 18,
          lat: origin.lat,
          lon: origin.lon,
          radius_m: 9000,
        },
        origin,
      )
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setTotal(result.total);
        setPage(1);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : "فهرست فروشگاه‌ها بارگذاری نشد.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applied, neighborhood, sort, origin]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await api.shops(
        {
          q: applied || undefined,
          neighborhood: neighborhood || undefined,
          sort,
          page: page + 1,
          page_size: 18,
          lat: origin.lat,
          lon: origin.lon,
          radius_m: 9000,
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

  const mapPoints = useMemo(
    () =>
      items
        .filter((store) => store.lat !== null && store.lon !== null)
        .map((store) => ({
          id: store.shop_id,
          label: store.name,
          lat: store.lat!,
          lon: store.lon!,
          kind: "shop" as const,
          distance_m: store.distance_m,
          meta: store.neighborhood ?? undefined,
        })),
    [items],
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand/5 px-2.5 py-1 text-xs font-medium text-brand">
            <Store className="size-3.5" strokeWidth={2} aria-hidden />
            نقشهٔ فروشگاه‌ها
          </p>
          <h1 className="text-2xl font-bold">فروشگاه‌های تهران</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "در حال بارگذاری…" : `${faNumber(total)} فروشگاه در ۹ کیلومتری نقطهٔ شروع`}
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5 text-brand" strokeWidth={1.5} aria-hidden />
          فاصله از {origin.label ?? "فردوسی"}
        </p>
      </header>

      <SearchInput
        value={query}
        onChange={setQuery}
        onSearch={(value) => setApplied(value)}
        placeholder="نام فروشگاه، محله یا دسته…"
        debounce={350}
        loading={loading}
      />

      <div className="flex flex-wrap items-center gap-2">
        {SORTS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setSort(option.value)}
            className={cn(
              "flex h-11 items-center rounded-full border-line px-3 text-xs transition-colors",
              sort === option.value
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card hover:border-brand/30 hover:bg-accent",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setNeighborhood("")}
          className={cn(
            "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs",
            neighborhood === "" ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card",
          )}
        >
          همهٔ محله‌ها
        </button>
        {meta.neighborhoods.slice(0, 14).map((hood) => (
          <button
            key={hood.name}
            type="button"
            onClick={() => setNeighborhood(hood.name === neighborhood ? "" : hood.name)}
            className={cn(
              "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs",
              hood.name === neighborhood
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card",
            )}
          >
            {hood.name}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-surface border-line border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-surface border-line border-border bg-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="فروشگاهی پیدا نشد"
          description="نام فروشگاه یا محله را تغییر دهید؛ در داده فقط فروشگاه‌های داخل تهران مختصات دارند."
          action={
            <Button
              size="lg"
              variant="brand"
              onClick={() => {
                setQuery("");
                setApplied("");
                setNeighborhood("");
              }}
            >
              پاک کردن جست‌وجو
            </Button>
          }
        />
      ) : (
        <>
          <TehranMap points={mapPoints} origin={origin} title="فروشگاه‌های نتیجه" />

          <div className="stagger grid gap-3 sm:grid-cols-2">
            {items.map((store) => (
              <StoreCardView key={store.shop_id} store={store} />
            ))}
          </div>

          {items.length < total && (
            <div className="flex justify-center">
              <Button size="lg" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore} className="gap-2">
                {loadingMore ? "در حال بارگذاری…" : "فروشگاه‌های بیشتر"}
                <ArrowDown className="size-4" strokeWidth={1.5} aria-hidden />
              </Button>
            </div>
          )}

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Store className="size-3.5" strokeWidth={1.5} aria-hidden />
            {fa(items.length)} از {fa(total)} فروشگاه نمایش داده شد
          </p>
        </>
      )}
    </div>
  );
}
