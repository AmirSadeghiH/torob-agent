import assert from "node:assert/strict";
import test from "node:test";
import { DAY_MS, FRESHNESS_TEXT, ageDays, freshnessOf, isoDaysAgo } from "../lib/freshness";
import { shopDisplayName, shopIdentity, shopShortCode } from "../lib/identity";
import { bbox, distanceLabel, haversineMeters, orderStops } from "../lib/geo";
import { dayHours, openNow } from "../lib/hours";
import { parseMessage, extractBudget } from "../nlu";
import { scoreOffer } from "../reliability";
import type { AssistantContext, Origin } from "../../shared/types";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const TEHRAN: Origin = { lat: 35.7005, lon: 51.4195, label: "فردوسی", neighborhood: "فردوسی" };

const vocab = {
  categories: ["هدفون", "گوشی موبایل", "دوربین مدار بسته", "مبل"],
  brands: ["سامسونگ", "اپل"],
  neighborhoods: ["فردوسی", "شیخ هادی", "تجریش"],
};

test("freshness buckets follow the documented thresholds", () => {
  assert.equal(freshnessOf(isoDaysAgo(0, NOW), NOW), "fresh");
  assert.equal(freshnessOf(isoDaysAgo(7, NOW), NOW), "fresh");
  assert.equal(freshnessOf(isoDaysAgo(8, NOW), NOW), "recent");
  assert.equal(freshnessOf(isoDaysAgo(30, NOW), NOW), "recent");
  assert.equal(freshnessOf(isoDaysAgo(31, NOW), NOW), "stale");
  assert.equal(freshnessOf(isoDaysAgo(90, NOW), NOW), "stale");
  assert.equal(freshnessOf(isoDaysAgo(91, NOW), NOW), "old");
});

test("freshness tolerates missing, malformed and future timestamps", () => {
  assert.equal(ageDays(null, NOW), null);
  assert.equal(freshnessOf(null, NOW), "unknown");
  assert.equal(freshnessOf("not-a-date", NOW), "unknown");
  assert.equal(ageDays(new Date(NOW + 5 * DAY_MS).toISOString(), NOW), 0);
});

test("haversine matches a known Tehran distance", () => {
  assert.equal(haversineMeters(TEHRAN, TEHRAN), 0);
  // فردوسی → تجریش is ≈ 11.5 km straight line.
  const ferdowsiToTajrish = haversineMeters(TEHRAN, { lat: 35.8044, lon: 51.4316 });
  assert.ok(ferdowsiToTajrish > 11_400 && ferdowsiToTajrish < 11_700, `got ${ferdowsiToTajrish}`);
});

test("distance labels switch from meters to kilometers", () => {
  assert.equal(distanceLabel(480), "۵۰۰ متر");
  assert.equal(distanceLabel(61), "۵۰ متر");
  assert.ok(distanceLabel(2_340).includes("۲٫۳") || distanceLabel(2_340).includes("۲.۳"));
  assert.equal(distanceLabel(null), "فاصله نامشخص");
});

test("bounding box contains the origin and covers the radius", () => {
  const box = bbox(TEHRAN, 1_000);
  assert.ok(box.minLat < TEHRAN.lat && box.maxLat > TEHRAN.lat);
  assert.ok(box.minLon < TEHRAN.lon && box.maxLon > TEHRAN.lon);
  assert.ok(haversineMeters(TEHRAN, { lat: box.maxLat, lon: TEHRAN.lon }) <= 1_010);
});

test("stops are ordered nearest-first and legs chain", () => {
  const ordered = orderStops(TEHRAN, [
    { id: "far", lat: 35.78, lon: 51.44 },
    { id: "near", lat: 35.703, lon: 51.42 },
    { id: "mid", lat: 35.72, lon: 51.43 },
    { id: "nocoords", lat: null, lon: null },
  ]);
  assert.equal(ordered.length, 4);
  assert.deepEqual(
    ordered.slice(0, 3).map((o) => o.stop.id),
    ["near", "mid", "far"],
  );
  assert.equal(ordered[3]?.stop.id, "nocoords");
  assert.equal(ordered[3]?.legM, null);
  const far = ordered[2]!;
  assert.ok(far.legM !== null && far.legM > 0);
});

test("weekly hours parse into shifts and evaluate open state", () => {
  const raw = {
    sat: { status: "declared", shifts: [{ start_time: "09:00:00", end_time: "18:00:00" }] },
    sun: { status: "closed", shifts: [] },
    mon: { status: "unsupported" },
  };
  const sat = dayHours(raw, "sat");
  assert.deepEqual(sat, { status: "declared", shifts: [{ start: "09:00", end: "18:00" }] });
  assert.equal(openNow(sat, 10 * 60), true);
  assert.equal(openNow(sat, 18 * 60), false);
  assert.equal(openNow(dayHours(raw, "sun"), 10 * 60), false);
  assert.equal(openNow(dayHours(raw, "mon"), 10 * 60), null);
  assert.equal(openNow(null, 600), null);

  const overnight = { status: "declared" as const, shifts: [{ start: "22:00", end: "02:00" }] };
  assert.equal(openNow(overnight, 23 * 60), true);
  assert.equal(openNow(overnight, 60), true);
  assert.equal(openNow(overnight, 12 * 60), false);
});

test("budgets understand millions, thousands and ranges", () => {
  assert.equal(extractBudget("هدفون زیر ۵ میلیون").max, 5_000_000);
  assert.equal(extractBudget("تا ۲۰ ملیون تومان").max, 20_000_000);
  assert.equal(extractBudget("بودجه ۱٬۵۰۰٬۰۰۰ تومان").max, 1_500_000);
  const range = extractBudget("بین ۱۰ تا ۲۰ میلیون");
  assert.equal(range.min, 10_000_000);
  assert.equal(range.max, 20_000_000);
});

test("greetings never match a category by accident", () => {
  const parsed = parseMessage("سلام", vocab);
  assert.equal(parsed.intent, "greeting");
  assert.equal(parsed.category, null);
});

test("search queries resolve category, brand and budget", () => {
  const parsed = parseMessage("هدفون بی‌سیم زیر ۵ میلیون", vocab);
  assert.equal(parsed.intent, "search");
  assert.equal(parsed.category, "هدفون");
  assert.equal(parsed.max_price, 5_000_000);

  const phone = parseMessage("گوشی سامسونگ تا ۲۰ میلیون ارزان‌ترین", vocab);
  assert.equal(phone.category, "گوشی موبایل");
  assert.equal(phone.brand, "سامسونگ");
  assert.equal(phone.max_price, 20_000_000);
  assert.equal(phone.sort, "price_asc");
});

test("budget keywords do not leak into the free-text query", () => {
  const parsed = parseMessage("دوربین مدار بسته زیر ۳ میلیون در تجریش", vocab);
  assert.equal(parsed.category, "دوربین مدار بسته");
  assert.equal(parsed.neighborhood, "تجریش");
  assert.equal(parsed.max_price, 3_000_000);
  assert.ok(!/میلیون/.test(parsed.q ?? ""));
});

test("plural forms still resolve to their category", () => {
  const parsed = parseMessage("ارزان‌ترین هدفون‌ها", vocab);
  assert.equal(parsed.category, "هدفون");
  assert.equal(parsed.sort, "price_asc");
  assert.equal(parsed.q, null);
});

test("unrecognised product words survive as a free-text query", () => {
  const parsed = parseMessage("پنکه رومیزی", vocab);
  assert.equal(parsed.intent, "search");
  assert.equal(parsed.q, "پنکه رومیزی");
});

test("intents cover plan, nearby, freshness and help", () => {
  assert.equal(parseMessage("برنامهٔ خرید بچین", vocab).intent, "plan");
  assert.equal(parseMessage("نزدیک‌ترین فروشگاه دوربین مدار بسته", vocab).intent, "stores");
  assert.equal(parseMessage("قیمت این کالا تازه است؟", vocab).intent, "freshness");
  assert.equal(parseMessage("چه کار می‌کنی؟", vocab).intent, "help");
});

test("compare and alternatives need a product context", () => {
  const context: AssistantContext = { product_id: "p1", offer_ids: ["o1"] };
  assert.equal(parseMessage("گزینه‌های ارزان‌تر", vocab, context).intent, "alternatives");
  assert.equal(parseMessage("گزینهٔ ارزان‌تر جایگزین کن", vocab, context).intent, "alternatives");
  assert.equal(parseMessage("این کالا را با مشابه‌ها مقایسه کن", vocab, context).intent, "compare");
  // Without an open product, «ارزان‌تر» must stay a plain cheaper-first search.
  assert.equal(parseMessage("هدفون ارزان‌تر", vocab).intent, "search");
});

test("only shops with a registered site or handle keep their recorded name", () => {
  assert.equal(shopIdentity("https://example.com", null), "registered");
  assert.equal(shopIdentity(null, "https://instagram.com/x"), "registered");
  assert.equal(shopIdentity("null", "null"), "anonymized");
  assert.equal(shopIdentity("", null), "anonymized");
  assert.equal(shopIdentity(null, null), "anonymized");

  assert.equal(shopDisplayName("shop_51d0c1a6edf81ba759726bab", "موبایل تخت جمشید", true), "موبایل تخت جمشید");
});

test("anonymised shops get an explicit label with a stable short id", () => {
  const id = "shop_3f93a30a9e66c6dece07cdff";
  const name = shopDisplayName(id, "فرورا رویس", false);
  assert.equal(name, "فروشگاه ناشناس‌شده #E07CDFF");
  assert.equal(shopShortCode(id), "E07CDFF");
  assert.equal(shopDisplayName(id, "فرورا رویس", false), name);
  assert.ok(name.includes("ناشناس"));

  const ids = Array.from({ length: 300 }, (_, i) => `shop_${i.toString(16).padStart(24, "0")}`);
  assert.equal(new Set(ids.map(shopShortCode)).size, ids.length);
});

test("reliability scores freshness and completeness of the record", () => {
  const base = {
    warranty: "۱۸ ماه گارانتی",
    description: "توضیحات کامل کالا",
    market: { min: 9_000_000, median: 10_000_000, second_min: 9_500_000, offer_count: 8 },
    now: NOW,
  };
  const shop = {
    has_hours: true,
    has_website: true,
    has_instagram: true,
    has_address: true,
    has_coords: true,
  };
  const fresh = scoreOffer({ ...base, price: 10_000_000, changed_at: isoDaysAgo(1, NOW), shop });
  const old = scoreOffer({ ...base, price: 10_000_000, changed_at: isoDaysAgo(200, NOW), shop });
  const bare = scoreOffer({
    ...base,
    price: 10_000_000,
    changed_at: isoDaysAgo(200, NOW),
    warranty: null,
    description: null,
    shop: { ...shop, has_hours: false, has_website: false, has_instagram: false },
  });
  assert.ok(fresh.score > old.score, `${fresh.score} should beat ${old.score}`);
  assert.ok(old.score > bare.score);
  assert.ok(fresh.score <= 100 && bare.score >= 0);
  assert.equal(fresh.level, "high");
  assert.ok(fresh.signals.length >= 3);
});

test("reliability never leans on a phone number or claims stock", () => {
  const result = scoreOffer({
    price: 10_000_000,
    changed_at: isoDaysAgo(3, NOW),
    warranty: null,
    description: null,
    market: { min: 10_000_000, median: 10_000_000, second_min: null, offer_count: 2 },
    shop: { has_hours: false, has_website: false, has_instagram: false, has_address: true, has_coords: true },
    now: NOW,
  });
  const text = [result.label, result.summary, ...result.signals.map((s) => `${s.label} ${s.detail}`)].join(" ");
  assert.ok(!result.signals.some((s) => s.key === "phone" || /تماس|تلفن|شماره/.test(s.label)));
  assert.ok(!/موجود است|موجود هست|موجودی تأیید/.test(text));
  assert.ok(!/قابل اتکا|مورد اعتماد/.test(result.label));
  assert.equal(result.level, "medium");
});

test("unknown price date is never presented as fresh", () => {
  assert.equal(freshnessOf(null, NOW), "unknown");
  assert.equal(FRESHNESS_TEXT.unknown, "بدون تاریخ قیمت");
  assert.equal(ageDays(null, NOW), null);
  const result = scoreOffer({
    price: 1_000_000,
    changed_at: null,
    warranty: null,
    description: null,
    market: { min: null, median: null, second_min: null, offer_count: 1 },
    shop: { has_hours: false, has_website: false, has_instagram: false, has_address: false, has_coords: false },
    now: NOW,
  });
  const freshness = result.signals.find((s) => s.key === "freshness");
  assert.equal(freshness?.points, 0);
  assert.ok(/ثبت نشده/.test(freshness?.detail ?? ""));
  assert.ok(!/تازه/.test(freshness?.detail ?? ""));
});
