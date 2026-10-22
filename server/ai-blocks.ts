import type {
  AssistantContext,
  AssistantIntent,
  Block,
  MapPoint,
  Origin,
  Plan,
  ProductCard,
  ProductDetail,
  SearchParams,
  SearchResult,
  ShopDetail,
  StoreCard,
} from "../shared/types";
import { comparisonRows } from "./agent";
import { planSummary } from "./plan";
import { distanceLabel } from "./lib/geo";
import { ageLabel, fa, toman } from "./lib/text";

/**
 * Typed, validated artifacts collected from the tools the model actually ran.
 * Only these records can become Generative UI blocks: the model writes the
 * Persian prose, the server decides what data is shown.
 */

export interface SearchArtifact {
  kind: "products";
  params: SearchParams;
  result: SearchResult;
}

export interface ProductArtifact {
  kind: "product";
  product: ProductDetail;
}

export interface CompareArtifact {
  kind: "compare";
  products: ProductDetail[];
}

export type StoreEvidence = "product_offers" | "category_offers";

export interface StoresArtifact {
  kind: "stores";
  stores: StoreCard[];
  evidence: StoreEvidence;
  subject: string;
}

export interface AlternativesArtifact {
  kind: "alternatives";
  reference: ProductCard;
  items: ProductCard[];
  dropped: number;
}

export interface PlanArtifact {
  kind: "plan";
  plan: Plan;
}

export interface ShopArtifact {
  kind: "shop";
  shop: ShopDetail;
}

export type ToolArtifact =
  | SearchArtifact
  | ProductArtifact
  | CompareArtifact
  | StoresArtifact
  | AlternativesArtifact
  | PlanArtifact
  | ShopArtifact;

export const MAX_UI_BLOCKS = 4;

function mapPoints(stores: StoreCard[], order: string[]): MapPoint[] {
  return stores
    .filter((store) => store.lat !== null && store.lon !== null)
    .map((store) => ({
      id: store.shop_id,
      label: store.name,
      lat: store.lat as number,
      lon: store.lon as number,
      kind: "shop" as const,
      distance_m: store.distance_m,
      meta: store.neighborhood ?? undefined,
      order: order.includes(store.shop_id) ? order.indexOf(store.shop_id) + 1 : undefined,
    }));
}

function mapBlock(title: string, stores: StoreCard[], origin: Origin, route: string[] = []): Block {
  return {
    type: "map",
    title,
    subtitle: "فاصله‌ها خط مستقیم از نقطهٔ شروع شماست، نه مسیر خیابان.",
    points: mapPoints(stores, route),
    origin,
    route_order: route,
  };
}

function searchTitle(params: SearchParams): string {
  if (params.category) {
    return params.max_price
      ? `${params.category} تا ${toman(params.max_price)}`
      : params.category;
  }
  if (params.brand) return `کالاهای ${params.brand}`;
  if (params.q) return `نتایج «${params.q}»`;
  return "نتیجهٔ جست‌وجو";
}

function offerCount(stores: StoreCard[]): number {
  return stores.reduce((sum, store) => sum + (store.matched_offers ?? 0), 0);
}

/** Blocks one artifact can contribute, in the order they should appear. */
function blocksFor(artifact: ToolArtifact, origin: Origin): { key: string; blocks: Block[] }[] {
  switch (artifact.kind) {
    case "products": {
      const items = artifact.result.items;
      if (items.length === 0) return [];
      const key = `products:${items.map((item) => item.product_id).join(",")}`;
      return [
        {
          key,
          blocks: [
            {
              type: "products",
              title: searchTitle(artifact.params),
              subtitle: `${fa(artifact.result.total)} کالا در دیتاست؛ ${fa(items.length)} مورد نشان داده شد`,
              products: items,
              layout: items.length <= 2 ? "list" : "grid",
            },
          ],
        },
      ];
    }
    case "product": {
      const product = artifact.product;
      const blocks: Block[] = [
        {
          type: "offers",
          title: `پیشنهادهای ${product.title}`,
          subtitle: `${fa(product.offers.length)} فروشگاه دارد؛ مرتب‌شده از ارزان‌ترین`,
          product_id: product.product_id,
          product_title: product.title,
          offers: product.offers.slice(0, 6),
          best_offer_id: product.offers[0]?.offer_id ?? "",
        },
      ];
      if (product.market.priced_offers > 0) {
        blocks.push({
          type: "insight",
          title: "نبض بازار این کالا",
          items: [
            { label: "کمترین قیمت", value: toman(product.market.min ?? 0), tone: "good" },
            {
              label: "میانهٔ بازار",
              value: product.market.median === null ? "نامشخص" : toman(product.market.median),
              tone: "neutral",
            },
            {
              label: "اختلاف قیمت",
              value:
                product.market.spread_percent === null
                  ? "نامشخص"
                  : `${fa(product.market.spread_percent)}٪`,
              hint: "بین ارزان‌ترین و گران‌ترین پیشنهاد ثبت‌شده",
              tone: (product.market.spread_percent ?? 0) > 60 ? "warn" : "neutral",
            },
            {
              label: "قیمت تازه",
              value: `${fa(product.market.fresh_offers)} از ${fa(product.market.priced_offers)}`,
              hint: "ثبت‌شده در ۳۰ روز گذشته",
              tone: product.market.fresh_offers === 0 ? "bad" : "good",
            },
          ],
        });
      }
      return [{ key: `product:${product.product_id}`, blocks }];
    }
    case "compare": {
      const ids = artifact.products.map((product) => product.product_id);
      return [
        {
          key: `compare:${ids.join(",")}`,
          blocks: [
            {
              type: "compare",
              title: "مقایسهٔ رو در رو",
              subtitle: "ستون روشن‌تر، گزینهٔ پیشنهادی است.",
              columns: artifact.products.map((product) => ({
                product_id: product.product_id,
                title: product.title,
                brand: product.brand,
                image: product.image,
                price: product.min_price,
                offer_count: product.offer_count,
                freshness: product.freshness,
                age_days: product.best?.age_days ?? null,
                neighborhood: product.best?.neighborhood ?? null,
                best_shop: product.best?.shop_name ?? null,
              })),
              rows: comparisonRows(artifact.products, origin),
              note: "قیمت‌ها کمترین پیشنهاد ثبت‌شده برای هر کالاست؛ هزینهٔ رفت‌وآمد جدا حساب کنید.",
            },
          ],
        },
      ];
    }
    case "stores": {
      if (artifact.stores.length === 0) return [];
      const stores = artifact.stores;
      const ids = stores.map((store) => store.shop_id).join(",");
      const blocks: Block[] = [
        {
          type: "stores",
          title: `فروشگاه‌های ${artifact.subject}`,
          subtitle:
            artifact.evidence === "product_offers"
              ? `${fa(offerCount(stores))} پیشنهاد ثبت‌شده برای همین کالا؛ مرتب‌شده از نزدیک‌ترین`
              : "دستهٔ کسب‌وکار یا پیشنهادهای همین دسته؛ وجود کالای مشخص تأیید نمی‌شود",
          stores,
          origin,
        },
      ];
      if (artifact.stores.some((store) => store.lat !== null)) {
        blocks.push(mapBlock("روی نقشه", stores, origin));
      }
      return [{ key: `stores:${ids}`, blocks }];
    }
    case "alternatives": {
      if (artifact.items.length === 0) return [];
      return [
        {
          key: `alternatives:${artifact.items.map((item) => item.product_id).join(",")}`,
          blocks: [
            {
              type: "products",
              title: "جایگزین‌های نزدیک",
              subtitle: `هم‌دسته با «${artifact.reference.title.slice(0, 48)}»`,
              products: artifact.items,
              layout: "grid",
            },
          ],
        },
      ];
    }
    case "plan": {
      const stops = artifact.plan.stops;
      return [
        {
          key: `plan:${stops.map((stop) => stop.shop.shop_id).join(",")}`,
          blocks: [
            { type: "plan", title: "برنامهٔ خرید حضوری", plan: artifact.plan },
            {
              type: "map",
              title: "مسیر پیشنهادی",
              subtitle: "ترتیب ایست‌ها با نزدیک‌ترین همسایه؛ زمان پیاده‌روی تخمینی است.",
              points: mapPoints(
                stops.map((stop) => ({
                  shop_id: stop.shop.shop_id,
                  name: stop.shop.name,
                  identity: stop.shop.identity,
                  neighborhood: stop.shop.neighborhood,
                  address: stop.shop.address,
                  lat: stop.shop.lat,
                  lon: stop.shop.lon,
                  distance_m: stop.shop.distance_m,
                  categories: [],
                  website: null,
                  instagram: null,
                  fast_delivery: false,
                  offer_count: 0,
                  hours_today: null,
                  open_now: null,
                })),
                stops.map((stop) => stop.shop.shop_id),
              ),
              origin: artifact.plan.origin,
              route_order: stops.map((stop) => stop.shop.shop_id),
            },
          ],
        },
      ];
    }
    case "shop": {
      const shop = artifact.shop;
      const blocks: Block[] = [
        {
          type: "stores",
          title: "فروشگاه انتخاب‌شده",
          subtitle: shop.identity === "registered" ? "نام و نشانی ثبت‌شده در دیتاست" : "شناسهٔ فروشگاه ناشناس‌شده است",
          stores: [shop],
          origin,
        },
      ];
      if (shop.lat !== null && shop.lon !== null) {
        blocks.push(mapBlock("روی نقشه", [shop], origin));
      }
      return [{ key: `shop:${shop.shop_id}`, blocks }];
    }
    default:
      return [];
  }
}

/**
 * Builds the final block list from the executed tools: real records only,
 * redundant repeats dropped, later results replacing earlier ones.
 */
export function buildUiBlocks(artifacts: ToolArtifact[], origin: Origin): Block[] {
  const seen = new Set<string>();
  const blocks: Block[] = [];
  const compareIds = artifacts
    .filter((artifact): artifact is CompareArtifact => artifact.kind === "compare")
    .map((artifact) => new Set(artifact.products.map((product) => product.product_id)));

  // Walk backwards so a later, more specific tool result wins over an earlier
  // broad one, then restore the original order for display.
  const ordered: Block[] = [];
  for (const artifact of [...artifacts].reverse()) {
    for (const candidate of blocksFor(artifact, origin).reverse()) {
      if (seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      const productIds = candidate.blocks
        .flatMap((block) => (block.type === "products" ? block.products.map((p) => p.product_id) : []));
      if (
        productIds.length > 0 &&
        compareIds.some((ids) => productIds.every((id) => ids.has(id)))
      ) {
        // The comparison block already shows these products side by side.
        continue;
      }
      ordered.push(...candidate.blocks);
    }
  }
  ordered.reverse();
  for (const block of ordered) {
    if (blocks.length >= MAX_UI_BLOCKS) break;
    blocks.push(block);
  }
  return blocks;
}

/** Deterministic Persian summary used when the model ends without prose. */
export function summarize(artifacts: ToolArtifact[], origin: Origin): string {
  const last = artifacts.at(-1);
  if (!last) return "برای این پیام اطلاعاتی در دیتاست پیدا نکردم. نام کالا یا بودجه را روشن‌تر بگویید.";
  switch (last.kind) {
    case "products": {
      const items = last.result.items;
      if (items.length === 0) return "با این فیلترها نتیجه‌ای در دیتاست نبود.";
      const cheapest = items
        .map((item) => item.min_price)
        .filter((price): price is number => price !== null)
        .sort((a, b) => a - b)[0];
      return `${fa(items.length)} گزینه پیدا شد${cheapest ? `؛ ارزان‌ترین از ${toman(cheapest)}` : ""}.`;
    }
    case "product":
      return last.product.offers[0]
        ? `کمترین قیمت ثبت‌شده ${toman(last.product.offers[0].price)} در «${last.product.offers[0].shop.name}» است؛ ${ageLabel(last.product.offers[0].age_days)}.`
        : "برای این کالا قیمتی ثبت نشده است.";
    case "compare":
      return `${fa(last.products.length)} گزینه مقایسه شد؛ ستون روشن‌تر ارزان‌ترین است.`;
    case "stores":
      return last.stores[0]
        ? `نزدیک‌ترین گزینه «${last.stores[0].name}» با فاصلهٔ خط مستقیم ${distanceLabel(last.stores[0].distance_m)} است.`
        : "فروشگاهی با این شرایط پیدا نشد.";
    case "alternatives":
      return `${fa(last.items.length)} جایگزین هم‌دسته پیدا شد.`;
    case "plan":
      return planSummary(last.plan);
    case "shop":
      return `اطلاعات ثبت‌شدهٔ «${last.shop.name}» آماده است.`;
    default:
      return "نتیجه آماده است.";
  }
}

export function suggestionsFor(artifacts: ToolArtifact[]): string[] {
  const last = artifacts.at(-1);
  if (!last) return ["هدفون بی‌سیم زیر ۵ میلیون", "نزدیک‌ترین فروشگاه دوربین مدار بسته", "برنامهٔ خرید بچین"];
  switch (last.kind) {
    case "product":
      return ["قیمت‌های همین کالا را مقایسه کن", "نزدیک‌ترین فروشگاه این کالا کجاست؟", "جایگزین ارزان‌تر پیشنهاد بده", "برنامهٔ خرید بچین"];
    case "compare":
      return ["نزدیک‌ترین فروشگاه این کالا کجاست؟", "برنامهٔ خرید بچین", "ارزان‌ترین گزینه‌ها را نشان بده"];
    case "stores":
      return ["برنامهٔ خرید بچین", "قیمت‌های این دسته را مقایسه کن", "فروشگاه‌های نزدیک‌تر"];
    case "plan":
      return ["گزینهٔ ارزان‌تر جایگزین کن", "فروشگاه‌های نزدیک‌تر", "قیمت‌ها را دوباره مقایسه کن"];
    case "alternatives":
      return ["این گزینه را با کالای فعلی مقایسه کن", "نزدیک‌ترین فروشگاه این کالا کجاست؟", "برنامهٔ خرید بچین"];
    case "shop":
      return ["قیمت‌های همین فروشگاه را ببین", "فروشگاه‌های نزدیک‌تر", "برنامهٔ خرید بچین"];
    default:
      return ["ارزان‌ترین گزینه‌ها را نشان بده", "قیمت‌ها را مقایسه کن", "برنامهٔ خرید بچین"];
  }
}

export function intentFor(artifacts: ToolArtifact[]): AssistantIntent {
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  if (kinds.has("plan")) return "plan";
  if (kinds.has("compare")) return "compare";
  if (kinds.has("alternatives")) return "alternatives";
  if (kinds.has("shop") || kinds.has("stores")) return "stores";
  if (kinds.has("product")) return "offers";
  if (kinds.has("products")) return "search";
  return "unknown";
}

/** Carries the useful ids forward so the next turn understands follow-ups. */
export function nextContext(
  context: AssistantContext,
  artifacts: ToolArtifact[],
): AssistantContext {
  const next: AssistantContext = { ...context };
  for (const artifact of artifacts) {
    if (artifact.kind === "product") {
      next.product_id = artifact.product.product_id;
      next.product_title = artifact.product.title;
      next.category = artifact.product.category;
    } else if (artifact.kind === "products" && artifact.result.items[0]) {
      next.product_id = artifact.result.items[0].product_id;
      next.product_title = artifact.result.items[0].title;
      next.category = artifact.result.items[0].category;
      next.query = artifact.params.q ?? context.query;
    } else if (artifact.kind === "compare" && artifact.products[0]) {
      next.product_id = artifact.products[0].product_id;
      next.product_title = artifact.products[0].title;
      next.category = artifact.products[0].category;
    } else if (artifact.kind === "plan") {
      next.offer_ids = artifact.plan.stops.flatMap((stop) => stop.items.map((item) => item.offer_id));
    }
  }
  return next;
}
