import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import type { Block } from "@/shared/types";
import { cn } from "@/lib/utils";
import { fa, formatToman } from "@/lib/format";
import { ProductCardView } from "@/components/ProductCardView";
import { OfferRow } from "@/components/OfferRow";
import { StoreCardView } from "@/components/StoreCardView";
import { ReliabilityView } from "@/components/ReliabilityView";
import { TehranMap } from "@/components/TehranMap";
import { PlanView } from "@/components/PlanView";

const SORT_LABEL: Record<string, string> = {
  price_asc: "ارزان‌ترین",
  price_desc: "گران‌ترین",
  freshness: "تازه‌ترین قیمت",
  offers: "بیشترین فروشنده",
  relevance: "مرتبط‌ترین",
};

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "products":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} subtitle={block.subtitle} />
          <div
            className={cn(
              block.layout === "list"
                ? "flex flex-col gap-3"
                : "stagger grid grid-cols-2 gap-3 md:grid-cols-3",
            )}
          >
            {block.products.map((product, index) => (
              <ProductCardView
                key={product.product_id}
                product={product}
                layout={block.layout ?? "grid"}
                eager={index < 3}
              />
            ))}
          </div>
          <Link
            to="/explore"
            className="inline-flex h-11 w-fit items-center gap-1.5 rounded-control px-1 text-sm text-brand hover:underline"
          >
            دیدن همه در کاوش
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </Link>
        </section>
      );

    case "offers":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} subtitle={block.subtitle} />
          <div className="flex flex-col gap-2">
            {block.offers.map((offer) => (
              <OfferRow
                key={offer.offer_id}
                offer={offer}
                productTitle={block.product_title}
                isBest={offer.offer_id === block.best_offer_id}
              />
            ))}
          </div>
          <Link
            to={`/p/${block.product_id}`}
            className="inline-flex h-11 w-fit items-center gap-1.5 rounded-control px-1 text-sm text-brand hover:underline"
          >
            صفحهٔ کامل کالا و مشخصات
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </Link>
        </section>
      );

    case "compare":
      return <CompareBlock block={block} />;

    case "stores":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} subtitle={block.subtitle} />
          <div className="stagger grid gap-3 sm:grid-cols-2">
            {block.stores.map((store) => (
              <StoreCardView key={store.shop_id} store={store} />
            ))}
          </div>
        </section>
      );

    case "map":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} subtitle={block.subtitle} />
          <TehranMap
            points={block.points}
            origin={block.origin}
            routeOrder={block.route_order}
            title={block.title}
          />
        </section>
      );

    case "filters":
      return <FiltersBlock block={block} />;

    case "reliability":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} />
          <ReliabilityView offer={block.offer} productTitle={block.product_title} />
        </section>
      );

    case "plan":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} />
          <PlanView plan={block.plan}>
            <Link
              to="/plan"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-control border-line border-border bg-secondary px-4 text-sm font-medium hover:bg-accent"
            >
              ویرایش در برنامهٔ خرید
            </Link>
          </PlanView>
        </section>
      );

    case "insight":
      return (
        <section className="flex flex-col gap-3">
          <SectionHeader title={block.title} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {block.items.map((item) => (
              <div key={item.label} className="rounded-xl border-line border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p
                  className={cn(
                    "mt-1 text-lg font-bold",
                    item.tone === "good" && "text-success",
                    item.tone === "warn" && "text-warning",
                    item.tone === "bad" && "text-destructive",
                  )}
                >
                  {item.value}
                </p>
                {item.hint && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.hint}</p>}
              </div>
            ))}
          </div>
        </section>
      );

    case "note": {
      const tone =
        block.tone === "warn"
          ? { Icon: AlertTriangle, className: "border-warning/40 bg-warning/10 text-warning" }
          : block.tone === "success"
            ? { Icon: CheckCircle2, className: "border-success/40 bg-success/10 text-success" }
            : { Icon: Info, className: "border-border bg-secondary text-muted-foreground" };
      return (
        <div className={cn("flex gap-2 rounded-xl border-line p-3 text-sm leading-7", tone.className)}>
          <tone.Icon className="mt-1 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <div>
            {block.title && <p className="font-medium text-foreground">{block.title}</p>}
            <p className={block.title ? "text-muted-foreground" : ""}>{block.body}</p>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function CompareBlock({ block }: { block: Extract<Block, { type: "compare" }> }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={block.title} subtitle={block.subtitle} />
      <div className="overflow-x-auto rounded-surface border-line border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="sticky start-0 bg-card p-3 text-start text-xs font-medium text-muted-foreground">
                ویژگی
              </th>
              {block.columns.map((column) => (
                <th key={column.product_id} scope="col" className="min-w-40 p-3 text-start align-top font-normal">
                  <Link to={`/p/${column.product_id}`} className="flex flex-col gap-2 hover:text-brand">
                    <span className="text-sm font-medium leading-6">{column.title}</span>
                    <span className="text-xs text-muted-foreground">{column.brand ?? column.neighborhood ?? "—"}</span>
                    <span className="text-base font-bold tabular-nums">
                      {column.price === null ? "—" : formatToman(column.price)}
                    </span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-0">
                <th scope="row" className="sticky start-0 bg-card p-3 text-start text-xs font-medium text-muted-foreground">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={index}
                    className={cn(
                      "p-3 align-top text-sm",
                      row.best_index === index && "bg-brand/10 font-semibold text-brand",
                    )}
                  >
                    {value ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.note && <p className="text-xs leading-6 text-muted-foreground">{block.note}</p>}
    </section>
  );
}

function FiltersBlock({ block }: { block: Extract<Block, { type: "filters" }> }) {
  const { active, options } = block;
  const chips: { label: string; value: string }[] = [];
  if (active.q) chips.push({ label: "جست‌وجو", value: active.q });
  if (active.category) chips.push({ label: "دسته", value: active.category });
  if (active.brand) chips.push({ label: "برند", value: active.brand });
  if (active.neighborhood) chips.push({ label: "محله", value: active.neighborhood });
  if (active.max_price) chips.push({ label: "بودجه تا", value: formatToman(active.max_price) });
  if (active.sort) chips.push({ label: "ترتیب", value: SORT_LABEL[active.sort] ?? active.sort });

  const exploreHref = (patch: Record<string, string | number | null | undefined>) => {
    const search = new URLSearchParams();
    const merged = {
      q: active.q,
      category: active.category,
      brand: active.brand,
      neighborhood: active.neighborhood,
      max_price: active.max_price,
      sort: active.sort,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value === null || value === undefined || value === "") continue;
      search.set(key, String(value));
    }
    return `/explore?${search.toString()}`;
  };

  return (
    <section className="flex flex-col gap-3 rounded-surface border-line border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="size-4" strokeWidth={1.5} aria-hidden />
          {block.title}
        </h3>
        <Link to={exploreHref({})} className="text-xs text-brand hover:underline">
          ویرایش در کاوش
        </Link>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={`${chip.label}-${chip.value}`}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">{chip.label}:</span>
              <span>{chip.value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">دسته‌های نزدیک</p>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {options.categories.map((category) => (
            <Link
              key={category}
              to={exploreHref({ category, q: null })}
              className={cn(
                "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs transition-colors",
                category === active.category
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              {category}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">محله</p>
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {options.neighborhoods.map((neighborhood) => (
            <Link
              key={neighborhood}
              to={exploreHref({ neighborhood })}
              className={cn(
                "flex h-11 shrink-0 items-center rounded-full border-line px-3 text-xs transition-colors",
                neighborhood === active.neighborhood
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              {neighborhood}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
