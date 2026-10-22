import { envValue } from "./env";
import { isValidLatLon, decodePolyline, type LatLon } from "./polyline";

/**
 * Server-side Neshan web-service client (routing + trip optimization).
 *
 * The service key never leaves the process: the browser only ever talks to
 * `/api/route`. Provider failures are translated into Persian messages with a
 * machine-readable code, and upstream payloads/headers are never forwarded.
 */

export const NESHAN_BASE_URL = "https://api.neshan.org";
export const DIRECTIONS_PATH = "/v4/direction";
export const TRIP_PATH = "/v3/trip";

export type NeshanMode = "walk" | "car" | "motorcycle";

export interface DirectionRequest {
  mode: NeshanMode;
  origin: LatLon;
  destination: LatLon;
  waypoints?: LatLon[];
  alternative?: boolean;
  avoidTrafficZone?: boolean;
  avoidOddEvenZone?: boolean;
}

export interface DirectionLeg {
  distance_m: number;
  duration_s: number;
  summary: string | null;
  steps: { instruction: string | null; distance_m: number; duration_s: number }[];
}

export interface DirectionRoute {
  distance_m: number;
  duration_s: number;
  geometry: LatLon[];
  legs: DirectionLeg[];
}

export interface TripResult {
  /** Original input indices in optimized visit order. */
  order: number[];
  /** Street names Neshan returned for each optimized point, when present. */
  names: (string | null)[];
}

const ERROR_MESSAGES: Record<number, string> = {
  400: "درخواست مسیریابی نامعتبر بود.",
  470: "مختصات ارسال‌شده برای مسیریابی معتبر نیست.",
  480: "کلید سرویس نقشه نامعتبر است.",
  481: "سهمیهٔ سرویس نقشه تمام شده است.",
  482: "تعداد درخواست‌ها زیاد است؛ چند لحظه بعد دوباره تلاش کنید.",
  483: "این کلید دسترسی به سرویس مسیریابی ندارد.",
  484: "دامنه یا آی‌پی این برنامه برای کلید نقشه مجاز نیست.",
  485: "سرویس مسیریابی برای این کلید فعال نشده است.",
  500: "سرویس نقشه خطای داخلی داد.",
};

export class NeshanError extends Error {
  readonly code: number;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, code: number, status: number) {
    super(message);
    this.name = "NeshanError";
    this.code = code;
    this.status = status;
    this.retryable = code === 482 || code === 500 || status === 429;
  }
}

export class NeshanConfigError extends NeshanError {
  constructor(message = "کلید سرویس مسیریابی (NESHAN_API_KEY) تنظیم نشده است.") {
    super(message, 0, 503);
    this.name = "NeshanConfigError";
  }
}

export function neshanRoutingConfigured(): boolean {
  return Boolean(envValue("NESHAN_API_KEY"));
}

function apiKey(): string {
  const key = envValue("NESHAN_API_KEY");
  if (!key) throw new NeshanConfigError();
  return key;
}

/** `latitude,longitude` — the order every Neshan request parameter uses. */
export function coordinateParam(point: LatLon): string {
  if (!isValidLatLon(point.lat, point.lon)) throw new NeshanError("مختصات نامعتبر است.", 470, 400);
  return `${point.lat},${point.lon}`;
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

export function clearNeshanCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ fetch */

const REQUEST_TIMEOUT_MS = 8_000;

interface NeshanEnvelope {
  status?: unknown;
  error?: unknown;
  message?: unknown;
  description?: unknown;
}

function providerCode(status: number, body: NeshanEnvelope | null): number {
  const raw = body && typeof body.error === "string" ? Number(body.error) : Number(body?.status);
  if (Number.isFinite(raw) && raw >= 400) return raw;
  return status;
}

async function request(path: string, params: URLSearchParams): Promise<unknown> {
  const key = apiKey();
  const query = params.toString();
  const cacheKey = `${path}?${query}`;
  const hit = cached<unknown>(cacheKey);
  if (hit) return hit;

  let response: Response;
  try {
    response = await fetch(`${NESHAN_BASE_URL}${path}?${query}`, {
      method: "GET",
      headers: { Accept: "application/json", "Api-Key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new NeshanError(
      aborted ? "سرویس نقشه پاسخ نداد؛ دوباره تلاش کنید." : "ارتباط با سرویس نقشه برقرار نشد.",
      0,
      aborted ? 504 : 502,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = providerCode(response.status, (body as NeshanEnvelope) ?? null);
    const message = ERROR_MESSAGES[code] ?? "سرویس مسیریابی پاسخ معتبری نداد.";
    throw new NeshanError(message, code, response.status);
  }

  if (body === null || typeof body !== "object") {
    throw new NeshanError("پاسخ سرویس مسیریابی قابل خواندن نبود.", 0, 502);
  }

  remember(cacheKey, body);
  return body;
}

/* -------------------------------------------------------------- directions */

interface RawLeg {
  summary?: unknown;
  distance?: { value?: unknown };
  duration?: { value?: unknown };
  steps?: unknown;
}

interface RawRoute {
  overview_polyline?: { points?: unknown };
  legs?: unknown;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseLegs(raw: unknown): DirectionLeg[] {
  if (!Array.isArray(raw)) return [];
  const legs: DirectionLeg[] = [];
  for (const entry of raw) {
    const leg = entry as RawLeg;
    const distance = num(leg?.distance?.value);
    const duration = num(leg?.duration?.value);
    if (distance === null || duration === null) continue;
    const steps: DirectionLeg["steps"] = [];
    if (Array.isArray(leg.steps)) {
      for (const step of leg.steps) {
        const s = step as { instruction?: unknown; distance?: { value?: unknown }; duration?: { value?: unknown } };
        const stepDistance = num(s?.distance?.value);
        const stepDuration = num(s?.duration?.value);
        if (stepDistance === null || stepDuration === null) continue;
        steps.push({
          instruction: typeof s.instruction === "string" ? s.instruction : null,
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

export async function fetchDirections(input: DirectionRequest): Promise<DirectionRoute[]> {
  const params = new URLSearchParams();
  params.set("origin", coordinateParam(input.origin));
  params.set("destination", coordinateParam(input.destination));
  params.set("type", input.mode === "walk" ? "pedestrian" : input.mode);
  if (input.waypoints && input.waypoints.length > 0) {
    params.set("waypoints", input.waypoints.map(coordinateParam).join("|"));
  }
  if (input.alternative) params.set("alternative", "true");
  if (input.avoidTrafficZone) params.set("avoidTrafficZone", "true");
  if (input.avoidOddEvenZone) params.set("avoidOddEvenZone", "true");

  const body = (await request(DIRECTIONS_PATH, params)) as { routes?: unknown };
  if (!Array.isArray(body.routes) || body.routes.length === 0) {
    throw new NeshanError("مسیری برای این نقاط پیدا نشد.", 0, 404);
  }

  const routes: DirectionRoute[] = [];
  for (const entry of body.routes) {
    const route = entry as RawRoute;
    const encoded = route?.overview_polyline?.points;
    if (typeof encoded !== "string" || encoded.length === 0) continue;
    let geometry: LatLon[];
    try {
      geometry = decodePolyline(encoded);
    } catch {
      continue;
    }
    const legs = parseLegs(route.legs);
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance_m, 0);
    const totalDuration = legs.reduce((sum, leg) => sum + leg.duration_s, 0);
    if (geometry.length < 2 || (legs.length === 0 && totalDistance === 0)) continue;
    routes.push({
      distance_m: Math.round(totalDistance),
      duration_s: Math.round(totalDuration),
      geometry,
      legs,
    });
  }

  if (routes.length === 0) {
    throw new NeshanError("پاسخ مسیریابی ساختار معتبری نداشت.", 0, 502);
  }
  return routes;
}

/* -------------------------------------------------------------------- trip */

interface TripRequest {
  points: LatLon[];
  /** false keeps the first point as the start. */
  sourceIsAnyPoint?: boolean;
  /** false keeps the last point as the end. */
  lastIsAnyPoint?: boolean;
  roundTrip?: boolean;
}

export async function fetchTripOrder(input: TripRequest): Promise<TripResult> {
  if (input.points.length < 3) {
    throw new NeshanError("بهینه‌سازی مسیر به حداقل سه نقطه نیاز دارد.", 0, 400);
  }
  const params = new URLSearchParams();
  params.set("waypoints", input.points.map(coordinateParam).join("|"));
  params.set("sourceIsAnyPoint", input.sourceIsAnyPoint === false ? "false" : "true");
  params.set("lastIsAnyPoint", input.lastIsAnyPoint === false ? "false" : "true");
  params.set("roundTrip", input.roundTrip ? "true" : "false");

  const body = (await request(TRIP_PATH, params)) as { points?: unknown };
  if (!Array.isArray(body.points) || body.points.length === 0) {
    throw new NeshanError("پاسخ بهینه‌سازی مسیر خالی بود.", 0, 502);
  }

  const order: number[] = [];
  const names: (string | null)[] = [];
  for (const entry of body.points) {
    const point = entry as { index?: unknown; name?: unknown };
    const index = typeof point.index === "number" ? point.index : Number(point.index);
    if (!Number.isInteger(index) || index < 0 || index >= input.points.length) continue;
    if (order.includes(index)) continue;
    order.push(index);
    names.push(typeof point.name === "string" ? point.name : null);
  }

  if (order.length !== input.points.length) {
    throw new NeshanError("ترتیب بهینه‌شدهٔ مسیر کامل نبود.", 0, 502);
  }
  return { order, names };
}
