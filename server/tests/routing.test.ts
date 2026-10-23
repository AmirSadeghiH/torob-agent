import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  NeshanError,
  clearNeshanCache,
  coordinateParam,
  fetchDirections,
  fetchTripOrder,
} from "../lib/neshan";
import { decodePolyline, isValidLatLon, polylineToGeoJson } from "../lib/polyline";
import { MAX_ROUTE_STOPS, RouteError, buildRoute } from "../routing";
import { shopsByIds } from "../repo";

/**
 * These tests never touch the network: `fetch` is replaced with a scripted
 * handler, so no Neshan quota or credential is needed.
 */

const KEY = "test-key-not-real";
const GOOGLE_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

/** Subtests that read real shop records skip when the dataset is not imported. */
const dbFile = process.env.HAMKHARID_DB
  ? path.resolve(process.env.HAMKHARID_DB)
  : path.resolve(process.cwd(), "data", "hamkharid.db");
const skipDb = existsSync(dbFile) && statSync(dbFile).size > 0
  ? false
  : "data/hamkharid.db is not imported (run npm run data:import)";
const ORIGIN = { lat: 35.7008, lon: 51.4035, label: "فردوسی" };

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

function directionBody(legCount = 2, extraRoutes = 0): unknown {
  const route = {
    overview_polyline: { points: GOOGLE_POLYLINE },
    legs: Array.from({ length: legCount }, (_, index) => ({
      summary: `خیابان ${index + 1}`,
      distance: { value: 400 + index * 100, text: "400 m" },
      duration: { value: 240 + index * 60, text: "4 min" },
      steps: [
        {
          instruction: "به سمت شمال بروید",
          distance: { value: 120 },
          duration: { value: 90 },
          type: "depart",
        },
      ],
    })),
  };
  const alternatives = Array.from({ length: extraRoutes }, () => ({
    overview_polyline: { points: GOOGLE_POLYLINE },
    legs: route.legs.map((leg) => ({
      ...leg,
      distance: { value: leg.distance.value + 300 },
      duration: { value: leg.duration.value + 120 },
    })),
  }));
  return { routes: [route, ...alternatives] };
}

beforeEach(() => {
  calls = [];
  clearNeshanCache();
  process.env.NESHAN_API_KEY = KEY;
  // Force the Neshan provider for these tests.
  delete process.env.MAPIR_API_KEY;
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NESHAN_API_KEY;
});

describe("polyline and coordinate helpers", () => {
  test("decodes the reference polyline into lat/lon pairs", () => {
    const points = decodePolyline(GOOGLE_POLYLINE);
    assert.equal(points.length, 3);
    assert.ok(Math.abs(points[0].lat - 38.5) < 1e-6);
    assert.ok(Math.abs(points[0].lon - -120.2) < 1e-6);
    assert.ok(Math.abs(points[2].lat - 43.252) < 1e-6);
    assert.ok(Math.abs(points[2].lon - -126.453) < 1e-6);
  });

  test("converts decoded points to GeoJSON [lon, lat] order", () => {
    const coordinates = polylineToGeoJson(GOOGLE_POLYLINE);
    assert.deepEqual(coordinates[0].map((value) => Math.round(value * 1000) / 1000), [-120.2, 38.5]);
    assert.deepEqual(coordinates[1].map((value) => Math.round(value * 1000) / 1000), [-120.95, 40.7]);
  });

  test("rejects truncated or invalid polylines instead of guessing", () => {
    assert.throws(() => decodePolyline("_p~iF"), /mid-value/);
    assert.throws(() => decodePolyline("!!!"), /invalid character/);
  });

  test("Neshan parameters use latitude,longitude", () => {
    assert.equal(coordinateParam({ lat: 35.7008, lon: 51.4035 }), "35.7008,51.4035");
    assert.throws(() => coordinateParam({ lat: 120, lon: 51 }), (error: unknown) => {
      assert.ok(error instanceof NeshanError);
      assert.equal(error.code, 470);
      return true;
    });
    assert.equal(isValidLatLon(35.7, 51.4), true);
    assert.equal(isValidLatLon(95, 51.4), false);
  });
});

describe("Neshan direction client", () => {
  test("sends pedestrian type, pipe-encoded waypoints and the Api-Key header", async () => {
    mockFetch(() => json(directionBody(3)));
    const routes = await fetchDirections({
      mode: "walk",
      origin: { lat: 35.7008, lon: 51.4035 },
      destination: { lat: 35.71, lon: 51.42 },
      waypoints: [{ lat: 35.705, lon: 51.41 }],
    });

    assert.equal(calls.length, 1);
    const url = calls[0].url;
    assert.equal(url.pathname, "/v4/direction");
    assert.equal(url.searchParams.get("origin"), "35.7008,51.4035");
    assert.equal(url.searchParams.get("destination"), "35.71,51.42");
    assert.equal(url.searchParams.get("waypoints"), "35.705,51.41");
    assert.equal(url.searchParams.get("type"), "pedestrian");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Api-Key"], KEY);

    assert.equal(routes.length, 1);
    assert.equal(routes[0].distance_m, 400 + 500 + 600);
    assert.equal(routes[0].duration_s, 240 + 300 + 360);
    assert.equal(routes[0].legs.length, 3);
    assert.equal(routes[0].geometry.length, 3);
  });

  test("uses car/motorcycle types with traffic options and parses alternatives", async () => {
    mockFetch(() => json(directionBody(2, 1)));
    const routes = await fetchDirections({
      mode: "motorcycle",
      origin: { lat: 35.7, lon: 51.4 },
      destination: { lat: 35.71, lon: 51.42 },
      avoidTrafficZone: true,
      alternative: true,
    });
    const url = calls[0].url;
    assert.equal(url.searchParams.get("type"), "motorcycle");
    assert.equal(url.searchParams.get("avoidTrafficZone"), "true");
    assert.equal(url.searchParams.get("alternative"), "true");
    assert.equal(routes.length, 2);
    assert.ok(routes[1].distance_m > routes[0].distance_m);
  });

  test("maps provider error codes to Persian messages without leaking the key", async () => {
    mockFetch(() => json({ error: "480", status: "KeyNotFound" }, 480));
    await assert.rejects(
      () =>
        fetchDirections({
          mode: "car",
          origin: { lat: 35.7, lon: 51.4 },
          destination: { lat: 35.71, lon: 51.42 },
        }),
      (error: unknown) => {
        assert.ok(error instanceof NeshanError);
        assert.equal(error.code, 480);
        assert.match(error.message, /کلید/);
        assert.ok(!error.message.includes(KEY));
        return true;
      },
    );
  });

  test("marks rate-limit failures retryable and treats empty routes as no-route", async () => {
    mockFetch(() => json({ status: "RateExceeded" }, 482));
    await assert.rejects(
      () =>
        fetchDirections({
          mode: "car",
          origin: { lat: 35.7, lon: 51.4 },
          destination: { lat: 35.71, lon: 51.42 },
        }),
      (error: unknown) => error instanceof NeshanError && error.retryable,
    );

    clearNeshanCache();
    mockFetch(() => json({ routes: [] }));
    await assert.rejects(
      () =>
        fetchDirections({
          mode: "car",
          origin: { lat: 35.7, lon: 51.4 },
          destination: { lat: 35.71, lon: 51.42 },
        }),
      (error: unknown) => error instanceof NeshanError && error.status === 404,
    );
  });

  test("rejects malformed upstream JSON instead of fabricating a route", async () => {
    mockFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await assert.rejects(
      () =>
        fetchDirections({
          mode: "walk",
          origin: { lat: 35.7, lon: 51.4 },
          destination: { lat: 35.71, lon: 51.42 },
        }),
      (error: unknown) => error instanceof NeshanError,
    );
  });
});

describe("Neshan trip optimization", () => {
  test("maps optimizer indices back to the original input order", async () => {
    mockFetch(() =>
      json({
        points: [
          { name: "ب", location: [51.42, 35.71], index: 2 },
          { name: "الف", location: [51.4035, 35.7008], index: 0 },
          { name: "پ", location: [51.41, 35.705], index: 1 },
        ],
      }),
    );
    const trip = await fetchTripOrder({
      points: [
        { lat: 35.7008, lon: 51.4035 },
        { lat: 35.705, lon: 51.41 },
        { lat: 35.71, lon: 51.42 },
      ],
      sourceIsAnyPoint: false,
      lastIsAnyPoint: true,
      roundTrip: false,
    });
    assert.deepEqual(trip.order, [2, 0, 1]);
    assert.equal(calls[0].url.pathname, "/v3/trip");
    assert.equal(calls[0].url.searchParams.get("sourceIsAnyPoint"), "false");
    assert.equal(calls[0].url.searchParams.get("roundTrip"), "false");
  });

  test("rejects an incomplete optimizer response", async () => {
    mockFetch(() => json({ points: [{ index: 1 }] }));
    await assert.rejects(
      () =>
        fetchTripOrder({
          points: [
            { lat: 35.7, lon: 51.4 },
            { lat: 35.71, lon: 51.41 },
            { lat: 35.72, lon: 51.42 },
          ],
        }),
      /کامل نبود/,
    );
  });
});

describe("buildRoute over dataset shops", () => {
  test("builds a TSP-ordered route with real legs, geometry and excluded ids", { skip: skipDb }, async () => {
    mockFetch((url) => {
      if (url.pathname === "/v3/trip") {
        return json({
          points: [
            { index: 0, location: [51.4035, 35.7008] },
            { index: 3, location: [51.4204, 35.6957] },
            { index: 1, location: [51.4071, 35.6949] },
            { index: 2, location: [51.4107, 35.6953] },
          ],
        });
      }
      return json(directionBody(4));
    });

    const route = await buildRoute({
      shop_ids: [...SHOP_IDS, "shop_missing_demo"],
      origin: ORIGIN,
      mode: "car",
      optimize: true,
    });

    const datasets = shopsByIds(SHOP_IDS).shops;
    assert.equal(route.optimization, "tsp");
    assert.deepEqual(
      route.stops.map((stop) => stop.shop_id),
      [datasets[2].shop_id, datasets[0].shop_id, datasets[1].shop_id],
    );
    assert.equal(route.stops[0].order, 1);
    assert.equal(route.distance_m, 400 + 500 + 600 + 700);
    assert.equal(route.duration_s, 240 + 300 + 360 + 420);
    assert.deepEqual(route.geometry[0].map((value) => Math.round(value * 1000) / 1000), [-120.2, 38.5]);
    assert.equal(route.excluded.length, 1);
    assert.equal(route.excluded[0].shop_id, "shop_missing_demo");
    assert.equal(route.provider, "neshan");
    assert.equal(route.return_to_origin, false);

    const tripCall = calls.find((call) => call.url.pathname === "/v3/trip");
    const directionCall = calls.find((call) => call.url.pathname === "/v4/direction");
    assert.ok(tripCall && directionCall);
    // Destination is the last optimized stop; the other stops are waypoints.
    assert.equal(directionCall.url.searchParams.get("destination"), "35.695329620242966,51.410700800954594");
    assert.equal(
      directionCall.url.searchParams.get("waypoints"),
      "35.695769,51.4204544|35.694991526310005,51.407137248405895",
    );
  });

  test("falls back to nearest-neighbour order when TSP is unavailable", { skip: skipDb }, async () => {
    mockFetch((url) => {
      if (url.pathname === "/v3/trip") return json({ error: "483", status: "ApiKeyTypeError" }, 483);
      return json(directionBody(3));
    });

    const route = await buildRoute({
      shop_ids: SHOP_IDS,
      origin: ORIGIN,
      mode: "car",
    });

    assert.equal(route.optimization, "nearest");
    assert.ok(route.warnings.some((warning) => warning.includes("بهینه‌سازی")));
    assert.equal(route.stops.length, 3);
    assert.equal(calls.filter((call) => call.url.pathname === "/v4/direction").length, 1);
  });

  test("walking routes never use the vehicle optimizer", { skip: skipDb }, async () => {
    mockFetch(() => json(directionBody(3)));
    const route = await buildRoute({
      shop_ids: SHOP_IDS,
      origin: ORIGIN,
      mode: "walk",
      optimize: true,
    });
    assert.equal(route.optimization, "nearest");
    assert.ok(!calls.some((call) => call.url.pathname === "/v3/trip"));
    assert.equal(calls[0].url.searchParams.get("type"), "pedestrian");
  });

  test("return-to-origin adds the closing leg and routes back to the start", { skip: skipDb }, async () => {
    mockFetch((url) => {
      if (url.pathname === "/v3/trip") {
        return json({
          points: [
            { index: 0 },
            { index: 2 },
            { index: 1 },
            { index: 3 },
          ],
        });
      }
      return json(directionBody(4));
    });

    const route = await buildRoute({
      shop_ids: SHOP_IDS,
      origin: ORIGIN,
      mode: "car",
      return_to_origin: true,
    });

    assert.equal(route.return_to_origin, true);
    const directionCall = calls.find((call) => call.url.pathname === "/v4/direction");
    assert.ok(directionCall);
    assert.equal(
      directionCall.url.searchParams.get("destination"),
      `${ORIGIN.lat},${ORIGIN.lon}`,
    );
    const tripCall = calls.find((call) => call.url.pathname === "/v3/trip");
    assert.ok(tripCall);
    assert.equal(tripCall.url.searchParams.get("roundTrip"), "true");
    assert.equal(tripCall.url.searchParams.get("lastIsAnyPoint"), "false");
  });

  test("missing server key fails honestly, without calling the provider", async () => {
    delete process.env.NESHAN_API_KEY;
    mockFetch(() => json(directionBody(1)));
    await assert.rejects(
      () =>
        buildRoute({
          shop_ids: SHOP_IDS.slice(0, 1),
          origin: ORIGIN,
          mode: "walk",
        }),
      (error: unknown) => {
        assert.ok(error instanceof RouteError);
        assert.equal(error.status, 503);
        assert.match(error.message, /NESHAN_API_KEY|کلید/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });

  test("provider failures surface as RouteError and never as geometry", { skip: skipDb }, async () => {
    mockFetch((url) => {
      if (url.pathname === "/v3/trip") return json({ error: "483" }, 483);
      return json({ error: "481", status: "LimitExceeded" }, 481);
    });
    await assert.rejects(
      () =>
        buildRoute({
          shop_ids: SHOP_IDS,
          origin: ORIGIN,
          mode: "car",
        }),
      (error: unknown) => {
        assert.ok(error instanceof RouteError);
        assert.equal(error.status, 503);
        assert.match(error.message, /سهمیه/);
        return true;
      },
    );
  });

  test("rejects an invalid origin and an empty shop list", async () => {
    await assert.rejects(
      () => buildRoute({ shop_ids: SHOP_IDS, origin: { lat: 120, lon: 51 }, mode: "car" }),
      (error: unknown) => error instanceof RouteError && error.status === 400,
    );
    await assert.rejects(
      () => buildRoute({ shop_ids: [], origin: ORIGIN, mode: "car" }),
      (error: unknown) => error instanceof RouteError && error.status === 400,
    );
  });

  test("caps the number of stops and reports the ones dropped", { skip: skipDb }, async () => {
    const ids = shopsByIds(SHOP_IDS).shops.map((shop) => shop.shop_id);
    const extras = [
      "shop_3f93a30a9e66c6dece07cdff",
      "shop_51d0c1a6edf81ba759726bab",
      "shop_9900a46f54a879ce260839bb",
    ];
    // Duplicate ids collapse, so the real cap needs distinct shops.
    const distinct = [...new Set([...ids, ...extras])];
    assert.ok(distinct.length <= MAX_ROUTE_STOPS);

    mockFetch((url) => {
      if (url.pathname === "/v3/trip") return json({ error: "483" }, 483);
      return json(directionBody(MAX_ROUTE_STOPS));
    });
    const route = await buildRoute({
      shop_ids: [...SHOP_IDS, "shop_extra_one", "shop_extra_two", "shop_extra_three"],
      origin: ORIGIN,
      mode: "car",
    });
    assert.equal(route.stops.length, 3);
    assert.equal(route.excluded.length, 3);
  });
});
