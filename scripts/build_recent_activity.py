"""Recent appliance activity from two official, free, public sources, through Oct 2026.

  * CPSC (U.S. Consumer Product Safety Commission) recall database: appliance-related recalls.
  * ENERGY STAR certified-product lists (data.energystar.gov): models by the date they reached the market.

Additive only: this writes web/recent.json and two small caches in data/external/. Nothing else reads or changes.

Caveats shown on the dashboard:
  * Recalls are safety events, not sales or satisfaction; a recall is classed as an appliance recall from the product's
    name using strict word matches (the groups below), so a few edge cases will be missed or included.
  * ENERGY STAR lists only models that are CURRENTLY certified, which is a subset of the market, and models drop off
    when standards tighten. Older years are therefore understated; recent years (and "launched since the data cut-off")
    are the reliable part.

Usage: python scripts/build_recent_activity.py        (needs internet to refresh; otherwise uses the caches)
"""
import csv
import json
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "data" / "external"
EXT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "amazon-growth-dashboard personal-research-project"}
CUTOFF = "2023-04"                           # the category review data ends Mar 2023; "since the cut-off" starts here

# ---------------------------------------------------------------- recalls
CPSC_URL = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2012-01-01"
GROUPS = [   # name, include pattern, exclude pattern (matched on product name and CPSC product type, whole words)
    ("Refrigerators & freezers", r"\b(refrigerators?|freezers?|fridges?)\b", r"\b(ice pack|cooler|freezer bag|freezer pop)\b"),
    ("Ice makers", r"\bice (makers?|machines?)\b|\bicemakers?\b", r""),
    ("Dishwashers", r"\bdishwashers?\b", r""),
    ("Washers & dryers", r"\b(washing machines?|clothes washers?|clothes dryers?|tumble dryers?|laundry (machines?|centers?)|washer[- ]dryer|dryers?)\b", r"\b(hair|pressure|dish|power|car)\b"),
    ("Ranges, ovens & cooktops", r"\b(ranges?|stoves?|cooktops?|ovens?)\b", r"\b(toaster|microwave|range extender|rangefinder|short.?range|shower)\b"),
    ("Coffee & espresso machines", r"\b(coffee|espresso|k-?cup|keurig|brewers?)\b", r"\b(grinder only)\b"),
    ("Humidifiers & dehumidifiers", r"\b(humidifiers?|dehumidifiers?)\b", r""),
    ("Range hoods", r"\brange hoods?\b|\bvent hoods?\b", r""),
    ("Small kitchen appliances", r"\b(air fryers?|pressure cookers?|slow cookers?|multi-?cookers?|blenders?|toasters?|kettles?|microwaves?|mixers?|food processors?|rice cookers?|juicers?|waffle makers?|griddles?)\b", r"\b(hand mixer attachment)\b"),
]
RX = [(n, re.compile(i, re.I), re.compile(e, re.I) if e else None) for n, i, e in GROUPS]


def classify(rec):
    text = " ; ".join([p.get("Name", "") + " " + (p.get("Type") or "") for p in rec.get("Products", [])])
    hits = []
    for n, inc, exc in RX:
        if inc.search(text) and not (exc and exc.search(text)):
            hits.append(n)
    return hits[:1] and hits[:1] or []                       # first matching group only, in priority order


def units(rec):
    s = " ".join(p.get("NumberOfUnits", "") or "" for p in rec.get("Products", []))
    m = re.search(r"([\d,]{3,})", s)
    return int(m.group(1).replace(",", "")) if m else None


def fetch_recalls():
    path = EXT / "recalls_appliances.csv"
    try:
        raw = json.loads(urllib.request.urlopen(urllib.request.Request(CPSC_URL, headers=UA), timeout=120).read())
        rows = []
        for r in raw:
            g = classify(r)
            if g:
                hz = (r.get("Hazards") or [{}])[0].get("Name", "") if r.get("Hazards") else ""
                rows.append({"recall_number": r["RecallNumber"], "date": r["RecallDate"][:10], "group": g[0], "title": re.sub(r"\s+", " ", r["Title"]).strip(),
                             "hazard": re.sub(r"\s+", " ", hz).strip()[:200], "units": units(r), "url": r["URL"]})
        rows.sort(key=lambda x: x["date"])
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
        print(f"CPSC: {len(raw)} recalls fetched, {len(rows)} appliance-related, latest {rows[-1]['date']}")
    except Exception as e:
        print("CPSC fetch failed, using cache:", e)
    with open(path, newline="") as f:
        return [{**r, "units": int(r["units"]) if r["units"] else None} for r in csv.DictReader(f)]


# ---------------------------------------------------------------- ENERGY STAR new models
ES = {"Refrigerators": "p5st-her9", "Freezers": "8t9c-g3tn", "Dishwashers": "q8py-6w3f", "Clothes washers": "bghd-e2wd", "Clothes dryers": "t9u7-4d2j", "Cooking products": "m6gi-ng33"}


def soda(dataset):
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"$select": "brand_name,model_number,date_available_on_market", "$limit": 50000, "$offset": offset, "$order": "model_number"})
        page = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://data.energystar.gov/resource/{dataset}.json?{q}", headers=UA), timeout=120).read())
        out += page
        if len(page) < 50000:
            return out
        offset += 50000


def fetch_models():
    path = EXT / "energystar_launches.csv"
    try:
        rows = []
        for cat, ds in ES.items():
            seen = set()
            for r in soda(ds):
                d, b, m = (r.get("date_available_on_market") or "")[:7], (r.get("brand_name") or "").strip(), (r.get("model_number") or "").strip()
                if not (d and b and m) or (b.lower(), m.lower()) in seen:
                    continue
                seen.add((b.lower(), m.lower()))
                rows.append((cat, b, d))
            print(f"ENERGY STAR {cat}: {len(seen):,} distinct certified models")
        agg = Counter(rows)
        with open(path, "w", newline="") as f:
            w = csv.writer(f); w.writerow(["category", "brand", "month", "models"])
            for (c, b, d), n in sorted(agg.items()):
                w.writerow([c, b, d, n])
    except Exception as e:
        print("ENERGY STAR fetch failed, using cache:", e)
    with open(path, newline="") as f:
        return [{**r, "models": int(r["models"])} for r in csv.DictReader(f)]


def main():
    recalls, models = fetch_recalls(), fetch_models()
    today = date.today().isoformat()
    last_month = max(r["date"][:7] for r in recalls)
    yrs = sorted({r["date"][:4] for r in recalls})
    names = [g[0] for g in GROUPS]
    by_year = {y: {n: 0 for n in names} for y in yrs}
    for r in recalls:
        by_year[r["date"][:4]][r["group"]] += 1
    cut = lambda months: (date.today().replace(day=1) - __import__("datetime").timedelta(days=30 * months)).isoformat()[:10]
    last12 = [r for r in recalls if r["date"] >= cut(12)]
    prior12 = [r for r in recalls if cut(24) <= r["date"] < cut(12)]
    since = [r for r in recalls if r["date"][:7] >= CUTOFF]
    recent = sorted(recalls, key=lambda r: r["date"], reverse=True)[:12]

    # ENERGY STAR: models by year, and who has launched since the cut-off
    yearly = defaultdict(lambda: defaultdict(int)); brand_since = defaultdict(lambda: defaultdict(int)); total_since = defaultdict(int)
    for m in models:
        yearly[m["category"]][m["month"][:4]] += m["models"]
        if m["month"] >= CUTOFF:
            brand_since[m["category"]][m["brand"]] += m["models"]; total_since[m["category"]] += m["models"]
    years_es = [str(y) for y in range(2020, int(today[:4]) + 1)]
    allb = defaultdict(int)
    for c in brand_since:
        for b, n in brand_since[c].items():
            allb[b] += n
    es_last_month = max(m["month"] for m in models)
    l12_models = sum(m["models"] for m in models if m["month"] > cut(12)[:7])
    p12_models = sum(m["models"] for m in models if cut(24)[:7] < m["month"] <= cut(12)[:7])
    out = {
        "meta": {"built": today, "cutoff": CUTOFF, "recalls_latest": max(r["date"] for r in recalls), "energystar_latest": es_last_month,
                 "recalls_url": "https://www.cpsc.gov/Recalls", "energystar_url": "https://www.energystar.gov/productfinder/",
                 "notes": {"recalls": "Safety recalls, not sales or satisfaction. Appliance groups are matched from product names.", "energystar": "Currently certified models only, a subset of the market; older years are understated."}},
        "recalls": {"groups": names, "by_year": {y: by_year[y] for y in yrs if y >= "2016"}, "last12": len(last12), "prior12": len(prior12), "since_cutoff": len(since),
                    "units_last12": sum(r["units"] or 0 for r in last12), "recent": [{k: r[k] for k in ("date", "group", "title", "hazard", "url")} | {"units": int(r["units"]) if r["units"] else None} for r in recent]},
        "energystar": {"categories": list(ES), "years": years_es, "by_year": {c: [yearly[c].get(y, 0) for y in years_es] for c in ES},
                       "last12": l12_models, "prior12": p12_models, "since_cutoff": sum(total_since.values()),
                       "top_brands_since_cutoff": [{"brand": b, "models": n, "share": round(n / sum(total_since.values()), 4)} for b, n in sorted(allb.items(), key=lambda x: -x[1])[:10]],
                       "top_by_category": {c: [{"brand": b, "models": n, "share": round(n / total_since[c], 4)} for b, n in sorted(brand_since[c].items(), key=lambda x: -x[1])[:5]] for c in ES}},
    }
    path = ROOT / "web" / "recent.json"
    path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB): recalls last 12m {len(last12)} (prior {len(prior12)}), ENERGY STAR models last 12m {l12_models} (prior {p12_models}), latest recall {out['meta']['recalls_latest']}")
    print("recalls by group, last 12 months:", dict(Counter(r["group"] for r in last12)))
    print("top brands launching since the cut-off:", [(b["brand"], b["models"]) for b in out["energystar"]["top_brands_since_cutoff"][:6]])


if __name__ == "__main__":
    main()
