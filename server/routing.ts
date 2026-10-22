import type {
  Origin,
  RouteOptimization,
  RoutePlan,
  RouteRequest,
  RouteStop,
  TravelMode,
} from "../shared/types";
import { orderStops } from "./lib/geo";
import { isValidLatLon, type LatLon } from "./lib/polyline";
import { NeshanError, fetchDirections, fetchTripOrder, neshanRoutingConfigured } from "./lib/neshan";
import {
  MapirError,
  fetchMapirRoute,
  fetchMapirTsp,
  mapirRoutingConfigured,
  type MapirProfile,
  type MapirRoute,
} from "./lib/mapir";
import { shopsByIds, type RouteShopRow } from "./repo";

/**
 * Turns a basket of shops into a real road/pavement route.
 *
 * Division of labour:
 *  - the dataset owns which shops exist and where they are (no invented pins),
 *  - Map.ir (`/vrp/tsp/v1/driving`) or Neshan (`v3/trip`) owns the visit order
 *    when that service is actually authorized and the mode supports it,
 *  - Map.ir (`/route/v1/…`) or Neshan (`v4/direction`) owns road geometry,
 *    distance and duration.
 * Nothing here estimates a road route locally: if the provider fails, the
 * request fails with a Persian message instead of a fabricated line.
 */

export const MAX_ROUTE_STOPS = 5;
export type RouteProvider = "mapir" | "neshan";

export class RouteError extends Error {
  readonly status: number;
  readonly code?: string | number;

  constructor(message: string, status = 400, code?: string | number) {
    super(message);
    this.name = "RouteError";
    this.status = status;
    this.code = code;
  }
}

const MODES: TravelMode[] = ["walk", "car", "motorcycle"];

export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === "string" && (MODES as string[]).includes(value);
}

/** Which provider this deployment will use, or null when no key is set. */
export function activeRouteProvider(): RouteProvider | null {
  if (mapirRoutingConfigured()) return "mapir";
  if (neshanRoutingConfigured()) return "neshan";
  return null;
}

function validOrigin(origin: Origin | null | undefined): Origin {
  if (!origin || typeof origin !== "object") throw new RouteError("نقطهٔ شروع ارسال نشده است.");
  const { lat, lon } = origin;
  if (typeof lat !== "number" || typeof lon !== "number" || !isValidLatLon(lat, lon)) {
    throw new RouteError("مختصات نقطهٔ شروع معتبر نیست.");
  }
  return {
    lat,
    lon,
    label: typeof origin.label === "string" ? origin.label.slice(0, 60) : undefined,
    neighborhood:
      typeof origin.neighborhood === "string" ? origin.neighborhood.slice(0, 60) : undefined,
  };
}

function nearestOrder<T extends { lat: number; lon: number }>(origin: Origin, items: T[]): T[] {
  return orderStops(origin, items).map((entry) => entry.stop);
}

function providerFailure(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof MapirError) {
    if (error.status === 503) return new RouteError(error.message, 503);
    if (error.status === 429) return new RouteError(error.message, 503);
    if (error.status === 404) return new RouteError(error.message, 404);
    if (error.status === 504) return new RouteError(error.message, 504);
    return new RouteError(error.message, 502, error.code ?? undefined);
  }
  if (error instanceof NeshanError) {
    const status =
      error.status === 503 || error.code === 481 || error.code === 482
        ? 503
        : error.status === 404
          ? 404
          : error.status === 504
            ? 504
            : 502;
    return new RouteError(error.message, status, error.code);
  }
  return new RouteError("سرویس مسیریابی در دسترس نبود.", 502);
}

interface Prepared {
  origin: Origin;
  originPoint: LatLon;
  shops: RouteShopRow[];
  excluded: RoutePlan["excluded"];
  warnings: string[];
  returnToOrigin: boolean;
  optimize: boolean;
}

function prepare(input: RouteRequest, provider: RouteProvider): Prepared {
  if (!isTravelMode(input.mode)) throw new RouteError("حالت سفر نامعتبر است.");
  const origin = validOrigin(input.origin);

  if (!Array.isArray(input.shop_ids)) throw new RouteError("فهرست فروشگاه‌ها ارسال نشده است.");
  const requestedIds = input.shop_ids
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64);
  if (requestedIds.length === 0) throw new RouteError("فروشگاهی برای مسیریابی انتخاب نشده است.");

  const warnings: string[] = [];
  if (requestedIds.length > MAX_ROUTE_STOPS) {
    warnings.push(
      `مسیر حداکثر ${MAX_ROUTE_STOPS.toLocaleString("fa-IR")} فروشگاه را پشتیبانی می‌کند؛ بقیه نادیده گرفته شدند.`,
    );
  }

  const { shops, missing, withoutCoords } = shopsByIds(requestedIds);
  const excluded: RoutePlan["excluded"] = [
    ...missing.map((shop_id) => ({ shop_id, reason: "این فروشگاه در دیتاست پیدا نشد." })),
    ...withoutCoords.map((shop) => ({
      shop_id: shop.shop_id,
      reason: "مختصات ثبت‌شده ندارد و بنابراین در نقشه و مسیر قابل نمایش نیست.",
    })),
  ];

  if (shops.length === 0) {
    throw new RouteError(
      "هیچ‌یک از فروشگاه‌های انتخابی مختصات معتبر در دیتاست ندارند؛ مسیری قابل ساخت نیست.",
      422,
    );
  }

  const limited = shops.slice(0, MAX_ROUTE_STOPS);
  for (const shop of shops.slice(MAX_ROUTE_STOPS)) {
    excluded.push({
      shop_id: shop.shop_id,
      reason: `بیش از ${MAX_ROUTE_STOPS.toLocaleString("fa-IR")} ایست در یک مسیر پشتیبانی نمی‌شود.`,
    });
  }

  void provider;

  return {
    origin,
    originPoint: { lat: origin.lat, lon: origin.lon },
    shops: limited,
    excluded,
    warnings,
    returnToOrigin: input.return_to_origin === true,
    optimize: input.optimize !== false,
  };
}

/* --------------------------------------------------------------- Map.ir */

const MAPIR_PROFILE: Record<TravelMode, MapirProfile> = {
  walk: "foot",
  car: "driving",
  // Map.ir documents no motorcycle profile; the car road network is used and
  // the substitution is stated in the response.
  motorcycle: "driving",
};

async function buildMapirRoute(
  input: RouteRequest,
  mode: TravelMode,
  prepared: Prepared,
  alternative: boolean,
): Promise<RoutePlan> {
  const { origin, originPoint, shops } = prepared;
  let ordered = shops;
  let optimization: RouteOptimization = "fixed";
  let optimizationNote = "ترتیب فروشگاه‌ها همان ترتیبی است که انتخاب کرده‌اید.";

  if (shops.length >= 2) {
    if (mode !== "walk" && prepared.optimize) {
      try {
        const tsp = await fetchMapirTsp({
          points: [originPoint, ...shops.map((shop) => ({ lat: shop.lat, lon: shop.lon }))],
          roundtrip: prepared.returnToOrigin,
          source: "first",
          destination: prepared.returnToOrigin ? "last" : "any",
        });
        const shopOrder = tsp.order.filter((index) => index !== 0).map((index) => index - 1);
        const complete =
          shopOrder.length === shops.length &&
          new Set(shopOrder).size === shops.length &&
          shopOrder.every((index) => index >= 0 && index < shops.length);
        if (!complete) throw new MapirError("ترتیب بهینه‌شدهٔ مسیر کامل نبود.", 502);
        ordered = shopOrder.map((index) => shops[index]);
        optimization = "tsp";
        optimizationNote =
          "ترتیب ایست‌ها با سرویس TSP نقشه (Map.ir) تقریبی تعیین شده است؛ این سرویس الگوریتم حریصانه دارد و کمترین زمان ممکن را تضمین نمی‌کند، سپس مسیر خیابانی هر پا از سرویس مسیریابی گرفته شد.";
      } catch (error) {
        if (error instanceof RouteError) throw error;
        if (error instanceof MapirError && error.code) {
          // `NoTrips` / `NotImplemented` are the documented TSP failures.
          prepared.warnings.push(`سرویس بهینه‌سازی ترتیب اجرا نشد (${error.code}).`);
        } else {
          prepared.warnings.push("سرویس بهینه‌سازی ترتیب در دسترس نبود.");
        }
        ordered = nearestOrder(origin, shops);
        optimization = "nearest";
        optimizationNote =
          "ترتیب ایست‌ها بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم چیده شد و مسیر خیابانی از سرویس مسیریابی گرفته شده است؛ این ترتیب بهینه‌سازی نشده است.";
        prepared.warnings.push("ترتیب ایست‌ها بهینه‌سازی رسمی نشده است.");
      }
    } else {
      ordered = nearestOrder(origin, shops);
      optimization = "nearest";
      optimizationNote =
        mode === "walk"
          ? "برای پیاده‌روی سرویس بهینه‌سازی نقطه‌ای در دسترس نیست؛ ترتیب بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم است، نه بهینهٔ مسیر پیاده."
          : "ترتیب ایست‌ها بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم چیده شد و مسیر خیابانی از سرویس مسیریابی گرفته شده است.";
    }
  }

  if (mode === "motorcycle") {
    prepared.warnings.push(
      "سرویس نقشه (Map.ir) حالت موتورسیکلت ندارد؛ مسیر خیابانی خودرو محاسبه و نمایش داده شده است.",
    );
  }

  const points: LatLon[] = prepared.returnToOrigin
    ? [originPoint, ...ordered.map((shop) => ({ lat: shop.lat, lon: shop.lon })), originPoint]
    : [originPoint, ...ordered.map((shop) => ({ lat: shop.lat, lon: shop.lon }))];

  let routes: MapirRoute[];
  try {
    routes = await fetchMapirRoute({
      profile: MAPIR_PROFILE[mode],
      points,
      alternatives: alternative,
      steps: true,
      overview: "full",
      geometries: "geojson",
    });
  } catch (error) {
    throw providerFailure(error);
  }

  const route = routes[0];
  const expectedLegs = ordered.length + (prepared.returnToOrigin ? 1 : 0);
  if (route.legs.length !== expectedLegs) {
    prepared.warnings.push("جزئیات هر پای مسیر کامل دریافت نشد؛ فقط جمع کل از سرویس مسیریابی است.");
  }

  if (mode === "walk" || mode === "motorcycle") {
    // Foot routes have no traffic; motorcycle is served by the car profile.
    prepared.warnings.push(
      mode === "walk"
        ? "زمان پیاده‌روی از سرویس مسیریابی پیاده است و به ترافیک وابسته نیست."
        : "زمان خودرو برای موتور تخمین زده شده و ممکن است متفاوت باشد.",
    );
  } else {
    prepared.warnings.push(
      "زمان رسیدن در شهرهای پوشش‌داده‌شده (مثل تهران) با در نظر گرفتن ترافیک گزارش می‌شود؛ در سایر منطقه‌ها بر پایهٔ سرعت مجاز جاده‌هاست.",
    );
  }

  return finish({
    provider: "mapir",
    mode,
    optimization,
    optimizationNote,
    prepared,
    ordered,
    distance: route.distance_m,
    duration: route.duration_s,
    geometry: route.geometry,
    legs: route.legs.map((leg) => ({ distance_m: leg.distance_m, duration_s: leg.duration_s })),
    alternatives: routes.slice(1).map((alt, index) => ({
      index: index + 1,
      distance_m: alt.distance_m,
      duration_s: alt.duration_s,
    })),
  });
}

/* --------------------------------------------------------------- Neshan */

async function buildNeshanRoute(
  mode: TravelMode,
  prepared: Prepared,
  alternative: boolean,
): Promise<RoutePlan> {
  const { origin, originPoint, shops } = prepared;
  let ordered = shops;
  let optimization: RouteOptimization = "fixed";
  let optimizationNote = "ترتیب فروشگاه‌ها همان ترتیبی است که انتخاب کرده‌اید.";

  if (shops.length >= 2) {
    if (mode !== "walk" && prepared.optimize) {
      try {
        const trip = await fetchTripOrder({
          points: [originPoint, ...shops.map((shop) => ({ lat: shop.lat, lon: shop.lon }))],
          sourceIsAnyPoint: false,
          lastIsAnyPoint: !prepared.returnToOrigin,
          roundTrip: prepared.returnToOrigin,
        });
        const shopOrder = trip.order.filter((index) => index !== 0).map((index) => index - 1);
        const complete =
          shopOrder.length === shops.length &&
          new Set(shopOrder).size === shops.length &&
          shopOrder.every((index) => index >= 0 && index < shops.length);
        if (!complete) throw new RouteError("ترتیب بهینه‌شدهٔ مسیر کامل نبود.", 502);
        ordered = shopOrder.map((index) => shops[index]);
        optimization = "tsp";
        optimizationNote = prepared.returnToOrigin
          ? "ترتیب ایست‌ها با سرویس بهینه‌سازی Neshan برای مسیر رفت‌وبرگشت به نقطهٔ شروع تعیین شد."
          : "ترتیب ایست‌ها با سرویس بهینه‌سازی Neshan (TSP) تعیین شد و سپس مسیر خیابانی هر پا گرفته شد.";
      } catch (error) {
        if (error instanceof RouteError) throw error;
        ordered = nearestOrder(origin, shops);
        optimization = "nearest";
        optimizationNote =
          "سرویس بهینه‌سازی سفر در دسترس نبود؛ ترتیب ایست‌ها بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم چیده شد و مسیر خیابانی از سرویس مسیریابی گرفته شده است.";
        prepared.warnings.push("ترتیب ایست‌ها بهینه‌سازی رسمی نشده است.");
      }
    } else {
      ordered = nearestOrder(origin, shops);
      optimization = "nearest";
      optimizationNote =
        mode === "walk"
          ? "برای پیاده‌روی سرویس بهینه‌سازی نقطه‌ای در دسترس نیست؛ ترتیب بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم است، نه بهینهٔ مسیر پیاده."
          : "ترتیب ایست‌ها بر پایهٔ نزدیک‌ترین فاصلهٔ خط مستقیم چیده شد و مسیر خیابانی از سرویس مسیریابی گرفته شده است.";
    }
  }

  const destination = prepared.returnToOrigin
    ? originPoint
    : { lat: ordered[ordered.length - 1].lat, lon: ordered[ordered.length - 1].lon };
  const waypoints = prepared.returnToOrigin
    ? ordered.map((shop) => ({ lat: shop.lat, lon: shop.lon }))
    : ordered.slice(0, -1).map((shop) => ({ lat: shop.lat, lon: shop.lon }));

  let routes;
  try {
    routes = await fetchDirections({
      mode,
      origin: originPoint,
      destination,
      waypoints,
      alternative,
    });
  } catch (error) {
    throw providerFailure(error);
  }

  const route = routes[0];
  const expectedLegs = ordered.length + (prepared.returnToOrigin ? 1 : 0);
  if (route.legs.length !== expectedLegs) {
    prepared.warnings.push("جزئیات هر پای مسیر کامل دریافت نشد؛ فقط جمع کل از سرویس مسیریابی است.");
  }

  return finish({
    provider: "neshan",
    mode,
    optimization,
    optimizationNote,
    prepared,
    ordered,
    distance: route.distance_m,
    duration: route.duration_s,
    geometry: route.geometry,
    legs: route.legs.map((leg) => ({ distance_m: leg.distance_m, duration_s: leg.duration_s })),
    alternatives: routes.slice(1).map((alt, index) => ({
      index: index + 1,
      distance_m: alt.distance_m,
      duration_s: alt.duration_s,
    })),
  });
}

/* ------------------------------------------------------------- assembly */

interface FinishInput {
  provider: RouteProvider;
  mode: TravelMode;
  optimization: RouteOptimization;
  optimizationNote: string;
  prepared: Prepared;
  ordered: RouteShopRow[];
  distance: number;
  duration: number;
  geometry: LatLon[];
  legs: { distance_m: number; duration_s: number }[];
  alternatives: RoutePlan["alternatives"];
}

function finish(input: FinishInput): RoutePlan {
  const stops: RouteStop[] = input.ordered.map((shop, index) => {
    const leg = input.legs[index];
    return {
      shop_id: shop.shop_id,
      name: shop.name,
      neighborhood: shop.neighborhood,
      address: shop.address,
      lat: shop.lat,
      lon: shop.lon,
      order: index + 1,
      distance_from_prev_m: leg ? leg.distance_m : null,
      duration_from_prev_s: leg ? leg.duration_s : null,
    };
  });

  return {
    mode: input.mode,
    optimization: input.optimization,
    optimization_note: input.optimizationNote,
    provider: input.provider,
    origin: input.prepared.origin,
    stops,
    return_to_origin: input.prepared.returnToOrigin,
    geometry: input.geometry.map((point) => [point.lon, point.lat] as [number, number]),
    distance_m: input.distance,
    duration_s: input.duration,
    alternatives: input.alternatives,
    excluded: input.prepared.excluded,
    warnings: input.prepared.warnings,
  };
}

export async function buildRoute(input: RouteRequest): Promise<RoutePlan> {
  if (!isTravelMode(input.mode)) throw new RouteError("حالت سفر نامعتبر است.");
  const provider = activeRouteProvider();
  if (!provider) {
    throw new RouteError(
      "مسیریابی خیابانی فعال نیست: کلید سرویس نقشه (MAPIR_API_KEY یا NESHAN_API_KEY) روی سرور تنظیم نشده است.",
      503,
    );
  }

  const alternative = input.alternative === true;
  const prepared = prepare(input, provider);
  return provider === "mapir"
    ? buildMapirRoute(input, input.mode, prepared, alternative)
    : buildNeshanRoute(input.mode, prepared, alternative);
}
