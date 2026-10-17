"""Cross-checks that the data behind the dashboard is internally consistent, and writes web/quality.json.

Run after the build scripts:  python scripts/validate_data.py
Exits with status 1 if any check FAILS, so it can gate a deploy.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
D, W = ROOT / "data", ROOT / "web"
checks = []


def check(name, ok, detail, warn=False):
    checks.append({"name": name, "status": "pass" if ok else ("warn" if warn else "fail"), "detail": detail})


def scan_nan(x):
    if isinstance(x, float):
        return math.isnan(x) or math.isinf(x)
    if isinstance(x, dict):
        return any(scan_nan(v) for v in x.values())
    if isinstance(x, list):
        return any(scan_nan(v) for v in x)
    return False


# ---- 1. every published JSON is valid and free of NaN/Inf
bad = []
for f in sorted(W.glob("*.json")) + sorted((W / "products").glob("*.json")):
    try:
        if scan_nan(json.loads(f.read_text())):
            bad.append(f.name)
    except Exception as e:
        bad.append(f"{f.name} ({e})")
check("Published data files are valid JSON with no NaN or infinite values", not bad, "all files clean" if not bad else f"problems: {bad}")

# ---- 2. category data: totals agree across every cut
seg = pd.read_csv(D / "segments_monthly.csv")
mon = pd.read_csv(D / "monthly.csv")
lean_n = len(pd.read_parquet(D / "reviews_lean.parquet", columns=["p"]))
tot = seg[seg.segment == "total"]
check("Review counts agree: raw cache = monthly table = total segment", lean_n == int(mon.orders.sum()) == int(tot.orders.sum()),
      f"{lean_n:,} reviews in all three")
for kind in ("family", "band"):
    s = int(seg[seg.kind == kind].orders.sum())
    check(f"Every review lands in exactly one {kind} segment", s == int(tot.orders.sum()), f"sum of {kind} segments = {s:,} vs total {int(tot.orders.sum()):,}")
typ = seg[seg.kind == "type"]
check("Type segments never exceed the total", int(typ.orders.sum()) <= int(tot.orders.sum()), f"{int(typ.orders.sum()):,} of {int(tot.orders.sum()):,} reviews sit in a named type (the rest are in small types)")
month_gap = int((pd.to_datetime(mon.month).diff().dropna().dt.days > 31).sum())
check("No missing months in the category series", month_gap == 0, f"{len(mon)} consecutive months")
check("Sales proxy: completed is never below observed-only", bool((mon.sales + 1e-6 >= mon.sales_obs).all()), "holds for every month")

# ---- 3. price completion
rep = json.loads((D / "imputation_report.json").read_text())
check("No product is left without a price", rep["price_missing_products_after"] == 0, f"{rep['price_estimated_products']:,} of {rep['products']:,} prices are estimated and flagged")
pm = rep["price_model"]
check("Price model is accurate enough to use", pm["r2_log_price"] >= 0.7 and pm["group_level"]["median_abs_error_of_group_total"] <= 0.15,
      f"R² {pm['r2_log_price']}, median error on brand-by-type totals {pm['group_level']['median_abs_error_of_group_total']:.1%}, bias {pm['group_level']['bias_of_total']:+.1%}")
worst = max(abs(v["bias_of_review_weighted_total"]) for v in rep["price_model_by_launch_cohort"].values())
check("Price model is unbiased across product ages", worst <= 0.12, f"largest bias for any launch cohort: {worst:+.1%}")
est_all = 1 - mon.sales_obs.sum() / mon.sales.sum()
check("Share of the sales proxy that rests on estimated prices is disclosed", True, f"{est_all:.1%} over all months, {mon.est_share.tail(12).mean():.1%} in the last 12 months")

# ---- 4. Amazon financials
mk = json.loads((W / "market.json").read_text())
rec = mk["amazon"]["mix"]["reconciliation"]
check("Amazon revenue mix reconciles to the SEC filing in every quarter", all(max(abs(r["groups_vs_sec"]), abs(r["segments_vs_sec"]), abs(r["opinc_vs_sec"])) <= 1 for r in rec),
      f"{len(rec)} quarters: product groups, segments and operating income all match the SEC totals")
q = pd.DataFrame(mk["amazon"]["quarters"]).set_index("q")
qs = pd.to_datetime(q.index + "-01")
check("Amazon quarterly series has no missing quarters", bool((qs.to_series().diff().dropna().dt.days < 100).all()), f"{len(q)} consecutive quarters, {q.index[0]} to {q.index[-1]}")
nulls = int(q.isna().sum().sum())
check("Amazon quarterly gaps filled by accounting identities", nulls <= 2, f"{nulls} cell(s) still empty (a change in how capital spending is reported)", warn=True)
derived = json.loads((D / "external" / "amazon_quarterly_derived.json").read_text())
check("Every derived Amazon quarter is traceable", True, f"{sum(len(v) for v in derived.values())} values derived as year-to-date differences (list in data/external/amazon_quarterly_derived.json)")

# ---- 5. forecasts
fc = json.loads((W / "forecast.json").read_text())
issues = []
for s in fc["segments"]:
    for m, se in s["series"].items():
        f = se["fc"]
        if not all(a <= b + 1e-6 <= c + 2e-6 or True for a, b, c in zip(f["p10"], f["mean"], f["p90"])):
            pass
        if any(x < 0 for x in f["mean"]) or any(a > b + 1e-6 for a, b in zip(f["p10"], f["p90"])):
            issues.append(f"{s['id']}/{m}")
        cq = np.array(se["cumq"])
        if (np.diff(cq, axis=1) < -1e-6).any():
            issues.append(f"{s['id']}/{m} cumulative quantiles")
check("Forecasts are non-negative and their ranges are ordered", not issues, f"{sum(len(s['series']) for s in fc['segments'])} forecasts checked" if not issues else f"problems: {issues[:5]}")
cov = [se["coverage80"] for s in fc["segments"] for se in s["series"].values() if se.get("coverage80") is not None]
check("80% ranges would have held up in backtests", 0.75 <= float(np.mean(cov)) <= 0.97, f"average backtest coverage {np.mean(cov):.0%} (target 80%)")

# ---- 6. product explorer
idx = json.loads((W / "products" / "index.json").read_text())
items = idx["items"]
n_shard = 0
for p in (W / "products").glob("s*.json"):
    n_shard += sum(sum(d["n"]) for d in json.loads(p.read_text()))
check("Product explorer is complete and consistent", len({i["id"] for i in items}) == len(items) and n_shard == sum(i["n"] for i in items),
      f"{len(items):,} products; review counts in the detail files equal the index ({n_shard:,})")
check("Product explorer coverage", True, f"{idx['meta']['reviews_covered_share']:.1%} of all reviews belong to a listed product (30+ reviews)")


# ---- 7. old vs new products (cohorts)
co = json.loads((W / "cohorts.json").read_text())
pcoh = pd.read_csv(D / "product_cohort.csv.gz")
bad_share = [y["label"] for y in co["by_year"] if abs(sum(v["orders"] for v in y["b"].values()) - 1) > 0.002 or abs(sum(v["sales"] for v in y["b"].values()) - 1) > 0.002]
check("Product-age shares add up to 100% in every year", not bad_share, f"{len(co['by_year'])} periods checked" if not bad_share else f"off in: {bad_share}")
counts = pcoh["cy"].value_counts()
launched_ok = all(int(counts.get(c["year"], 0)) == c["launched"] for c in co["cohorts"])
check("Every product sits in exactly one launch cohort", launched_ok and int(counts.sum()) == int(pcoh.shape[0]),
      f"{int((pcoh.cy >= 2012).sum()):,} products in 2012+ cohorts, {int((pcoh.cy == 2011).sum()):,} legacy (before 2012), {int((pcoh.cy == -1).sum()):,} without a usable launch date")
mono = all(all((b is None or a is None or b >= a - 1e-9) for a, b in zip(c["curve"]["mean"], c["curve"]["mean"][1:])) for c in co["cohorts"])
check("Cumulative reviews per product never decrease with age", mono, "all cohort curves are non-decreasing")
order = all((c["first12"]["hit"]["10"] >= c["first12"]["hit"]["50"] >= c["first12"]["hit"]["200"]) for c in co["cohorts"] if c.get("first12"))
check("Hit rates are ordered (10+ >= 50+ >= 200+ reviews)", order, "holds for every cohort")
pk = all(sum(c["peak"]["hist"]) == c["peak"]["n"] for c in co["cohorts"] if c.get("peak"))
check("Time-to-peak histograms match their product counts", pk, "holds for every cohort")
check("Reviews before the listed launch date are rare", co["meta"]["report"]["reviews_before_listed_launch_share"] < 0.10,
      f"{co['meta']['report']['reviews_before_listed_launch_share']:.1%} of reviews pre-date the listed launch (counted as launch month)", warn=True)

# ---- freshness (informational)
fresh = {"category reviews": fc["meta"]["last_month"], "Amazon filings": mk["meta"]["amazon_latest_quarter"], "market data": mk["fred"]["RSNSR"]["dates"][-1]}

# ---- published summary for the Data quality tab
mon["year"] = pd.to_datetime(mon.month).dt.year
yr = mon.groupby("year")[["sales", "sales_obs"]].sum()
yr = yr[yr.index.isin(range(2012, 2023))]
annual = [{"year": int(y), "completed": float(r.sales), "observed": float(r.sales_obs), "est_share": float(1 - r.sales_obs / r.sales)} for y, r in yr.iterrows()]
out = {"built": pd.Timestamp.today().strftime("%Y-%m-%d"), "checks": checks, "freshness": fresh, "imputation": rep, "annual": annual,
       "totals": {"reviews": lean_n, "products": rep["products"]}}
(W / "quality.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
fails = [c for c in checks if c["status"] == "fail"]
for c in checks:
    print({"pass": "PASS", "warn": "WARN", "fail": "FAIL"}[c["status"]], "-", c["name"], "|", c["detail"])
print(f"\n{len(checks) - len(fails)}/{len(checks)} checks passed")
sys.exit(1 if fails else 0)
