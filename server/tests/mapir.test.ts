import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import {
  MapirError,
  clearMapirCache,
  coordinatePath,
  coordinatesPath,
  decodePolyline6,
  fetchMapirRoute,
  fetchMapirTsp,
} from "../lib/mapir";
import { decodePolyline, isValidLatLon, polylineToGeoJson } from "../lib/polyline";
import { RouteError, activeRouteProvider, buildRoute } from "../routing";
import { shopsByIds } from "../repo";

/**
 * Deterministic Map.ir tests: `fetch` is replaced with a scripted handler, so
 * no provider quota or real credential is consumed.
 */

const KEY = "mapir-test-key";
const ORIGIN = { lat: 35.7008, lon: 51.4035, label: "فردوسی" };
/** polyline6 for (35.7008,51.4035) then (35.71,51.42). */
const POLYLINE6 = "_c_bcAwml`aB_~Pgf_@";

const SHOP_IDS = [
  "shop_3f93a30a9e66c6dece07cdff",
  "shop_51d0c1a6edf81ba759726bab",
  "shop_9900a46f54a879ce260839bb",
];

const originalFetch = globalThis.fetch;
let calls: { url: URL; init: RequestInit }[] = [];

function mockFetch(handler: (url: URL) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return handler(url);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function routeBody(options: { legCount?: number; extraRoutes?: number; geometry?: unknown } = {}) {
  const legCount = options.legCount ?? 2;
  const leg = (index: number) => ({
    summary: `خیابان ${index + 1}`,
    distance: 400 + index * 100,
    duration: 240 + index * 60,
    steps: [
      { instruction: "به سمت شمال بروید", name: "خیابان آزادی", distance: 120, duration: 90 },
    ],
  });
  const route = (extra = 0) => ({
    distance: Array.from({ length: legCount }, (_, i) => 400 + i * 100).reduce((a, b) => a + b, 0) + extra,
    duration: Array.from({ length: legCount }, (_, i) => 240 + i * 60).reduce((a, b) => a + b, 0) + extra,
    geometry: options.geometry ?? {
      type: "LineString",
      coordinates: [
        [51.40338, 35.70061],
        [51.40473, 35.69847],
        [51.40712, 35.69472],
      ],
    },
    legs: Array.from({ length: legCount }, (_, i) => leg(i)),
  });
  return { code: "Ok", routes: [route(), ...Array.from({ length: options.extraRoutes ?? 0 }, () => route(300))] };
}

beforeEach(() => {
  calls = [];
  clearMapirCache();
  process.env.MAPIR_API_KEY = KEY;
  // Force the Map.ir provider for these tests even when Neshan keys exist.
  delete process.env.NESHAN_API_KEY;
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MAPIR_API_KEY;
});

describe("coordinate helpers", () => {
  test("Map.ir path coordinates are longitude,latitude joined by ';'", () => {
    assert.equal(coordinatePath({ lat: 35.7008, lon: 51.4035 }), "51.4035,35.7008");
    assert.equal(
      coordinatesPath([
        { lat: 35.7008, lon: 51.4035 },
        { lat: 35.71, lon: 51.42 },
      ]),
      "51.4035,35.7008;51.42,35.71",
    );
    assert.throws(() => coordinatePath({ lat: 120, lon: 51 }), MapirError);
    assert.throws(() => coordinatesPath([{ lat: 35.7, lon: 51.4 }]), MapirError);
  });

  test("polyline6 decoding yields [lon, lat] GeoJSON order", () => {
    const points = decodePolyline6(POLYLINE6);
    assert.equal(points.length, 2);
    assert.ok(Math.abs(points[0].lat - 35.7008) < 1e-5);
    assert.ok(Math.abs(points[0].lon - 51.4035) < 1e-5);
    assert.ok(Math.abs(points[1].lat - 35.71) < 1e-5);
    assert.ok(Math.abs(points[1].lon - 51.42) < 1e-5);
    // and the shared Google-precision decoder still matches the reference case
    const google = polylineToGeoJson("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    assert.deepEqual(google[0].map((v) => Math.round(v * 1000) / 1000), [-120.2, 38.5]);
    assert.throws(() => decodePolyline("_p~iF"), /mid-value/, "a partial value must not decode");
    assert.equal(isValidLatLon(35.7, 51.4), true);
    assert.equal(isValidLatLon(0, 200), false);
  });
});

describe("Map.ir route client", () => {
  test("builds the documented URL and sends the x-api-key header", async () => {
    mockFetch(() => json(routeBody()));
    const routes = await fetchMapirRoute({
      profile: "driving",
      points: [
        { lat: 35.7008, lon: 51.4035 },
        { lat: 35.71, lon: 51.42 },
      ],
      alternatives: true,
      steps: true,
    });

    assert.equal(calls.length, 1);
    const url = calls[0].url;
    assert.equal(url.origin, "https://api.map.ir");
    assert.equal(url.pathname, "/route/v1/driving/51.4035,35.7008;51.42,35.71");
    assert.equal(url.searchParams.get("overview"), "full");
    assert.equal(url.searchParams.get("geometries"), "geojson");
    assert.equal(url.searchParams.get("alternatives"), "true");
    assert.equal(url.searchParams.get("steps"), "true");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], KEY);

    assert.equal(routes.length, 1);
    assert.equal(routes[0].distance_m, 900);
    assert.equal(routes[0].duration_s, 540);
    assert.equal(routes[0].geometry[0].lon, 51.40338);
    assert.equal(routes[0].geometry[0].lat, 35.70061);
    assert.equal(routes[0].legs.length, 2);
    assert.equal(routes[0].legs[0].steps[0].instruction, "به سمت شمال بروید");
  });

  test("uses the foot profile for walking and parses polyline6 geometry", async () => {
    mockFetch(() => json(routeBody({ geometry: POLYLINE6 })));
    await fetchMapirRoute({
      profile: "foot",
      points: [
        { lat: 35.7008, lon: 51.4035 },
        { lat: 35.71, lon: 51.42 },
      ],
    });
    assert.equal(calls[0].url.pathname, "/foot/v1/driving/51.4035,35.7008;51.42,35.71");
    assert.equal(calls[0].url.searchParams.get("geometries"), "geojson");
  });

  test("reports invalid credentials and rate limits in Persian without leaking the key", async () => {
    mockFetch(() => json({ message: "x-api-key is invalid" }, 401));
    await assert.rejects(
      () =>
        fetchMapirRoute({
          profile: "driving",
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.42 },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof MapirError);
        assert.equal(error.status, 401);
        assert.match(error.message, /کلید/);
        assert.ok(!error.message.includes(KEY));
        assert.ok(!error.message.includes("x-api-key"));
        return true;
      },
    );

    clearMapirCache();
    mockFetch(() => json({ message: "rate limit" }, 429));
    await assert.rejects(
      () =>
        fetchMapirRoute({
          profile: "driving",
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.42 },
          ],
        }),
      (error: unknown) => error instanceof MapirError && error.retryable,
    );
  });

  test("treats empty routes and malformed bodies as failures, never a fake route", async () => {
    mockFetch(() => json({ code: "NoRoute", routes: [], waypoints: [] }));
    await assert.rejects(
      () =>
        fetchMapirRoute({
          profile: "driving",
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.42 },
          ],
        }),
      (error: unknown) => error instanceof MapirError && error.status === 404,
    );

    clearMapirCache();
    // The gateway serves its SPA HTML shell when routing is not enabled for
    // the key; that must surface as "service unavailable", never a route.
    mockFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await assert.rejects(
      () =>
        fetchMapirRoute({
          profile: "driving",
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.42 },
          ],
        }),
      (error: unknown) => error instanceof MapirError && error.status === 503,
    );

    clearMapirCache();
    mockFetch(() => json({ code: "Ok", routes: [{ distance: "far", duration: null }] }));
    await assert.rejects(
      () =>
        fetchMapirRoute({
          profile: "driving",
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.42 },
          ],
        }),
      (error: unknown) => error instanceof MapirError && error.status === 502,
    );
  });
});

describe("Map.ir TSP", () => {
  test("maps returned waypoint locations back to the input order", async () => {
    mockFetch(() =>
      json({
        code: "Ok",
        waypoints: [
          { location: [51.4071, 35.6949], trips_index: 0, waypoint_index: 1 },
          { location: [51.4035, 35.7008], trips_index: 0, waypoint_index: 0 },
          { location: [51.4107, 35.6953], trips_index: 0, waypoint_index: 2 },
        ],
      }),
    );
    const trip = await fetchMapirTsp({
      points: [
        { lat: 35.7008, lon: 51.4035 },
        { lat: 35.6949, lon: 51.4071 },
        { lat: 35.6953, lon: 51.4107 },
      ],
      roundtrip: false,
      source: "first",
      destination: "any",
    });
    assert.deepEqual(trip.order, [1, 0, 2]);
    assert.equal(calls[0].url.pathname, "/vrp/tsp/v1/driving/51.4035,35.7008;51.4071,35.6949;51.4107,35.6953");
    assert.equal(calls[0].url.searchParams.get("roundtrip"), "false");
    assert.equal(calls[0].url.searchParams.get("source"), "first");
    assert.equal(calls[0].url.searchParams.get("destination"), "any");
  });

  test("rejects a partial or unmatched optimizer response", async () => {
    mockFetch(() => json({ code: "Ok", waypoints: [{ location: [51.4035, 35.7008] }] }));
    await assert.rejects(
      () =>
        fetchMapirTsp({
          points: [
            { lat: 35.7008, lon: 51.4035 },
            { lat: 35.6949, lon: 51.4071 },
            { lat: 35.6953, lon: 51.4107 },
          ],
        }),
      /کامل نبود/,
    );

    clearMapirCache();
    mockFetch(() => json({ code: "Ok", waypoints: [{ location: [40.0, 10.0] }] }));
    await assert.rejects(
      () =>
        fetchMapirTsp({
          points: [
            { lat: 35.7008, lon: 51.4035 },
            { lat: 35.6949, lon: 51.4071 },
            { lat: 35.6953, lon: 51.4107 },
          ],
        }),
      /کامل نبود/,
    );
  });

  test("surfaces the documented NoTrips service code", async () => {
    mockFetch(() => json({ code: "NoTrips" }, 400));
    await assert.rejects(
      () =>
        fetchMapirTsp({
          points: [
            { lat: 35.7008, lon: 51.4035 },
            { lat: 35.6949, lon: 51.4071 },
            { lat: 35.6953, lon: 51.4107 },
          ],
        }),
      (error: unknown) => error instanceof MapirError,
    );
  });
});

describe("buildRoute with the Map.ir provider", () => {
  test("builds a TSP-ordered driving route with provider geometry and legs", async () => {
    const shops = shopsByIds(SHOP_IDS).shops;
    mockFetch((url) => {
      if (url.pathname.startsWith("/vrp/tsp/v1/driving")) {
        return json({
          code: "Ok",
          waypoints: [
            { location: [ORIGIN.lon, ORIGIN.lat] },
            { location: [shops[2].lon, shops[2].lat] },
            { location: [shops[0].lon, shops[0].lat] },
            { location: [shops[1].lon, shops[1].lat] },
          ],
        });
      }
      return json(routeBody({ legCount: 4 }));
    });

    const route = await buildRoute({
      shop_ids: [...SHOP_IDS, "shop_missing_demo"],
      origin: ORIGIN,
      mode: "car",
      optimize: true,
    });

    assert.equal(route.provider, "mapir");
    assert.equal(route.optimization, "tsp");
    assert.deepEqual(
      route.stops.map((stop) => stop.shop_id),
      [shops[2].shop_id, shops[0].shop_id, shops[1].shop_id],
    );
    assert.equal(route.distance_m, 2200);
    assert.equal(route.duration_s, 1320);
    assert.deepEqual(route.geometry[0], [51.40338, 35.70061]);
    assert.equal(route.excluded.length, 1);
    assert.match(route.optimization_note, /حریصانه|تقریبی/);

    const tspCall = calls.find((call) => call.url.pathname.startsWith("/vrp/tsp/v1/driving"));
    const routeCall = calls.find((call) => call.url.pathname.startsWith("/route/v1/driving"));
    assert.ok(tspCall && routeCall);
    // The driving route must run origin → ordered stops in the TSP order.
    assert.equal(
      routeCall.url.pathname,
      `/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${shops[2].lon},${shops[2].lat};${shops[0].lon},${shops[0].lat};${shops[1].lon},${shops[1].lat}`,
    );
  });

  test("walking routes never call TSP and use the foot profile", async () => {
    mockFetch(() => json(routeBody({ legCount: 3 })));
    const route = await buildRoute({ shop_ids: SHOP_IDS, origin: ORIGIN, mode: "walk", optimize: true });
    assert.equal(route.optimization, "nearest");
    assert.ok(!calls.some((call) => call.url.pathname.startsWith("/vrp/tsp")));
    assert.ok(calls[0].url.pathname.startsWith("/foot/v1/driving"));
    assert.equal(route.provider, "mapir");
  });

  test("motorcycle falls back to the car roads and says so", async () => {
    mockFetch(() => json(routeBody({ legCount: 1 })));
    const route = await buildRoute({ shop_ids: SHOP_IDS.slice(0, 1), origin: ORIGIN, mode: "motorcycle" });
    assert.ok(calls[0].url.pathname.startsWith("/route/v1/driving"));
    assert.ok(route.warnings.some((warning) => warning.includes("موتورسیکلت")));
  });

  test("return-to-origin closes the loop and requests a roundtrip TSP", async () => {
    const shops = shopsByIds(SHOP_IDS).shops;
    mockFetch((url) => {
      if (url.pathname.startsWith("/vrp/tsp/v1/driving")) {
        return json({
          code: "Ok",
          waypoints: [
            { location: [ORIGIN.lon, ORIGIN.lat] },
            { location: [shops[1].lon, shops[1].lat] },
            { location: [shops[2].lon, shops[2].lat] },
            { location: [shops[0].lon, shops[0].lat] },
          ],
        });
      }
      return json(routeBody({ legCount: 4 }));
    });

    const route = await buildRoute({
      shop_ids: SHOP_IDS,
      origin: ORIGIN,
      mode: "car",
      return_to_origin: true,
    });

    assert.equal(route.return_to_origin, true);
    const tspCall = calls.find((call) => call.url.pathname.startsWith("/vrp/tsp/v1/driving"));
    const routeCall = calls.find((call) => call.url.pathname.startsWith("/route/v1/driving"));
    assert.ok(tspCall && routeCall);
    assert.equal(tspCall.url.searchParams.get("roundtrip"), "true");
    assert.equal(tspCall.url.searchParams.get("destination"), "last");
    assert.ok(routeCall.url.pathname.endsWith(`;${ORIGIN.lon},${ORIGIN.lat}`));
  });

  test("falls back to the honest nearest order when TSP fails", async () => {
    mockFetch((url) => {
      if (url.pathname.startsWith("/vrp/tsp/v1/driving")) return json({ code: "NoTrips" }, 400);
      return json(routeBody({ legCount: 3 }));
    });
    const route = await buildRoute({ shop_ids: SHOP_IDS, origin: ORIGIN, mode: "car" });
    assert.equal(route.optimization, "nearest");
    assert.ok(route.warnings.some((warning) => warning.includes("بهینه‌سازی")));
    assert.equal(route.stops.length, 3);
  });

  test("missing server key fails honestly without calling the provider", async () => {
    delete process.env.MAPIR_API_KEY;
    mockFetch(() => json(routeBody({ legCount: 1 })));
    assert.equal(activeRouteProvider(), null);
    await assert.rejects(
      () => buildRoute({ shop_ids: SHOP_IDS.slice(0, 1), origin: ORIGIN, mode: "walk" }),
      (error: unknown) => {
        assert.ok(error instanceof RouteError);
        assert.equal(error.status, 503);
        assert.match(error.message, /MAPIR_API_KEY/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  test("provider failure never produces geometry and invalid input is rejected", async () => {
    mockFetch(() => json({ message: "quota exceeded" }, 403));
    await assert.rejects(
      () => buildRoute({ shop_ids: SHOP_IDS.slice(0, 1), origin: ORIGIN, mode: "walk" }),
      (error: unknown) => error instanceof RouteError && error.status === 502,
    );

    await assert.rejects(
      () => buildRoute({ shop_ids: SHOP_IDS, origin: { lat: 120, lon: 51 }, mode: "car" }),
      (error: unknown) => error instanceof RouteError && error.status === 400,
    );
    await assert.rejects(
      () => buildRoute({ shop_ids: [], origin: ORIGIN, mode: "car" }),
      (error: unknown) => error instanceof RouteError && error.status === 400,
    );
  });

  test("caches identical route requests", async () => {
    mockFetch(() => json(routeBody({ legCount: 1 })));
    const body = { shop_ids: SHOP_IDS.slice(0, 1), origin: ORIGIN, mode: "walk" as const };
    await buildRoute(body);
    await buildRoute(body);
    assert.equal(calls.length, 1);
  });
});
