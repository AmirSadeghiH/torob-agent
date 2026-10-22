/**
 * Google/Neshan encoded-polyline decoding.
 *
 * Neshan (like Google) encodes `latitude,longitude` pairs with 1e5 precision.
 * GeoJSON and MapLibre expect `[longitude, latitude]`, so the conversion lives
 * in one place instead of being repeated at call sites.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Decodes an encoded polyline (default Google precision 1e5) into ordered points. */
export function decodePolyline(encoded: string, precision = 1e5): LatLon[] {
  if (typeof encoded !== "string") throw new Error("polyline must be a string");
  if (precision <= 0) throw new Error("precision must be positive");
  if (encoded.length === 0) return [];

  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    const latResult = decodeValue(encoded, index);
    index = latResult.next;
    const lonResult = decodeValue(encoded, index);
    index = lonResult.next;

    lat += latResult.value;
    lon += lonResult.value;

    const latDeg = lat / precision;
    const lonDeg = lon / precision;
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
      throw new Error("polyline contains a non-numeric coordinate");
    }
    if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) {
      throw new Error("polyline coordinate out of range");
    }
    points.push({ lat: latDeg, lon: lonDeg });
  }

  return points;
}

function decodeValue(encoded: string, start: number): { value: number; next: number } {
  let index = start;
  let shift = 0;
  let result = 0;
  let byte: number;

  do {
    if (index >= encoded.length) throw new Error("polyline ended mid-value");
    byte = encoded.charCodeAt(index++) - 63;
    if (byte < 0 || byte > 63) throw new Error("polyline contains an invalid character");
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (shift > 30) throw new Error("polyline value is too large");
  } while (byte >= 0x20);

  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
}

/** `{lat, lon}` → GeoJSON `[lon, lat]` (MapLibre order). */
export function toLonLat(point: LatLon): [number, number] {
  return [point.lon, point.lat];
}

/** Decoded polyline (precision 1e5) → GeoJSON LineString coordinate list. */
export function polylineToGeoJson(encoded: string): [number, number][] {
  return decodePolyline(encoded).map(toLonLat);
}

/** Validates a coordinate pair in the ranges both APIs agree on. */
export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
