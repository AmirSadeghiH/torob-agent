import express, { type NextFunction, type Request, type Response } from "express";
import type {
  AssistantContext,
  AssistantRequest,
  Origin,
  SearchParams,
  ShopSearchParams,
} from "../shared/types";
import { dbHealth, getMeta, getOffer, getProduct, getShop, searchProducts, searchShops } from "./repo";
import { buildPlan } from "./plan";
import { RouteError, buildRoute, isTravelMode } from "./routing";
import { respond } from "./assistant";
import { normalizeHistory } from "./ai-config";

export const api = express.Router();

class BadRequest extends Error {}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function originFrom(value: unknown): Origin | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lat = num(v.lat);
  const lon = num(v.lon);
  if (lat === undefined || lon === undefined) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    label: str(v.label, 60),
    neighborhood: str(v.neighborhood, 60),
  };
}

function originFromQuery(req: Request): Origin | null {
  const lat = num(req.query.lat);
  const lon = num(req.query.lon);
  if (lat === undefined || lon === undefined) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: str(req.query.label, 60), neighborhood: str(req.query.neighborhood, 60) };
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req, res);
      if (result && typeof result.catch === "function") result.catch(next);
    } catch (error) {
      next(error);
    }
  };

api.get("/health", wrap((_req, res) => {
  const meta = getMeta();
  const health = dbHealth();
  res.json({
    ok: health.ready,
    db: { path: "data/hamkharid.db", size_mb: health.size_mb, ready: health.ready },
    counts: {
      products: meta.counts.products,
      offers: meta.counts.offers,
      shops: meta.counts.shops,
    },
    imported_at: health.imported_at,
  });
}));

api.get("/meta", wrap((_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=120");
  res.json(getMeta());
}));

api.get("/search", wrap((req, res) => {
  const params: SearchParams = {
    q: str(req.query.q),
    category: str(req.query.category),
    brand: str(req.query.brand, 80),
    neighborhood: str(req.query.neighborhood, 60),
    min_price: num(req.query.min_price),
    max_price: num(req.query.max_price),
    min_offers: num(req.query.min_offers),
    max_age_days: num(req.query.max_age_days),
    page: num(req.query.page) ?? 1,
    page_size: num(req.query.page_size) ?? 12,
    sort: ["relevance", "price_asc", "price_desc", "offers", "freshness"].includes(String(req.query.sort))
      ? (req.query.sort as SearchParams["sort"])
      : undefined,
    lat: num(req.query.lat),
    lon: num(req.query.lon),
    radius_m: num(req.query.radius_m),
  };
  if (params.max_price !== undefined && params.max_price <= 0) throw new BadRequest("max_price must be positive");
  const origin = originFromQuery(req);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(searchProducts(params, origin));
}));

api.get("/products/:id", wrap((req, res) => {
  const product = getProduct(String(req.params.id), originFromQuery(req));
  if (!product) {
    res.status(404).json({ error: "کالا پیدا نشد." });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(product);
}));

api.get("/offers/:id", wrap((req, res) => {
  const offer = getOffer(String(req.params.id), originFromQuery(req));
  if (!offer) {
    res.status(404).json({ error: "پیشنهاد پیدا نشد." });
    return;
  }
  res.json(offer);
}));

api.get("/shops", wrap((req, res) => {
  const params: ShopSearchParams = {
    q: str(req.query.q),
    neighborhood: str(req.query.neighborhood, 60),
    category: str(req.query.category),
    sort: ["offers", "name", "distance"].includes(String(req.query.sort))
      ? (req.query.sort as ShopSearchParams["sort"])
      : undefined,
    page: num(req.query.page) ?? 1,
    page_size: num(req.query.page_size) ?? 12,
    lat: num(req.query.lat),
    lon: num(req.query.lon),
    radius_m: num(req.query.radius_m),
  };
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(searchShops(params, originFromQuery(req)));
}));

api.get("/shops/:id", wrap((req, res) => {
  const shop = getShop(String(req.params.id), originFromQuery(req));
  if (!shop) {
    res.status(404).json({ error: "فروشگاه پیدا نشد." });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=120");
  res.json(shop);
}));

api.post("/plan", wrap((req, res) => {
  const body = (req.body ?? {}) as { offer_ids?: unknown; origin?: unknown };
  if (!Array.isArray(body.offer_ids)) throw new BadRequest("offer_ids must be an array");
  const ids = body.offer_ids
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 64)
    .slice(0, 40);
  if (ids.length === 0) throw new BadRequest("offer_ids is empty");
  const origin = originFrom(body.origin) ?? getMeta().default_origin;
  const plan = buildPlan(ids, origin);
  if (!plan) {
    res.status(404).json({ error: "هیچ‌یک از پیشنهادها پیدا نشد." });
    return;
  }
  res.json(plan);
}));

api.post("/route", wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.shop_ids)) throw new BadRequest("shop_ids must be an array");
  const shopIds = body.shop_ids
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64)
    .slice(0, 20);
  if (shopIds.length === 0) throw new BadRequest("shop_ids is empty");
  if (!isTravelMode(body.mode)) throw new BadRequest("mode must be walk, car or motorcycle");
  const origin = originFrom(body.origin);
  if (!origin) throw new BadRequest("origin is required");

  try {
    const route = await buildRoute({
      shop_ids: shopIds,
      origin,
      mode: body.mode,
      optimize: body.optimize !== false,
      return_to_origin: body.return_to_origin === true,
      alternative: body.alternative === true,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(route);
  } catch (error) {
    if (error instanceof RouteError) {
      res.status(error.status).json({ error: error.message, code: error.code ?? null });
      return;
    }
    throw error;
  }
}));

api.post("/assistant", wrap(async (req, res) => {
  const body = (req.body ?? {}) as Partial<AssistantRequest>;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new BadRequest("message is required");
  if (message.length > 600) throw new BadRequest("message is too long");

  const rawContext = (body.context ?? {}) as Record<string, unknown>;
  const context: AssistantContext = {
    product_id: str(rawContext.product_id, 64),
    product_title: str(rawContext.product_title, 200),
    category: str(rawContext.category, 120),
    query: str(rawContext.query, 120),
    offer_ids: Array.isArray(rawContext.offer_ids)
      ? rawContext.offer_ids.filter((id): id is string => typeof id === "string").slice(0, 40)
      : undefined,
    origin: originFrom(rawContext.origin) ?? undefined,
  };

  const response = await respond({
    message,
    context,
    history: normalizeHistory(body.history),
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(response);
}));

export function apiErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof BadRequest) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error("[api]", error);
  res.status(500).json({ error: "خطای غیرمنتظره در سرور. دوباره تلاش کنید." });
}
