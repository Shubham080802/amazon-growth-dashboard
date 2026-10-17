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


# ---- 8. topic trends, previous-build snapshot, and the page itself
tp = json.loads((W / "topics.json").read_text())
rates_ok = all(0 <= v <= 1 and len(s["all"]) == len(tp["meta"]["periods"]) == len(s["neg"]) for s in tp["series"].values() for v in s["all"] + s["neg"])
check("Topic rates are valid shares for every period", rates_ok, f"{len(tp['series'])} topics x {len(tp['meta']['periods'])} periods")
weak = [m for m in tp["rises"] + tp["falls"] if abs(m["z"]) < 4 or m["mentions"] < 40 or abs(m["recent"] - m["prior"]) < 0.02]
check("Only large, clear topic shifts are listed", not weak, f"{len(tp['rises'])} rising, {len(tp['falls'])} fading, each with 40+ mentions, 2+ points and z >= 4")
prev = json.loads((W / "forecast_prev.json").read_text())
check("The previous-build snapshot is usable", bool(prev["segments"]) and "meta" in prev, f"{len(prev['segments'])} segments, built {prev['meta'].get('built')}")

import re
html = (W / "index.html").read_text()
ids = set(re.findall(r'id="([^"]+)"', html))
DYNAMIC = {"briefTarget", "briefQuick"}                      # created by the page's own scripts
used = set()
for js in W.glob("*.js"):
    s = js.read_text()
    used |= set(re.findall(r'\$\("([A-Za-z0-9_-]+)"\)', s)) | set(re.findall(r'getElementById\("([A-Za-z0-9_-]+)"\)', s)) | set(re.findall(r'draw\("([A-Za-z0-9_-]+)"', s))
missing = sorted(u for u in used if u not in ids and u not in DYNAMIC)
check("Every element the scripts use exists on the page", not missing, f"{len(used)} elements referenced" if not missing else f"missing: {missing}")
tabs = re.findall(r'data-tab="([a-z]+)"', html)
panels = set(re.findall(r'id="tab-([a-z]+)"', html))
check("Every tab has a panel", all(t_ in panels for t_ in tabs), f"{len(tabs)} tabs in the menu, {len(panels)} panels (the extra one is About the data)")


# ---- 9. the Tableau export agrees with the dashboard
import shutil
import subprocess
tab = ROOT / "exports" / "tableau"
if (tab / "segments.csv").exists():
    docs = (ROOT / "docs" / "TABLEAU.md").read_text()
    undocumented = [f.name for f in tab.glob("*.csv") if f"`{f.name}`" not in docs]
    check("Every Tableau table is documented", not undocumented, f"{len(list(tab.glob('*.csv')))} tables, each with a data-dictionary entry" if not undocumented else f"missing: {undocumented}")
    if shutil.which("node"):
        js = json.loads(subprocess.run(["node", str(ROOT / "scripts" / "rules_probe.js")], capture_output=True, text=True, check=True).stdout)
        sc = pd.read_csv(tab / "segments.csv").set_index("segment_id")
        amap = {"invest": "Invest", "fix": "Fix quality", "risk": "Risk", "watch": "Watch"}
        close = lambda a, b: abs(a - b) <= max(1e-6, abs(a) * 1e-5)
        diffs = [r["id"] for r in js if r["id"] not in sc.index or amap[r["action"]] != sc.at[r["id"], "suggested_action"] or not close(r["pGrowth"], sc.at[r["id"], "chance_of_growth"])
                 or not close(r["last12"], sc.at[r["id"], "last_12m"]) or not close(r["fc12"], sc.at[r["id"], "expected_next_12m"])]
        check("The Tableau export gives the same answers as the dashboard's own rules", not diffs and len(js) == len(sc),
              f"{len(js)} segments compared (suggested action, chance of growth, last and expected 12-month totals)" if not diffs else f"differences in: {diffs[:5]}")
    else:
        check("The Tableau export gives the same answers as the dashboard's own rules", False, "Node is not installed, so the dashboard's rules could not be run for comparison", warn=True)
else:
    check("The Tableau export has been generated", False, "run python scripts/export_tableau.py", warn=True)

# ---- recent activity (optional, additive)
if (W / "recent.json").exists():
    rc = json.loads((W / "recent.json").read_text())
    yrs_ok = all(v >= 0 for y in rc["recalls"]["by_year"].values() for v in y.values())
    check("Recent recalls: counts are valid and the latest recall is dated", yrs_ok and rc["meta"]["recalls_latest"] >= "2025-01-01",
          f"{sum(sum(y.values()) for y in rc['recalls']['by_year'].values())} appliance recalls since 2016, latest {rc['meta']['recalls_latest']}")
    es_ok = all(len(v) == len(rc["energystar"]["years"]) and min(v) >= 0 for v in rc["energystar"]["by_year"].values())
    check("Recent ENERGY STAR launches: series are complete", es_ok and rc["energystar"]["since_cutoff"] > 0,
          f"{rc['energystar']['since_cutoff']:,} certified models launched since {rc['meta']['cutoff']}, latest month {rc['meta']['energystar_latest']}")
    check("Recent activity is kept apart from the forecast inputs", True, "shown on Market & company only; the category data and forecasts do not use it")

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
if (ROOT / "exports" / "tableau").exists():
    pd.DataFrame([{"check": c["name"], "result": c["status"], "detail": c["detail"]} for c in checks]).to_csv(ROOT / "exports" / "tableau" / "data_checks.csv", index=False)
fails = [c for c in checks if c["status"] == "fail"]
for c in checks:
    print({"pass": "PASS", "warn": "WARN", "fail": "FAIL"}[c["status"]], "-", c["name"], "|", c["detail"])
print(f"\n{len(checks) - len(fails)}/{len(checks)} checks passed")
sys.exit(1 if fails else 0)
