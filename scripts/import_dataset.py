#!/usr/bin/env python3
"""Import the Torob CSVs into the هم‌خرید SQLite database.

The import is explicit (`npm run data:import`), never part of app startup.
It streams every row, rebuilds a fresh database next to the live one and
atomically replaces it at the end, so running it twice cannot duplicate rows
and a crash never leaves a half-filled database behind.

Usage:
    python scripts/import_dataset.py [--data-dir .] [--out data/hamkharid.db]
                                    [--limit N] [--verbose]

Exit codes: 0 ok, 2 blocked (missing file), 1 import error.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

csv.field_size_limit(10 * 1024 * 1024)

SCHEMA_VERSION = "1"
NULLISH = {"null", "none", "undefined", "nan", ""}
MIN_PRICE = 1_000                # cheaper than this is junk data
MAX_PRICE = 20_000_000_000       # 20 milliard toman; above is corrupt

TEHRAN_BBOX = (35.55, 35.85, 51.10, 51.60)

SCHEMA = """
CREATE TABLE products (
  product_id      TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  title_norm      TEXT NOT NULL,
  brand           TEXT,
  brand_norm      TEXT,
  model           TEXT,
  category        TEXT NOT NULL,
  category_norm   TEXT NOT NULL,
  image           TEXT,
  images          TEXT NOT NULL,
  specs           TEXT NOT NULL,
  search_text     TEXT NOT NULL,
  offer_count     INTEGER NOT NULL DEFAULT 0,
  min_price       INTEGER,
  max_price       INTEGER,
  best_price      INTEGER,
  best_offer_id   TEXT,
  best_shop_id    TEXT,
  newest_price_at TEXT,
  oldest_price_at TEXT
);
CREATE TABLE offers (
  offer_id      TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  shop_id       TEXT NOT NULL,
  title         TEXT,
  price         INTEGER NOT NULL,
  changed_at    TEXT,
  warranty      TEXT,
  warranty_label TEXT,
  description   TEXT
);
CREATE TABLE shops (
  shop_id        TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  name_norm      TEXT NOT NULL,
  address        TEXT,
  neighborhood   TEXT,
  neighborhood_norm TEXT,
  lat            REAL,
  lon            REAL,
  categories     TEXT NOT NULL,
  categories_norm TEXT NOT NULL,
  contacts       TEXT NOT NULL,
  phone          TEXT,
  instagram      TEXT,
  website        TEXT,
  payments       TEXT NOT NULL,
  fast_delivery  INTEGER NOT NULL DEFAULT 0,
  hours          TEXT NOT NULL,
  offer_count    INTEGER NOT NULL DEFAULT 0,
  in_tehran      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE categories (
  name          TEXT PRIMARY KEY,
  name_norm     TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  shop_count    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE neighborhoods (
  name          TEXT PRIMARY KEY,
  name_norm     TEXT NOT NULL,
  lat           REAL,
  lon           REAL,
  shop_count    INTEGER NOT NULL DEFAULT 0,
  offer_count   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_offers_product ON offers(product_id, price);
CREATE INDEX idx_offers_shop ON offers(shop_id);
CREATE INDEX idx_offers_price ON offers(price);
CREATE INDEX idx_products_category ON products(category, min_price);
CREATE INDEX idx_products_min_price ON products(min_price);
CREATE INDEX idx_products_offers ON products(offer_count DESC);
CREATE INDEX idx_shops_hood ON shops(neighborhood);
CREATE INDEX idx_shops_cat ON shops(categories_norm);

CREATE VIRTUAL TABLE product_fts USING fts5(
  product_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE shop_fts USING fts5(
  shop_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
"""

# ---------------------------------------------------------------- normalizing

ARABIC_MAP = {
    "ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه",
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و", "ئ": "ی",
}
DROP = {"\u200c", "\u200d", "\u200e", "\u200f", "\u0640", "\ufeff"}
PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"


def normalize(text: str) -> str:
    """Search normal form: unify ی/ک, drop ZWNJ, diacritics and Persian digits."""
    out = []
    for ch in text:
        if ch in DROP:
            continue
        if "\u064b" <= ch <= "\u065f" or ch == "\u0670":
            continue
        out.append(ARABIC_MAP.get(ch, ch))
    s = "".join(out)
    s = "".join(str(PERSIAN_DIGITS.index(c)) if c in PERSIAN_DIGITS else c for c in s)
    s = "".join(str(ARABIC_DIGITS.index(c)) if c in ARABIC_DIGITS else c for c in s)
    return " ".join(s.lower().split())


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    s = value.strip()
    return None if s.lower() in NULLISH else s


def parse_json(raw: str | None, fallback):
    s = clean(raw)
    if s is None:
        return fallback
    try:
        return json.loads(s)
    except Exception:
        return fallback


def iso_utc(raw: str | None) -> str | None:
    s = clean(raw)
    if s is None:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def warranty_label(raw: str | None) -> str | None:
    w = parse_json(raw, None)
    if not isinstance(w, dict):
        return None
    provider = clean(w.get("provider"))
    desc = clean(w.get("description"))
    months = w.get("period_months")
    if isinstance(months, (int, float)) and months > 0:
        label = f"{int(months)} ماه گارانتی"
        if provider:
            label += f" {provider}"
        return label
    if desc:
        return desc
    if provider:
        return provider
    return None


def phone_of(contacts) -> str | None:
    if not isinstance(contacts, list):
        return None
    for c in contacts:
        if not isinstance(c, dict):
            continue
        num = clean(str(c.get("display_number") or ""))
        if not num:
            continue
        latin = "".join(
            str(PERSIAN_DIGITS.index(ch)) if ch in PERSIAN_DIGITS
            else str(ARABIC_DIGITS.index(ch)) if ch in ARABIC_DIGITS else ch
            for ch in num
        )
        digits = "".join(ch for ch in latin if ch.isdigit())
        if len(digits) >= 8:
            return digits
    return None


def in_bbox(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return (TEHRAN_BBOX[0] <= lat <= TEHRAN_BBOX[1]) and (TEHRAN_BBOX[2] <= lon <= TEHRAN_BBOX[3])


def category_pairs(raw: str | None) -> list[str]:
    data = parse_json(raw, [])
    if not isinstance(data, list):
        return []
    return [c.strip() for c in data if isinstance(c, str) and c.strip()]


# ---------------------------------------------------------------- import core

class Progress:
    def __init__(self, label: str, total_hint: int) -> None:
        self.label = label
        self.n = 0
        self.t0 = time.time()
        self.next_tick = 25_000
        self.total_hint = total_hint

    def tick(self, skipped: int = 0) -> None:
        self.n += 1
        if self.n >= self.next_tick:
            rate = self.n / max(1e-6, time.time() - self.t0)
            print(f"  {self.label}: {self.n:,} ردیف — {rate:,.0f} ردیف/ثانیه"
                  + (f" — ردشده {skipped:,}" if skipped else ""), flush=True)
            self.next_tick += 25_000


class Importer:
    def __init__(self, root: Path, db_path: Path, limit: int | None, verbose: bool) -> None:
        self.root = root
        self.db_path = db_path
        self.limit = limit
        self.verbose = verbose
        self.tmp_path = db_path.with_suffix(db_path.suffix + ".tmp")
        self.counts = {
            "shops_read": 0, "shops_written": 0,
            "products_read": 0, "products_written": 0, "products_title_fallback": 0,
            "offers_read": 0, "offers_written": 0,
            "skipped_price_null": 0, "skipped_price_invalid": 0,
            "skipped_price_low": 0, "skipped_price_high": 0,
            "skipped_date_invalid": 0,
        }
        self.warnings: list[str] = []

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    # -- plumbing ---------------------------------------------------------
    def open(self) -> sqlite3.Connection:
        self.tmp_path.parent.mkdir(parents=True, exist_ok=True)
        if self.tmp_path.exists():
            self.tmp_path.unlink()
        conn = sqlite3.connect(self.tmp_path)
        conn.executescript("""
            PRAGMA journal_mode = MEMORY;
            PRAGMA synchronous = OFF;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -200000;
        """)
        conn.executescript(SCHEMA)
        return conn

    def rows(self, filename: str):
        path = self.root / filename
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader)
            width = len(header)
            for i, row in enumerate(reader):
                if self.limit is not None and i >= self.limit:
                    break
                if len(row) != width:
                    row = (row + [""] * width)[:width]
                yield dict(zip(header, row))

    # -- shops ------------------------------------------------------------
    def import_shops(self, conn: sqlite3.Connection) -> None:
        print("فروشگاه‌ها…")
        prog = Progress("shops", 6_476)
        batch: list[tuple] = []
        sql = """INSERT OR REPLACE INTO shops (
            shop_id, name, name_norm, address, neighborhood, neighborhood_norm,
            lat, lon, categories, categories_norm, contacts, phone, instagram,
            website, payments, fast_delivery, hours, in_tehran
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""
        for row in self.rows("shops.csv"):
            self.counts["shops_read"] += 1
            prog.tick()
            sid = clean(row.get("shop_id"))
            name = clean(row.get("name"))
            if not sid or not name:
                self.warn("shop بدون شناسه یا نام رد شد")
                continue
            hood = clean(row.get("location_label"))
            cats = category_pairs(row.get("category_names"))
            contacts = parse_json(row.get("contacts"), [])
            try:
                lat = float(row.get("lat") or "")
                lon = float(row.get("lon") or "")
            except ValueError:
                lat = lon = None
            if not in_bbox(lat, lon):
                self.warn("مختصات فروشگاه بیرون از تهران یا نامعتبر بود و ذخیره نشد")
                lat = lon = None
            payments = parse_json(row.get("payment_options"), [])
            hours = parse_json(row.get("weekly_hours"), {})
            batch.append((
                sid, name, normalize(name), clean(row.get("address")), hood,
                normalize(hood) if hood else None, lat, lon,
                json.dumps(cats, ensure_ascii=False),
                normalize(" ".join(cats)),
                json.dumps(contacts, ensure_ascii=False) if contacts else "[]",
                phone_of(contacts),
                clean(row.get("instagram")),
                clean(row.get("website_url")),
                json.dumps(payments, ensure_ascii=False) if payments else "[]",
                1 if str(row.get("supports_fast_delivery")).strip().lower() == "true" else 0,
                json.dumps(hours, ensure_ascii=False) if hours else "{}",
                1 if lat is not None else 0,
            ))
            if len(batch) >= 1_000:
                conn.executemany(sql, batch)
                conn.commit()
                self.counts["shops_written"] += len(batch)
                batch.clear()
        if batch:
            conn.executemany(sql, batch)
            conn.commit()
            self.counts["shops_written"] += len(batch)
        print(f"  {self.counts['shops_written']:,} فروشگاه نوشته شد")

    # -- products ---------------------------------------------------------
    def import_products(self, conn: sqlite3.Connection) -> None:
        print("کالاها…")
        prog = Progress("products", 225_903)
        batch: list[tuple] = []
        sql = """INSERT OR REPLACE INTO products (
            product_id, title, title_norm, brand, brand_norm, model, category,
            category_norm, image, images, specs, search_text
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""
        fts_sql = "INSERT INTO product_fts (product_id, body) VALUES (?, ?)"
        fts_batch: list[tuple] = []
        for row in self.rows("products.csv"):
            self.counts["products_read"] += 1
            prog.tick()
            pid = clean(row.get("product_id"))
            if not pid:
                continue
            title = clean(row.get("persian_title"))
            brand = clean(row.get("brand_name"))
            model = clean(row.get("model"))
            category = clean(row.get("category_name")) or "دسته‌بندی‌نشده"
            if not title:
                title = model or category
                self.counts["products_title_fallback"] += 1
            images = parse_json(row.get("image_urls"), [])
            if not isinstance(images, list):
                images = []
            images = [u for u in images if isinstance(u, str) and u.startswith("http")]
            specs = parse_json(row.get("specs"), [])
            if not isinstance(specs, list):
                specs = []
            search = normalize(" ".join(x for x in (title, brand or "", model or "", category) if x))
            batch.append((
                pid, title, normalize(title), brand, normalize(brand) if brand else None,
                model, category, normalize(category),
                images[0] if images else None,
                json.dumps(images, ensure_ascii=False),
                json.dumps(specs, ensure_ascii=False),
                search,
            ))
            fts_batch.append((pid, search))
            if len(batch) >= 1_000:
                conn.executemany(sql, batch)
                conn.executemany(fts_sql, fts_batch)
                conn.commit()
                self.counts["products_written"] += len(batch)
                batch.clear()
                fts_batch.clear()
        if batch:
            conn.executemany(sql, batch)
            conn.executemany(fts_sql, fts_batch)
            conn.commit()
            self.counts["products_written"] += len(batch)
        print(f"  {self.counts['products_written']:,} کالا نوشته شد")

    # -- offers -----------------------------------------------------------
    def import_offers(self, conn: sqlite3.Connection) -> None:
        print("پیشنهادها…")
        prog = Progress("offers", 331_506)
        batch: list[tuple] = []
        sql = """INSERT OR REPLACE INTO offers (
            offer_id, product_id, shop_id, title, price, changed_at,
            warranty, warranty_label, description
        ) VALUES (?,?,?,?,?,?,?,?,?)"""
        skipped = 0
        for row in self.rows("offers.csv"):
            self.counts["offers_read"] += 1
            prog.tick(skipped)
            oid = clean(row.get("offer_id"))
            pid = clean(row.get("product_id"))
            sid = clean(row.get("shop_id"))
            if not oid or not pid or not sid:
                skipped += 1
                continue
            raw_price = (row.get("price_toman") or "").strip()
            try:
                price = int(float(raw_price))
            except ValueError:
                if raw_price.lower() in NULLISH:
                    self.counts["skipped_price_null"] += 1
                else:
                    self.counts["skipped_price_invalid"] += 1
                skipped += 1
                continue
            if price < MIN_PRICE:
                self.counts["skipped_price_low"] += 1
                skipped += 1
                continue
            if price > MAX_PRICE:
                self.counts["skipped_price_high"] += 1
                skipped += 1
                continue
            changed = iso_utc(row.get("last_price_changed_at"))
            if changed is None:
                self.counts["skipped_date_invalid"] += 1
            warranty = parse_json(row.get("warranty"), None)
            batch.append((
                oid, pid, sid, clean(row.get("seller_title")), price, changed,
                json.dumps(warranty, ensure_ascii=False) if warranty else None,
                warranty_label(row.get("warranty")),
                clean(row.get("description")),
            ))
            if len(batch) >= 5_000:
                conn.executemany(sql, batch)
                conn.commit()
                self.counts["offers_written"] += len(batch)
                batch.clear()
        if batch:
            conn.executemany(sql, batch)
            conn.commit()
            self.counts["offers_written"] += len(batch)
        print(f"  {self.counts['offers_written']:,} پیشنهاد نوشته شد "
              f"({skipped:,} ردیف کنار گذاشته شد)")

    # -- derived tables ---------------------------------------------------
    def derive(self, conn: sqlite3.Connection) -> None:
        print("محاسبهٔ شاخص‌های کالا…")
        conn.executescript("""
            UPDATE products SET
              offer_count = (SELECT COUNT(*) FROM offers o WHERE o.product_id = products.product_id),
              min_price = (SELECT MIN(price) FROM offers o WHERE o.product_id = products.product_id),
              max_price = (SELECT MAX(price) FROM offers o WHERE o.product_id = products.product_id),
              best_offer_id = (SELECT o.offer_id FROM offers o WHERE o.product_id = products.product_id
                               ORDER BY o.price ASC, o.changed_at DESC LIMIT 1),
              best_price = (SELECT MIN(price) FROM offers o WHERE o.product_id = products.product_id),
              best_shop_id = (SELECT o.shop_id FROM offers o WHERE o.product_id = products.product_id
                              ORDER BY o.price ASC, o.changed_at DESC LIMIT 1),
              newest_price_at = (SELECT MAX(changed_at) FROM offers o WHERE o.product_id = products.product_id),
              oldest_price_at = (SELECT MIN(changed_at) FROM offers o WHERE o.product_id = products.product_id);
        """)
        conn.commit()
        print("محاسبهٔ شاخص‌های فروشگاه…")
        conn.execute("""
            UPDATE shops SET
              offer_count = (SELECT COUNT(*) FROM offers o WHERE o.shop_id = shops.shop_id)
        """)
        conn.commit()

        print("دسته‌بندی‌ها و محله‌ها…")
        conn.execute("""
            INSERT INTO categories (name, name_norm, product_count)
            SELECT category, category_norm, COUNT(*) FROM products GROUP BY category
        """)
        conn.commit()
        rows = conn.execute("SELECT name, name_norm, product_count FROM categories").fetchall()
        shop_counts: dict[str, int] = {}
        for sid, cats, hood in conn.execute(
                "SELECT shop_id, categories, neighborhood FROM shops"):
            try:
                names = json.loads(cats)
            except Exception:
                names = []
            for name in names:
                if isinstance(name, str) and name.strip():
                    shop_counts[name.strip()] = shop_counts.get(name.strip(), 0) + 1
        conn.executemany(
            "UPDATE categories SET shop_count = ? WHERE name = ?",
            [(shop_counts.get(name, 0), name) for name, _norm, _pc in rows],
        )
        # shop-only categories (no product row) still deserve a filter chip
        existing = {name for name, _n, _p in rows}
        missing = [(name, normalize(name), 0, count) for name, count in shop_counts.items()
                   if name not in existing]
        conn.executemany(
            "INSERT OR IGNORE INTO categories (name, name_norm, product_count, shop_count) "
            "VALUES (?,?,?,?)", missing)
        conn.commit()

        conn.execute("""
            INSERT INTO neighborhoods (name, name_norm, lat, lon, shop_count)
            SELECT neighborhood, neighborhood_norm, AVG(lat), AVG(lon), COUNT(*)
            FROM shops WHERE neighborhood IS NOT NULL
            GROUP BY neighborhood
        """)
        conn.execute("""
            UPDATE neighborhoods SET offer_count = (
                SELECT COALESCE(SUM(offer_count), 0) FROM shops
                WHERE shops.neighborhood = neighborhoods.name
            )
        """)
        conn.commit()

        print("ایندکس جست‌وجوی فروشگاه‌ها…")
        for sid, name, hood, cats in conn.execute(
                "SELECT shop_id, name, neighborhood, categories_norm FROM shops"):
            body = " ".join(x for x in (normalize(name), hood or "", cats or "") if x)
            conn.execute("INSERT INTO shop_fts (shop_id, body) VALUES (?, ?)", (sid, body))
        conn.commit()

        conn.executescript("""
            UPDATE shops SET
              in_tehran = (lat IS NOT NULL AND lon IS NOT NULL)
        """)
        conn.commit()

    def write_meta(self, conn: sqlite3.Connection) -> None:
        files = {}
        for name in ("shops.csv", "products.csv", "offers.csv"):
            p = self.root / name
            if p.exists():
                files[name] = {
                    "bytes": p.stat().st_size,
                    "modified_at": datetime.fromtimestamp(
                        p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                }
        price_bounds = conn.execute(
            "SELECT COUNT(*), MIN(price), MAX(price), MIN(changed_at), MAX(changed_at) FROM offers"
        ).fetchone()
        meta = {
            "schema_version": SCHEMA_VERSION,
            "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source_files": files,
            "price_min_allowed": MIN_PRICE,
            "price_max_allowed": MAX_PRICE,
            "offers_priced": price_bounds[0],
            "price_overall_min": price_bounds[1],
            "price_overall_max": price_bounds[2],
            "price_oldest": price_bounds[3],
            "price_newest": price_bounds[4],
            "counts": self.counts,
            "warnings": self.warnings,
        }
        for k, v in meta.items():
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                         (k, json.dumps(v, ensure_ascii=False)))
        conn.commit()

    # -- run --------------------------------------------------------------
    def run(self) -> int:
        for name in ("shops.csv", "products.csv", "offers.csv"):
            if not (self.root / name).exists():
                print(f"مانع: فایل {name} پیدا نشد.", file=sys.stderr)
                return 2
        t0 = time.time()
        conn = self.open()
        try:
            self.import_shops(conn)
            self.import_products(conn)
            self.import_offers(conn)
            self.derive(conn)
            self.write_meta(conn)
            print("بهینه‌سازی…")
            conn.executescript("""
                PRAGMA journal_mode = DELETE;
                ANALYZE;
                VACUUM;
            """)
            conn.close()
        except Exception:
            conn.close()
            if self.tmp_path.exists():
                self.tmp_path.unlink()
            raise
        target = self.db_path
        for suffix in ("-wal", "-shm"):
            stray = Path(str(target) + suffix)
            if stray.exists():
                stray.unlink()
        os.replace(self.tmp_path, target)
        size_mb = target.stat().st_size / (1024 * 1024)
        print(f"پایان در {time.time() - t0:.0f} ثانیه — {target} ({size_mb:,.0f} مگابایت)")
        print(f"کالا {self.counts['products_written']:,} · پیشنهاد "
              f"{self.counts['offers_written']:,} · فروشگاه {self.counts['shops_written']:,}")
        if self.warnings:
            print("هشدارها:")
            for w in self.warnings:
                print(f"  - {w}")
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=".")
    ap.add_argument("--out", default="data/hamkharid.db")
    ap.add_argument("--limit", type=int, default=None,
                    help="فقط N ردیف از هر فایل، برای آزمون سریع")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    root = Path(args.data_dir).resolve()
    out = Path(args.out)
    if not out.is_absolute():
        out = root / out
    print(f"ورود داده از {root} به {out}")
    return Importer(root, out, args.limit, args.verbose).run()


if __name__ == "__main__":
    sys.exit(main())
