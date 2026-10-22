import type { Origin, Plan, PlanItem, PlanStop } from "../shared/types";
import { ageDays, freshnessOf } from "./lib/freshness";
import { fa, faNumber } from "./lib/text";
import { VISIT_MINUTES_PER_STOP, WALK_SPEED_M_PER_MIN, orderStops } from "./lib/geo";
import { offersForPlan } from "./repo";

interface Group {
  shop: PlanStop["shop"];
  items: PlanItem[];
  lat: number | null;
  lon: number | null;
}

/**
 * Groups chosen offers by shop, orders the shops as a walkable route from the
 * origin, and surfaces what could go wrong (stale price, far stop, split areas).
 * Distances are straight-line between coordinates, never street routing.
 */
export function buildPlan(offerIds: string[], origin: Origin): Plan | null {
  const rows = offersForPlan(offerIds, origin);
  if (rows.length === 0) return null;

  const groups = new Map<string, Group>();
  for (const row of rows) {
    let group = groups.get(row.shop.shop_id);
    if (!group) {
      group = { shop: row.shop, items: [], lat: row.shop.lat, lon: row.shop.lon };
      groups.set(row.shop.shop_id, group);
    }
    group.items.push({
      offer_id: row.offer_id,
      product_id: row.product_id,
      title: row.title,
      price: row.price,
      age_days: ageDays(row.changed_at),
      freshness: freshnessOf(row.changed_at),
      image: row.image,
    });
  }

  const ordered = orderStops(origin, [...groups.values()]);
  const stops: PlanStop[] = ordered.map(({ stop, legM }, index) => {
    const subtotal = stop.items.reduce((sum, i) => sum + i.price, 0);
    const ages = stop.items.map((i) => i.age_days).filter((a): a is number => a !== null);
    return {
      order: index + 1,
      shop: { ...stop.shop, distance_m: stop.shop.distance_m },
      items: stop.items,
      subtotal,
      oldest_age_days: ages.length > 0 ? Math.max(...ages) : null,
      distance_from_prev_m: legM,
      leg_minutes: legM === null ? null : Math.max(1, Math.round(legM / WALK_SPEED_M_PER_MIN)),
    };
  });

  const total = stops.reduce((sum, s) => sum + s.subtotal, 0);
  const totalDistance = stops.reduce((sum, s) => sum + (s.distance_from_prev_m ?? 0), 0);
  const itemCount = stops.reduce((sum, s) => sum + s.items.length, 0);
  const neighborhoods = [...new Set(stops.map((s) => s.shop.neighborhood).filter((n): n is string => Boolean(n)))];
  const staleCount = stops.reduce(
    (n, s) => n + s.items.filter((i) => i.freshness === "stale" || i.freshness === "old").length,
    0,
  );
  const warnings: string[] = [];
  if (staleCount > 0) {
    warnings.push(
      `قیمت ${fa(staleCount)} قلم قدیمی‌تر از یک ماه است؛ پیش از رفتن، قیمت و موجودی را از منبع دیگری بررسی کنید.`,
    );
  }
  if (stops.length >= 4) {
    warnings.push("چهار ایست یا بیشتر در یک روز خسته‌کننده می‌شود؛ اگر شد، خرید را دو نوبت کنید.");
  }
  if (totalDistance > 5000) {
    warnings.push(
      `فاصلهٔ خط مستقیم ایست‌ها حدود ${fa(Math.round(totalDistance / 1000))} کیلومتر است؛ مسافت واقعی خیابان بیشتر می‌شود، برای بخشی از مسیر تاکسی بگیرید.`,
    );
  }
  if (neighborhoods.length > 1) {
    warnings.push(`خرید در ${fa(neighborhoods.length)} محله پخش شده است: ${neighborhoods.join("، ")}.`);
  }
  if (warnings.length === 0) {
    warnings.push("فاصلهٔ مستقیم ایست‌ها کم است و تاریخ قیمت‌ها تازه است؛ مسیر آمادهٔ رفتن است.");
  }

  return {
    origin,
    stops,
    item_count: itemCount,
    total,
    total_distance_m: totalDistance,
    walk_minutes: Math.max(1, Math.round(totalDistance / WALK_SPEED_M_PER_MIN)),
    visit_minutes:
      Math.max(1, Math.round(totalDistance / WALK_SPEED_M_PER_MIN)) +
      VISIT_MINUTES_PER_STOP * stops.length,
    warnings,
    neighborhoods,
  };
}

export function planSummary(plan: Plan): string {
  const shopCount = plan.stops.length;
  return `${fa(shopCount)} فروشگاه، ${fa(plan.item_count)} قلم، جمع ${faNumber(plan.total)} تومان؛ تخمین حدود ${fa(plan.visit_minutes)} دقیقه بر پایهٔ فاصلهٔ خط مستقیم.`;
}
