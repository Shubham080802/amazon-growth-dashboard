"""Export the dashboard's numbers as tidy CSV files for Tableau (Desktop, Cloud, Server or Public).

Run after the build scripts:   python scripts/export_tableau.py
Writes exports/tableau/*.csv and refreshes the data dictionary in docs/TABLEAU.md.

Design rules:
  * Long ("tidy") tables with one meaning per column, ISO dates (yyyy-mm-dd), no merged headers.
  * Join tables on segment_id (segment tables) or product_id (product tables).
  * The decision rules are the dashboard's own (web/rules.js); validate_data.py proves this file gives the same answers.
  * Only aggregated numbers are exported. No review text.
"""
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
W, D, OUT = ROOT / "web", ROOT / "data", ROOT / "exports" / "tableau"
OUT.mkdir(parents=True, exist_ok=True)
RULES = {"invest": 0.7, "risk": 0.7, "floor": 4.0}                       # same defaults as the dashboard
KIND = {"total": "Whole category", "family": "Parts vs appliances", "type": "Product type", "brand": "Brand", "band": "Price band", "product": "Product"}
MEASURE = {"sales": "Sales proxy ($)", "orders": "Reviews", "rating": "Average rating"}
ACTION = {"invest": "Invest", "fix": "Fix quality", "risk": "Risk", "watch": "Watch"}

load = lambda p: json.loads(Path(p).read_text())
iso = lambda ym: f"{ym}-01"
F, MK, TP, LC = load(W / "forecast.json"), load(W / "market.json"), load(W / "topics.json"), load(W / "cohorts.json")
PX = load(W / "products" / "index.json")
checks_doc = load(W / "quality.json")

# ---------------------------------------------------------------- the data dictionary: one place defines every column
DICT = {
    "segments": ("One row per brand, product type, price band, product or parts-vs-appliances group: the scorecard behind the Executive brief.", {
        "segment_id": "Stable key, for example brand:GE. Join other segment tables on this.", "segment_type": "Brand, Product type, Price band, Product, Parts vs appliances, or Whole category.",
        "segment": "Display name.", "measure": "What the money columns measure: Sales proxy ($), or Reviews when a segment has no price data.",
        "last_12m": "Total over the last 12 months of data (to Mar 2023).", "prior_12m": "Total over the 12 months before that.", "change_vs_prior_12m": "last_12m divided by prior_12m, minus 1.",
        "expected_next_12m": "Model's expected total over the 12 months after Mar 2023.", "low_case_next_12m": "10th percentile of the same total (likely range, low end).", "high_case_next_12m": "90th percentile (likely range, high end).",
        "expected_change": "expected_next_12m divided by last_12m, minus 1.", "chance_of_growth": "Probability the next 12 months beat the last 12, from 1,000 simulated futures.",
        "rating_last_12m": "Average star rating, weighted by reviews.", "rating_prior_12m": "The same for the 12 months before.", "rating_change": "rating_last_12m minus rating_prior_12m.",
        "forecast_model": "Model chosen by backtest.", "typical_forecast_miss": "Weighted average monthly forecast error in backtests (0.18 = 18%).", "forecast_bias": "Average over-forecast in backtests; positive means forecasts ran high.",
        "range_coverage_80": "Share of backtest outcomes inside the 80% range (the aim is 0.80).", "confidence": "High (miss up to 15%), Medium (up to 30%), Low (above 30%).",
        "suggested_action": "Invest, Fix quality, Risk or Watch, using the dashboard's rules at default thresholds.", "action_reason": "Plain-language reason for the action.", "tentative": "True when confidence is Low."}),
    "segment_monthly": ("Monthly history for every segment, 2012 to Mar 2023.", {
        "segment_id": "Join key.", "segment_type": "As in segments.", "segment": "Display name.", "month": "First day of the month.", "reviews": "Number of reviews.",
        "sales_proxy": "Price of each verified-purchase review, summed; missing prices are estimated.", "sales_listed_prices_only": "The same using only prices Amazon listed (a lower bound).",
        "avg_rating": "Average star rating.", "unhappy_share": "Share of reviews that are 1 or 2 stars."}),
    "forecast_monthly": ("Month-by-month forecast for every segment and measure, 24 months from Apr 2023.", {
        "segment_id": "Join key.", "segment_type": "As in segments.", "segment": "Display name.", "measure": "Sales proxy ($), Reviews or Average rating.", "month": "First day of the forecast month.",
        "months_ahead": "1 for Apr 2023, up to 24.", "expected": "Expected value.", "low_80": "10th percentile.", "high_80": "90th percentile.", "low_95": "5th percentile.", "high_95": "95th percentile.", "model": "Model used."}),
    "monitoring": ("Actual vs what the model expected, for the last 12 months, for monitored segments.", {
        "segment_id": "Join key.", "segment_type": "As in segments.", "segment": "Display name.", "measure": "Sales proxy ($), Reviews or Average rating.", "month": "First day of the month.",
        "actual": "What happened.", "expected": "What the model expected using data up to the previous month.", "low_80": "Low end of the expected range.", "high_80": "High end.", "position": "Above, Below or Within the expected range."}),
    "products": ("One row per product with 30+ reviews (81% of review volume): lifecycle, growth and rating shift.", {
        "product_id": "Amazon ASIN.", "title": "Product title (shortened).", "brand": "Brand.", "product_type": "Product type from Amazon's category path.", "reviews": "Reviews to Mar 2023.",
        "first_review_month": "First day of the month of the first review.", "last_review_month": "First day of the month of the latest review.", "rating": "Average rating, all time.",
        "price": "Price used in the sales proxy.", "price_is_estimated": "True when Amazon listed no price and it was estimated.", "reviews_last_12m": "Reviews in the last 12 months of data.",
        "reviews_prior_12m": "Reviews in the 12 months before.", "change_in_reviews": "reviews_last_12m divided by reviews_prior_12m, minus 1 (blank under 5 prior reviews).", "rating_change": "Rating change, last 12m vs prior 12m (blank under 10 reviews).",
        "lifecycle_stage": "New, Growing, Steady, Declining, Faded or Low activity.", "peak_month": "Month of peak review activity (3-month average).", "listed_launch_month": "Amazon's 'date first available'.",
        "launch_year": "Launch cohort year (blank for products launched before 2012 or without a date).", "first_year_reviews": "Reviews in the first 12 months, when observable.",
        "first_year_percentile": "Rank of first_year_reviews among products launched the same year (0 to 1).", "amazon_rank_snapshot": "Best-seller rank when the data was collected (2023).", "amazon_rating_count": "Amazon's own count of ratings, including those without text."}),
    "product_monthly": ("Monthly review history for every product in products.", {
        "product_id": "Join key.", "month": "First day of the month.", "reviews": "Reviews.", "avg_rating": "Average rating (blank when no reviews).", "unhappy_reviews": "Reviews of 1 or 2 stars.", "verified_reviews": "Verified-purchase reviews."}),
    "product_topics": ("What customers mention, per product with 100+ reviews. Counts only; no review text.", {
        "product_id": "Join key.", "topic": "One of 12 topics (keyword list in themes.py).", "mentions_all": "Reviews mentioning the topic, all time.", "mentions_unhappy": "Among 1-2 star reviews.",
        "mentions_last_12m": "In the last 12 months.", "mentions_prior_12m": "In the 12 months before.", "reviews_all": "Total reviews.", "reviews_unhappy": "Total 1-2 star reviews.", "reviews_last_12m": "Total reviews, last 12 months.", "reviews_prior_12m": "Total reviews, prior 12 months."}),
    "topics_category": ("Category-wide topic mentions by period.", {
        "period": "Calendar year, or Year to Mar 2023.", "topic": "Topic.", "share_of_reviews": "Share of the period's reviews mentioning it.", "share_of_unhappy_reviews": "Share of the period's 1-2 star reviews mentioning it.",
        "reviews_in_period": "Reviews in the period.", "unhappy_reviews_in_period": "1-2 star reviews in the period."}),
    "topic_shifts": ("Topics rising or fading within a product type, last 12 months vs the 12 before. Only large, clearly significant shifts.", {
        "product_type": "Product type.", "topic": "Topic.", "direction": "Rising or Fading.", "share_prior_12m": "Share of reviews mentioning it, prior 12 months.", "share_last_12m": "Share, last 12 months.",
        "change_points": "Change in percentage points.", "mentions": "Mentions in the last 12 months.", "z_score": "Two-proportion z statistic."}),
    "cohorts": ("Launch cohorts: how products launched in each year performed, compared by product age.", {
        "launch_year": "Year the products were launched.", "products_launched": "Products launched that year.", "products_observed_full_first_year": "Launched early enough to have 12 months of data.",
        "share_reaching_10_reviews_in_year1": "Share reaching 10+ reviews in their first 12 months.", "share_reaching_50_reviews_in_year1": "Share reaching 50+.", "share_reaching_200_reviews_in_year1": "Share reaching 200+.",
        "average_reviews_year1": "Average reviews in the first 12 months.", "median_reviews_year1": "Median.", "survival_24m": "Of products with 10+ reviews in year one, share still reviewed at 24 months.",
        "survival_36m": "At 36 months.", "survival_48m": "At 48 months.", "median_months_to_peak": "Median months from launch to peak, within the first 36 months.", "first_year_rating": "Average rating of first-year reviews.", "first_year_unhappy_share": "Share of first-year reviews that are 1-2 stars."}),
    "age_mix": ("Where each period's reviews come from, by the product's age when reviewed.", {
        "period": "Calendar year, or Year to Mar 2023.", "product_age_group": "Launched within 12 months, 1 to 3 years since launch, or 3+ years since launch.", "share_of_reviews": "Share of the period's reviews.",
        "share_of_sales_proxy": "Share of the period's sales proxy.", "avg_rating": "Average rating.", "unhappy_share": "Share of 1-2 star reviews.", "reviews": "Reviews."}),
    "type_dependence": ("How much each product type or brand depends on new launches (last 12 months).", {
        "group_type": "Product type or Brand.", "group": "Name.", "reviews_last_12m": "Reviews.", "share_from_products_under_2_years": "Share from products launched in the last 24 months.",
        "share_from_products_under_1_year": "Share from products launched in the last 12 months.", "launches_2019_2022": "Products launched Apr 2019 to Mar 2022 (blank when too few).",
        "share_reaching_50_reviews_in_year1": "Share of those launches reaching 50+ reviews in year one.", "median_first_year_reviews": "Median first-year reviews.", "rating_newer_products": "Average rating of reviews on products under 2 years old.", "rating_older_products": "Average rating on older products."}),
    "amazon_quarterly": ("Amazon's reported quarterly results (SEC filings), $ millions.", {
        "quarter_start": "First day of the quarter.", "quarter": "Label such as Q2 2026.", "net_sales": "Net sales.", "operating_income": "Operating income.", "net_income": "Net income.",
        "operating_cash_flow": "Operating cash flow.", "capital_spending": "Capital spending (blank for one quarter where the reporting definition changed)."}),
    "amazon_revenue_mix": ("Net sales by product and service group, Q3 2024 to Q2 2026, $ millions. Reconciles to the SEC total.", {
        "quarter_start": "First day of the quarter.", "quarter": "Label.", "group": "Online stores, Third-party seller services, Advertising services, Subscription services, Physical stores, AWS or Other.", "net_sales": "Net sales."}),
    "amazon_segments": ("Net sales and operating income by segment, Q3 2024 to Q2 2026, $ millions.", {
        "quarter_start": "First day of the quarter.", "quarter": "Label.", "segment": "North America, International or AWS.", "net_sales": "Net sales.", "operating_income": "Operating income."}),
    "amazon_forecast": ("Model outlook for Amazon's quarterly net sales, $ millions.", {
        "quarter_start": "First day of the forecast quarter.", "quarter": "Label.", "expected": "Expected net sales.", "low_80": "10th percentile.", "high_80": "90th percentile."}),
    "market_series": ("U.S. market series (Census Bureau, BLS, Federal Reserve, Michigan, Freddie Mac, BEA) via FRED, from 2012.", {
        "series_id": "FRED series id.", "series": "Description.", "publisher": "Who publishes it.", "unit": "Unit.", "frequency": "Monthly or Quarterly.", "date": "First day of the period.", "value": "Value."}),
    "data_checks": ("The consistency checks run on every rebuild.", {"check": "What is checked.", "result": "pass, warn or fail.", "detail": "What was found."}),
}


def write(name, rows):
    df = pd.DataFrame(rows)
    cols = list(DICT[name][1])
    assert list(df.columns) == cols, f"{name}: columns {list(df.columns)} differ from the dictionary {cols}"
    df.to_csv(OUT / f"{name}.csv", index=False, float_format="%.6g")
    return len(df)


# ---------------------------------------------------------------- the decision rules, ported from web/rules.js
QS = F["meta"]["quantiles"]
lastn = lambda a, n, off=0: a[len(a) - n - off: len(a) - off]


def prob_at_least(qv, x):
    if x <= qv[0]:
        return 0.97
    if x >= qv[-1]:
        return 0.03
    for i in range(1, len(qv)):
        if x <= qv[i]:
            w = 0 if qv[i] == qv[i - 1] else (x - qv[i - 1]) / (qv[i] - qv[i - 1])
            return 1 - (QS[i - 1] + w * (QS[i] - QS[i - 1]))
    return 0.03


def wrating(s, n, off=0):
    num = den = 0
    for r, o in zip(lastn(s["hist"]["rating"], n, off), lastn(s["hist"]["orders"], n, off)):
        if r is not None:
            num += r * o; den += o
    return num / den if den else None


def derive(s):
    pm = "sales" if "sales" in s["series"] else "orders"
    se, h = s["series"][pm], s["hist"]
    q = se["cumq"][11]
    last12, prior12, fc12 = sum(lastn(h[pm], 12)), sum(lastn(h[pm], 12, 12)), sum(se["fc"]["mean"][:12])
    r_now, r_prev = wrating(s, 12), wrating(s, 12, 12)
    grade = "High" if se["wmape"] <= 0.15 else "Medium" if se["wmape"] <= 0.30 else "Low"
    return dict(pm=pm, last12=last12, prior12=prior12, fc12=fc12, lo12=q[1], hi12=q[17], growth=fc12 / last12 - 1, pGrowth=prob_at_least(q, last12),
                rNow=r_now, rPrev=r_prev, dR=None if r_now is None or r_prev is None else r_now - r_prev, grade=grade, wmape=se["wmape"])


def decide(d):
    quality = (d["rNow"] is not None and d["rNow"] < RULES["floor"]) or (d["dR"] is not None and d["dR"] <= -0.10)
    key = "watch"
    if d["pGrowth"] <= 1 - RULES["risk"]:
        key = "risk"
    elif quality and d["pGrowth"] >= 0.5:
        key = "fix"
    elif d["pGrowth"] >= RULES["invest"] and not quality:
        key = "invest"
    return key, d["grade"] == "Low"


def reason(key, d):
    pg = round(d["pGrowth"] * 100)
    if key == "risk":
        return f"only a {pg}% chance of growth (a risk is flagged at {round((1 - RULES['risk']) * 100)}% or less)"
    if key == "fix":
        r = "n/a" if d["rNow"] is None else f"{d['rNow']:.2f}"
        ch = "" if d["dR"] is None else f" ({d['dR']:+.2f} on last year)"
        return f"growth looks likely ({pg}% chance) but the rating is {r}{ch}, below the {RULES['floor']:.1f} floor or falling by 0.10 or more"
    if key == "invest":
        return f"a {pg}% chance of growth (needs {round(RULES['invest'] * 100)}%) and healthy ratings"
    return f"no clear signal: {pg}% chance of growth, between the risk and invest thresholds"


SEGS = {s["id"]: s for s in F["segments"]}
rows = []
for s in F["segments"]:
    d = derive(s); key, tent = decide(d); se = s["series"][d["pm"]]
    rows.append({"segment_id": s["id"], "segment_type": KIND[s["kind"]], "segment": s["label"], "measure": MEASURE[d["pm"]], "last_12m": d["last12"], "prior_12m": d["prior12"],
                 "change_vs_prior_12m": d["last12"] / d["prior12"] - 1 if d["prior12"] else None, "expected_next_12m": d["fc12"], "low_case_next_12m": d["lo12"], "high_case_next_12m": d["hi12"],
                 "expected_change": d["growth"], "chance_of_growth": d["pGrowth"], "rating_last_12m": d["rNow"], "rating_prior_12m": d["rPrev"], "rating_change": d["dR"],
                 "forecast_model": se["model"], "typical_forecast_miss": se["wmape"], "forecast_bias": se["bias"], "range_coverage_80": se.get("coverage80"), "confidence": d["grade"],
                 "suggested_action": ACTION[key], "action_reason": reason(key, d), "tentative": tent})
counts = {"segments": write("segments", rows)}

# ---------------------------------------------------------------- segment history, forecasts, monitoring
seg = pd.read_csv(D / "segments_monthly.csv")
seg["avg_rating"] = seg["rating_sum"] / seg["orders"].where(seg["orders"] > 0)
seg["unhappy_share"] = seg["neg"] / seg["orders"].where(seg["orders"] > 0)
counts["segment_monthly"] = write("segment_monthly", pd.DataFrame({
    "segment_id": seg["segment"], "segment_type": seg["kind"].map(KIND), "segment": seg["label"], "month": seg["month"].map(iso), "reviews": seg["orders"], "sales_proxy": seg["sales"],
    "sales_listed_prices_only": seg["sales_obs"], "avg_rating": seg["avg_rating"], "unhappy_share": seg["unhappy_share"]}))

fc_rows, mon_rows = [], []
for s in F["segments"]:
    for m, se in s["series"].items():
        f = se["fc"]
        for i, mo in enumerate(f["month"]):
            fc_rows.append({"segment_id": s["id"], "segment_type": KIND[s["kind"]], "segment": s["label"], "measure": MEASURE[m], "month": iso(mo), "months_ahead": i + 1,
                            "expected": f["mean"][i], "low_80": f["p10"][i], "high_80": f["p90"][i], "low_95": f["p05"][i], "high_95": f["p95"][i], "model": se["model"]})
        for r in se.get("monitor", []):
            mon_rows.append({"segment_id": s["id"], "segment_type": KIND[s["kind"]], "segment": s["label"], "measure": MEASURE[m], "month": iso(r["month"]), "actual": r["actual"],
                             "expected": r["expected"], "low_80": r["lo"], "high_80": r["hi"], "position": "Above" if r["actual"] > r["hi"] else "Below" if r["actual"] < r["lo"] else "Within"})
counts["forecast_monthly"] = write("forecast_monthly", fc_rows)
counts["monitoring"] = write("monitoring", mon_rows)

# ---------------------------------------------------------------- products
types = PX["meta"]["types"]
prod_rows = [{"product_id": p["id"], "title": p["t"], "brand": p["b"], "product_type": types[p["y"]], "reviews": p["n"], "first_review_month": iso(p["f"]), "last_review_month": iso(p["l"]),
              "rating": p["rt"], "price": p["pr"], "price_is_estimated": bool(p["pe"]), "reviews_last_12m": p["c"], "reviews_prior_12m": p["pc"], "change_in_reviews": p["g"], "rating_change": p["dr"],
              "lifecycle_stage": p["st"], "peak_month": iso(p["pk"]), "listed_launch_month": iso(p["la"]) if p["la"] else None, "launch_year": p["cy"], "first_year_reviews": p["f12"],
              "first_year_percentile": p["p12"], "amazon_rank_snapshot": p["rk"], "amazon_rating_count": p["ra"]} for p in PX["items"]]
counts["products"] = write("products", prod_rows)

themes = [t["key"] for t in PX["meta"]["themes"]]
label = {t["key"]: t["label"] for t in PX["meta"]["themes"]}
pm_rows, pt_rows = [], []
for sh in range(PX["meta"]["shards"]):
    for d in load(W / "products" / f"s{sh:02d}.json"):
        y, mth = map(int, d["s"].split("-"))
        for i, (n, rs, ng, v) in enumerate(zip(d["n"], d["rs"], d["ng"], d["v"])):
            t = y * 12 + mth - 1 + i
            pm_rows.append({"product_id": d["a"], "month": f"{t // 12}-{t % 12 + 1:02d}-01", "reviews": n, "avg_rating": rs / n if n else None, "unhappy_reviews": ng, "verified_reviews": v})
        if "th" in d:
            nA, nN, nR, nP = d["N"]
            for k, c in zip(themes, d["th"]):
                pt_rows.append({"product_id": d["a"], "topic": label[k], "mentions_all": c[0], "mentions_unhappy": c[1], "mentions_last_12m": c[2], "mentions_prior_12m": c[3],
                                "reviews_all": nA, "reviews_unhappy": nN, "reviews_last_12m": nR, "reviews_prior_12m": nP})
counts["product_monthly"] = write("product_monthly", pm_rows)
counts["product_topics"] = write("product_topics", pt_rows)

# ---------------------------------------------------------------- topics, cohorts, age mix
P = TP["meta"]["periods"]
topic_rows = [{"period": p, "topic": t["label"], "share_of_reviews": TP["series"][t["key"]]["all"][i], "share_of_unhappy_reviews": TP["series"][t["key"]]["neg"][i],
               "reviews_in_period": TP["meta"]["reviews"][i], "unhappy_reviews_in_period": TP["meta"]["unhappy"][i]} for t in TP["meta"]["themes"] for i, p in enumerate(P)]
counts["topics_category"] = write("topics_category", topic_rows)
counts["topic_shifts"] = write("topic_shifts", [{"product_type": x["type"], "topic": x["label"], "direction": "Rising" if x["recent"] > x["prior"] else "Fading", "share_prior_12m": x["prior"], "share_last_12m": x["recent"],
                                                  "change_points": (x["recent"] - x["prior"]) * 100, "mentions": x["mentions"], "z_score": x["z"]} for x in TP["rises"] + TP["falls"]])

coh_rows = []
for c in LC["cohorts"]:
    f1, sv, pk, fq = c.get("first12"), c.get("survival", {}), c.get("peak"), c.get("first12_quality")
    coh_rows.append({"launch_year": c["year"], "products_launched": c["launched"], "products_observed_full_first_year": f1["n"] if f1 else None,
                     "share_reaching_10_reviews_in_year1": f1["hit"]["10"] if f1 else None, "share_reaching_50_reviews_in_year1": f1["hit"]["50"] if f1 else None, "share_reaching_200_reviews_in_year1": f1["hit"]["200"] if f1 else None,
                     "average_reviews_year1": f1["mean"] if f1 else None, "median_reviews_year1": f1["median"] if f1 else None,
                     "survival_24m": sv.get("24", {}).get("active"), "survival_36m": sv.get("36", {}).get("active"), "survival_48m": sv.get("48", {}).get("active"),
                     "median_months_to_peak": pk["median"] if pk else None, "first_year_rating": fq["rating"] if fq else None, "first_year_unhappy_share": fq["neg"] if fq else None})
counts["cohorts"] = write("cohorts", coh_rows)
AGE = {"new": "Launched within 12 months", "mid": "1 to 3 years since launch", "old": "3+ years since launch"}
counts["age_mix"] = write("age_mix", [{"period": y["label"], "product_age_group": AGE[b], "share_of_reviews": v["orders"], "share_of_sales_proxy": v["sales"], "avg_rating": v["rating"], "unhappy_share": v["neg"], "reviews": v["n"]}
                                       for y in LC["by_year"] for b, v in y["b"].items()])
dep = [("Product type", x) for x in LC["types"]] + [("Brand", x) for x in LC["brands"]]
counts["type_dependence"] = write("type_dependence", [{"group_type": g, "group": x["key"], "reviews_last_12m": x["reviews"], "share_from_products_under_2_years": x["new24_share"], "share_from_products_under_1_year": x["new12_share"],
                                                       "launches_2019_2022": x.get("launches"), "share_reaching_50_reviews_in_year1": x.get("hit50"), "median_first_year_reviews": x.get("median_first12"),
                                                       "rating_newer_products": x["rating_new"], "rating_older_products": x["rating_old"]} for g, x in dep])

# ---------------------------------------------------------------- Amazon and the market
qlab = lambda q: f"Q{(int(q[5:7]) - 1) // 3 + 1} {q[:4]}"
counts["amazon_quarterly"] = write("amazon_quarterly", [{"quarter_start": iso(r["q"]), "quarter": qlab(r["q"]), "net_sales": r["revenue"], "operating_income": r["operating_income"], "net_income": r["net_income"],
                                                         "operating_cash_flow": r["operating_cash_flow"], "capital_spending": r["capex"]} for r in MK["amazon"]["quarters"]])
mix = MK["amazon"]["mix"]["quarters"]
counts["amazon_revenue_mix"] = write("amazon_revenue_mix", [{"quarter_start": iso(q), "quarter": qlab(q), "group": g, "net_sales": v} for q, x in sorted(mix.items()) for g, v in x["groups"].items()])
counts["amazon_segments"] = write("amazon_segments", [{"quarter_start": iso(q), "quarter": qlab(q), "segment": g, "net_sales": v["sales"], "operating_income": v["opinc"]} for q, x in sorted(mix.items()) for g, v in x["segments"].items()])
af = MK["amazon"]["forecast"]["fc"]
counts["amazon_forecast"] = write("amazon_forecast", [{"quarter_start": iso(q), "quarter": qlab(q), "expected": af["mean"][i], "low_80": af["p10"][i], "high_80": af["p90"][i]} for i, q in enumerate(af["month"])])
counts["market_series"] = write("market_series", [{"series_id": sid, "series": s["label"], "publisher": s["publisher"], "unit": s["unit"], "frequency": "Quarterly" if s["freq"] == "Q" else "Monthly", "date": iso(d), "value": v}
                                                   for sid, s in MK["fred"].items() for d, v in zip(s["dates"], s["values"])])
counts["data_checks"] = write("data_checks", [{"check": c["name"], "result": c["status"], "detail": c["detail"]} for c in checks_doc["checks"]])

# ---------------------------------------------------------------- refresh the data dictionary in the guide
doc = ROOT / "docs" / "TABLEAU.md"
md = []
for name, (blurb, cols) in DICT.items():
    md.append(f"### `{name}.csv`  ({counts[name]:,} rows)\n{blurb}\n\n| Column | Meaning |\n|---|---|\n" + "\n".join(f"| `{c}` | {d} |" for c, d in cols.items()) + "\n")
block = "<!-- DICTIONARY START (generated by scripts/export_tableau.py; do not edit by hand) -->\n" + "\n".join(md) + "<!-- DICTIONARY END -->"
if doc.exists():
    t = doc.read_text()
    t = re.sub(r"<!-- DICTIONARY START.*?<!-- DICTIONARY END -->", lambda m: block, t, flags=re.S) if "<!-- DICTIONARY START" in t else t + "\n" + block + "\n"
    doc.write_text(t)
size = sum(p.stat().st_size for p in OUT.glob("*.csv")) / 1e6
print(f"wrote {len(counts)} tables ({size:.1f} MB) to {OUT.relative_to(ROOT)}")
print({k: v for k, v in counts.items()})
