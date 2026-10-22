import { all, dbSizeMb, get, readMeta, tableCount } from "./db";
import {
  ageDays,
  freshnessOf,
  FRESHNESS_TEXT,
} from "./lib/freshness";
import { haversineMeters } from "./lib/geo";
import { dayHours, openNow, tehranNow, type DayKey } from "./lib/hours";
import { normalizeFa, shorten } from "./lib/text";
import { hasRegistryRecord, shopDisplayName, shopIdentity } from "./lib/identity";
import { scoreOffer, type ReliabilityInput } from "./reliability";
import type {
  CategoryInfo,
  ComparisonColumn,
  DayHours,
  Meta,
  NeighborhoodInfo,
  OfferView,
  Origin,
  PlanItem,
  ProductCard,
  ProductDetail,
  ShopDetail,
  ShopProduct,
  ShopSearchParams,
  ShopSearchResult,
  SearchParams,
  SearchResult,
  Spec,
  StoreCard,
  StoreRef,
} from "../shared/types";

const DEFAULT_PAGE_SIZE = 12;

interface ProductRow {
  product_id: string;
  title: string;
  brand: string | null;
  category: string;
  image: string | null;
  images: string;
  specs: string;
  min_price: number | null;
  max_price: number | null;
  offer_count: number;
  best_price: number | null;
  best_offer_id: string | null;
  best_shop_id: string | null;
  newest_price_at: string | null;
  shop_name: string | null;
  shop_hood: string | null;
  shop_lat: number | null;
  shop_lon: number | null;
  shop_website: string | null;
  shop_instagram: string | null;
  best_changed_at: string | null;
}

interface OfferRow {
  offer_id: string;
  product_id: string;
  price: number;
  changed_at: string | null;
  title: string | null;
  warranty_label: string | null;
  description: string | null;
  shop_id: string;
  shop_name: string;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  hours: string;
  instagram: string | null;
  website: string | null;
  categories: string;
}

interface ShopRow {
  shop_id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lon: number | null;
  categories: string;
  instagram: string | null;
  website: string | null;
  payments: string;
  fast_delivery: number;
  hours: string;
  offer_count: number;
  matched_offers?: number;
}

const PRODUCT_SELECT = `
  p.product_id, p.title, p.brand, p.category, p.image, p.images, p.specs,
  p.min_price, p.max_price, p.offer_count, p.best_price, p.best_offer_id,
  p.best_shop_id, p.newest_price_at,
  s.name AS shop_name, s.neighborhood AS shop_hood,
  s.lat AS shop_lat, s.lon AS shop_lon,
  s.website AS shop_website, s.instagram AS shop_instagram,
  bo.changed_at AS best_changed_at`;

const PRODUCT_JOINS = `
  LEFT JOIN shops s ON s.shop_id = p.best_shop_id
  LEFT JOIN offers bo ON bo.offer_id = p.best_offer_id`;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function distanceTo(
  origin: Origin | null,
  lat: number | null,
  lon: number | null,
): number | null {
  if (!origin || lat === null || lon === null) return null;
  return haversineMeters(origin, { lat, lon });
}

function mapProduct(row: ProductRow, origin: Origin | null = null, now = Date.now()): ProductCard {
  const hasBest =
    row.best_price !== null && row.best_offer_id !== null && row.shop_name !== null;
  const best = hasBest
    ? {
        offer_id: row.best_offer_id!,
        price: row.best_price!,
        shop_id: row.best_shop_id ?? "",
        shop_name: shopDisplayName(
          row.best_shop_id ?? "",
          row.shop_name,
          hasRegistryRecord(row.shop_website, row.shop_instagram),
        ),
        neighborhood: row.shop_hood,
        changed_at: row.best_changed_at,
        age_days: ageDays(row.best_changed_at, now),
        freshness: freshnessOf(row.best_changed_at, now),
        distance_m: distanceTo(origin, row.shop_lat, row.shop_lon),
      }
    : null;
  return {
    product_id: row.product_id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    image: row.image,
    min_price: row.min_price,
    max_price: row.max_price,
    offer_count: row.offer_count,
    best,
    newest_at: row.newest_price_at,
    freshness: freshnessOf(row.newest_price_at, now),
  };
}

function storeRef(row: OfferRow | ShopRow, origin: Origin | null): StoreRef {
  const recorded = "shop_name" in row ? row.shop_name : row.name;
  return {
    shop_id: row.shop_id,
    name: shopDisplayName(row.shop_id, recorded, hasRegistryRecord(row.website, row.instagram)),
    identity: shopIdentity(row.website, row.instagram),
    neighborhood: row.neighborhood,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    distance_m: distanceTo(origin, row.lat, row.lon),
  };
}

// --------------------------------------------------------------------- meta

function llmAgentConfigured(): boolean {
  const enabled = (process.env.AI_AGENT_ENABLED ?? "").trim().toLowerCase();
  const key = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? "";
  return ["1", "true", "yes", "on"].includes(enabled) && key.trim().length > 0;
}

let metaCache: Meta | null = null;

export function getMeta(): Meta {
  if (metaCache) return metaCache;
  const categories = all<{ name: string; product_count: number; shop_count: number }>(
    `SELECT name, product_count, shop_count FROM categories
     WHERE product_count > 0 OR shop_count > 0
     ORDER BY product_count DESC, shop_count DESC LIMIT 60`,
  );
  const neighborhoods = all<{
    name: string;
    lat: number;
    lon: number;
    shop_count: number;
    offer_count: number;
  }>(
    `SELECT name, lat, lon, shop_count, offer_count FROM neighborhoods
     WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY shop_count DESC`,
  );
  const brands = all<{ brand: string }>(
    `SELECT brand FROM products WHERE brand IS NOT NULL
     GROUP BY brand ORDER BY COUNT(*) DESC LIMIT 40`,
  );
  const defaultHood =
    neighborhoods.find((n) => n.name === "فردوسی") ?? neighborhoods[0] ?? null;
  const data = readMeta<{ imported_at?: string }>("imported_at");
  const counts = readMeta<{
    products?: number;
    offers?: number;
    shops?: number;
  }>("counts");
  const categoryCount =
    get<{ n: number }>("SELECT COUNT(*) AS n FROM categories")?.n ?? categories.length;
  const priceNewest = readMeta<string>("price_newest");
  const priceOldest = readMeta<string>("price_oldest");
  const pricedOffers = readMeta<number>("offers_priced");

  metaCache = {
    counts: {
      products: tableCount("products"),
      offers: tableCount("offers"),
      shops: tableCount("shops"),
      categories: categoryCount,
      neighborhoods: neighborhoods.length,
      comparable_products:
        get<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE offer_count >= 2")?.n ?? 0,
    },
    categories,
    neighborhoods,
    brands: brands.map((b) => b.brand),
    default_origin: defaultHood
      ? {
          lat: defaultHood.lat,
          lon: defaultHood.lon,
          label: defaultHood.name,
          neighborhood: defaultHood.name,
        }
      : { lat: 35.7005, lon: 51.4195, label: "فردوسی", neighborhood: "فردوسی" },
    data: {
      imported_at: data?.imported_at ?? null,
      price_newest: priceNewest,
      price_oldest: priceOldest,
      priced_offers: pricedOffers ?? 0,
    },
    assistant: {
      engine: llmAgentConfigured() ? "llm_agent" : "rules",
      note: llmAgentConfigured()
        ? "مدل زبانی ابزارها را انتخاب می‌کند؛ اگر در دسترس نباشد، موتور قطعی پاسخ می‌دهد."
        : "برنامه‌ریزی و انتخاب ابزارها قطعی و بدون مدل زبانی انجام می‌شود.",
    },
  };
  if (counts?.products && counts.products !== metaCache.counts.products) {
    metaCache.counts.products = counts.products;
  }
  return metaCache;
}

let categoryNamesCache: string[] | null = null;
export function allCategoryNames(): string[] {
  if (!categoryNamesCache) {
    categoryNamesCache = all<{ name: string }>(
      "SELECT name FROM categories ORDER BY product_count DESC",
    ).map((r) => r.name);
  }
  return categoryNamesCache;
}

let brandNamesCache: string[] | null = null;
export function allBrandNames(): string[] {
  if (!brandNamesCache) {
    brandNamesCache = all<{ brand: string }>(
      `SELECT brand FROM products WHERE brand IS NOT NULL
       GROUP BY brand HAVING COUNT(*) >= 5 ORDER BY COUNT(*) DESC LIMIT 600`,
    ).map((r) => r.brand);
  }
  return brandNamesCache;
}

// ------------------------------------------------------------------- search

interface SearchSql {
  from: string;
  where: string;
  params: (string | number)[];
  useFts: boolean;
}

function buildSearchSql(params: SearchParams, useLike: boolean): SearchSql {
  const where: string[] = ["p.offer_count >= 1", "p.min_price IS NOT NULL"];
  const values: (string | number)[] = [];
  const q = params.q?.trim();
  const useFts = Boolean(q) && !useLike;
  const from = useFts
    ? "FROM product_fts JOIN products p ON p.product_id = product_fts.product_id"
    : "FROM products p";

  if (q) {
    if (useFts) {
      const fts = normalizeFa(q)
        .split(" ")
        .filter(Boolean)
        .map((t) => t.replace(/["'^*:()\-]/g, ""))
        .filter(Boolean)
        .map((t) => `"${t}"*`)
        .join(" ");
      if (fts) {
        where.push("product_fts MATCH ?");
        values.push(fts);
      }
    } else {
      const like = `%${normalizeFa(q)}%`;
      where.push("(p.title_norm LIKE ? OR p.brand_norm LIKE ? OR p.category_norm LIKE ?)");
      values.push(like, like, like);
    }
  }
  if (params.category) {
    where.push("p.category = ?");
    values.push(params.category);
  }
  if (params.brand) {
    where.push("p.brand = ?");
    values.push(params.brand);
  }
  if (params.neighborhood) {
    where.push("s.neighborhood = ?");
    values.push(params.neighborhood);
  }
  if (typeof params.min_price === "number") {
    where.push("p.min_price >= ?");
    values.push(params.min_price);
  }
  if (typeof params.max_price === "number") {
    where.push("p.min_price <= ?");
    values.push(params.max_price);
  }
  if (typeof params.min_offers === "number" && params.min_offers > 1) {
    where.push("p.offer_count >= ?");
    values.push(params.min_offers);
  }
  if (typeof params.max_age_days === "number" && params.max_age_days > 0) {
    where.push("p.newest_price_at IS NOT NULL AND p.newest_price_at >= ?");
    values.push(new Date(Date.now() - params.max_age_days * 86_400_000).toISOString());
  }
  return { from, where: where.join(" AND "), params: values, useFts };
}

function orderBy(params: SearchParams, useFts: boolean): string {
  const sort = params.sort ?? (useFts ? "relevance" : "offers");
  switch (sort) {
    case "price_asc":
      return "p.min_price ASC, p.offer_count DESC";
    case "price_desc":
      return "p.min_price DESC, p.offer_count DESC";
    case "freshness":
      return "p.newest_price_at DESC, p.offer_count DESC";
    case "relevance":
      return useFts
        ? "bm25(product_fts), p.offer_count DESC"
        : "p.offer_count DESC, p.newest_price_at DESC";
    default:
      return "p.offer_count DESC, p.min_price ASC";
  }
}

export function searchProducts(params: SearchParams, origin: Origin | null = null): SearchResult {
  const started = performance.now();
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(48, Math.max(1, Math.floor(params.page_size ?? DEFAULT_PAGE_SIZE)));
  const bboxFilter =
    origin && typeof params.radius_m === "number"
      ? {
          minLat: origin.lat - (params.radius_m / 111_320) * 1.1,
          maxLat: origin.lat + (params.radius_m / 111_320) * 1.1,
          minLon: origin.lon - (params.radius_m / (111_320 * Math.cos((origin.lat * Math.PI) / 180))) * 1.1,
          maxLon: origin.lon + (params.radius_m / (111_320 * Math.cos((origin.lat * Math.PI) / 180))) * 1.1,
        }
      : null;

  const run = (useLike: boolean) => {
    const base = buildSearchSql(params, useLike);
    const where = [base.where];
    const values = [...base.params];
    if (bboxFilter) {
      where.push("s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ?");
      values.push(bboxFilter.minLat, bboxFilter.maxLat, bboxFilter.minLon, bboxFilter.maxLon);
    }
    const whereSql = where.join(" AND ");
    const total =
      get<{ n: number }>(
        `SELECT COUNT(*) AS n ${base.from} ${PRODUCT_JOINS} WHERE ${whereSql}`,
        values,
      )?.n ?? 0;
    return { base, whereSql, values, total };
  };

  let { base, whereSql, values, total } = run(false);
  if (total === 0 && params.q && base.useFts) {
    ({ base, whereSql, values, total } = run(true));
  }

  const now = Date.now();
  const near = Boolean(origin && bboxFilter);
  let rows: ProductRow[];
  let items: ProductCard[];
  if (near) {
    // Cheapest correct prefilter: rank the bbox candidates by squared degree
    // distance in SQL, so the 500 kept rows are genuinely the closest ones.
    rows = all<ProductRow>(
      `SELECT ${PRODUCT_SELECT} ${base.from} ${PRODUCT_JOINS} WHERE ${whereSql}
       ORDER BY ((s.lat - ?) * (s.lat - ?) + (s.lon - ?) * (s.lon - ?)) ASC LIMIT 500`,
      [...values, origin!.lat, origin!.lat, origin!.lon, origin!.lon],
    );
    const radius = params.radius_m ?? 4000;
    items = rows
      .map((row) => mapProduct(row, origin, now))
      .filter((p) => p.best?.distance_m !== null && (p.best?.distance_m ?? Infinity) <= radius)
      .sort((a, b) => (a.best?.distance_m ?? 0) - (b.best?.distance_m ?? 0));
    // The SQL count is the bbox size, not the true radius match — report what we serve.
    total = items.length;
    const start = (page - 1) * pageSize;
    items = items.slice(start, start + pageSize);
  } else {
    rows = all<ProductRow>(
      `SELECT ${PRODUCT_SELECT} ${base.from} ${PRODUCT_JOINS} WHERE ${whereSql}
       ORDER BY ${orderBy(params, base.useFts)} LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    items = rows.map((row) => mapProduct(row, origin, now));
  }

  return {
    items,
    total,
    page,
    page_size: pageSize,
    took_ms: Math.round(performance.now() - started),
    applied: {
      q: params.q ?? null,
      category: params.category ?? null,
      brand: params.brand ?? null,
      neighborhood: params.neighborhood ?? null,
      min_price: params.min_price ?? null,
      max_price: params.max_price ?? null,
      min_offers: params.min_offers ?? null,
      max_age_days: params.max_age_days ?? null,
      sort: params.sort ?? null,
      radius_m: params.radius_m ?? null,
    },
  };
}

// ------------------------------------------------------------------ product

interface PriceRow {
  price: number;
  changed_at: string | null;
}

export interface MarketStats {
  min: number | null;
  max: number | null;
  median: number | null;
  second_min: number | null;
  prices: number[];
  priced_offers: number;
  fresh_offers: number;
  newest: string | null;
}

function marketStats(productId: string): MarketStats {
  const rows = all<PriceRow>(
    "SELECT price, changed_at FROM offers WHERE product_id = ? ORDER BY price ASC",
    [productId],
  );
  if (rows.length === 0) {
    return {
      min: null, max: null, median: null, second_min: null, prices: [],
      priced_offers: 0, fresh_offers: 0, newest: null,
    };
  }
  const prices = rows.map((r) => r.price);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0 ? Math.round((prices[mid - 1]! + prices[mid]!) / 2) : prices[mid]!;
  const fresh = rows.filter((r) => freshnessOf(r.changed_at) === "fresh" || freshnessOf(r.changed_at) === "recent");
  return {
    min: prices[0] ?? null,
    max: prices[prices.length - 1] ?? null,
    median,
    second_min: prices.length > 1 ? prices[1]! : null,
    prices,
    priced_offers: prices.length,
    fresh_offers: fresh.length,
    newest: rows
      .map((r) => r.changed_at)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null,
  };
}

function mapOffer(row: OfferRow, market: MarketStats, origin: Origin | null, now: number): OfferView {
  const shop = storeRef(row, origin);
  const days = ageDays(row.changed_at, now);
  const freshness = freshnessOf(row.changed_at, now);
  const reliabilityInput: ReliabilityInput = {
    price: row.price,
    changed_at: row.changed_at,
    warranty: row.warranty_label,
    description: row.description,
    shop: {
      has_hours: row.hours !== "{}" && row.hours !== "",
      has_website: Boolean(row.website),
      has_instagram: Boolean(row.instagram),
      has_address: Boolean(row.address),
      has_coords: row.lat !== null && row.lon !== null,
    },
    market: {
      min: market.min,
      median: market.median,
      second_min: market.second_min,
      offer_count: market.priced_offers,
    },
    now,
  };
  return {
    offer_id: row.offer_id,
    product_id: row.product_id,
    price: row.price,
    changed_at: row.changed_at,
    age_days: days,
    freshness,
    freshness_label: FRESHNESS_TEXT[freshness],
    title: shorten(row.title, 120),
    warranty: row.warranty_label,
    description: shorten(row.description, 220),
    shop,
    reliability: scoreOffer(reliabilityInput),
  };
}

function offerRowsForProduct(productId: string, limit = 200): OfferRow[] {
  return all<OfferRow>(
    `SELECT o.offer_id, o.product_id, o.price, o.changed_at, o.title, o.warranty_label,
            o.description, s.shop_id, s.name AS shop_name, s.neighborhood, s.address,
            s.lat, s.lon, s.hours, s.instagram, s.website, s.categories
     FROM offers o JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.product_id = ?
     ORDER BY o.price ASC, o.changed_at DESC
     LIMIT ?`,
    [productId, limit],
  );
}

export function getProduct(productId: string, origin: Origin | null = null): ProductDetail | null {
  const row = get<ProductRow>(
    `SELECT ${PRODUCT_SELECT} FROM products p ${PRODUCT_JOINS} WHERE p.product_id = ?`,
    [productId],
  );
  if (!row) return null;
  const now = Date.now();
  const market = marketStats(productId);
  const offers = offerRowsForProduct(productId).map((o) => mapOffer(o, market, origin, now));
  const images = parseJson<string[]>(row.images, []).filter((u) => typeof u === "string");
  const specs = parseJson<Spec[]>(row.specs, []).filter(
    (s) => s && typeof s.key === "string" && typeof s.value === "string",
  );

  const card = mapProduct(row, origin, now);
  if (offers[0]) {
    card.best = {
      offer_id: offers[0].offer_id,
      price: offers[0].price,
      shop_id: offers[0].shop.shop_id,
      shop_name: offers[0].shop.name,
      neighborhood: offers[0].shop.neighborhood,
      changed_at: offers[0].changed_at,
      age_days: offers[0].age_days,
      freshness: offers[0].freshness,
      distance_m: offers[0].shop.distance_m,
    };
  }

  const basePrice = card.min_price ?? market.median ?? 0;
  const alternatives =
    basePrice > 0
      ? all<ProductRow>(
          `SELECT ${PRODUCT_SELECT} FROM products p ${PRODUCT_JOINS}
           WHERE p.category = ? AND p.product_id <> ? AND p.offer_count >= 1
             AND p.min_price IS NOT NULL AND p.min_price BETWEEN ? AND ?
           ORDER BY ABS(p.min_price - ?) ASC, p.offer_count DESC
           LIMIT 6`,
          [row.category, productId, Math.round(basePrice * 0.45), Math.round(basePrice * 1.9), basePrice],
        ).map((r) => mapProduct(r, origin, now))
      : [];

  return {
    ...card,
    images: images.length > 0 ? images : row.image ? [row.image] : [],
    specs,
    offers,
    market: {
      min: market.min,
      median: market.median,
      max: market.max,
      spread_percent:
        market.min && market.max && market.min > 0
          ? Math.round(((market.max - market.min) / market.min) * 100)
          : null,
      priced_offers: market.priced_offers,
      fresh_offers: market.fresh_offers,
    },
    alternatives,
  };
}

export function getOffer(offerId: string, origin: Origin | null = null): OfferView | null {
  const row = get<OfferRow>(
    `SELECT o.offer_id, o.product_id, o.price, o.changed_at, o.title, o.warranty_label,
            o.description, s.shop_id, s.name AS shop_name, s.neighborhood, s.address,
            s.lat, s.lon, s.hours, s.instagram, s.website, s.categories
     FROM offers o JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.offer_id = ?`,
    [offerId],
  );
  if (!row) return null;
  return mapOffer(row, marketStats(row.product_id), origin, Date.now());
}

export function getProductsByIds(ids: string[], origin: Origin | null = null): ProductCard[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = all<ProductRow>(
    `SELECT ${PRODUCT_SELECT} FROM products p ${PRODUCT_JOINS}
     WHERE p.product_id IN (${placeholders})`,
    ids,
  );
  const now = Date.now();
  const byId = new Map(rows.map((r) => [r.product_id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is ProductRow => Boolean(r))
    .map((r) => mapProduct(r, origin, now));
}

// -------------------------------------------------------------------- shops

function mapStore(row: ShopRow, origin: Origin | null, now = new Date()): StoreCard {
  const hoursRaw = parseJson<Record<string, unknown>>(row.hours, {});
  const { day, minutes } = tehranNow(now);
  const today = dayHours(hoursRaw, day);
  return {
    shop_id: row.shop_id,
    name: shopDisplayName(row.shop_id, row.name, hasRegistryRecord(row.website, row.instagram)),
    identity: shopIdentity(row.website, row.instagram),
    neighborhood: row.neighborhood,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    distance_m: distanceTo(origin, row.lat, row.lon),
    categories: parseJson<string[]>(row.categories, []).slice(0, 6),
    website: row.website,
    instagram: row.instagram,
    fast_delivery: row.fast_delivery === 1,
    offer_count: row.offer_count,
    hours_today: today,
    open_now: openNow(today, minutes),
    matched_offers: row.matched_offers,
  };
}

export function searchShops(params: ShopSearchParams, origin: Origin | null = null): ShopSearchResult {
  const started = performance.now();
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(48, Math.max(1, Math.floor(params.page_size ?? 12)));
  const q = params.q?.trim();
  const from = q
    ? "FROM shop_fts JOIN shops s ON s.shop_id = shop_fts.shop_id"
    : "FROM shops s";
  const where = ["s.in_tehran = 1"];
  const values: (string | number)[] = [];
  if (q) {
    where.push("shop_fts MATCH ?");
    values.push(
      normalizeFa(q)
        .split(" ")
        .filter(Boolean)
        .map((t) => `"${t}"*`)
        .join(" "),
    );
  }
  if (params.neighborhood) {
    where.push("s.neighborhood = ?");
    values.push(params.neighborhood);
  }
  if (params.category) {
    where.push("(' ' || s.categories_norm || ' ') LIKE ?");
    values.push(`% ${normalizeFa(params.category)} %`);
  }
  const whereSql = where.join(" AND ");
  const total =
    get<{ n: number }>(`SELECT COUNT(*) AS n ${from} WHERE ${whereSql}`, values)?.n ?? 0;

  const sort = params.sort ?? (origin ? "distance" : "offers");
  if (sort === "distance" && origin) {
    const rows = all<ShopRow>(
      `SELECT s.* ${from} WHERE ${whereSql} ORDER BY s.offer_count DESC LIMIT 500`,
      values,
    );
    const radius = params.radius_m ?? 10_000;
    const mapped = rows
      .map((r) => mapStore(r, origin))
      .filter((s) => s.distance_m !== null && s.distance_m <= radius)
      .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    const start = (page - 1) * pageSize;
    return {
      items: mapped.slice(start, start + pageSize),
      total: mapped.length,
      page,
      page_size: pageSize,
      took_ms: Math.round(performance.now() - started),
    };
  }

  const rows = all<ShopRow>(
    `SELECT s.* ${from} WHERE ${whereSql}
     ORDER BY ${sort === "name" ? "s.name ASC" : "s.offer_count DESC, s.name ASC"}
     LIMIT ? OFFSET ?`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((r) => mapStore(r, origin)),
    total,
    page,
    page_size: pageSize,
    took_ms: Math.round(performance.now() - started),
  };
}

export function getShop(shopId: string, origin: Origin | null = null): ShopDetail | null {
  const row = get<ShopRow>("SELECT * FROM shops WHERE shop_id = ?", [shopId]);
  if (!row) return null;
  const base = mapStore(row, origin);
  const topRows = all<{ product_id: string; title: string; image: string | null; price: number; offer_count: number }>(
    `SELECT p.product_id, p.title, p.image, MIN(o.price) AS price, p.offer_count
     FROM offers o JOIN products p ON p.product_id = o.product_id
     WHERE o.shop_id = ? AND p.offer_count >= 1
     GROUP BY p.product_id
     ORDER BY p.offer_count DESC, p.newest_price_at DESC
     LIMIT 8`,
    [shopId],
  );
  const hoursRaw = parseJson<Record<string, unknown>>(row.hours, {});
  const rawPayments = parseJson<{ provider_name?: string }[]>(row.payments, []);
  const hours: Partial<Record<DayKey, DayHours>> = {};
  const dayKeys: DayKey[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  for (const key of dayKeys) {
    const parsed = dayHours(hoursRaw, key);
    if (parsed) hours[key] = parsed;
  }
  const top_products: ShopProduct[] = topRows.map((r) => ({
    product_id: r.product_id,
    title: r.title,
    image: r.image,
    price_at_shop: r.price,
    offer_count: r.offer_count,
  }));
  return {
    ...base,
    payments: rawPayments
      .map((payment) => payment?.provider_name)
      .filter((name): name is string => Boolean(name)),
    hours,
    top_products,
  };
}

export interface SellingStoreInput {
  category?: string;
  brand?: string;
  productIds?: string[];
  origin: Origin | null;
  radiusM?: number;
  limit?: number;
}

export function getStoresSelling(input: SellingStoreInput): StoreCard[] {
  if (!input.category && !input.brand && (!input.productIds || input.productIds.length === 0)) {
    return [];
  }
  const where = ["s.in_tehran = 1"];
  const values: (string | number)[] = [];
  if (input.category) {
    where.push("p.category = ?");
    values.push(input.category);
  }
  if (input.brand) {
    where.push("p.brand = ?");
    values.push(input.brand);
  }
  if (input.productIds && input.productIds.length > 0) {
    where.push(`p.product_id IN (${input.productIds.map(() => "?").join(",")})`);
    values.push(...input.productIds);
  }
  const rows = all<ShopRow>(
    `SELECT s.shop_id, s.name, s.address, s.neighborhood, s.lat, s.lon, s.categories,
            s.instagram, s.website, s.payments, s.fast_delivery, s.hours,
            s.offer_count, COUNT(DISTINCT o.offer_id) AS matched_offers
     FROM shops s JOIN offers o ON o.shop_id = s.shop_id
     JOIN products p ON p.product_id = o.product_id
     WHERE ${where.join(" AND ")}
     GROUP BY s.shop_id
     ORDER BY matched_offers DESC, s.offer_count DESC
     LIMIT 400`,
    values,
  );
  const radius = input.radiusM ?? 6000;
  const origin = input.origin;
  let stores = rows
    .map((r) => mapStore(r, origin))
    .filter((s) => (origin ? s.distance_m !== null && s.distance_m <= radius : true));
  if (origin) {
    stores = stores.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
  }
  return stores.slice(0, input.limit ?? 8);
}

// --------------------------------------------------------------------- plan

export interface PlanOfferRow {
  offer_id: string;
  price: number;
  changed_at: string | null;
  product_id: string;
  title: string;
  image: string | null;
  shop: StoreRef;
}

export function offersForPlan(ids: string[], origin: Origin | null): PlanOfferRow[] {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)].slice(0, 40);
  const placeholders = unique.map(() => "?").join(",");
  const rows = all<{
    offer_id: string;
    price: number;
    changed_at: string | null;
    product_id: string;
    title: string;
    image: string | null;
    shop_id: string;
    shop_name: string;
    neighborhood: string | null;
    address: string | null;
    lat: number | null;
    lon: number | null;
    website: string | null;
    instagram: string | null;
  }>(
    `SELECT o.offer_id, o.price, o.changed_at, o.product_id, p.title, p.image,
            s.shop_id, s.name AS shop_name, s.neighborhood, s.address, s.lat, s.lon,
            s.website, s.instagram
     FROM offers o JOIN products p ON p.product_id = o.product_id
     JOIN shops s ON s.shop_id = o.shop_id
     WHERE o.offer_id IN (${placeholders})`,
    unique,
  );
  const byId = new Map(rows.map((r) => [r.offer_id, r]));
  return unique
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      offer_id: r.offer_id,
      price: r.price,
      changed_at: r.changed_at,
      product_id: r.product_id,
      title: r.title,
      image: r.image,
      shop: {
        shop_id: r.shop_id,
        name: shopDisplayName(r.shop_id, r.shop_name, hasRegistryRecord(r.website, r.instagram)),
        identity: shopIdentity(r.website, r.instagram),
        neighborhood: r.neighborhood,
        address: r.address,
        lat: r.lat,
        lon: r.lon,
        distance_m: distanceTo(origin, r.lat, r.lon),
      },
    }));
}

/** Coordinate-bearing shop rows for routing. Never invents a missing location. */
export interface RouteShopRow {
  shop_id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

export function shopsByIds(ids: string[]): {
  shops: RouteShopRow[];
  missing: string[];
  withoutCoords: { shop_id: string; name: string }[];
} {
  const unique = [...new Set(ids)].slice(0, 12);
  if (unique.length === 0) return { shops: [], missing: [], withoutCoords: [] };
  const placeholders = unique.map(() => "?").join(",");
  const rows = all<ShopRow>(
    `SELECT shop_id, name, address, neighborhood, lat, lon,
            categories, instagram, website, payments, fast_delivery, hours, offer_count
     FROM shops WHERE shop_id IN (${placeholders})`,
    unique,
  );
  const byId = new Map(rows.map((row) => [row.shop_id, row]));
  const shops: RouteShopRow[] = [];
  const missing: string[] = [];
  const withoutCoords: { shop_id: string; name: string }[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      missing.push(id);
      continue;
    }
    const name = shopDisplayName(row.shop_id, row.name, hasRegistryRecord(row.website, row.instagram));
    if (
      row.lat === null ||
      row.lon === null ||
      !Number.isFinite(row.lat) ||
      !Number.isFinite(row.lon) ||
      Math.abs(row.lat) > 90 ||
      Math.abs(row.lon) > 180
    ) {
      withoutCoords.push({ shop_id: row.shop_id, name });
      continue;
    }
    shops.push({
      shop_id: row.shop_id,
      name,
      neighborhood: row.neighborhood,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
    });
  }
  return { shops, missing, withoutCoords };
}

export function planItems(ids: string[], origin: Origin | null): PlanItem[] {
  return offersForPlan(ids, origin).map((o) => ({
    offer_id: o.offer_id,
    product_id: o.product_id,
    title: o.title,
    price: o.price,
    age_days: ageDays(o.changed_at),
    freshness: freshnessOf(o.changed_at),
    image: o.image,
  }));
}

// ------------------------------------------------------------------ compare

export function compareColumns(ids: string[], origin: Origin | null): ComparisonColumn[] {
  return getProductsByIds(ids, origin).map((p) => ({
    product_id: p.product_id,
    title: p.title,
    brand: p.brand,
    image: p.image,
    price: p.min_price,
    offer_count: p.offer_count,
    freshness: p.freshness,
    age_days: p.best?.age_days ?? null,
    neighborhood: p.best?.neighborhood ?? null,
    best_shop: p.best?.shop_name ?? null,
  }));
}

export function categoryTopProducts(category: string, limit = 4): ProductCard[] {
  const rows = all<ProductRow>(
    `SELECT ${PRODUCT_SELECT} FROM products p ${PRODUCT_JOINS}
     WHERE p.category = ? AND p.offer_count >= 2
     ORDER BY p.offer_count DESC, p.newest_price_at DESC LIMIT ?`,
    [category, limit],
  );
  return rows.map((r) => mapProduct(r));
}

export function neighborhoodList(): NeighborhoodInfo[] {
  return getMeta().neighborhoods;
}

export function dbHealth() {
  return {
    size_mb: dbSizeMb(),
    ready: tableCount("products") > 0,
    imported_at: readMeta<string>("imported_at"),
  };
}
