#!/usr/bin/env python3
"""Bounded-memory audit of the هم‌خرید source CSVs.

Streams every file once, keeps only scalar counters and capped id sets, and
writes a Markdown report. Never loads a whole table into memory and never
prints raw rows.

Usage:
    python scripts/inspect_dataset.py [--data-dir .] [--out docs/dataset-audit.md]

Exit code 0 means every file was readable and parsed; 2 means a blocker
(missing file / bad header) was found and written to the report.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

csv.field_size_limit(10 * 1024 * 1024)

EXPECTED = {
    "shops.csv": ["address", "category_names", "contacts", "instagram", "lat", "location_label",
                  "lon", "name", "payment_options", "shop_id", "supports_fast_delivery",
                  "website_url", "weekly_hours"],
    "products.csv": ["brand_name", "category_name", "image_urls", "model", "persian_title",
                     "product_id", "specs"],
    "offers.csv": ["description", "last_price_changed_at", "offer_id", "price_toman",
                   "product_id", "seller_title", "shop_id", "warranty"],
}

TEHRAN_BBOX = (35.55, 35.85, 51.10, 51.60)  # lat_min, lat_max, lon_min, lon_max
PRICE_MIN_REAL = 10_000          # anything cheaper than 10k toman is suspicious
PRICE_MAX_REAL = 5_000_000_000   # 5 milliard toman
CAP = 20_000                     # cap on stored id sets used for FK / notes


NULLISH = {"null", "none", "undefined", "nan"}


def blank(v: str | None) -> bool:
    """True for missing values, including the literal "null" the export uses."""
    if v is None:
        return True
    s = v.strip()
    return s == "" or s.lower() in NULLISH


def parse_json(v: str | None):
    if blank(v):
        return None
    try:
        return json.loads(v)
    except Exception:
        return "__invalid__"


def pct(part: int, total: int) -> str:
    if not total:
        return "—"
    return f"{part / total * 100:.1f}٪"


def size_mb(path: Path) -> str:
    n = path.stat().st_size / (1024 * 1024)
    return f"{n:,.1f} مگابایت"


class ColumnStats:
    def __init__(self) -> None:
        self.null = 0
        self.empty_string = 0
        self.literal_null = 0
        self.too_long = 0
        self.max_len = 0
        self.json_ok = 0
        self.json_bad = 0
        self.json_empty = 0

    def add(self, v: str | None, is_json: bool = False) -> None:
        if v is None:
            self.null += 1
            return
        if v.strip() == "":
            self.empty_string += 1
            return
        if v.strip().lower() in NULLISH:
            self.literal_null += 1
            return
        self.max_len = max(self.max_len, len(v))
        if is_json:
            parsed = parse_json(v)
            if parsed is None:
                self.json_empty += 1
            elif parsed == "__invalid__":
                self.json_bad += 1
            else:
                self.json_ok += 1


def stream(path: Path, expected_cols: list[str], on_row) -> tuple[bool, int, list[str]]:
    """Stream a CSV, validate the header, call on_row(dict) per record."""
    if not path.exists():
        return False, 0, []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            return False, 0, []
        header = [h.strip() for h in header]
        width = len(header)
        n = 0
        bad_width = 0
        for row in reader:
            if len(row) != width:
                bad_width += 1
                if len(row) < width:
                    row = row + [""] * (width - len(row))
                else:
                    row = row[:width]
            on_row(dict(zip(header, row)))
            n += 1
        if bad_width:
            print(f"  ! {path.name}: {bad_width} rows had a wrong field count (padded/truncated)")
    return True, n, header


def audit_shops(path: Path) -> dict:
    stats = {c: ColumnStats() for c in EXPECTED["shops.csv"]}
    ids: set[str] = set()
    dup_ids = 0
    coords_missing = 0
    coords_bad = 0
    outside_bbox = 0
    fast = Counter()
    with_contact = 0
    with_website = 0
    with_instagram = 0
    neighborhoods = Counter()
    categories = Counter()
    cat_none = 0
    hours_status = Counter()
    names = Counter()

    def on_row(row: dict) -> None:
        nonlocal dup_ids, coords_missing, coords_bad, outside_bbox, fast
        nonlocal with_contact, with_website, with_instagram, cat_none
        for c, st in stats.items():
            st.add(row.get(c), is_json=c in {"category_names", "contacts", "weekly_hours"})
        sid = (row.get("shop_id") or "").strip()
        if sid in ids:
            dup_ids += 1
        elif sid:
            ids.add(sid)
        try:
            lat = float(row.get("lat") or "")
            lon = float(row.get("lon") or "")
        except ValueError:
            coords_missing += 1
            return
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            coords_bad += 1
        elif not (TEHRAN_BBOX[0] <= lat <= TEHRAN_BBOX[1] and TEHRAN_BBOX[2] <= lon <= TEHRAN_BBOX[3]):
            outside_bbox += 1
        label = (row.get("location_label") or "").strip()
        if label:
            neighborhoods[label] += 1
        cats = parse_json(row.get("category_names"))
        if isinstance(cats, list) and cats:
            for c in cats:
                categories[str(c)] += 1
        elif cats is None or cats == []:
            cat_none += 1
        if parse_json(row.get("contacts")):
            with_contact += 1
        if not blank(row.get("website_url")):
            with_website += 1
        if not blank(row.get("instagram")):
            with_instagram += 1
        fast[(row.get("supports_fast_delivery") or "").strip()] += 1
        hours = parse_json(row.get("weekly_hours"))
        if isinstance(hours, dict):
            for day in ("sat", "sun", "mon", "tue", "wed", "thu", "fri"):
                d = hours.get(day) or {}
                hours_status[str(d.get("status"))] += 1
        nm = (row.get("name") or "").strip()
        if nm:
            names[nm] += 1

    ok, n, header = stream(path, EXPECTED["shops.csv"], on_row)
    return {
        "file": path.name, "ok": ok, "rows": n, "header": header,
        "columns": stats, "dup_ids": dup_ids, "unique_ids": len(ids), "id_set": ids,
        "coords_missing": coords_missing, "coords_bad": coords_bad,
        "outside_bbox": outside_bbox, "fast": fast,
        "with_contact": with_contact, "with_website": with_website,
        "with_instagram": with_instagram, "categories": categories,
        "no_category": cat_none, "neighborhoods": neighborhoods,
        "hours_status": hours_status, "names": names, "size": size_mb(path),
    }


def audit_products(path: Path) -> dict:
    stats = {c: ColumnStats() for c in EXPECTED["products.csv"]}
    ids: set[str] = set()
    dup_ids = 0
    no_image = 0
    image_counts: list[int] = []
    non_http_images = 0
    no_brand = 0
    no_category = 0
    spec_counts: list[int] = []
    categories = Counter()
    brands = Counter()
    titles = Counter()
    title_len: list[int] = []
    images_host = Counter()

    def on_row(row: dict) -> None:
        nonlocal dup_ids, no_image, non_http_images, no_brand, no_category
        for c, st in stats.items():
            st.add(row.get(c), is_json=c in {"image_urls", "specs"})
        pid = (row.get("product_id") or "").strip()
        if pid in ids:
            dup_ids += 1
        elif pid:
            ids.add(pid)
        imgs = parse_json(row.get("image_urls"))
        if not isinstance(imgs, list) or not imgs:
            no_image += 1
            image_counts.append(0)
        else:
            image_counts.append(len(imgs))
            for u in imgs[:4]:
                if isinstance(u, str):
                    if u.startswith("http"):
                        try:
                            images_host[u.split("/")[2]] += 1
                        except Exception:
                            pass
                    else:
                        non_http_images += 1
        brand = (row.get("brand_name") or "").strip()
        if blank(brand):
            no_brand += 1
        else:
            brands[brand] += 1
        cat = (row.get("category_name") or "").strip()
        if blank(cat):
            no_category += 1
        else:
            categories[cat] += 1
        title = (row.get("persian_title") or "").strip()
        if title:
            titles[title] += 1
            title_len.append(len(title))
        specs = parse_json(row.get("specs"))
        if isinstance(specs, list):
            spec_counts.append(len(specs))

    ok, n, header = stream(path, EXPECTED["products.csv"], on_row)
    return {
        "file": path.name, "ok": ok, "rows": n, "header": header,
        "columns": stats, "dup_ids": dup_ids, "unique_ids": len(ids), "id_set": ids,
        "no_image": no_image, "image_counts": image_counts,
        "non_http_images": non_http_images, "no_brand": no_brand,
        "no_category": no_category, "spec_counts": spec_counts,
        "categories": categories, "brands": brands, "titles": titles,
        "title_len": title_len, "images_host": images_host, "size": size_mb(path),
    }


def audit_offers(path: Path) -> dict:
    stats = {c: ColumnStats() for c in EXPECTED["offers.csv"]}
    ids: set[str] = set()
    dup_ids = 0
    prices: list[int] = []
    bad_price = 0
    zero_price = 0
    suspicious_low = 0
    suspicious_high = 0
    bad_date = 0
    future_date = 0
    dates: list[datetime] = []
    per_product = Counter()
    per_shop = Counter()
    product_ids: set[str] = set()
    shop_ids: set[str] = set()
    warranty = Counter()
    with_desc = 0
    null_price_count = [0]
    product_offer_ids: dict[str, set[str]] = {}

    def on_row(row: dict) -> None:
        nonlocal dup_ids, bad_price, zero_price, suspicious_low, suspicious_high
        nonlocal bad_date, future_date, with_desc
        for c, st in stats.items():
            st.add(row.get(c))
        oid = (row.get("offer_id") or "").strip()
        if oid in ids:
            dup_ids += 1
        elif oid:
            ids.add(oid)
        raw = (row.get("price_toman") or "").strip()
        try:
            price = int(float(raw))
        except ValueError:
            bad_price += 1
            price = -1
            if raw.lower() in NULLISH:
                null_price_count[0] += 1
        if price == 0:
            zero_price += 1
        elif 0 < price < PRICE_MIN_REAL:
            suspicious_low += 1
        elif price > PRICE_MAX_REAL:
            suspicious_high += 1
        if price > 0:
            prices.append(price)
        ts = (row.get("last_price_changed_at") or "").strip()
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                dates.append(dt)
                if dt > datetime.now(timezone.utc):
                    future_date += 1
            except ValueError:
                bad_date += 1
        pid = (row.get("product_id") or "").strip()
        sid = (row.get("shop_id") or "").strip()
        if pid:
            per_product[pid] += 1
            product_ids.add(pid)
        if sid:
            per_shop[sid] += 1
            shop_ids.add(sid)
        warranty[(row.get("warranty") or "").strip()] += 1
        if not blank(row.get("description")):
            with_desc += 1
        if pid and oid:
            product_offer_ids.setdefault(pid, set()).add(oid)

    ok, n, header = stream(path, EXPECTED["offers.csv"], on_row)
    spread = [
        len(s) for s in product_offer_ids.values()
    ]
    return {
        "file": path.name, "ok": ok, "rows": n, "header": header,
        "columns": stats, "dup_ids": dup_ids, "unique_ids": len(ids),
        "prices": prices, "bad_price": bad_price, "null_price": null_price_count[0],
        "zero_price": zero_price,
        "suspicious_low": suspicious_low, "suspicious_high": suspicious_high,
        "bad_date": bad_date, "future_date": future_date, "dates": dates,
        "per_product": per_product, "per_shop": per_shop,
        "product_ids": product_ids, "shop_ids": shop_ids,
        "warranty": warranty, "with_desc": with_desc, "spread": spread,
        "size": size_mb(path),
    }


def quantiles(values: list[int]) -> dict[str, str]:
    if not values:
        return {}
    v = sorted(values)
    def q(p: float) -> int:
        return v[min(len(v) - 1, int(len(v) * p))]
    return {
        "min": f"{v[0]:,}", "p25": f"{q(0.25):,}", "p50": f"{q(0.5):,}",
        "p90": f"{q(0.9):,}", "p99": f"{q(0.99):,}", "max": f"{v[-1]:,}",
        "mean": f"{statistics.fmean(v):,.0f}",
    }


def table_counter(title: str, counter: Counter, total: int, limit: int = 15) -> list[str]:
    out = [f"**{title}**", "", "| مقدار | تعداد | سهم |", "| --- | ---: | ---: |"]
    for key, n in counter.most_common(limit):
        label = key if key not in ("", "None") else "(خالی)"
        out.append(f"| {label} | {n:,} | {pct(n, total)} |")
    out.append("")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=".")
    ap.add_argument("--out", default="docs/dataset-audit.md")
    args = ap.parse_args()
    root = Path(args.data_dir).resolve()
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path

    print("— بررسی دیتاست —")
    blockers: list[str] = []
    shops_path = root / "shops.csv"
    products_path = root / "products.csv"
    offers_path = root / "offers.csv"
    for p in (shops_path, products_path, offers_path):
        print(f"  {p.name}: {'موجود' if p.exists() else 'یافت نشد'}"
              + (f" — {size_mb(p)}" if p.exists() else ""))
        if not p.exists():
            blockers.append(f"فایل `{p.name}` پیدا نشد.")

    shops = audit_shops(shops_path) if shops_path.exists() else None
    if shops:
        print(f"  shops: {shops['rows']:,} ردیف")
    products = audit_products(products_path) if products_path.exists() else None
    if products:
        print(f"  products: {products['rows']:,} ردیف")
    offers = audit_offers(offers_path) if offers_path.exists() else None
    if offers:
        print(f"  offers: {offers['rows']:,} ردیف")

    lines: list[str] = []
    add = lines.append
    add("# گزارش بررسی دیتاست هم‌خرید")
    add("")
    add("این گزارش به‌صورت خودکار با `scripts/inspect_dataset.py` تولید می‌شود و اعداد آن")
    add("از یک پیمایش کامل و یک‌بارهٔ فایل‌های CSV به‌دست آمده است. هیچ ردیفی در گزارش")
    add("چاپ نمی‌شود؛ فقط شمارش، توزیع و کیفیت داده.")
    add("")
    add(f"زمان تولید گزارش: `{datetime.now(timezone.utc).isoformat(timespec='seconds')}`")
    add("")
    add("## ۱. فایل‌های منبع")
    add("")
    add("| فایل | حجم | ردیف | ستون‌ها |")
    add("| --- | ---: | ---: | --- |")
    for item in (shops, products, offers):
        if not item:
            continue
        add(f"| `{item['file']}` | {item['size']} | {item['rows']:,} | "
            f"{'، '.join(item['header'])} |")
    add("")
    if blockers:
        add("> **مانع:** " + " ".join(blockers))
        add("")

    if shops:
        add("## ۲. فروشگاه‌ها (`shops.csv`)")
        add("")
        add(f"- ردیف: **{shops['rows']:,}**، شناسهٔ یکتا: **{shops['unique_ids']:,}**، "
            f"شناسهٔ تکراری: **{shops['dup_ids']:,}**")
        add(f"- مختصات ناموجود/نامعتبر: **{shops['coords_missing']:,}** "
            f"({pct(shops['coords_missing'], shops['rows'])})، خارج از باکس تهران: "
            f"**{shops['outside_bbox']:,}** ({pct(shops['outside_bbox'], shops['rows'])})")
        add(f"- دارای راه ارتباطی: **{shops['with_contact']:,}**، وب‌سایت: "
            f"**{shops['with_website']:,}**، اینستاگرام: **{shops['with_instagram']:,}**")
        add(f"- بدون دسته‌بندی: **{shops['no_category']:,}**")
        add(f"- ارسال سریع (مقدار خام): {dict(shops['fast'])}")
        add(f"- وضعیت ساعت کاری (روز×فروشگاه): {dict(shops['hours_status'].most_common(4))}")
        add("")
        st = shops["columns"]
        add("| ستون | خالی | رشتهٔ تهی | «null» متنی | JSON معتبر | JSON خراب | بیشترین طول |")
        add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
        for c in EXPECTED["shops.csv"]:
            s = st[c]
            add(f"| `{c}` | {s.null:,} | {s.empty_string:,} | {s.literal_null:,} | "
                f"{s.json_ok:,} | {s.json_bad:,} | {s.max_len:,} |")
        add("")
        lines.extend(table_counter("پرتکرارترین محله‌ها (`location_label`)",
                                   shops["neighborhoods"], shops["rows"], 12))
        lines.extend(table_counter("پرتکرارترین دسته‌های فروشگاه",
                                   shops["categories"], shops["rows"], 12))
        dup_names = Counter({k: v for k, v in shops["names"].items() if v > 1})
        add(f"- نام فروشگاه تکراری (بیش از یک شعبه/ثبت): **{sum(dup_names.values()):,}** ردیف "
            f"در **{len(dup_names):,}** نام.")
        add("")

    if products:
        add("## ۳. کالاها (`products.csv`)")
        add("")
        add(f"- ردیف: **{products['rows']:,}**، شناسهٔ یکتا: **{products['unique_ids']:,}**، "
            f"تکراری: **{products['dup_ids']:,}**")
        add(f"- بدون تصویر: **{products['no_image']:,}** "
            f"({pct(products['no_image'], products['rows'])}); "
            f"تصویر با آدرس غیر http: **{products['non_http_images']:,}**")
        add(f"- بدون برند: **{products['no_brand']:,}**، بدون دسته: "
            f"**{products['no_category']:,}**")
        ic = products["image_counts"]
        add(f"- تعداد تصویر هر کالا: میانگین {statistics.fmean(ic):.2f}، "
            f"بیشینه {max(ic):,}" if ic else "- تعداد تصویر: —")
        sl = products["spec_counts"]
        if sl:
            add(f"- تعداد مشخصه هر کالا: میانگین {statistics.fmean(sl):.1f}، "
                f"میانه {statistics.median(sl):.0f}، بیشینه {max(sl):,}")
            add(f"- کالاهای بدون مشخصه: **{products['rows'] - len(sl):,}**")
        tl = products["title_len"]
        if tl:
            add(f"- طول عنوان فارسی: میانه {statistics.median(tl):.0f} نویسه، "
                f"بیشینه {max(tl):,}")
        dup_titles = sum(n for n in products["titles"].values() if n > 1)
        add(f"- عنوان تکراری: **{dup_titles:,}** ردیف در "
            f"**{sum(1 for n in products['titles'].values() if n > 1):,}** عنوان.")
        add("")
        st = products["columns"]
        add("| ستون | خالی | رشتهٔ تهی | «null» متنی | JSON معتبر | JSON خراب | بیشترین طول |")
        add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
        for c in EXPECTED["products.csv"]:
            s = st[c]
            add(f"| `{c}` | {s.null:,} | {s.empty_string:,} | {s.literal_null:,} | "
                f"{s.json_ok:,} | {s.json_bad:,} | {s.max_len:,} |")
        add("")
        lines.extend(table_counter("پرتکرارترین دستهٔ کالا", products["categories"],
                                   products["rows"], 18))
        lines.extend(table_counter("پرتکرارترین برند", products["brands"],
                                   products["rows"], 15))
        add(f"- میزبان تصاویر: {dict(products['images_host'].most_common(3))}")
        add("")

    if offers:
        add("## ۴. پیشنهادها (`offers.csv`)")
        add("")
        add(f"- ردیف: **{offers['rows']:,}**، شناسهٔ یکتا: **{offers['unique_ids']:,}**، "
            f"تکراری: **{offers['dup_ids']:,}**")
        add(f"- کالای یکتا در پیشنهادها: **{len(offers['per_product']):,}**، "
            f"فروشگاه یکتا: **{len(offers['per_shop']):,}**")
        add(f"- قیمت تهی (رشتهٔ «null»): **{offers['null_price']:,}**، غیرعددی دیگر: "
            f"**{offers['bad_price'] - offers['null_price']:,}**، صفر: **{offers['zero_price']:,}**، "
            f"کمتر از ۱۰ هزار تومان: **{offers['suspicious_low']:,}** "
            f"({pct(offers['suspicious_low'], offers['rows'])}), بیش از ۵ میلیارد تومان: "
            f"**{offers['suspicious_high']:,}**")
        add(f"- تاریخ نامعتبر: **{offers['bad_date']:,}**، تاریخ آینده: "
            f"**{offers['future_date']:,}**")
        q = quantiles(offers["prices"])
        if q:
            add(f"- توزیع قیمت (تومان): کمینه {q['min']}، صدک ۲۵ {q['p25']}، میانه "
                f"{q['p50']}، صدک ۹۰ {q['p90']}، صدک ۹۹ {q['p99']}، بیشینه {q['max']}")
        if offers["dates"]:
            ds = sorted(offers["dates"])
            add(f"- بازهٔ `last_price_changed_at`: از `{ds[0].isoformat()}` تا "
                f"`{ds[-1].isoformat()}`")
            ages = [(datetime.now(timezone.utc) - d).days for d in ds]
            fresh_7 = sum(1 for a in ages if a <= 7)
            fresh_30 = sum(1 for a in ages if a <= 30)
            stale_90 = sum(1 for a in ages if a > 90)
            add(f"- تازگی قیمت: ≤۷ روز {pct(fresh_7, len(ds))}، ≤۳۰ روز "
                f"{pct(fresh_30, len(ds))}، قدیمی‌تر از ۹۰ روز {pct(stale_90, len(ds))}")
        spread = offers["spread"]
        if spread:
            one = sum(1 for s in spread if s <= 1)
            multi = sum(1 for s in spread if s >= 2)
            add(f"- کالاهای تک‌پیشنهاد: **{one:,}**، دارای دو پیشنهاد یا بیشتر: **{multi:,}**، "
                f"بیشترین پیشنهاد برای یک کالا: **{max(spread):,}**")
            add(f"- تعداد پیشنهاد هر کالا: میانگین {statistics.fmean(spread):.2f}، "
                f"میانه {statistics.median(spread):.0f}")
        add(f"- توضیح غیرخالی: **{offers['with_desc']:,}**")
        add("")
        st = offers["columns"]
        add("| ستون | خالی | رشتهٔ تهی | «null» متنی | بیشترین طول |")
        add("| --- | ---: | ---: | ---: | ---: |")
        for c in EXPECTED["offers.csv"]:
            s = st[c]
            add(f"| `{c}` | {s.null:,} | {s.empty_string:,} | {s.literal_null:,} | {s.max_len:,} |")
        add("")
        lines.extend(table_counter("مقادیر گارانتی (خام)", offers["warranty"],
                                   offers["rows"], 12))
        lines.extend(table_counter("پرتکرارترین فروشگاه بر اساس تعداد پیشنهاد",
                                   offers["per_shop"], offers["rows"], 12))

    # ---------- relationships ----------
    add("## ۵. روابط و یکپارچگی ارجاعی")
    add("")
    if products and offers:
        missing_products = offers["product_ids"] - products["id_set"]
        add(f"- `offers.product_id` → `products.product_id`: "
            f"**{len(offers['product_ids']):,}** شناسهٔ ارجاع‌شده، "
            f"**{len(missing_products):,}** شناسهٔ بدون کالا.")
        orphan_offers = sum(offers["per_product"].get(pid, 0) for pid in list(missing_products)[:CAP])
        add(f"  (حداکثر {CAP:,} شناسهٔ اول: {orphan_offers:,} پیشنهاد یتیم)")
        no_offer = products["unique_ids"] - len(offers["product_ids"] & products["id_set"])
        add(f"- کالاهای بدون هیچ پیشنهاد: **{no_offer:,}** "
            f"({pct(no_offer, products['unique_ids'])})")
    if shops and offers:
        missing_shops = offers["shop_ids"] - shops["id_set"]
        add(f"- `offers.shop_id` → `shops.shop_id`: **{len(offers['shop_ids']):,}** "
            f"شناسهٔ ارجاع‌شده، **{len(missing_shops):,}** بدون فروشگاه.")
        shops_with_offers = offers["shop_ids"] & shops["id_set"]
        add(f"- فروشگاه‌های بدون پیشنهاد: **{shops['unique_ids'] - len(shops_with_offers):,}** "
            f"({pct(shops['unique_ids'] - len(shops_with_offers), shops['unique_ids'])})")
    add("")

    add("## ۶. تصمیم‌های ورود داده به اپلیکیشن")
    add("")
    add("| منبع | جدول مقصد | قاعده |")
    add("| --- | --- | --- |")
    add("| `products.csv` | `products` | کلید `product_id`؛ `image_urls` و `specs` به‌صورت JSON "
        "فشرده نگه داشته می‌شوند، تصویر اول به `primary_image` و مشخصات کلیدی به ستون‌های "
        "قابل جست‌وجو منتقل می‌شود. |")
    add("| `offers.csv` | `offers` | کلید `offer_id`؛ قیمت غیرمثبت و خارج از بازهٔ منطقی "
        "وارد نمی‌شود؛ تاریخ به UTC ISO ذخیره می‌شود و «تازگی» در زمان خواندن محاسبه می‌شود. |")
    add("| `shops.csv` | `shops` | کلید `shop_id`؛ فقط فروشگاه با مختصات معتبر و داخل باکس "
        "تهران روی نقشه می‌آید، بقیه در فهرست می‌مانند اما بدون فاصله. |")
    add("| همه | `search_index` | ایندکس FTS5 روی عنوان/برند/دستهٔ کالا و نام/محلهٔ فروشگاه، "
        "با نرمال‌سازی ی/ك عربی و حذف نیم‌فاصله. |")
    add("")
    add("ورود داده با `scripts/import_dataset.py` و به‌صورت دستی انجام می‌شود")
    add("(`npm run data:import`)، نه هنگام بالا آمدن سرور. ایمپورت idempotent است:")
    add("جدول‌ها با `INSERT OR REPLACE` در تراکنش‌های دسته‌ای پر می‌شوند و اجرای دوباره")
    add("ردیف تکراری نمی‌سازد.")
    add("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"گزارش نوشته شد: {out_path}")
    if blockers:
        print("مانع: " + " ".join(blockers))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
