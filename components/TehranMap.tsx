import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Locate, Loader2, MapPin, Navigation } from "lucide-react";
import rtlPluginUrl from "@mapbox/mapbox-gl-rtl-text/mapbox-gl-rtl-text.min.js?url";
import type { LonLat, MapPoint, Origin, TravelMode } from "@/shared/types";
import { cn } from "@/lib/utils";
import { distanceText, fa } from "@/lib/format";

/**
 * Real street map behind the existing `TehranMap` interface.
 *
 * Providers, in order of preference (see `.env.example`):
 *  - Map.ir vector tiles via `VITE_MAPIR_MAP_KEY` — loaded with plain
 *    MapLibre GL and authenticated with the documented `x-api-key` header.
 *  - Neshan tiles via `VITE_NESHAN_MAP_KEY` — loaded with the Neshan SDK.
 *  - otherwise an explicit Persian notice; never a schematic fallback.
 *
 * Markers come from dataset coordinates only. When the routing service
 * returned real geometry it is drawn as a GeoJSON line; without it there is
 * no line at all — a straight line is never substituted for a road route.
 */

export interface MapRouteGeometry {
  geometry: LonLat[];
  mode: TravelMode;
}

interface TehranMapProps {
  points: MapPoint[];
  origin: Origin | null;
  routeOrder?: string[];
  route?: MapRouteGeometry | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  title?: string;
  /** Bigger canvas for the plan page, smaller for chat cards. */
  size?: "compact" | "tall";
  showDetail?: boolean;
}

type MapModule = typeof import("maplibre-gl");
type MapInstance = InstanceType<MapModule["Map"]>;
type MarkerInstance = InstanceType<MapModule["Marker"]>;

const MAPIR_KEY = ((import.meta.env.VITE_MAPIR_MAP_KEY as string | undefined) ?? "").trim();
const NESHAN_KEY = ((import.meta.env.VITE_NESHAN_MAP_KEY as string | undefined) ?? "").trim();

export type MapProvider = "mapir" | "neshan";
const PROVIDER: MapProvider | null = MAPIR_KEY ? "mapir" : NESHAN_KEY ? "neshan" : null;
const PROVIDER_LABEL = PROVIDER === "mapir" ? "Map.ir" : PROVIDER === "neshan" ? "Neshan" : "";

const MAPIR_STYLE = `https://map.ir/vector/styles/main/mapir-xyz-style.json?x-api-key=${MAPIR_KEY}`;
const NESHAN_STYLE = "https://static.neshan.org/sdk/maplibre/styles/dark.json";
/** ترب‌یار red — MapLibre paint needs a concrete color, not a CSS variable. */
const ROUTE_COLOR = "#DF1723";
const LOAD_TIMEOUT_MS = 12_000;
/** MapLibre only accepts one RTL plugin registration per page. */
let rtlPluginRegistered = false;

type MapStatus = "idle" | "ready" | "error";

export function TehranMap({
  points,
  origin,
  routeOrder = [],
  route = null,
  selectedId,
  onSelect,
  className,
  title,
  size = "compact",
  showDetail = true,
}: TehranMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const moduleRef = useRef<MapModule | null>(null);
  const markersRef = useRef<MarkerInstance[]>([]);
  const fitKeyRef = useRef<string>("");
  const [status, setStatus] = useState<MapStatus>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [internalSelected, setInternalSelected] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const selected = selectedId !== undefined ? selectedId : internalSelected;

  const placeable = useMemo(
    () =>
      points.filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lon) &&
          Math.abs(point.lat) <= 90 &&
          Math.abs(point.lon) <= 180,
      ),
    [points],
  );

  const center = useMemo<[number, number]>(() => {
    if (origin) return [origin.lon, origin.lat];
    if (placeable[0]) return [placeable[0].lon, placeable[0].lat];
    return [51.389, 35.6892];
  }, [origin, placeable]);

  const select = useCallback(
    (id: string | null) => {
      if (selectedId === undefined) setInternalSelected(id);
      onSelect?.(id);
    },
    [onSelect, selectedId],
  );

  /* --------------------------------------------------------------- map init */
  useEffect(() => {
    if (!PROVIDER || !containerRef.current) return;
    let disposed = false;
    let disposer: (() => void) | null = null;

    const container = containerRef.current;
    let map: MapInstance;

    (async () => {
      let module: MapModule;
      try {
        if (PROVIDER === "mapir") {
          module = await import("maplibre-gl");
          await import("maplibre-gl/dist/maplibre-gl.css");
          if (!rtlPluginRegistered) {
            rtlPluginRegistered = true;
            // Persian/Arabic label shaping for the Map.ir vector style.
            module.setRTLTextPlugin(rtlPluginUrl, true).catch(() => {
              /* the plugin failed to load; labels stay unshaped */
            });
          }
          map = new module.Map({
            container,
            style: MAPIR_STYLE,
            center,
            zoom: 13.5,
            minZoom: 5,
            maxZoom: 20,
            transformRequest: (url: string) =>
              url.includes("map.ir") ? { url, headers: { "x-api-key": MAPIR_KEY } } : { url },
          });
        } else {
          const neshan = await import("@neshan-maps-platform/maplibre-sdk");
          await import("@neshan-maps-platform/maplibre-sdk/style.css");
          module = neshan as unknown as MapModule;
          map = new neshan.Map({
            container,
            style: NESHAN_STYLE,
            center,
            zoom: 13.5,
            minZoom: 5,
            maxZoom: 20,
            apiKey: NESHAN_KEY,
            rtl: { lazy: false },
          });
        }
      } catch {
        if (disposed) return;
        setStatus("error");
        setErrorText("مرورگر نتوانست نقشه را راه‌اندازی کند (WebGL در دسترس نیست یا ماژول نقشه بارگذاری نشد).");
        return;
      }

      if (disposed) {
        map.remove();
        return;
      }

      moduleRef.current = module;
      mapRef.current = map;
      setStatus("idle");

      const timeout = window.setTimeout(() => {
        if (!disposed && !map.loaded()) {
          setStatus("error");
          setErrorText("بارگذاری نقشه بیش از حد طول کشید. اتصال شبکه را بررسی کنید.");
        }
      }, LOAD_TIMEOUT_MS);

      map.on("load", () => {
        if (disposed) return;
        window.clearTimeout(timeout);
        setStatus("ready");
        setErrorText(null);
        map.resize();
      });

      map.on("error", (event: unknown) => {
        if (disposed) return;
        const message =
          event && typeof event === "object" && "error" in event
            ? String((event as { error?: { message?: string } }).error?.message ?? "")
            : "";
        if (/401|403|483|key|unauthor|forbidden|style/i.test(message)) {
          setStatus("error");
          setErrorText(
            /483/.test(message)
              ? "کلید نقشه برای این سرویس مجاز نیست (نوع کلید اشتباه است؛ کلید «نقشهٔ وب/Web map» لازم است)."
              : /401|403|key|unauthor|forbidden/i.test(message)
                ? `کلید نقشه ${PROVIDER_LABEL} معتبر نیست یا برای این دامنه مجاز نشده است.`
                : `بارگذاری نقشهٔ ${PROVIDER_LABEL} ناموفق بود.`,
          );
        }
      });

      map.addControl(new module.NavigationControl({ showCompass: true }), "top-left");

      const resizeObserver = new ResizeObserver(() => {
        if (!disposed) map.resize();
      });
      resizeObserver.observe(container);

      disposer = () => {
        window.clearTimeout(timeout);
        resizeObserver.disconnect();
        map.remove();
      };
    })();

    return () => {
      disposed = true;
      // If the module was still loading when we unmounted, remove the map as
      // soon as it finishes; otherwise tear it down right away. This keeps
      // React Strict Mode's double-mount from leaving two instances behind.
      disposer?.();
      disposer = null;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current = null;
      moduleRef.current = null;
    };
    // The map instance is created once per provider/key; props are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PROVIDER, MAPIR_KEY, NESHAN_KEY]);

  /* --------------------------------------------------------------- markers */
  useEffect(() => {
    const map = mapRef.current;
    const module = moduleRef.current;
    if (!map || !module || status !== "ready") return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const addMarker = (element: HTMLElement, lon: number, lat: number) => {
      const marker = new module.Marker({ element, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
      markersRef.current.push(marker);
    };

    if (origin) {
      const element = document.createElement("div");
      element.className =
        "relative flex size-11 items-center justify-center rounded-full border-2 border-brand bg-card text-brand shadow-lg";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML =
        '<span class="absolute inline-flex size-11 animate-ping rounded-full bg-brand/30"></span>' +
        '<span class="relative flex size-5 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">ش</span>';
      element.title = `نقطهٔ شروع: ${origin.label ?? "فردوسی"}`;
      addMarker(element, origin.lon, origin.lat);
    }

    for (const point of placeable) {
      const order = routeOrder.indexOf(point.id);
      const isSelected = point.id === selected;
      const element = document.createElement("button");
      element.type = "button";
      element.setAttribute(
        "aria-label",
        `${order >= 0 ? `ایست ${fa(order + 1)}: ` : ""}${point.label}${
          point.distance_m !== null ? `، ${distanceText(point.distance_m)}` : ""
        }`,
      );
      element.title = point.label;
      const base =
        "flex size-9 items-center justify-center rounded-full border-2 text-xs font-bold shadow-lg transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
      element.className = isSelected
        ? `${base} scale-110 border-brand bg-brand text-brand-foreground`
        : `${base} border-card bg-foreground text-background hover:scale-105`;
      element.textContent = order >= 0 ? fa(order + 1) : "•";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        select(point.id);
        map.flyTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
      });
      addMarker(element, point.lon, point.lat);
    }
  }, [status, placeable, origin, routeOrder, selected, select]);

  /* ---------------------------------------------------------------- route */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    const coordinates = route?.geometry ?? [];
    const existing = map.getSource("route") as { setData: (data: unknown) => void } | undefined;

    if (coordinates.length < 2) {
      if (existing) {
        if (map.getLayer("route-line")) map.removeLayer("route-line");
        if (map.getLayer("route-casing")) map.removeLayer("route-casing");
        map.removeSource("route");
      }
      return;
    }

    const data = {
      type: "Feature" as const,
      properties: { mode: route?.mode ?? "walk" },
      geometry: { type: "LineString" as const, coordinates },
    };

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 9, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": 5 },
      });
    }
  }, [route, status]);

  /* ------------------------------------------------------------------ fit */
  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const coords: [number, number][] = [];
    if (origin) coords.push([origin.lon, origin.lat]);
    for (const point of placeable) coords.push([point.lon, point.lat]);
    if (route?.geometry) coords.push(...route.geometry);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: 15 });
      return;
    }
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 56, maxZoom: 16, duration: 500 },
    );
  }, [origin, placeable, route, status]);

  useEffect(() => {
    if (status !== "ready") return;
    const key = `${placeable.map((p) => p.id).join(",")}|${origin?.lat ?? ""},${origin?.lon ?? ""}|${
      route?.geometry.length ?? 0
    }|${fitNonce}`;
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;
    fitAll();
  }, [status, placeable, origin, route, fitNonce, fitAll]);

  const selectedPoint = placeable.find((point) => point.id === selected) ?? null;
  const hasPoints = placeable.length > 0 || Boolean(origin);

  if (!PROVIDER) {
    return (
      <MapShell className={className} title={title} size={size}>
        <EmptyState
          tone="error"
          title="نقشهٔ تعاملی فعال نیست"
          body="کلید نقشهٔ وب تنظیم نشده است (VITE_MAPIR_MAP_KEY برای Map.ir یا VITE_NESHAN_MAP_KEY برای Neshan). بدون کلید، نقشه یا مسیر ساختگی نمایش داده نمی‌شود."
        />
      </MapShell>
    );
  }

  if (!hasPoints) {
    return (
      <MapShell className={className} title={title} size={size}>
        <EmptyState
          tone="muted"
          title="نقطه‌ای برای نمایش روی نقشه نیست"
          body="مختصات این فروشگاه‌ها در دیتاست ثبت نشده است؛ موقعیت آن‌ها حدس زده نمی‌شود."
        />
      </MapShell>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-surface border-line border-border bg-card", className)}>
      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label={title ?? `نقشهٔ ${PROVIDER_LABEL} — فروشگاه‌ها، مسیر و نقطهٔ شروع`}
          className={cn(
            "w-full bg-secondary",
            size === "tall" ? "h-[380px] sm:h-[460px] lg:h-[520px]" : "h-[320px] sm:h-[380px]",
          )}
        />
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 px-6 text-center">
            {status === "error" ? (
              <>
                <AlertTriangle className="size-5 text-warning" strokeWidth={1.5} aria-hidden />
                <p className="text-sm text-warning" role="alert">
                  {errorText ?? "بارگذاری نقشه ناموفق بود."}
                </p>
                <p className="text-xs text-muted-foreground">
                  بررسی کنید کلید نقشه برای دامنهٔ {window.location.host} مجاز باشد.
                </p>
              </>
            ) : (
              <>
                <Loader2 className="size-5 animate-spin text-brand" strokeWidth={2} aria-hidden />
                <p className="text-sm text-muted-foreground">در حال بارگذاری نقشهٔ {PROVIDER_LABEL}…</p>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setFitNonce((value) => value + 1)}
          className="absolute bottom-3 start-3 z-10 flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control border-line border-border bg-card/95 px-3 text-xs font-medium text-foreground shadow-float backdrop-blur hover:bg-accent"
          aria-label="نمایش همهٔ نقاط و مسیر"
        >
          <Locate className="size-4" strokeWidth={1.5} aria-hidden />
          نمای کامل
        </button>
      </div>

      {showDetail && (
        <div className="border-t border-border px-4 py-3">
          {selectedPoint ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selectedPoint.label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {selectedPoint.meta ?? "فروشگاه"}
                  {selectedPoint.distance_m !== null && (
                    <span dir="rtl">· {distanceText(selectedPoint.distance_m)}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/s/${selectedPoint.id}`}
                  className="inline-flex h-11 items-center rounded-control border-line border-border px-3 text-xs hover:bg-accent"
                >
                  صفحهٔ فروشگاه
                </Link>
                <Link
                  to="/plan"
                  className="inline-flex h-11 items-center gap-1.5 rounded-control bg-brand px-3 text-xs font-medium text-brand-foreground"
                >
                  <Navigation className="size-3.5" strokeWidth={2} aria-hidden />
                  مسیریابی
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-6 text-muted-foreground">
              یک نشانگر را انتخاب کنید تا نام و فاصلهٔ خط مستقیم آن دیده شود. مسیر خیابانی در صفحهٔ
              «برنامهٔ خرید» از سرویس مسیریابی {PROVIDER_LABEL} گرفته می‌شود.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MapShell({
  children,
  className,
  title,
  size,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  size: "compact" | "tall";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-surface border-line border-border bg-card",
        size === "tall" ? "min-h-[320px] sm:min-h-[380px]" : "min-h-64",
        className,
      )}
      role="region"
      aria-label={title ?? "نقشه"}
    >
      {children}
    </div>
  );
}

function EmptyState({
  tone,
  title,
  body,
}: {
  tone: "error" | "muted";
  title: string;
  body: string;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-2 px-6 py-10 text-center">
      <AlertTriangle
        className={cn("size-5", tone === "error" ? "text-warning" : "text-muted-foreground")}
        strokeWidth={1.5}
        aria-hidden
      />
      <p className={cn("text-sm font-medium", tone === "error" ? "text-warning" : "text-foreground")}>
        {title}
      </p>
      <p className="text-xs leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
