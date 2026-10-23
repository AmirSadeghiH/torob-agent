import type {
  AssistantContext,
  AssistantIntent,
  AssistantRequest,
  AssistantResponse,
  Block,
  ComparisonRow,
  InsightItem,
  MapPoint,
  NextStep,
  OfferView,
  ProductCard,
  ProductDetail,
  SearchParams,
  StoreCard,
  StoreRef,
} from "../shared/types";
import {
  allBrandNames,
  allCategoryNames,
  compareColumns,
  getMeta,
  getProduct,
  getProductsByIds,
  getStoresSelling,
  searchProducts,
  searchShops,
} from "./repo";
import { parseMessage, type ParsedQuery } from "./nlu";
import { buildPlan, planSummary } from "./plan";
import { ageLabel, fa, faNumber, toman } from "./lib/text";
import { distanceLabel } from "./lib/geo";
import type { Origin } from "../shared/types";
import { shopCapabilities } from "./capabilities";
import { contextualSuggestions, withRequestAction, type ActionDraft, type SuggestionConditions } from "./suggestions";
import { buildInquiryMessage, inquiryContacts } from "./inquiry";

const MAX_OFFERS = 6;

interface Draft {
  reply: string;
  blocks: Block[];
  suggestions: NextStep[];
  context: AssistantContext;
  intent: AssistantResponse["meta"]["intent"];
  toolCalls: string[];
  parsed: AssistantResponse["meta"]["parsed"];
}

function priceOrUnknown(value: number | null): string {
  return value === null ? "قیمت نامشخص" : toman(value);
}

function freshnessPhrase(p: ProductCard): string {
  if (!p.best) return "قیمت ثبت‌نشده";
  return ageLabel(p.best.age_days);
}

function searchTitle(parsed: ParsedQuery): string {
  if (parsed.category) {
    return parsed.max_price
      ? `${parsed.category} زیر ${toman(parsed.max_price)}`
      : parsed.category;
  }
  if (parsed.brand) return `کالاهای ${parsed.brand}`;
  if (parsed.q) return `نتایج «${parsed.q}»`;
  return "پیشنهادهای قابل مقایسه";
}

function paramsFrom(parsed: ParsedQuery, extra: Partial<SearchParams> = {}): SearchParams {
  return {
    q: parsed.q ?? undefined,
    category: parsed.category ?? undefined,
    brand: parsed.brand ?? undefined,
    neighborhood: parsed.neighborhood ?? undefined,
    max_price: parsed.max_price ?? undefined,
    min_price: parsed.min_price ?? undefined,
    sort: parsed.sort ?? undefined,
    page_size: parsed.limit,
    ...extra,
  };
}

function mapBlock(
  title: string,
  stores: StoreCard[],
  origin: Origin,
  routeOrder: string[] = [],
): Block {
  const points: MapPoint[] = stores
    .filter((s) => s.lat !== null && s.lon !== null)
    .map((s) => ({
      id: s.shop_id,
      label: s.name,
      lat: s.lat!,
      lon: s.lon!,
      kind: "shop",
      distance_m: s.distance_m,
      meta: s.neighborhood ?? undefined,
      order: routeOrder.indexOf(s.shop_id) >= 0 ? routeOrder.indexOf(s.shop_id) + 1 : undefined,
    }));
  return {
    type: "map",
    title,
    subtitle: "فاصله‌ها از نقطهٔ شروع شماست.",
    points,
    origin,
    route_order: routeOrder,
  };
}

/** Live conditions carried by the interactive panel, merged with the message. */
function conditionsFrom(context: AssistantContext, parsed: ParsedQuery): SuggestionConditions {
  return {
    budgetMax: parsed.max_price ?? context.budget?.max ?? null,
    budgetMin: parsed.min_price ?? context.budget?.min ?? null,
    neighborhood: parsed.neighborhood ?? context.neighborhood ?? null,
    radius_m: context.radius_m ?? null,
    category: parsed.category ?? context.category ?? null,
    sort: parsed.sort ?? context.sort ?? null,
  };
}

/**
 * Next steps from the products actually on screen and the conditions the user
 * is shopping under. Deterministic and model-independent, so it also serves
 * the rules fallback.
 */
function nextSteps(
  intent: AssistantIntent,
  context: AssistantContext,
  parsed: ParsedQuery,
  products: ProductCard[],
  contact: boolean,
  kind: "products" | "compare" | "stores" | "plan" | "alternatives" | "product" | "inquiry" | null = null,
): NextStep[] {
  return contextualSuggestions({
    intent,
    context,
    conditions: conditionsFrom(context, parsed),
    products: products.map((product) => ({
      product_id: product.product_id,
      title: product.title,
      min_price: product.min_price,
      offer_count: product.offer_count,
      freshness: product.freshness,
    })),
    contact,
    kind: kind ?? undefined,
    inquiry: context.inquiry_status
      ? {
          status: context.inquiry_status,
          hasContact: contact,
          product_id: context.product_id ?? "",
        }
      : null,
  });
}

function hasContact(cards: ProductCard[]): boolean {
  return cards.some((card) => Boolean(card.best?.website || card.best?.instagram));
}

/** A suggestion that runs by asking the assistant a plain question. */
function messageStep(text: string): NextStep {
  return { label: text, action: { type: "message", text, request: text } };
}

/** The card shape the NextStep engine consumes for product actions. */
function toCard(product: ProductDetail): ProductCard {
  return product;
}

/** Wraps an action draft into a client-facing suggestion. */
function step(label: string, action: ActionDraft): NextStep {
  return { label, action: withRequestAction(action) };
}

function insightFor(product: ProductDetail): Block {
  const items: InsightItem[] = [
    {
      label: "کمترین قیمت",
      value: priceOrUnknown(product.market.min),
      hint: product.best ? `${product.best.shop_name}، ${product.best.neighborhood ?? ""}` : undefined,
      tone: "good",
    },
    {
      label: "میانهٔ بازار",
      value: priceOrUnknown(product.market.median),
      hint: `از ${fa(product.market.priced_offers)} پیشنهاد`,
      tone: "neutral",
    },
    {
      label: "اختلاف قیمت",
      value:
        product.market.spread_percent === null
          ? "—"
          : `${fa(product.market.spread_percent)}٪`,
      hint: "بین ارزان‌ترین و گران‌ترین فروشنده",
      tone: (product.market.spread_percent ?? 0) > 60 ? "warn" : "neutral",
    },
    {
      label: "قیمت تازه",
      value: `${fa(product.market.fresh_offers)} از ${fa(product.market.priced_offers)}`,
      hint: "ثبت‌شده در ۳۰ روز گذشته",
      tone: product.market.fresh_offers === 0 ? "bad" : "good",
    },
  ];
  return { type: "insight", title: "نبض بازار این کالا", items };
}

function offersBlock(product: ProductDetail, limit = MAX_OFFERS): Block {
  return {
    type: "offers",
    title: `پیشنهادهای ${product.title}`,
    subtitle: `${fa(product.offers.length)} فروشگاه؛ مرتب‌شده از ارزان‌ترین`,
    product_id: product.product_id,
    product_title: product.title,
    offers: product.offers.slice(0, limit),
    best_offer_id: product.offers[0]?.offer_id ?? "",
  };
}

function offersByPrice(offers: OfferView[]): OfferView[] {
  return [...offers].sort((a, b) => a.price - b.price);
}

export function comparisonRows(products: ProductDetail[], origin: Origin): ComparisonRow[] {
  const columns = compareColumns(
    products.map((p) => p.product_id),
    origin,
  );
  const bestPriceIndex = columns.reduce(
    (best, c, i) =>
      c.price !== null && (best === null || c.price < (columns[best]?.price ?? Infinity)) ? i : best,
    null as number | null,
  );
  const bestAgeIndex = columns.reduce(
    (best, c, i) =>
      c.age_days !== null && (best === null || c.age_days < (columns[best]?.age_days ?? Infinity))
        ? i
        : best,
    null as number | null,
  );

  const rows: ComparisonRow[] = [
    {
      label: "کمترین قیمت",
      values: columns.map((c) => (c.price === null ? null : toman(c.price))),
      highlight: "lowest",
      best_index: bestPriceIndex,
    },
    {
      label: "تعداد پیشنهاد",
      values: columns.map((c) => `${fa(c.offer_count)} فروشگاه`),
      highlight: null,
    },
    {
      label: "تازگی قیمت",
      values: columns.map((c) => (c.age_days === null ? "نامشخص" : ageLabel(c.age_days))),
      highlight: "freshest",
      best_index: bestAgeIndex,
    },
    {
      label: "ارزان‌ترین فروشگاه",
      values: columns.map((c) => c.best_shop),
      highlight: null,
    },
    {
      label: "محله",
      values: columns.map((c) => c.neighborhood),
      highlight: null,
    },
  ];

  const specRows: ComparisonRow[] = [];
  const firstSpecs = products[0]?.specs ?? [];
  for (const spec of firstSpecs) {
    if (specRows.length >= 4) break;
    if (!spec.key || spec.key.length > 28 || spec.value.length > 70) continue;
    const values = products.map((p) => {
      const found = p.specs.find((s) => s.key === spec.key);
      return found ? found.value.slice(0, 70) : null;
    });
    if (values.filter(Boolean).length < 2) continue;
    specRows.push({ label: spec.key, values, highlight: null });
  }

  return rows.concat(specRows);
}

// ---------------------------------------------------------------- handlers

function exploreHref(parsed: ParsedQuery, patch: Record<string, string | number | null>): string {
  const merged: Record<string, string | number | null> = {
    q: parsed.q,
    category: parsed.category,
    brand: parsed.brand,
    neighborhood: parsed.neighborhood,
    max_price: parsed.max_price,
    sort: parsed.sort ?? null,
    ...patch,
  };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return `/explore?${search.toString()}`;
}

/** Round a raised budget up to a readable step so the next search is meaningful. */
function roundedBudget(value: number): number {
  return Math.max(500_000, Math.ceil((value * 1.5) / 100_000) * 100_000);
}

/**
 * The smallest budget that would actually match something: the cheapest
 * matching product above the stated budget, rounded up to a readable step.
 * Data-driven, so the suggested raise is a real parameter that returns
 * results instead of another empty page.
 */
function raisedBudget(params: SearchParams, budget: number, origin: Origin): number {
  try {
    const probe = searchProducts(
      {
        ...params,
        max_price: undefined,
        min_price: budget + 1,
        sort: "price_asc",
        page_size: 1,
      },
      origin,
    );
    const price = probe.items[0]?.min_price;
    if (typeof price === "number" && price > budget) {
      return Math.ceil(price / 100_000) * 100_000;
    }
  } catch {
    // Fall back to the generic raise below.
  }
  return roundedBudget(budget);
}

function handleSearch(parsed: ParsedQuery, origin: Origin, context: AssistantContext): Draft {
  const toolCalls: string[] = [];
  const params = paramsFrom(parsed);
  const result = searchProducts(params, origin);
  toolCalls.push("search_products");

  const items = result.items;
  const contextOut: AssistantContext = {
    ...context,
    category: parsed.category ?? context.category,
    query: parsed.q ?? undefined,
    product_id: items[0]?.product_id ?? context.product_id,
    product_title: items[0]?.title ?? context.product_title,
  };

  if (items.length === 0) {
    // Never widen the query behind the user's back: the budget they stated is
    // the budget we report, and widening is an explicit next step they choose.
    const budget = parsed.max_price;
    const suggested = budget ? raisedBudget(params, budget, origin) : null;
    const actions = budget
      ? [
          {
            label: `افزایش بودجه تا ${toman(suggested ?? budget)}`,
            to: exploreHref(parsed, { max_price: suggested ?? budget }),
          },
          { label: "حذف فیلتر بودجه", to: exploreHref(parsed, { max_price: null }) },
          { label: "حذف همهٔ فیلترها", to: "/explore" },
        ]
      : [
          { label: "دیدن نتیجه در کاوش", to: exploreHref(parsed, {}) },
          { label: "حذف همهٔ فیلترها", to: "/explore" },
        ];
    return {
      reply: budget
        ? `در بودجهٔ اعلام‌شده (تا ${toman(budget)}) چیزی پیدا نکردم و جست‌وجو را بی‌اجازهٔ شما بازتر نکردم. بودجه را بالا ببرید یا فیلتر را بردارید.`
        : parsed.q
          ? `برای «${parsed.q}» با این فیلترها چیزی پیدا نکردم. اگر برند یا مشخصات را ساده‌تر بنویسید، دوباره می‌گردم.`
          : "در این فیلترها کالایی پیدا نشد. دسته یا محله را عوض کنید.",
      blocks: [
        {
          type: "note",
          title: "نتیجه‌ای با همین فیلترها نبود",
          body: budget
            ? "هیچ پیشنهادی داخل این سقف قیمت نبود. یکی از اقدام‌های زیر جست‌وجوی تازه‌ای با پارامترهای مشخص اجرا می‌کند."
            : "با پارامترهای فعلی نتیجه‌ای نداشتیم. می‌توانید در کاوش فیلترها را دقیق‌تر تنظیم کنید.",
          tone: "warn",
          actions,
        },
        {
          type: "filters",
          title: "فیلترهای اعمال‌شده",
          active: {
            q: parsed.q,
            category: parsed.category,
            brand: parsed.brand,
            neighborhood: parsed.neighborhood,
            max_price: parsed.max_price,
            min_price: parsed.min_price,
            radius_m: null,
            max_age_days: null,
            min_offers: null,
            sort: parsed.sort,
          },
          origin: origin,
          radius_m: null,
          options: {
            categories: getMeta().categories.slice(0, 10).map((c) => c.name),
            neighborhoods: getMeta().neighborhoods.slice(0, 12).map((n) => n.name),
            brands: getMeta().brands.slice(0, 10),
          },
        },
        {
          type: "preference_picker",
          title: "کدام دسته را بررسی کنیم؟",
          question: "از میان دسته‌های موجود در دیتاست، یکی را برای جست‌وجوی تازه انتخاب کنید.",
          options: getMeta().categories.slice(0, 6).map((category) => ({
            key: category.name,
            label: category.name,
            description: `${fa(category.product_count)} کالا، ${fa(category.shop_count)} فروشگاه`,
          })),
        },
      ],
      suggestions: nextSteps(parsed.intent, context, parsed, [], false, "products"),
      context: contextOut,
      intent: parsed.intent,
      toolCalls,
      parsed: parsed.debug,
    };
  }

  const cheapest = items
    .map((p) => p.min_price)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b)[0];
  const ages = items
    .map((p) => p.best?.age_days)
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const freshest = ages[0];

  const blocks: Block[] = [
    {
      type: "products",
      title: searchTitle(parsed),
      subtitle: `${fa(result.total)} کالا در دیتاست؛ ${fa(items.length)} پیشنهاد برای شما`,
      products: items,
      layout: parsed.limit <= 3 ? "list" : "grid",
    },
  ];

  if (parsed.category || parsed.brand || parsed.max_price) {
    blocks.push({
      type: "filters",
      title: "فیلترها",
      active: {
        q: parsed.q,
        category: parsed.category,
        brand: parsed.brand,
        neighborhood: parsed.neighborhood,
        max_price: parsed.max_price,
        min_price: parsed.min_price,
        radius_m: null,
        max_age_days: null,
        min_offers: null,
        sort: parsed.sort,
      },
      origin: origin,
      radius_m: null,
      options: {
        categories: getMeta().categories.slice(0, 10).map((c) => c.name),
        neighborhoods: getMeta().neighborhoods.slice(0, 12).map((n) => n.name),
        brands: getMeta().brands.slice(0, 10),
      },
    });
  }

  if (items[0] && (parsed.limit <= 2 || parsed.intent === "offers")) {
    const detail = getProduct(items[0].product_id, origin);
    toolCalls.push("get_product");
    if (detail) {
      blocks.push(offersBlock(detail));
      blocks.push(insightFor(detail));
      contextOut.product_id = detail.product_id;
      contextOut.product_title = detail.title;
    }
  }

  const parts = [
    `${fa(items.length)} گزینه پیدا شد.`,
    cheapest !== undefined ? `ارزان‌ترین از ${toman(cheapest)} شروع می‌شود.` : "",
    freshest !== undefined ? `تازه‌ترین قیمت ${ageLabel(freshest)} ثبت شده است.` : "",
  ].filter(Boolean);

  return {
    reply: parts.join(" "),
    blocks,
    suggestions: nextSteps(parsed.intent, context, parsed, items, hasContact(items), "products"),
    context: contextOut,
    intent: parsed.intent === "offers" ? "offers" : "search",
    toolCalls,
    parsed: parsed.debug,
  };
}

function handleOffers(
  parsed: ParsedQuery,
  origin: Origin,
  context: AssistantContext,
): Draft {
  const toolCalls: string[] = ["get_product"];
  // «قیمت این» refers to the open product; a named product starts a new subject.
  const namesNewSubject = Boolean(parsed.q || parsed.brand || parsed.category);
  let product = !namesNewSubject && context.product_id
    ? getProduct(context.product_id, origin)
    : null;
  if (!product) {
    const search = searchProducts(paramsFrom(parsed, { page_size: 3 }), origin);
    toolCalls.push("search_products");
    const first = search.items.find((p) => p.offer_count > 0);
    product = first ? getProduct(first.product_id, origin) : null;
  }
  if (!product) {
    return {
      reply: "کالای مشخصی برای بررسی قیمت پیدا نکردم. نام کالا را کامل‌تر بنویسید.",
      blocks: [
        { type: "note", title: "کالا مشخص نیست", body: "مثلاً بنویسید «قیمت هدفون سونی WH-1000XM4».", tone: "info" },
      ],
      suggestions: [messageStep("هدفون زیر ۵ میلیون")],
      context,
      intent: parsed.intent,
      toolCalls,
      parsed: parsed.debug,
    };
  }

  const best = product.offers[0];
  const blocks: Block[] = [offersBlock(product), insightFor(product)];
  if (best) {
    blocks.push({
      type: "reliability",
      title: "این قیمت چقدر قابل اتکاست؟",
      offer: best,
      product_id: product.product_id,
      product_title: product.title,
    });
  }
  if (best) {
    blocks.push({
      type: "decision_summary",
      title: "جمع‌بندی تصمیم",
      product_title: product.title,
      budget: parsed.max_price ?? null,
      best_offer_id: best.offer_id,
      reasons: [
        {
          label: "کمترین قیمت",
          value: priceOrUnknown(product.market.min),
          tone: "good",
          hint: best.shop.name,
        },
        { label: "میانهٔ بازار", value: priceOrUnknown(product.market.median), tone: "neutral" },
        {
          label: "تازگی",
          value: `${fa(product.market.fresh_offers)} از ${fa(product.market.priced_offers)}`,
          tone: product.market.fresh_offers === 0 ? "bad" : "good",
          hint: "پیشنهادهای ثبت‌شده در ۳۰ روز گذشته",
        },
        {
          label: "فاصله",
          value: best.shop.distance_m === null ? "نامشخص" : distanceLabel(best.shop.distance_m),
          tone: "neutral",
          hint: "خط مستقیم تخمینی، نه مسیر خیابان",
        },
      ],
      next_step:
        best.shop.website || best.shop.instagram
          ? "برای در دست داشتن این پیشنهاد، از فروشگاهِ راه تماسِ ثبت‌شده استفاده کنید."
          : "برای تماس، فروشندهٔ دیگری از میان پیشنهادهای همین کالا که وب‌سایت یا اینستاگرام ثبت‌شده دارد انتخاب کنید.",
      warnings: [
        "قیمتها از دیتاست ثبت‌شده هستند و لزوماً قیمت روز نیستند.",
        "این مجموعه میزان موجودی یا گارانتی را نمی‌گوید.",
      ],
    });
  }

  const stores = product.offers
    .slice(0, 4)
    .map((offer) => storeFromOffer(offer));
  if (stores.length > 0) {
    blocks.push(mapBlock("فروشگاه‌های این کالا", stores, origin));
  }
  const spread = product.market.spread_percent;
  const reply = best
    ? `کمترین قیمت ${toman(best.price)} در «${best.shop.name}» است؛ ${best.freshness_label} (${ageLabel(best.age_days)}).${
        spread !== null && spread > 40
          ? ` اختلاف ارزان‌ترین و گران‌ترین فروشنده ${fa(spread)}٪ است، پس مقایسه به‌صرفه است.`
          : ""
      }`
    : "برای این کالا قیمتی ثبت نشده است.";

  return {
    reply,
    blocks,
    suggestions: nextSteps(
      "offers",
      context,
      parsed,
      [toCard(product)],
      product.offers.some((offer) => Boolean(offer.shop.website || offer.shop.instagram)),
      "product",
    ),
    context: {
      ...context,
      product_id: product.product_id,
      product_title: product.title,
      category: product.category,
      query: parsed.q ?? undefined,
    },
    intent: "offers",
    toolCalls,
    parsed: parsed.debug,
  };
}

function storeFromOffer(offer: OfferView): StoreCard {
  const identity = offer.shop.identity;
  return {
    shop_id: offer.shop.shop_id,
    name: offer.shop.name,
    identity,
    neighborhood: offer.shop.neighborhood,
    address: offer.shop.address,
    lat: offer.shop.lat,
    lon: offer.shop.lon,
    distance_m: offer.shop.distance_m,
    website: offer.shop.website,
    instagram: offer.shop.instagram,
    categories: [],
    fast_delivery: false,
    offer_count: 0,
    hours_today: null,
    open_now: null,
    capabilities: shopCapabilities({
      payments: [],
      fast_delivery: false,
      has_hours: false,
      identity,
    }),
  };
}

function handleCompare(parsed: ParsedQuery, origin: Origin, context: AssistantContext): Draft {
  const toolCalls: string[] = [];
  let products: ProductDetail[] = [];
  if (context.product_id) {
    const current = getProduct(context.product_id, origin);
    toolCalls.push("get_product");
    if (current) {
      products.push(current);
      const alternative = current.alternatives[0];
      if (alternative) {
        const alt = getProduct(alternative.product_id, origin);
        if (alt) products.push(alt);
      }
    }
  }
  if (products.length < 2) {
    const search = searchProducts(paramsFrom(parsed, { page_size: 3, sort: parsed.sort ?? "offers" }), origin);
    toolCalls.push("search_products");
    const candidateIds = search.items
      .filter((p) => p.offer_count > 0)
      .slice(0, 3)
      .map((p) => p.product_id);
    products = candidateIds
      .map((id) => getProduct(id, origin))
      .filter((p): p is ProductDetail => p !== null);
  }
  if (products.length < 2) {
    return {
      reply: "برای مقایسه دست‌کم دو کالا لازم است. نام دو مدل را بنویسید یا از صفحهٔ کالا مقایسه را شروع کنید.",
      blocks: [
        {
          type: "note",
          title: "مقایسه ناتمام",
          body: "مثلاً «هدفون سونی و هدفون پاناسونیک را مقایسه کن».",
          tone: "info",
        },
      ],
      suggestions: [messageStep("هدفون سونی زیر ۵ میلیون")],
      context,
      intent: "compare",
      toolCalls,
      parsed: parsed.debug,
    };
  }

  const columns = compareColumns(products.map((p) => p.product_id), origin);
  const cheapestIndex = columns.reduce(
    (best, c, i) =>
      c.price !== null && (columns[best]?.price === null || c.price < (columns[best]?.price ?? Infinity))
        ? i
        : best,
    0,
  );
  const rows = comparisonRows(products, origin);

  return {
    reply: `این ${fa(columns.length)} گزینه را از نظر قیمت، تازگی اطلاعات و فروشنده مقایسه کردم. ارزان‌ترین «${columns[cheapestIndex]?.title}» است؛ اما پیش از انتخاب، ستون تازگی قیمت را هم ببینید.`,
    blocks: [
      {
        type: "compare",
        title: "مقایسهٔ رو در رو",
        subtitle: "ستون روشن‌تر، انتخاب پیشنهادی است.",
        columns,
        rows,
        note: "قیمت‌ها کمترین پیشنهاد ثبت‌شده برای هر کالاست؛ هزینهٔ رفت‌وآمد را جدا حساب کنید.",
      },
      {
        type: "products",
        title: "گزینه‌های حاضر در مقایسه",
        products: products.map((p) => ({
          product_id: p.product_id,
          title: p.title,
          brand: p.brand,
          category: p.category,
          image: p.image,
          min_price: p.min_price,
          max_price: p.max_price,
          offer_count: p.offer_count,
          best: p.best,
          newest_at: p.newest_at,
          freshness: p.freshness,
        })),
        layout: "list",
      },
    ],
    suggestions: [
      step("برنامهٔ خرید بچین", { type: "plan" }),
      step("ارزان‌ترین گزینه‌ها را نشان بده", { type: "search", patch: { sort: "price_asc" } }),
      step("فروشگاه‌های نزدیک را ببین", { type: "stores", product_id: products[0]?.product_id }),
    ],
    context: {
      ...context,
      product_id: products[0]?.product_id,
      product_title: products[0]?.title,
      category: products[0]?.category,
    },
    intent: "compare",
    toolCalls,
    parsed: parsed.debug,
  };
}

function handleStores(parsed: ParsedQuery, origin: Origin, context: AssistantContext): Draft {
  const toolCalls: string[] = [];
  let stores: StoreCard[] = [];
  if (parsed.category || parsed.brand) {
    stores = getStoresSelling({
      category: parsed.category ?? undefined,
      brand: parsed.brand ?? undefined,
      origin,
      radiusM: 6000,
      limit: 8,
    });
    toolCalls.push("get_stores_selling");
  }
  if (stores.length === 0) {
    const result = searchShops(
      {
        q: parsed.q ?? undefined,
        category: parsed.category ?? undefined,
        neighborhood: parsed.neighborhood ?? undefined,
        sort: "distance",
        page_size: 8,
        lat: origin.lat,
        lon: origin.lon,
        radius_m: 8000,
      },
      origin,
    );
    toolCalls.push("search_shops");
    stores = result.items;
  }

  if (stores.length === 0) {
    return {
      reply: "فروشگاهی نزدیک این نقطه پیدا نشد. محله را عوض کنید یا شعاع را بیشتر بگیرید.",
      blocks: [
        {
          type: "note",
          title: "فروشگاهی در نزدیکی نیست",
          body: "می‌توانید محلهٔ دیگری را انتخاب کنید یا در فهرست فروشگاه‌ها همهٔ تهران را ببینید.",
          tone: "warn",
        },
      ],
      suggestions: [
        messageStep("فروشگاه‌های فردوسی"),
        { label: "همهٔ فروشگاه‌ها", action: { type: "search", patch: { neighborhood: null }, request: "همهٔ فروشگاه‌ها" } },
      ],
      context,
      intent: "stores",
      toolCalls,
      parsed: parsed.debug,
    };
  }

  const closest = stores[0]!;
  const subject = parsed.category ?? parsed.brand ?? parsed.q ?? "این دسته";
  return {
    reply: `${fa(stores.length)} فروشگاه برای ${subject} در اطراف نقطهٔ شما پیدا شد. نزدیک‌ترین «${closest.name}» در فاصلهٔ خط مستقیم ${distanceLabel(closest.distance_m)} است. فاصله‌ها تخمینی‌اند و مسیر خیابان نیستند.`,
    blocks: [
      {
        type: "stores",
        title: `فروشگاه‌های ${subject}`,
        subtitle: "مرتب‌شده از نزدیک‌ترین به نقطهٔ شروع",
        stores,
        origin,
      },
      mapBlock("روی نقشه", stores, origin),
    ],
    suggestions: [
      step("برنامهٔ خرید بچین", { type: "plan" }),
      step("قیمت‌ها را مقایسه کن", { type: "search", patch: { sort: "price_asc" } }),
      step("فروشگاه‌های نزدیک‌تر", { type: "stores" }),
    ],
    context: {
      origin: context.origin,
      category: parsed.category ?? context.category,
      query: parsed.q ?? undefined,
    },
    intent: "stores",
    toolCalls,
    parsed: parsed.debug,
  };
}

function planStoreCard(stop: { shop: StoreRef }): StoreCard {
  const shop = stop.shop;
  const identity = shop.identity;
  return {
    shop_id: shop.shop_id,
    name: shop.name,
    identity,
    neighborhood: shop.neighborhood,
    address: shop.address,
    lat: shop.lat,
    lon: shop.lon,
    distance_m: shop.distance_m,
    website: shop.website,
    instagram: shop.instagram,
    categories: [],
    fast_delivery: false,
    offer_count: 0,
    hours_today: null,
    open_now: null,
    capabilities: shopCapabilities({
      payments: [],
      fast_delivery: false,
      has_hours: false,
      identity,
    }),
  };
}

function handlePlan(
  parsed: ParsedQuery,
  origin: Origin,
  context: AssistantContext,
): Draft {
  const toolCalls: string[] = [];
  let offerIds = context.offer_ids ?? [];
  let autoBuilt = false;
  if (offerIds.length === 0) {
    const search = searchProducts(paramsFrom(parsed, { page_size: 3 }), origin);
    toolCalls.push("search_products");
    for (const item of search.items.slice(0, 3)) {
      const detail = getProduct(item.product_id, origin);
      if (detail?.offers[0]) offerIds.push(detail.offers[0].offer_id);
    }
    toolCalls.push("get_product");
    autoBuilt = offerIds.length > 0;
  }
  const plan = buildPlan(offerIds, origin);
  if (!plan) {
    return {
      reply: "برای ساختن برنامه، دست‌کم یک کالا به سبد اضافه کنید یا بگویید چه می‌خواهید بخرید.",
      blocks: [
        {
          type: "note",
          title: "سبد خالی است",
          body: "از کارت هر کالا «افزودن به برنامه» را بزنید، بعد دوباره از من برنامه بخواهید.",
          tone: "info",
        },
      ],
      suggestions: [
        messageStep("هدفون زیر ۵ میلیون"),
        step("برنامهٔ خرید بچین", { type: "plan" }),
      ],
      context,
      intent: "plan",
      toolCalls,
      parsed: parsed.debug,
    };
  }

  toolCalls.push("build_plan");
  const note = autoBuilt
    ? "این برنامه را از سه گزینهٔ اول همین جست‌وجو ساختم؛ می‌توانید هر قلم را عوض کنید یا از سبد خودتان برنامه بگیرید."
    : null;

  return {
    reply: `${planSummary(plan)} ${plan.warnings[0] ?? ""}`.trim(),
    blocks: [
      { type: "plan", title: "برنامهٔ خرید حضوری", plan },
      mapBlock(
        "مسیر پیشنهادی",
        plan.stops.map((stop) => planStoreCard(stop)),
        origin,
        plan.stops.map((s) => s.shop.shop_id),
      ),
      ...(note ? [{ type: "note" as const, body: note, tone: "info" as const }] : []),
    ],
    suggestions: [
      step("این برنامه را در سبد نگه دار", { type: "plan" }),
      step("گزینهٔ ارزان‌تر جایگزین کن", { type: "search", patch: { sort: "price_asc" } }),
      step("فروشگاه‌های نزدیک‌تر", { type: "stores" }),
    ],
    context: { ...context, offer_ids: plan.stops.flatMap((s) => s.items.map((i) => i.offer_id)) },
    intent: "plan",
    toolCalls,
    parsed: parsed.debug,
  };
}

function handleAlternatives(
  parsed: ParsedQuery,
  origin: Origin,
  context: AssistantContext,
): Draft {
  const toolCalls: string[] = [];
  let product = context.product_id ? getProduct(context.product_id, origin) : null;
  if (!product) {
    toolCalls.push("search_products");
    const search = searchProducts(paramsFrom(parsed, { page_size: 2 }), origin);
    const first = search.items[0];
    if (first) product = getProduct(first.product_id, origin);
  }
  if (!product) {
    return {
      reply: "کالای مرجعی پیدا نکردم. اول یک کالا را باز کنید یا نامش را بنویسید.",
      blocks: [],
      suggestions: nextSteps(parsed.intent, context, parsed, [], false, "alternatives"),
      context,
      intent: "alternatives",
      toolCalls,
      parsed: parsed.debug,
    };
  }
  toolCalls.push("get_product");
  if (product.alternatives.length === 0) {
    return {
      reply: "برای این کالا جایگزین نزدیکی در همان دسته و بازهٔ قیمت پیدا نشد.",
      blocks: [
        {
          type: "note",
          title: "جایگزینی نیست",
          body: "می‌توانید بازهٔ قیمت را بازتر کنید یا دستهٔ دیگری را ببینید.",
          tone: "warn",
        },
      ],
      suggestions: [
        step("نزدیک‌ترین فروشگاه این کالا کجاست؟", { type: "stores", product_id: product.product_id }),
      ],
      context: { ...context, product_id: product.product_id },
      intent: "alternatives",
      toolCalls,
      parsed: parsed.debug,
    };
  }
  const cheaper = product.alternatives.filter(
    (a) => a.min_price !== null && product?.min_price !== null && a.min_price < (product.min_price ?? 0),
  );
  return {
    reply: `${fa(product.alternatives.length)} جایگزین در همان دسته پیدا کردم${
      cheaper.length > 0
        ? `؛ ${fa(cheaper.length)} مورد از «${product.title.slice(0, 40)}» ارزان‌تر است.`
        : "؛ هیچ‌کدام ارزان‌تر نیست، اما تازگی قیمت‌ها فرق دارد."
    }`,
    blocks: [
      {
        type: "products",
        title: "جایگزین‌های نزدیک",
        subtitle: "همان دسته، بازهٔ قیمت نزدیک به کالای فعلی",
        products: product.alternatives,
        layout: "grid",
      },
    ],
    suggestions: nextSteps(
      "alternatives",
      context,
      parsed,
      [toCard(product), ...product.alternatives],
      product.offers.some((offer) => Boolean(offer.shop.website || offer.shop.instagram)),
      "alternatives",
    ),
    context: { ...context, product_id: product.product_id, product_title: product.title },
    intent: "alternatives",
    toolCalls,
    parsed: parsed.debug,
  };
}

/**
 * Prepares a seller inquiry from a real recorded offer. The block carries the
 * offer and the contact channels the dataset actually records; the server
 * never invents a phone number or a WhatsApp link.
 */
function handleInquiry(
  parsed: ParsedQuery,
  origin: Origin,
  context: AssistantContext,
): Draft {
  const toolCalls: string[] = [];
  const namesNewSubject = Boolean(parsed.q || parsed.brand || parsed.category);
  let product = !namesNewSubject && context.product_id
    ? getProduct(context.product_id, origin)
    : null;
  if (!product) {
    const search = searchProducts(
      paramsFrom(parsed, { page_size: 3, sort: parsed.sort ?? "offers" }),
      origin,
    );
    toolCalls.push("search_products");
    const first = search.items.find((p) => p.offer_count > 0) ?? search.items[0];
    product = first ? getProduct(first.product_id, origin) : null;
  }
  if (!product) {
    return {
      reply: "کالای مشخصی برای آماده‌کردن استعلام پیدا نکردم. نام کالا را کامل‌تر بنویسید.",
      blocks: [
        {
          type: "note",
          title: "کالا مشخص نیست",
          body: "مثلاً بنویسید «استعلام موجودی هدفون سونی».",
          tone: "info",
        },
      ],
      suggestions: nextSteps("inquiry", context, parsed, [], false, "products"),
      context,
      intent: "inquiry",
      toolCalls,
      parsed: parsed.debug,
    };
  }
  toolCalls.push("get_product");
  const offer =
    product.offers.find((entry) => Boolean(entry.shop.website || entry.shop.instagram)) ??
    product.offers[0];
  if (!offer) {
    return {
      reply: `برای «${product.title.slice(0, 40)}» پیشنهاد ثبت‌شده‌ی قیمتی پیدا نشد.`,
      blocks: [
        {
          type: "note",
          title: "پیشنهاد قیمتی نیست",
          body: "برای این کالا قیمت ثبت‌شده‌ی nào در دیتاست نیست؛ از کالای دیگری استفاده کنید.",
          tone: "warn",
        },
      ],
      suggestions: nextSteps("inquiry", context, parsed, [toCard(product)], false, "products"),
      context: { ...context, product_id: product.product_id, product_title: product.title },
      intent: "inquiry",
      toolCalls,
      parsed: parsed.debug,
    };
  }

  const contacts = inquiryContacts({
    website: offer.shop.website,
    instagram: offer.shop.instagram,
  });
  const message = buildInquiryMessage({
    productTitle: product.title,
    shopName: offer.shop.name,
    price: offer.price,
    changedAt: offer.changed_at,
    warranty: offer.warranty,
  });

  const blocks: Block[] = [];
  if (context.inquiry_status) {
    // The status the user reported earlier is shown as their report, never as a
    // Torobyar verification, and it keeps the channel open for a follow-up.
    blocks.push({
      type: "seller_followup",
      title: "وضعیت گزارش‌شده از تماس قبلی",
      subtitle: "این وضعیت از شما پرسیده شده و ترب‌یار آن را تأیید نکرده است.",
      inquiry_id: offer.offer_id,
      product_title: product.title,
      shop_name: offer.shop.name,
      price: offer.price,
      status: context.inquiry_status,
      note: null,
      contacts,
      message,
    });
  }

  blocks.push({
    type: "seller_inquiry",
      title: `استعلام موجودی و قیمت از «${offer.shop.name}»`,
      subtitle:
        contacts.length > 0
          ? "پیام آماده برای کپی است؛ ترب‌یار خودکار پیام نمی‌فرستد."
          : "این فروشنده راه تماس ثبت‌شده‌ی معتبر (وب‌سایت یا اینستاگرام) ندارد.",
      product_id: product.product_id,
      product_title: product.title,
      offer,
      contacts,
      message,
  });
  if (contacts.length === 0) {
    blocks.push({
      type: "note",
      title: "راه تماس ثبت‌نشده",
      body: "شماره‌ی تلفن در این دیتاست معتبر نیست و نمایش داده نمی‌شود. فروشندهٔ دیگری از میان پیشنهادهای همین کالا که وب‌سایت یا اینستاگرام ثبت‌شده دارد انتخاب کنید.",
      tone: "warn",
    });
  }

  const reply =
    contacts.length > 0
      ? `برای «${product.title.slice(0, 40)}» در «${offer.shop.name}» یک پیام استعلام آماده کردم. ترب‌یار خودکار پیام نمی‌فرستد؛ شما خودتان کانال را باز می‌کنید یا پیام را کپی می‌کنید.`
      : `فروشندهٔ ارزان‌ترین پیشنهاد «${offer.shop.name}» راه تماس ثبت‌شده‌ی معتبر ندارد. از فروشندهٔ دیگری با وب‌سایت یا اینستاگرام ثبت‌شده استفاده کنید.`;

  return {
    reply,
    blocks,
    suggestions: nextSteps(
      "inquiry",
      context,
      parsed,
      [toCard(product)],
      contacts.length > 0,
      "inquiry",
    ),
    context: { ...context, product_id: product.product_id, product_title: product.title },
    intent: "inquiry",
    toolCalls,
    parsed: parsed.debug,
  };
}

function handleFreshness(
  parsed: ParsedQuery,
  origin: Origin,
  context: AssistantContext,
): Draft {
  const offersDraft = handleOffers(parsed, origin, context);
  const freshnessNote: Block = {
    type: "note",
    title: "چطور تازگی را می‌خوانم",
    body: "کمتر از ۷ روز تازه، تا ۳۰ روز کم‌خطر و بیشتر از ۹۰ روز کهنه حساب می‌شود. این برچسب‌ها فقط سن ثبت قیمت را نشان می‌دهند، نه موجودی یا صحت قیمت. برای خرید حضوری، قیمت‌های کهنه را قبل از رفتن از منبع دیگری بررسی کنید.",
    tone: "info",
  };
  return {
    ...offersDraft,
    blocks: [...offersDraft.blocks, freshnessNote],
    intent: "freshness",
  };
}

function handleGreeting(origin: Origin): Draft {
  const meta = getMeta();
  return {
    reply:
      "سلام! من ترب‌یارم؛ دستیار هوشمند خرید شما. بگویید چه می‌خواهید بخرید، چه بودجه‌ای دارید یا کدام محله را ترجیح می‌دهید؛ قیمت‌های ثبت‌شدهٔ فروشگاه‌های تهران را مقایسه می‌کنم و برنامهٔ یک خرید مطمئن می‌چینم.",
    blocks: [
      {
        type: "insight",
        title: "آنچه در دسترس دارم",
        items: [
          { label: "کالای indexed", value: `${faNumber(meta.counts.products)} کالا`, tone: "neutral" },
          { label: "پیشنهاد قیمت", value: `${faNumber(meta.counts.offers)} مورد`, tone: "neutral" },
          { label: "فروشگاه", value: `${faNumber(meta.counts.shops)} فروشگاه`, tone: "neutral" },
          {
            label: "قابل مقایسه",
            value: `${faNumber(meta.counts.comparable_products)} کالا`,
            hint: "بیش از یک فروشنده",
            tone: "good",
          },
        ],
      },
      {
        type: "note",
        title: "یک نمونه",
        body: "بنویسید «هدفون بی‌سیم زیر ۵ میلیون» یا «نزدیک‌ترین فروشگاه دوربین مدار بسته در فردوسی».",
        tone: "info",
      },
    ],
    suggestions: [
      messageStep("هدفون بی‌سیم زیر ۵ میلیون"),
      messageStep("گوشی سامسونگ تا ۲۰ میلیون"),
      messageStep("نزدیک‌ترین فروشگاه دوربین مدار بسته"),
      step("برنامهٔ خرید بچین", { type: "plan" }),
    ],
    context: { origin },
    intent: "greeting",
    toolCalls: [],
    parsed: {},
  };
}

function handleHelp(origin: Origin): Draft {
  return {
    reply:
      "چهار کار برایتان می‌کنم: پیدا کردن کالا با بودجه و دسته، مقایسهٔ قیمت فروشگاه‌ها، سنجش تازگی و اتکای هر قیمت، و چیدن یک برنامهٔ حضوری که فقط ایست‌های نزدیک هم را دارد. هر زمان بگویید «نزدیک من» تا فاصله‌ها از محله‌تان حساب شود.",
    blocks: [
      {
        type: "note",
        title: "مثال‌های کاربردی",
        body: "«مبل تخت‌خوابشو زیر ۳۰ میلیون»، «قیمت گوشی سامسونگ تازه است؟»، «مقایسهٔ دو هدفون»، «برنامهٔ خرید با این سه کالا».",
        tone: "info",
      },
    ],
    suggestions: [
      messageStep("هدفون زیر ۵ میلیون"),
      messageStep("قیمت‌ها را از نظر تازگی بررسی کن"),
      messageStep("نزدیک‌ترین فروشگاه به من"),
      step("برنامهٔ خرید بچین", { type: "plan" }),
    ],
    context: { origin },
    intent: "help",
    toolCalls: [],
    parsed: {},
  };
}

// ------------------------------------------------------------------ entry

export async function respond(request: AssistantRequest): Promise<AssistantResponse> {
  const started = performance.now();
  const meta = getMeta();
  const origin: Origin = request.context?.origin ?? meta.default_origin;
  const context: AssistantContext = request.context ?? {};
  const parsed = parseMessage(
    request.message,
    {
      categories: allCategoryNames(),
      brands: allBrandNames(),
      neighborhoods: meta.neighborhoods.map((n) => n.name),
    },
    context,
  );

  let draft: Draft;
  switch (parsed.intent) {
    case "greeting":
      draft = handleGreeting(origin);
      break;
    case "help":
      draft = handleHelp(origin);
      break;
    case "offers":
      draft = handleOffers(parsed, origin, context);
      break;
    case "compare":
      draft = handleCompare(parsed, origin, context);
      break;
    case "stores":
      draft = handleStores(parsed, origin, context);
      break;
    case "plan":
      draft = handlePlan(parsed, origin, context);
      break;
    case "alternatives":
      draft = handleAlternatives(parsed, origin, context);
      break;
    case "freshness":
      draft = handleFreshness(parsed, origin, context);
      break;
    case "inquiry":
      draft = handleInquiry(parsed, origin, context);
      break;
    case "unknown":
      draft = {
        reply:
          "برای اینکه درست کمک کنم، بگویید چه چیزی می‌خواهید بخرید؛ مثلاً «هدفون زیر ۵ میلیون» یا «نزدیک‌ترین فروشگاه مبل». اگر کالایی را باز کرده‌اید، همان را نام ببرید.",
        blocks: [
          {
            type: "note",
            title: "دقیق‌تر بگویید",
            body: "دسته، بودجه یا محله را کنار نام کالا بنویسید تا نتیجهٔ دقیق‌تری بگیرید.",
            tone: "info",
          },
        ],
        suggestions: [
          messageStep("هدفون بی‌سیم زیر ۵ میلیون"),
          messageStep("گوشی سامسونگ تا ۲۰ میلیون"),
          messageStep("نزدیک‌ترین فروشگاه دوربین مدار بسته"),
          step("برنامهٔ خرید بچین", { type: "plan" }),
        ],
        context,
        intent: "unknown",
        toolCalls: [],
        parsed: parsed.debug,
      };
      break;
    default:
      draft = handleSearch(parsed, origin, context);
  }

  return {
    reply: draft.reply,
    blocks: draft.blocks,
    suggestions: draft.suggestions,
    context: { ...draft.context, origin },
    meta: {
      engine: "rules",
      ms: Math.round(performance.now() - started),
      intent: draft.intent,
      tool_calls: draft.toolCalls,
      parsed: draft.parsed,
    },
  };
}

/** Exported for tests. */
export const __internal = { comparisonRows, offersByPrice, searchTitle };
