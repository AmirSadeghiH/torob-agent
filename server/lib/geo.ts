import type { Origin } from "../../shared/types";

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function distanceLabel(meters: number | null): string {
  if (meters === null) return "فاصله نامشخص";
  if (meters < 950) return `${Math.max(50, Math.round(meters / 50) * 50).toLocaleString("fa-IR")} متر`;
  return `${(meters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر`;
}

/** Bounding box for a radius query, used as a cheap SQL prefilter. */
export function bbox(origin: Origin, radiusM: number) {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.2, Math.cos(toRad(origin.lat)));
  return {
    minLat: origin.lat - dLat,
    maxLat: origin.lat + dLat,
    minLon: origin.lon - dLon,
    maxLon: origin.lon + dLon,
  };
}

/** Nearest-neighbour ordering; returns stops plus the leg before each one. */
export function orderStops<T extends { lat: number | null; lon: number | null }>(
  origin: Origin,
  stops: T[],
): { stop: T; legM: number | null }[] {
  let current = origin;
  const remaining = [...stops];
  const ordered: { stop: T; legM: number | null }[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      if (stop.lat === null || stop.lon === null) return;
      const d = haversineMeters(current, { lat: stop.lat, lon: stop.lon });
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    const legM =
      next.lat !== null && next.lon !== null
        ? haversineMeters(current, { lat: next.lat, lon: next.lon })
        : null;
    ordered.push({ stop: next, legM });
    if (next.lat !== null && next.lon !== null) {
      current = { lat: next.lat, lon: next.lon };
    }
  }
  return ordered;
}

export const WALK_SPEED_M_PER_MIN = 75; // ≈ 4.5 km/h on Tehran pavements
export const VISIT_MINUTES_PER_STOP = 15;
