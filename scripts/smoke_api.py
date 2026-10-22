"""End-to-end smoke test for the running هم‌خرید API.

Usage: python scripts/smoke_api.py [--base http://127.0.0.1:8787]
Requires the server (`npm run dev` or `npm start`) and an imported database.
Exits non-zero on the first broken contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

FAILS: list[str] = []
ANON_PREFIX = "فروشگاه ناشناس‌شده #"
PHONE_PATTERNS = (
    re.compile(r"\btel:"),
    re.compile(r"\"phone\"\s*:"),
    re.compile(r"\"contacts\"\s*:"),
    re.compile(r"\b0\d{10}\b"),
    re.compile(r"\b09\d{9}\b"),
)


def call(base: str, path: str, body: dict | None = None) -> tuple[int, dict | list]:
    url = base + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"raw": raw}


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")
    if not condition:
        FAILS.append(name)


def q(**params: object) -> str:
    return "?" + urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})


def raw(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def no_phone(label: str, payload: object) -> None:
    text = raw(payload)
    hits = [pattern.pattern for pattern in PHONE_PATTERNS if pattern.search(text)]
    check(f"no fake phone in {label}", not hits, ", ".join(hits))


def shop_naming(label: str, shops: list[dict]) -> None:
    bad = []
    for shop in shops:
        name = shop.get("name", "")
        if shop.get("identity") == "anonymized":
            if not name.startswith(ANON_PREFIX) or len(name.split("#")[-1].strip()) != 7:
                bad.append(name)
        elif shop.get("identity") == "registered":
            if not name or name.startswith(ANON_PREFIX):
                bad.append(name)
        else:
            bad.append(name)
    check(f"shop identity naming in {label}", not bad, str(bad[:3]))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    base = parser.parse_args().base.rstrip("/")

    status, health = call(base, "/api/health")
    check("health 200", status == 200 and isinstance(health, dict) and health.get("ok") is True)
    counts = health.get("counts", {}) if isinstance(health, dict) else {}
    check("dataset counts", counts.get("offers", 0) > 300_000, json.dumps(counts))

    status, meta = call(base, "/api/meta")
    check("meta 200", status == 200 and bool(meta.get("categories")) if isinstance(meta, dict) else False)
    check("meta engine is rules", isinstance(meta, dict) and meta.get("assistant", {}).get("engine") == "rules")
    origin = meta["default_origin"]
    check("default origin has coords", isinstance(origin.get("lat"), float) and isinstance(origin.get("lon"), float))

    status, search = call(base, "/api/search" + q(q="هدفون", max_price=5_000_000, page_size=6))
    items = search.get("items", []) if isinstance(search, dict) else []
    check("search 200", status == 200)
    check("search returns products", len(items) > 0, f"{len(items)} items")
    check("search respects budget", all((i.get("min_price") or 0) <= 5_000_000 for i in items))
    check("search echoes persian query intact", search.get("applied", {}).get("q") == "هدفون")

    category_name = meta["categories"][0]["name"]
    status, category = call(base, "/api/search" + q(category=category_name, page_size=3))
    check(
        f"category filter «{category_name}»",
        status == 200 and len(category.get("items", [])) > 0,
        f"{len(category.get('items', []))} items" if status == 200 else str(category),
    )

    status, nearby = call(
        base,
        "/api/search"
        + q(category=category_name, page_size=6, lat=origin["lat"], lon=origin["lon"], radius_m=3000),
    )
    nearby_items = nearby.get("items", []) if isinstance(nearby, dict) else []
    distances = [(i.get("best") or {}).get("distance_m") for i in nearby_items]
    check("radius search returns matches", status == 200 and len(nearby_items) > 0, f"{len(nearby_items)} items")
    check("radius distances within 3km", all(d is not None and d <= 3000 for d in distances), str(distances))
    check("radius total matches served page", nearby.get("total") >= len(nearby_items), f"total={nearby.get('total')}")
    check("radius sorts nearest first", distances == sorted(distances))

    no_phone("search", search)
    best_names = [i["best"]["shop_name"] for i in items if i.get("best")]
    check(
        "best-offer shop names follow the identity rule",
        all(n.startswith(ANON_PREFIX) or n.strip() != "" for n in best_names),
        str(best_names[:2]),
    )

    if items:
        product_id = items[0]["product_id"]
        status, product = call(base, f"/api/products/{urllib.parse.quote(product_id)}")
        check("product detail", status == 200 and product.get("product_id") == product_id)
        offers = product.get("offers", [])
        check("product has offers", len(offers) > 0, f"{len(offers)} offers")
        check("offer reliability scored", all(0 <= o.get("reliability", {}).get("score", -1) <= 100 for o in offers))
        no_phone("product detail", product)
        shop_naming("product offers", [o["shop"] for o in offers])
        check(
            "reliability has no phone signal",
            all(not any(s.get("key") == "phone" or "تماس" in s.get("label", "") for s in o["reliability"]["signals"]) for o in offers),
        )
        check(
            "reliability never claims stock",
            all(not re.search(r"موجود است|موجودی تأیید", o["reliability"]["summary"]) for o in offers),
        )
        unpriced = [o for o in offers if not o.get("changed_at")]
        check(
            "prices without a timestamp are not called fresh",
            all(o.get("freshness") == "unknown" for o in unpriced),
            f"{len(unpriced)} undated offers",
        )
        if offers:
            status, offer = call(base, f"/api/offers/{urllib.parse.quote(offers[0]['offer_id'])}")
            check("offer detail", status == 200 and offer.get("offer_id") == offers[0]["offer_id"])

    status, shops = call(base, "/api/shops" + q(limit=3, lat=origin["lat"], lon=origin["lon"]))
    stores = shops.get("items", []) if isinstance(shops, dict) else []
    check("shop list", status == 200 and len(stores) > 0, f"{len(stores)} stores")
    shop_naming("shop list", stores)
    no_phone("shop list", shops)
    if stores:
        status, store = call(base, f"/api/shops/{urllib.parse.quote(stores[0]['shop_id'])}")
        check("shop detail", status == 200 and store.get("shop_id") == stores[0]["shop_id"])
        check("shop detail has hours and products", status == 200 and isinstance(store.get("hours"), dict) and "top_products" in store)
        no_phone("shop detail", store)
        shop_naming("shop detail", [store])

    status, empty_budget = call(base, "/api/assistant", {"message": "هدفون زیر ۱۰۰۰ تومان"})
    blocks = empty_budget.get("blocks", []) if isinstance(empty_budget, dict) else []
    note = next((b for b in blocks if b.get("type") == "note"), {})
    filters = next((b for b in blocks if b.get("type") == "filters"), {})
    check("zero-result search keeps the stated budget", empty_budget.get("meta", {}).get("parsed", {}).get("max_price") == 1000)
    check("zero-result search does not widen the query", empty_budget.get("meta", {}).get("tool_calls") == ["search_products"])
    check("zero-result search returns no out-of-budget products", not any(b.get("type") == "products" for b in blocks))
    check("zero-result filters echo the real budget", filters.get("active", {}).get("max_price") == 1000)
    actions = note.get("actions", [])
    check("zero-result offers at least two actions", len(actions) >= 2, str([a.get("label") for a in actions]))

    def action_params(action: dict) -> dict[str, str]:
        return urllib.parse.parse_qs(urllib.parse.urlparse(action.get("to", "")).query)

    def action_budget(action: dict) -> int | None:
        values = action_params(action).get("max_price")
        return int(values[0]) if values else None

    raise_action = next((a for a in actions if (action_budget(a) or 0) > 1000), None)
    drop_action = next(
        (a for a in actions if action_budget(a) is None and "/explore" in a.get("to", "")), None
    )
    check(
        "zero-result actions carry real parameters",
        raise_action is not None and drop_action is not None,
        str([a.get("to") for a in actions]),
    )
    if raise_action is not None:
        replay = {k: v[0] for k, v in action_params(raise_action).items() if k != "sort"}
        status, raised = call(base, "/api/search" + q(**replay))
        check(
            "the suggested budget raise returns real products",
            status == 200 and raised.get("total", 0) > 0,
            f"max_price={action_budget(raise_action)} total={raised.get('total')}",
        )

    conversations = [
        ("سلام", {}, "greeting"),
        ("هدفون بی‌سیم زیر ۵ میلیون", {}, "search"),
        ("گوشی سامسونگ تا ۲۰ میلیون", {}, "search"),
        ("نزدیک‌ترین فروشگاه دوربین مدار بسته", {}, "stores"),
        ("ارزان‌ترین لپ‌تاپ‌ها", {}, "search"),
    ]
    for message, context, intent in conversations:
        status, reply = call(base, "/api/assistant", {"message": message, "context": context})
        ok = status == 200 and reply.get("meta", {}).get("intent") == intent and bool(reply.get("reply"))
        check(f"assistant «{message}» → {intent}", ok, str(reply.get("meta", {}).get("intent")) if status == 200 else str(reply))

    if items:
        status, reply = call(
            base,
            "/api/assistant",
            {"message": "همین کالا را مقایسه کن", "context": {"product_id": items[0]["product_id"], "origin": origin}},
        )
        check("assistant compare on product", status == 200 and bool(reply.get("blocks")))

    basket: list[str] = []
    for item in items[:3]:
        status, product = call(base, f"/api/products/{urllib.parse.quote(item['product_id'])}")
        if status == 200 and product.get("offers"):
            basket.append(product["offers"][0]["offer_id"])
    status, plan = call(base, "/api/plan", {"offer_ids": basket, "origin": origin})
    no_phone("plan", plan)
    check("plan built", status == 200 and plan.get("item_count") == len(basket), json.dumps({
        "stops": len(plan.get("stops", [])), "items": plan.get("item_count"), "total": plan.get("total"),
    }))
    check("plan route ordered", [s["order"] for s in plan.get("stops", [])] == list(range(1, len(plan.get("stops", [])) + 1)))
    check("plan totals consistent", plan.get("total") == sum(s["subtotal"] for s in plan.get("stops", [])))

    status, bad = call(base, "/api/products/does-not-exist")
    check("unknown product 404", status == 404)
    status, empty = call(base, "/api/assistant", {"message": ""})
    check("empty message 400", status == 400)
    status, junk = call(base, "/api/plan", {"offer_ids": ["nope"]})
    check("unknown offers plan 404", status == 404)

    print(f"\n{len(FAILS)} failing check(s)." if FAILS else "\nAll smoke checks passed.")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
