/**
 * Map.ir web-service client (routing + TSP).
 *
 * Map.ir documents (help.map.ir):
 *  - host `https://api.map.ir`
 *  - profile endpoints `/route/v1/driving/{coordinates}` (car),
 *    `/foot/v1/driving/{coordinates}` (pedestrian) and
 *    `/bicycle/v1/driving/{coordinates}` (bicycle)
 *  - path coordinates as `longitude,latitude` separated by `;`
 *  - TSP at `/vrp/tsp/v1/driving/{coordinates}` — a greedy heuristic
 *  - authentication via the `x-api-key` request header
 *
 * The key never leaves the server; the browser only calls `/api/route`.
 */

import { envValue } from "./env";
import { isValidLatLon, decodePolyline, type LatLon } from "./polyline";

export const MAPIR_BASE_URL = "https://api.map.ir";
/**
 * The routing profiles and TSP are served directly from the `api.map.ir`
 * gateway; the help pages show each profile path with no extra prefix.
 */
export const ROUTES_BASE_PATH = "";

export type MapirProfile = "driving" | "foot" | "bicycle";

const PROFILE_PATH: Record<MapirProfile, string> = {
  driving: "/route/v1/driving",
  foot: "/foot/v1/driving",
  bicycle: "/bicycle/v1/driving",
};

export const TSP_PATH = "/vrp/tsp/v1/driving";
export const ETA_PATH = "/eta/route/v1/driving";

export class MapirError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "MapirError";
    this.status = status;
    this.code = code;
    this.retryable = status === 429 || status >= 500;
  }
}

export class MapirConfigError extends MapirError {
  constructor(message = "کلید سرویس نقشه (MAPIR_API_KEY) روی سرور تنظیم نشده است.") {
    super(message, 503);
    this.name = "MapirConfigError";
  }
}

export function mapirRoutingConfigured(): boolean {
  return Boolean(envValue("MAPIR_API_KEY"));
}

function apiKey(): string {
  const key = envValue("MAPIR_API_KEY");
  if (!key) throw new MapirConfigError();
  return key;
}

/** Map.ir path coordinates: `longitude,latitude`. */
export function coordinatePath(point: LatLon): string {
  if (!isValidLatLon(point.lat, point.lon)) {
    throw new MapirError("مختصات نامعتبر است.", 400);
  }
  return `${point.lon},${point.lat}`;
}

export function coordinatesPath(points: LatLon[]): string {
  if (points.length < 2) throw new MapirError("حداقل دو نقطه لازم است.", 400);
  return points.map(coordinatePath).join(";");
}

/* ------------------------------------------------------------------- cache */

interface CacheEntry {
  at: number;
  value: unknown;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 100;
const cache = new Map<string, CacheEntry>();

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function remember(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

export function clearMapirCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------- http */

const REQUEST_TIMEOUT_MS = 8_000;

async function request(path: string, params?: URLSearchParams): Promise<unknown> {
  const key = apiKey();
  const url = `${MAPIR_BASE_URL}${path}${params ? `?${params.toString()}` : ""}`;
  const cacheKey = url;
  const hit = cached<unknown>(cacheKey);
  if (hit) return hit;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new MapirError(
      aborted ? "سرویس نقشه پاسخ نداد؛ دوباره تلاش کنید." : "ارتباط با سرویس نقشه برقرار نشد.",
      aborted ? 504 : 502,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  let parsed = false;
  try {
    if (text) {
      body = JSON.parse(text);
      parsed = true;
    }
  } catch {
    body = null;
    parsed = false;
  }

  // The gateway serves its SPA HTML shell (HTTP 200 or 404) when the routing
  // service is not deployed or not enabled for this key. That is a config
  // problem, not "no route found", and must never be read as a route.
  if (!parsed) {
    throw new MapirError(
      "این سرویس مسیریابی روی درگاه Map.ir پاسخ نداد؛ ممکن است برای این کلید فعال نشده باشد.",
      503,
      "ServiceUnavailable",
    );
  }

  if (!response.ok) {
    const code =
      body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
        ? (body as { code: string }).code
        : String(response.status);
    throw new MapirError(messageForStatus(response.status, code), response.status, code);
  }

  if (body === null || typeof body !== "object") {
    throw new MapirError("پاسخ سرویس نقشه قابل خواندن نبود.", 502);
  }

  remember(cacheKey, body);
  return body;
}

/**
 * Map.ir does not document stable error codes for routing, so only the HTTP
 * status is translated and no upstream text is forwarded to the client.
 */
function messageForStatus(status: number, code?: string): string {
  if (code === "NoRoute") return "مسیری بین این نقاط روی شبکهٔ معابر پیدا نشد.";
  if (code === "ServiceUnavailable") {
    return "این سرویس مسیریابی برای این کلید فعال نشده است.";
  }
  if (status === 401 || status === 403) return "کلید سرویس نقشه معتبر نیست یا دسترسی لازم را ندارد.";
  if (status === 404) return "مسیری برای این نقاط پیدا نشد.";
  if (status === 429) return "تعداد درخواست‌ها زیاد است؛ چند لحظه بعد دوباره تلاش کنید.";
  if (status === 400) return "درخواست مسیریابی نامعتبر بود.";
  if (status >= 500) return "سرویس نقشه خطای داخلی داد.";
  return "سرویس مسیریابی پاسخ معتبری نداد.";
}

/* --------------------------------------------------------------- geometry */

export function decodePolyline6(encoded: string): LatLon[] {
  return decodePolyline(encoded, 1e6);
}

/* ------------------------------------------------------------------ route */

export interface MapirRouteRequest {
  profile: MapirProfile;
  points: LatLon[];
  alternatives?: boolean;
  steps?: boolean;
  overview?: "full" | "simplified" | "false";
  geometries?: "geojson" | "polyline" | "polyline6";
}

export interface MapirStep {
  instruction: string | null;
  name: string | null;
  distance_m: number;
  duration_s: number;
}

export interface MapirLeg {
  distance_m: number;
  duration_s: number;
  summary: string | null;
  steps: MapirStep[];
}

export interface MapirRoute {
  distance_m: number;
  duration_s: number;
  geometry: LatLon[];
  legs: MapirLeg[];
}

export async function fetchMapirRoute(request_: MapirRouteRequest): Promise<MapirRoute[]> {
  const path = `${PROFILE_PATH[request_.profile]}/${coordinatesPath(request_.points)}`;
  const params = new URLSearchParams();
  params.set("overview", request_.overview ?? "full");
  params.set("geometries", request_.geometries ?? "geojson");
  params.set("alternatives", request_.alternatives ? "true" : "false");
  params.set("steps", request_.steps ? "true" : "false");

  const body = (await request(path, params)) as {
    code?: unknown;
    routes?: unknown;
    waypoints?: unknown;
  };

  if (typeof body.code === "string" && body.code !== "Ok") {
    throw new MapirError("سرویس مسیریابی مسیری برنگرداند.", 404, body.code);
  }
  if (!Array.isArray(body.routes) || body.routes.length === 0) {
    throw new MapirError("مسیری برای این نقاط پیدا نشد.", 404);
  }

  const routes: MapirRoute[] = [];
  for (const entry of body.routes) {
    const route = entry as {
      distance?: unknown;
      duration?: unknown;
      geometry?: unknown;
      legs?: unknown;
    };
    const distance = numOf(route.distance);
    const duration = numOf(route.duration);
    const geometry = parseGeometry(route.geometry);
    if (distance === null || duration === null || geometry === null) continue;
    routes.push({
      distance_m: Math.round(distance),
      duration_s: Math.round(duration),
      geometry,
      legs: parseLegs(route.legs),
    });
  }

  if (routes.length === 0) {
    throw new MapirError("پاسخ مسیریابی ساختار معتبری نداشت.", 502);
  }
  return routes;
}

function numOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Map.ir `geometries=geojson` returns `{type:"LineString",coordinates:[[lon,lat],…]}`. */
function parseGeometry(raw: unknown): LatLon[] | null {
  if (typeof raw === "string" && raw.length > 0) {
    try {
      return decodePolyline6(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    const geometry = raw as { type?: unknown; coordinates?: unknown };
    if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return null;
    const points: LatLon[] = [];
    for (const pair of geometry.coordinates) {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const lon = Number(pair[0]);
      const lat = Number(pair[1]);
      if (!isValidLatLon(lat, lon)) return null;
      points.push({ lat, lon });
    }
    return points.length >= 2 ? points : null;
  }
  return null;
}

function parseLegs(raw: unknown): MapirLeg[] {
  if (!Array.isArray(raw)) return [];
  const legs: MapirLeg[] = [];
  for (const entry of raw) {
    const leg = entry as { distance?: unknown; duration?: unknown; summary?: unknown; steps?: unknown };
    const distance = numOf(leg.distance);
    const duration = numOf(leg.duration);
    if (distance === null || duration === null) continue;
    const steps: MapirStep[] = [];
    if (Array.isArray(leg.steps)) {
      for (const step of leg.steps) {
        const s = step as {
          instruction?: unknown;
          name?: unknown;
          distance?: unknown;
          duration?: unknown;
        };
        const stepDistance = numOf(s.distance);
        const stepDuration = numOf(s.duration);
        if (stepDistance === null || stepDuration === null) continue;
        steps.push({
          instruction: typeof s.instruction === "string" ? s.instruction : null,
          name: typeof s.name === "string" ? s.name : null,
          distance_m: stepDistance,
          duration_s: stepDuration,
        });
      }
    }
    legs.push({
      distance_m: distance,
      duration_s: duration,
      summary: typeof leg.summary === "string" ? leg.summary : null,
      steps,
    });
  }
  return legs;
}

/* -------------------------------------------------------------------- TSP */

export interface MapirTspRequest {
  points: LatLon[];
  roundtrip?: boolean;
  source?: "any" | "first";
  destination?: "any" | "last";
}

export interface MapirTspResult {
  /** Original input indices in the optimized visit order. */
  order: number[];
}

/**
 * Map.ir TSP is documented as a greedy heuristic, never a guaranteed optimum.
 * The response exposes `waypoints[]` with `trips_index`/`waypoint_index`; the
 * docs do not state whether these are input indices, so the returned
 * `location` is matched back onto the input list (exact match first, then the
 * closest input point), and the result is rejected unless every input point
 * is covered exactly once.
 */
export async function fetchMapirTsp(input: MapirTspRequest): Promise<MapirTspResult> {
  if (input.points.length < 3) {
    throw new MapirError("بهینه‌سازی مسیر به حداقل سه نقطه نیاز دارد.", 400);
  }
  const params = new URLSearchParams();
  params.set("geometries", "geojson");
  params.set("overview", "false");
  params.set("roundtrip", input.roundtrip ? "true" : "false");
  params.set("source", input.source ?? "first");
  params.set("destination", input.destination ?? "last");

  const body = (await request(`${TSP_PATH}/${coordinatesPath(input.points)}`, params)) as {
    code?: unknown;
    waypoints?: unknown;
  };

  if (typeof body.code === "string" && body.code !== "Ok") {
    throw new MapirError("بهینه‌سازی مسیر انجام نشد.", 404, body.code);
  }
  if (!Array.isArray(body.waypoints) || body.waypoints.length === 0) {
    throw new MapirError("پاسخ بهینه‌سازی مسیر خالی بود.", 502);
  }

  const order: number[] = [];
  for (const entry of body.waypoints) {
    const point = entry as { location?: unknown };
    const pair = Array.isArray(point.location) ? point.location : null;
    if (!pair || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!isValidLatLon(lat, lon)) continue;
    const exact = input.points.findIndex((p) => p.lon === lon && p.lat === lat);
    const index =
      exact >= 0
        ? exact
        : nearestIndex(input.points, { lat, lon });
    if (index === null || order.includes(index)) continue;
    order.push(index);
  }

  if (order.length !== input.points.length) {
    throw new MapirError("ترتیب بهینه‌شدهٔ مسیر کامل نبود.", 502);
  }
  return { order };
}

function nearestIndex(points: LatLon[], target: LatLon): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const dLat = point.lat - target.lat;
    const dLon = point.lon - target.lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  // 1e-4 degrees ≈ 11 m; anything farther than that is a different place.
  return best !== null && bestDistance <= 1e-8 ? best : null;
}
