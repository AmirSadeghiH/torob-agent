import { AsyncLocalStorage } from "node:async_hooks";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, tool, toolCallLimitMiddleware } from "langchain";
import { z } from "zod";
import type {
  AssistantContext,
  AssistantHistoryTurn,
  AssistantIntent,
  Block,
  Origin,
  ProductCard,
  ProductDetail,
  SearchParams,
  StoreCard,
} from "../shared/types";
import {
  allBrandNames,
  allCategoryNames,
  getMeta,
  getOffer,
  getProduct,
  getShop,
  getStoresSelling,
  searchProducts,
} from "./repo";
import { buildPlan } from "./plan";
import { createChatModel, getAgentConfig, normalizeHistory, type AgentConfig } from "./ai-config";
import { normalizeFa } from "./lib/text";
import { haversineMeters } from "./lib/geo";
import {
  buildUiBlocks,
  intentFor,
  nextContext,
  suggestionsFor,
  summarize,
  type PlanArtifact,
  type ToolArtifact,
} from "./ai-blocks";

type AgentModel = NonNullable<Parameters<typeof createAgent>[0]["model"]>;

export { getAgentConfig, normalizeHistory, createChatModel };
export type { AgentConfig };

/* ------------------------------------------------- request-scoped collector */

/**
 * Everything a tool records lands here. `AsyncLocalStorage` keeps two
 * simultaneous conversations from seeing each other's blocks.
 */
interface Collector {
  artifacts: ToolArtifact[];
  executed: string[];
  origin: Origin;
}

const collectorStorage = new AsyncLocalStorage<Collector>();

function activeCollector(): Collector {
  return (
    collectorStorage.getStore() ?? {
      artifacts: [],
      executed: [],
      origin: getMeta().default_origin,
    }
  );
}

function record(toolName: string, artifact: ToolArtifact): void {
  const collector = collectorStorage.getStore();
  if (!collector) return;
  collector.executed.push(toolName);
  collector.artifacts.push(artifact);
}

function originForTools(): Origin {
  return activeCollector().origin;
}

/* ------------------------------------------------------------- validation */

function datasetVocabulary() {
  return {
    categories: allCategoryNames(),
    brands: allBrandNames(),
    neighborhoods: getMeta().neighborhoods.map((n) => n.name),
  };
}

/** Maps a model-provided label onto a real dataset value or fails loudly. */
function canonical(
  raw: string,
  values: string[],
  label: string,
  examples = 6,
): string {
  const wanted = normalizeFa(raw);
  const exact = values.find((value) => normalizeFa(value) === wanted);
  if (exact) return exact;
  const partial = values.find((value) => normalizeFa(value).includes(wanted));
  if (partial) return partial;
  const near = values.filter((value) => normalizeFa(value).startsWith(wanted.slice(0, 3))).slice(0, examples);
  throw new Error(
    `${label} «${raw}» در دیتاست نیست.` +
      (near.length > 0 ? ` گزینه‌های موجود: ${near.join("، ")}` : " با نام دیگری جست‌وجو کن."),
  );
}

function clampLimit(value: number | undefined, fallbackValue: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallbackValue;
  return Math.min(max, Math.max(1, Math.round(value)));
}

function toCard(product: ProductDetail): ProductCard {
  return {
    product_id: product.product_id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    image: product.image,
    min_price: product.min_price,
    max_price: product.max_price,
    offer_count: product.offer_count,
    best: product.best,
    newest_at: product.newest_at,
    freshness: product.freshness,
  };
}

function clip(value: string | null, max = 90): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ tools */

const searchSchema = z.object({
  query: z.string().trim().max(80).optional().describe("Free text product words, Persian"),
  category: z.string().trim().max(60).optional().describe("Dataset category name, exactly as returned by a previous tool"),
  brand: z.string().trim().max(60).optional().describe("Dataset brand name"),
  neighborhood: z.string().trim().max(60).optional().describe("Tehran neighborhood name"),
  min_price: z.number().int().positive().max(10_000_000_000).optional(),
  max_price: z.number().int().positive().max(10_000_000_000).optional().describe("Hard budget ceiling in toman"),
  sort: z.enum(["relevance", "price_asc", "price_desc", "offers", "freshness"]).optional(),
  radius_m: z.number().int().min(500).max(20_000).optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

export const searchProductsTool = tool(
  async (input) => {
    const origin = originForTools();
    const vocab = datasetVocabulary();
    const category = input.category ? canonical(input.category, vocab.categories, "دسته") : undefined;
    const brand = input.brand ? canonical(input.brand, vocab.brands, "برند") : undefined;
    const neighborhood = input.neighborhood
      ? canonical(input.neighborhood, vocab.neighborhoods, "محله")
      : undefined;
    if (
      typeof input.min_price === "number" &&
      typeof input.max_price === "number" &&
      input.min_price > input.max_price
    ) {
      throw new Error("min_price نباید از max_price بیشتر باشد.");
    }

    const params: SearchParams = {
      q: input.query?.trim() || undefined,
      category,
      brand,
      neighborhood,
      min_price: input.min_price,
      max_price: input.max_price,
      sort: input.sort,
      page_size: clampLimit(input.limit, 4, 6),
      radius_m: input.radius_m,
    };
    const result = searchProducts(params, origin);
    record("search_products", { kind: "products", params, result });

    return JSON.stringify({
      total: result.total,
      shown: result.items.length,
      filters: {
        q: params.q ?? null,
        category: category ?? null,
        brand: brand ?? null,
        neighborhood: neighborhood ?? null,
        min_price: params.min_price ?? null,
        max_price: params.max_price ?? null,
        sort: params.sort ?? null,
        radius_m: params.radius_m ?? null,
      },
      items: result.items.map((item) => ({
        product_id: item.product_id,
        title: clip(item.title, 110),
        brand: item.brand,
        category: item.category,
        min_price: item.min_price,
        max_price: item.max_price,
        offer_count: item.offer_count,
        cheapest_offer: item.best
          ? {
              offer_id: item.best.offer_id,
              price: item.best.price,
              shop: item.best.shop_name,
              neighborhood: item.best.neighborhood,
              age_days: item.best.age_days,
              freshness: item.best.freshness,
            }
          : null,
      })),
      note:
        result.items.length === 0
          ? "هیچ کالایی با این فیلترها نبود؛ فیلتر را ساده‌تر یا بودجه را بالاتر بده."
          : undefined,
    });
  },
  {
    name: "search_products",
    description:
      "Search the Torob dataset for products and their cheapest recorded offer. Use it whenever the user names a product, category, brand, budget or neighborhood. Prices are recorded, not live. Returns at most 6 rows: product_id, title, min/max price, offer count and the cheapest offer id. Never invent products; call this first, then fetch details with the returned ids.",
    schema: searchSchema,
  },
);

const productDetailsSchema = z.object({
  product_id: z.string().trim().min(3).max(64).describe("A product_id returned by another tool"),
});

export const getProductDetailsTool = tool(
  async (input) => {
    const origin = originForTools();
    const product = getProduct(input.product_id, origin);
    if (!product) {
      throw new Error(
        "این product_id در دیتاست نیست. ابتدا search_products را صدا بزن و شناسه‌ای از خروجی آن را بفرست.",
      );
    }
    record("get_product_details", { kind: "product", product });

    return JSON.stringify({
      product_id: product.product_id,
      title: clip(product.title, 140),
      brand: product.brand,
      category: product.category,
      market: {
        min_price: product.market.min,
        median_price: product.market.median,
        max_price: product.market.max,
        priced_offers: product.market.priced_offers,
        fresh_offers: product.market.fresh_offers,
      },
      specs: product.specs.slice(0, 6).map((spec) => ({
        key: clip(spec.key, 40),
        value: clip(spec.value, 90),
      })),
      offers: product.offers.slice(0, 4).map((offer) => ({
        offer_id: offer.offer_id,
        price: offer.price,
        changed_at: offer.changed_at,
        age_days: offer.age_days,
        freshness: offer.freshness,
        warranty: clip(offer.warranty, 50),
        shop: {
          shop_id: offer.shop.shop_id,
          name: offer.shop.name,
          identity: offer.shop.identity,
          neighborhood: offer.shop.neighborhood,
          address: clip(offer.shop.address, 120),
          distance_m: offer.shop.distance_m,
        },
        reliability_score: offer.reliability.score,
      })),
      alternatives_count: product.alternatives.length,
      note: "قیمت و موجودی ثبت‌شده است و موجودی فعلی تأیید نمی‌شود.",
    });
  },
  {
    name: "get_product_details",
    description:
      "Fetch one product's recorded specifications, price statistics, freshness and up to 4 real offers (with offer_id and shop) from the dataset. Use it after search_products, before quoting a price, or when the user asks about 'همین کالا'. Requires a valid product_id from a previous tool result; unknown ids fail.",
    schema: productDetailsSchema,
  },
);

const compareSchema = z.object({
  product_ids: z
    .array(z.string().trim().min(3).max(64))
    .min(2)
    .max(3)
    .describe("Two or three product_ids, normally taken from the open product and a search result"),
});

export const compareProductsTool = tool(
  async (input) => {
    const origin = originForTools();
    const ids = [...new Set(input.product_ids)];
    if (ids.length < 2) {
      throw new Error("برای مقایسه دو کالای متفاوت لازم است؛ شناسه‌های تکراری را حذف کن.");
    }
    const products = ids.map((id) => getProduct(id, origin)).filter((p): p is ProductDetail => p !== null);
    if (products.length < 2) {
      throw new Error(
        "شناسه‌های فرستاده‌شده در دیتاست پیدا نشدند. با search_products کالاها را پیدا کن و شناسه‌های واقعی را بفرست.",
      );
    }
    record("compare_products", { kind: "compare", products });

    const rows = products.map((product) => ({
      product_id: product.product_id,
      title: clip(product.title, 110),
      brand: product.brand,
      category: product.category,
      min_price: product.min_price,
      max_price: product.max_price,
      offer_count: product.offer_count,
      price_age_days: product.best?.age_days ?? null,
      freshness: product.freshness,
      cheapest_shop: product.best?.shop_name ?? null,
      neighborhood: product.best?.neighborhood ?? null,
      median_price: product.market.median,
      specs: product.specs
        .filter((spec) => spec.key.length <= 28 && spec.value.length <= 70)
        .slice(0, 3)
        .map((spec) => ({ key: spec.key, value: spec.value })),
    }));
    const lowest = products.reduce(
      (best, product) =>
        product.min_price !== null && (best === null || product.min_price < best.min_price!)
          ? { product_id: product.product_id, min_price: product.min_price }
          : best,
      null as { product_id: string; min_price: number } | null,
    );

    return JSON.stringify({
      products: rows,
      lowest_price_product_id: lowest?.product_id ?? null,
      note: "برای هر کالا کمترین قیمت ثبت‌شده آمده است؛ «نامشخص» یعنی داده‌ای در دیتاست نبوده.",
    });
  },
  {
    name: "compare_products",
    description:
      "Compare 2-3 different products on recorded price, offer count, price freshness and shared specifications. Use it when the user asks to compare models or shortlisted products. Do not use it to compare offers of the same product (use get_product_details for that). Only valid product_ids from earlier tool results are accepted; missing data is reported as unknown.",
    schema: compareSchema,
  },
);

const storesSchema = z.object({
  product_id: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .optional()
    .describe("Exact product whose recorded offers should be located"),
  category: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe("Category-level discovery when there is no specific product yet"),
  radius_m: z.number().int().min(500).max(20_000).optional(),
  limit: z.number().int().min(1).max(6).optional(),
});

export const findStoresForProductTool = tool(
  async (input) => {
    const origin = originForTools();
    const limit = clampLimit(input.limit, 4, 6);
    const radiusM = input.radius_m ?? 6_000;

    let stores: StoreCard[] = [];
    let evidence: "product_offers" | "category_offers";
    let subject: string;
    let product: ProductDetail | null = null;

    if (input.product_id) {
      product = getProduct(input.product_id, origin);
      if (!product) {
        throw new Error("این product_id در دیتاست نیست؛ ابتدا با search_products کالا را پیدا کن.");
      }
      const shopsWithOffer = new Set(product.offers.map((offer) => offer.shop.shop_id));
      stores = getStoresSelling({
        productIds: [product.product_id],
        origin,
        radiusM,
        limit: 12,
      })
        // Only shops with a recorded offer for this exact product.
        .filter((store) => shopsWithOffer.has(store.shop_id))
        .slice(0, limit);
      evidence = "product_offers";
      subject = clip(product.title, 40) ?? product.category;
    } else if (input.category) {
      const category = canonical(input.category, allCategoryNames(), "دسته");
      stores = getStoresSelling({ category, origin, radiusM, limit });
      evidence = "category_offers";
      subject = category;
    } else {
      throw new Error("product_id یا category لازم است.");
    }

    record("find_stores_for_product", { kind: "stores", stores, evidence, subject });

    const distances = stores
      .filter((store) => store.lat !== null)
      .map((store) => haversineMeters(origin, { lat: store.lat as number, lon: store.lon as number }));

    return JSON.stringify({
      evidence,
      subject,
      origin: { label: origin.label ?? null, neighborhood: origin.neighborhood ?? null },
      radius_m: radiusM,
      count: stores.length,
      closest_distance_m: distances.length > 0 ? Math.min(...distances) : null,
      stores: stores.map((store) => ({
        shop_id: store.shop_id,
        name: store.name,
        identity: store.identity,
        neighborhood: store.neighborhood,
        address: clip(store.address, 120),
        distance_m: store.distance_m,
        open_now: store.open_now,
        categories: store.categories.slice(0, 3),
        matched_offers: store.matched_offers ?? null,
        public_links: {
          website: store.website,
          instagram: store.instagram,
        },
      })),
      note:
        evidence === "product_offers"
          ? "همهٔ این فروشگاه‌ها پیشنهاد ثبت‌شده برای همین کالا دارند؛ فاصله خط مستقیم است."
          : "این فروشگاه‌ها پیشنهاد ثبت‌شده در این دسته دارند، نه لزوماً همین کالا؛ برای کالای مشخص، اول کالا را پیدا کن.",
    });
  },
  {
    name: "find_stores_for_product",
    description:
      "List shops that have a recorded offer for a specific product (or, without a product, shops with offers in a category). Returns real coordinates, distance from the user's start point, address, opening state and public links; never a phone number. Use it for «کدام فروشگاه این کالا را دارد؟» or «نزدیک‌ترین فروشگاه ...». A category match alone is not proof that a specific product is in stock.",
    schema: storesSchema,
  },
);

const alternativesSchema = z.object({
  product_id: z.string().trim().min(3).max(64),
  max_price: z.number().int().positive().max(10_000_000_000).optional().describe("Hard ceiling the alternative must respect"),
  category: z.string().trim().max(60).optional(),
});

export const findAlternativesTool = tool(
  async (input) => {
    const origin = originForTools();
    const reference = getProduct(input.product_id, origin);
    if (!reference) {
      throw new Error("این product_id در دیتاست نیست؛ ابتدا کالای مرجع را با search_products پیدا کن.");
    }
    const category = input.category ? canonical(input.category, allCategoryNames(), "دسته") : null;

    let items = reference.alternatives;
    if (category) items = items.filter((item) => item.category === category);
    if (typeof input.max_price === "number") {
      items = items.filter((item) => item.min_price !== null && item.min_price <= (input.max_price as number));
    }
    const dropped = reference.alternatives.length - items.length;
    const limited = items.slice(0, 4);
    record("find_alternatives", {
      kind: "alternatives",
      reference: toCard(reference),
      items: limited,
      dropped,
    });

    return JSON.stringify({
      reference: {
        product_id: reference.product_id,
        title: clip(reference.title, 100),
        min_price: reference.min_price,
        category: reference.category,
        brand: reference.brand,
      },
      count: limited.length,
      dropped_by_constraints: dropped,
      items: limited.map((item) => ({
        product_id: item.product_id,
        title: clip(item.title, 110),
        brand: item.brand,
        category: item.category,
        min_price: item.min_price,
        offer_count: item.offer_count,
        freshness: item.freshness,
        price_delta:
          typeof item.min_price === "number" && typeof reference.min_price === "number"
            ? item.min_price - reference.min_price
            : null,
      })),
      note:
        limited.length === 0
          ? "با این محدودیت‌ها جایگزینی در همان دسته و بازهٔ قیمت نبود؛ بودجه یا دسته را بازتر کن."
          : "جایگزین‌ها فقط از کالاهای هم‌دسته و نزدیک به بازهٔ قیمت مرجع آمده‌اند.",
    });
  },
  {
    name: "find_alternatives",
    description:
      "Find real cheaper or comparable alternatives in the same category as a reference product, optionally under a hard budget. Use it for «ارزان‌تر پیدا کن» or «جایگزین پیشنهاد بده». Needs a valid reference product_id and returns real product ids with price deltas; if constraints leave nothing, say so instead of inventing options.",
    schema: alternativesSchema,
  },
);

const planSchema = z.object({
  offer_ids: z
    .array(z.string().trim().min(3).max(64))
    .min(1)
    .max(8)
    .describe("offer_id values that appeared in earlier tool results"),
});

export const buildShoppingPlanTool = tool(
  async (input) => {
    const origin = originForTools();
    const ids = [...new Set(input.offer_ids)];
    const invalid = ids.filter((id) => getOffer(id, origin) === null);
    if (invalid.length > 0) {
      throw new Error(
        `${invalid.length} شناسهٔ پیشنهاد در دیتاست نیست. فقط offer_idهایی را بفرست که در خروجی ابزارها آمده‌اند.`,
      );
    }
    const plan = buildPlan(ids, origin);
    if (!plan) throw new Error("برنامه‌ای ساخته نشد؛ دست‌کم یک offer_id معتبر لازم است.");
    record("build_shopping_plan", { kind: "plan", plan } satisfies PlanArtifact);

    return JSON.stringify({
      stops: plan.stops.map((stop) => ({
        order: stop.order,
        shop: { shop_id: stop.shop.shop_id, name: stop.shop.name, address: clip(stop.shop.address, 100) },
        items: stop.items.map((item) => ({
          offer_id: item.offer_id,
          title: clip(item.title, 70),
          price: item.price,
          freshness: item.freshness,
        })),
        subtotal: stop.subtotal,
        distance_from_previous_m: stop.distance_from_prev_m,
        walk_minutes: stop.leg_minutes,
      })),
      item_count: plan.item_count,
      total: plan.total,
      straight_line_distance_m: plan.total_distance_m,
      estimated_walk_minutes: plan.walk_minutes,
      warnings: plan.warnings.slice(0, 3),
      note: "فاصله و زمان پیاده‌روی تخمینی و بر پایهٔ خط مستقیم است، نه مسیر خیابان.",
    });
  },
  {
    name: "build_shopping_plan",
    description:
      "Group a small list of recorded offers by shop, order the shops as a walkable route from the user's start point and total the basket. Use it for «برنامهٔ خرید بچین» or «برای این‌ها مسیر بده». Only offer_ids that exist in the dataset are accepted; pass prices never, the server reads them. Distances are straight-line estimates, not road routing.",
    schema: planSchema,
  },
);

const shopSchema = z.object({
  shop_id: z.string().trim().min(3).max(64).describe("A shop_id returned by another tool"),
});

export const getShopDetailsTool = tool(
  async (input) => {
    const origin = originForTools();
    const shop = getShop(input.shop_id, origin);
    if (!shop) {
      throw new Error("این shop_id در دیتاست نیست؛ از خروجی search یا find_stores_for_product استفاده کن.");
    }
    record("get_shop_details", { kind: "shop", shop });

    return JSON.stringify({
      shop_id: shop.shop_id,
      name: shop.name,
      identity: shop.identity,
      neighborhood: shop.neighborhood,
      address: clip(shop.address, 140),
      categories: shop.categories.slice(0, 4),
      payments: shop.payments.slice(0, 4),
      fast_delivery: shop.fast_delivery,
      open_now: shop.open_now,
      hours_today: shop.hours_today,
      distance_m: shop.distance_m,
      public_links: { website: shop.website, instagram: shop.instagram },
      recorded_offers: shop.offer_count,
      top_products: shop.top_products.slice(0, 5).map((item) => ({
        product_id: item.product_id,
        title: clip(item.title, 80),
        price_at_shop: item.price_at_shop,
      })),
      note:
        shop.identity === "registered"
          ? "نام و نشانی از دیتاست ثبت شده است؛ تأیید مستقل نیست."
          : "این فروشگاه ناشناس‌شده است؛ نام تجاری واقعی آن تأیید نشده.",
    });
  },
  {
    name: "get_shop_details",
    description:
      "Return one shop's recorded address, business categories, today's hours, public website/Instagram links and its top recorded offers. Use it when the user asks about a specific shop. Never present a phone number or a contact action: the challenge dataset has no verified contacts.",
    schema: shopSchema,
  },
);

export const shoppingTools = [
  searchProductsTool,
  getProductDetailsTool,
  compareProductsTool,
  findStoresForProductTool,
  findAlternativesTool,
  buildShoppingPlanTool,
  getShopDetailsTool,
] as const;

/* ------------------------------------------------------------ system prompt */

function contextLines(context: AssistantContext, origin: Origin): string {
  const lines: string[] = [];
  lines.push(
    `نقطهٔ شروع فاصله‌ها: ${origin.label ?? "نامشخص"}${origin.neighborhood ? ` (محلهٔ ${origin.neighborhood})` : ""}. مختصات را فقط برای تخمین فاصله استفاده کن و هرگز موقعیت دقیق کاربر را حدس نزن.`,
  );
  if (context.product_id) {
    lines.push(
      `کالای باز در گفت‌وگو: «${context.product_title ?? context.product_id}» با شناسهٔ ${context.product_id}. ضمیرهایی مثل «همین» یا «این کالا» به همین اشاره دارند.`,
    );
  }
  if (context.category) lines.push(`دستهٔ فعلی گفت‌وگو: ${context.category}.`);
  if (context.query) lines.push(`جست‌وجوی قبلی کاربر: «${context.query}».`);
  if (context.offer_ids && context.offer_ids.length > 0) {
    lines.push(
      `سبد فعلی ${context.offer_ids.length} پیشنهاد دارد؛ اگر برنامهٔ خرید خواست، می‌توانی همین شناسه‌ها را به build_shopping_plan بدهی و لازم نیست دوباره جست‌وجو کنی.`,
    );
  }
  return lines.join("\n");
}

export function buildSystemPrompt(context: AssistantContext, origin: Origin): string {
  return [
    "تو «ترب‌یار»، دستیار هوشمند خرید حضوری برای تهران هستی و فقط از دیتاست تراب کار می‌کنی.",
    "",
    "قواعد قطعی:",
    "- دیتاست مرجع همهٔ واقعیت‌های کالا، قیمت، فروشگاه و نشانی است. هیچ کالا، قیمت، مشخصه، نام فروشگاه، نشانی یا فاصله‌ای از خودت نساز.",
    "- برای هر پرسش دربارهٔ کالای مشخص، قیمت، مقایسه یا فروشگاه، اول ابزار مناسب را صدا بزن. اگر ابزار جواب داد، همان را مبنا بگیر؛ اگر ابزار خطا داد، ورودی را اصلاح کن یا صادقانه بگو پیدا نشد.",
    "- قیمت ثبت‌شده به معنی قیمت روز یا موجودی نیست. اگر تاریخ قیمت نامشخص است، همان را بگو.",
    "- نام فروشگاه ناشناس‌شده را هرگز به‌عنوان کسب‌وکار واقعی معرفی نکن.",
    "- شماره تلفن، واتساپ یا راه تماس از دیتاست نساز و پیشنهاد نده.",
    "- تطبیق دستهٔ کسب‌وکار با وجود یک کالای مشخص را یکی نکن؛ فقط وقتی بگو فروشگاه این کالا را دارد که ابزار پیشنهاد همان کالا را برگرداند.",
    "- بودجهٔ سخت کاربر را بی‌اجازه نقض نکن. اگر چیزی در بودجه نبود، محدودیت را بگو و یک تغییر فیلتر مشخص پیشنهاد بده.",
    "- فاصله و زمان پیاده‌روی تخمینی و خط مستقیم است؛ همین را شفاف بگو.",
    "- حداکثر چند ابزار صدا بزن و از تکرار بی‌فایده پرهیز کن؛ پاسخ کوتاه بده.",
    "",
    "لحن و خروجی:",
    "- فارسی طبیعی و محاوره‌ای مؤدبانه، ۲ تا ۴ جمله کوتاه. فهرست بلند، مارک‌داون سنگین یا شناسهٔ فنی (product_id/offer_id) در متن نیاور؛ کارت‌ها و جدول‌ها را رابط کاربری نشان می‌دهد.",
    "- فقط به داده‌ای که ابزار برگردانده ارجاع بده و دلیل پیشنهاد را کوتاه توضیح بده. استدلال درونی‌ات را افشا نکن.",
    "",
    "زمینهٔ این گفت‌وگو:",
    contextLines(context, origin),
  ].join("\n");
}

/* --------------------------------------------------------------- the agent */

function historyMessages(history: AssistantHistoryTurn[]): BaseMessage[] {
  return normalizeHistory(history).map((turn) =>
    turn.role === "user" ? new HumanMessage(turn.text) : new AIMessage(turn.text),
  );
}

function contentText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join(" ")
    .trim();
}

function lastAssistantText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !AIMessage.isInstance(message)) continue;
    const text = contentText(message.content).trim();
    if (text) return text;
  }
  return "";
}

export interface AgentInput {
  message: string;
  context?: AssistantContext;
  origin: Origin;
  history?: AssistantHistoryTurn[];
}

export interface AgentDeps {
  /** Injected in tests; production builds `ChatOpenAI` from env. */
  model?: AgentModel;
  config?: AgentConfig;
}

export interface AgentRun {
  reply: string;
  blocks: Block[];
  toolCalls: string[];
  context: AssistantContext;
  suggestions: string[];
  intent: AssistantIntent;
  artifacts: ToolArtifact[];
  model: string;
}

/**
 * One real agent turn: the model picks tools, the tools hit the repository,
 * their results go back to the model, and only then do we build the UI.
 */
export async function runShoppingAgent(input: AgentInput, deps: AgentDeps = {}): Promise<AgentRun> {
  const config = deps.config ?? getAgentConfig();
  const context = input.context ?? {};
  const model = deps.model ?? createChatModel(config);
  if (config.enabled && !config.apiKey && !deps.model) {
    throw new Error("AI agent is enabled but no OPENAI_API_KEY is configured");
  }

  const agent = createAgent({
    model,
    tools: [...shoppingTools],
    systemPrompt: buildSystemPrompt(context, input.origin),
    middleware: [toolCallLimitMiddleware({ runLimit: config.maxSteps, exitBehavior: "end" })],
  });

  const collector: Collector = { artifacts: [], executed: [], origin: input.origin };
  const result = await collectorStorage.run(collector, async () => {
    const messages: BaseMessage[] = [
      ...historyMessages(input.history ?? []),
      new HumanMessage(input.message.slice(0, 600)),
    ];
    return agent.invoke(
      { messages },
      { recursionLimit: config.maxSteps * 2 + 2 },
    );
  });

  const messages = (result as { messages?: BaseMessage[] }).messages ?? [];
  const modelText = lastAssistantText(messages);
  const artifacts = collector.artifacts;

  return {
    reply: modelText || summarize(artifacts, input.origin),
    blocks: buildUiBlocks(artifacts, input.origin),
    toolCalls: [...new Set(collector.executed)],
    context: nextContext(context, artifacts),
    suggestions: suggestionsFor(artifacts),
    intent: intentFor(artifacts),
    artifacts,
    model: config.model,
  };
}

export { buildUiBlocks };
