import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, MapPin, Navigation } from "lucide-react";
import type { MapPoint, Origin } from "@/shared/types";
import { cn } from "@/lib/utils";
import { distanceText, fa } from "@/lib/format";

interface TehranMapProps {
  points: MapPoint[];
  origin: Origin | null;
  routeOrder?: string[];
  className?: string;
  title?: string;
}

const W = 400;
const H = 300;
const PAD = 28;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * A schematic but metrically honest map: positions are projected from real
 * coordinates, so relative distance and direction are right. No tiles, so it
 * works offline and never leaks a request to a third-party map.
 */
export function TehranMap({ points, origin, routeOrder = [], className, title }: TehranMapProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [points]);

  const layout = useMemo(() => {
    const withCoords = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const all = origin
      ? [{ lat: origin.lat, lon: origin.lon }, ...withCoords]
      : withCoords;
    if (all.length === 0) return null;

    const lats = all.map((p) => p.lat);
    const lons = all.map((p) => p.lon);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const cos = Math.max(0.2, Math.cos(toRad(centerLat)));

    const unit = (p: { lat: number; lon: number }) => ({
      x: (p.lon - centerLon) * cos,
      y: (p.lat - centerLat) * -1,
    });

    let spanX = 0;
    let spanY = 0;
    for (const p of all) {
      const u = unit(p);
      spanX = Math.max(spanX, Math.abs(u.x));
      spanY = Math.max(spanY, Math.abs(u.y));
    }
    // Keep a 2 km floor so a single store does not fill the whole canvas.
    const floor = 0.009;
    spanX = Math.max(spanX * 1.35, floor);
    spanY = Math.max(spanY * 1.35, floor * (H / W));

    const scale = Math.min((W - PAD * 2) / (spanX * 2), (H - PAD * 2) / (spanY * 2));
    const place = (p: { lat: number; lon: number }) => {
      const u = unit(p);
      return { x: W / 2 + u.x * scale, y: H / 2 + u.y * scale };
    };
    const metersPerPixel = 111_320 / (scale * cos);
    const barMeters = metersPerPixel * 72 > 1500 ? 2000 : metersPerPixel * 72 > 700 ? 1000 : 500;
    const barWidth = barMeters / metersPerPixel;
    return { place, barMeters, barWidth, count: all.length };
  }, [points, origin]);

  if (!layout) {
    return (
      <div className="flex h-64 items-center justify-center rounded-surface border-line border-dashed border-border text-sm text-muted-foreground">
        نقطه‌ای برای نمایش روی نقشه نیست.
      </div>
    );
  }

  const selectedPoint = points.find((p) => p.id === selected) ?? null;

  return (
    <div className={cn("overflow-hidden rounded-surface border-line border-border bg-card", className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={title ?? "نقشهٔ شماتیک فروشگاه‌ها و نقطهٔ شروع"}
        >
          <rect x="0" y="0" width={W} height={H} className="fill-background" />
          <g className="stroke-border" strokeWidth={1}>
            {Array.from({ length: 7 }).map((_, i) => (
              <line key={`v${i}`} x1={PAD + (i * (W - PAD * 2)) / 6} y1={PAD} x2={PAD + (i * (W - PAD * 2)) / 6} y2={H - PAD} />
            ))}
            {Array.from({ length: 5 }).map((_, i) => (
              <line key={`h${i}`} x1={PAD} y1={PAD + (i * (H - PAD * 2)) / 4} x2={W - PAD} y2={PAD + (i * (H - PAD * 2)) / 4} />
            ))}
          </g>

          {origin && (
            <g>
              <circle cx={layout.place(origin).x} cy={layout.place(origin).y} r={13} className="fill-background stroke-brand" strokeWidth={1.5} />
              <circle cx={layout.place(origin).x} cy={layout.place(origin).y} r={5} className="fill-brand" />
              <text
                x={layout.place(origin).x}
                y={layout.place(origin).y - 18}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
              >
                {origin.label ?? "شروع"}
              </text>
            </g>
          )}

          {points.map((point) => {
            const { x, y } = layout.place(point);
            const order = routeOrder.indexOf(point.id);
            const isSelected = selected === point.id;
            return (
              <g
                key={point.id}
                role="button"
                tabIndex={0}
                aria-label={`${point.label}${point.distance_m !== null ? `، ${distanceText(point.distance_m)}` : ""}`}
                onClick={() => setSelected(point.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(point.id);
                  }
                }}
                className="cursor-pointer focus-visible:outline-none"
              >
                <circle cx={x} cy={y} r={16} fill="transparent" />
                {isSelected && <circle cx={x} cy={y} r={14} className="fill-brand/20" />}
                <circle
                  cx={x}
                  cy={y}
                  r={order >= 0 ? 10 : 6}
                  className={cn(
                    "stroke-background transition-colors",
                    isSelected ? "fill-brand" : "fill-foreground",
                  )}
                  strokeWidth={2}
                />
                {order >= 0 && (
                  <text x={x} y={y + 3} textAnchor="middle" className="fill-background text-xs font-bold">
                    {fa(order + 1)}
                  </text>
                )}
                {isSelected && (
                  <text x={x} y={y - 16} textAnchor="middle" className="fill-foreground text-xs">
                    {point.label.length > 22 ? `${point.label.slice(0, 22)}…` : point.label}
                  </text>
                )}
              </g>
            );
          })}

          <g transform={`translate(${W - 40} 24)`}>
            <line x1={0} y1={10} x2={0} y2={0} className="stroke-muted-foreground" strokeWidth={1.5} />
            <path d="M -4 4 L 0 0 L 4 4" className="fill-none stroke-muted-foreground" strokeWidth={1.5} />
            <text x={0} y={22} textAnchor="middle" className="fill-muted-foreground text-xs">
              شمال
            </text>
          </g>

          <g transform={`translate(${PAD} ${H - 14})`}>
            <line x1={0} y1={-4} x2={layout.barWidth} y2={-4} className="stroke-muted-foreground" strokeWidth={1.5} />
            <text x={layout.barWidth / 2} y={-8} textAnchor="middle" className="fill-muted-foreground text-xs">
              {layout.barMeters >= 1000 ? `${fa(layout.barMeters / 1000)} کیلومتر` : `${fa(layout.barMeters)} متر`}
            </text>
          </g>
        </svg>
      </div>

      <div className="border-t border-border px-4 py-3">
        {selectedPoint ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{selectedPoint.label}</p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-3.5" strokeWidth={1.5} aria-hidden />
                {selectedPoint.meta ?? "فروشگاه"}
                {selectedPoint.distance_m !== null && <span>· {distanceText(selectedPoint.distance_m)}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/s/${selectedPoint.id}`}
                className="inline-flex h-11 items-center rounded-control border-line border-border px-3 text-xs hover:bg-accent"
              >
                صفحهٔ فروشگاه
              </Link>
              {origin && (
                <a
                  href={`https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${origin.lat},${origin.lon};${selectedPoint.lat},${selectedPoint.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-1.5 rounded-control bg-brand px-3 text-xs font-medium text-brand-foreground"
                >
                  <Navigation className="size-3.5" strokeWidth={2} aria-hidden />
                  مسیر پیاده در نقشهٔ باز
                  <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            برای دیدن جزئیات، یک نقطه را انتخاب کنید. نقشه شماتیک است و خطوط، مسیر خیابان نیستند؛ فاصله‌ها خط مستقیم بین مختصات واقعی‌اند.
          </p>
        )}
      </div>
    </div>
  );
}
