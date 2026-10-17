"""Old vs new products: launch cohorts, new-product share, hit rates, survival, time to peak, quality by age.

Everything is measured on the same basis as the rest of the category model (reviews through Mar 2023) and
aligned by product AGE (months since launch), so a 2022 launch is compared with older ones at the same age,
never at the same calendar date. Cohorts that have not yet reached an age are excluded from that age's statistic
instead of being counted as zero.

Launch month = Amazon's "Date First Available" when listed; otherwise the product's first review (flagged).
Only products that were ever reviewed or are in the metadata are included; products Amazon has since removed
may be absent, which can make old cohorts look healthier than they were (stated on the dashboard).

Outputs: web/cohorts.json, data/product_cohort.csv.gz
Usage:   python scripts/build_cohorts.py data
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
data = Path(sys.argv[1])
FIRST_COHORT = 2012                # products launched earlier are "legacy": their early life is not in the data
MAXA = 135                         # ages 0..134 months
HIT = (10, 50, 200)

m = pd.read_csv(data / "products_master.csv.gz")
r = pd.read_parquet(data / "reviews_lean.parquet")
END = int(r["month"].max())
n_prod = len(m)

to_idx = lambda s: int(s[:4]) * 12 + int(s[5:7]) - 1
listed = m["launch"].map(lambda s: to_idx(s) if isinstance(s, str) else np.nan)
first_rev = r.groupby("p")["month"].min().reindex(range(n_prod))
L = listed.fillna(first_rev)
src = np.where(listed.notna(), "listed", np.where(first_rev.notna(), "first review", "none"))
after = (L > END)                                         # launched after the data window
ok = L.notna() & ~after
cy = np.where(ok, np.where(L // 12 < FIRST_COHORT, FIRST_COHORT - 1, (L // 12)), -1).astype(int)   # 2011 = legacy
lastyear = lambda i: f"{i // 12}-{i % 12 + 1:02d}"

# age of every review; negative ages (review before the listed launch) are counted as age 0 and reported
Lr = L.to_numpy()[r["p"].to_numpy()]
age_raw = r["month"].to_numpy() - Lr
valid_r = ~np.isnan(Lr) & (Lr <= END)
neg_age_share = float(np.mean(age_raw[valid_r] < 0))
age = np.clip(np.nan_to_num(age_raw, nan=-1), 0, None).astype(int)
r = r.assign(age=age, valid=valid_r, year=r["month"] // 12)
r["price"] = m["price"].to_numpy()[r["p"]]
r["sales"] = np.where(r["ver"] == 1, r["price"], 0.0)
r["neg"] = (r["rating"] <= 2).astype(int)
r["bucket"] = np.select([r["age"] < 12, r["age"] < 36], ["new", "mid"], "old")
rv = r[r["valid"]]

report = {"products_in_metadata": int(n_prod), "launch_listed_share": round(float(listed.notna().mean()), 4),
          "launch_from_first_review": int((src == "first review").sum()), "launched_after_window": int(after.sum()),
          "reviews_before_listed_launch_share": round(neg_age_share, 4)}

# ---------------------------------------------------------------- age-aligned matrix for cohort products
coh = (cy >= FIRST_COHORT)
idx_all = np.where(coh)[0]
sub = rv[rv["p"].isin(idx_all) & (rv["age"] < MAXA)]
mat = np.zeros((n_prod, MAXA), dtype=np.int32)
g = sub.groupby(["p", "age"]).size()
mat[g.index.get_level_values(0).to_numpy(), g.index.get_level_values(1).to_numpy()] = g.to_numpy()
obs_max = (END - L).fillna(-1).to_numpy().astype(int)       # ages 0..obs_max have been observed
cum = mat.cumsum(axis=1)


def pct(a, q):
    return None if len(a) == 0 else float(np.percentile(a, q))


cohorts, pc_rows = [], []
for Y in range(FIRST_COHORT, END // 12 + 1):
    idx = np.where(cy == Y)[0]
    if len(idx) < 30:
        continue
    om = obs_max[idx]; C = cum[idx]; M = mat[idx]
    row = {"year": Y, "launched": int(len(idx)), "with_reviews": int((M.sum(1) > 0).sum()),
           "listed_share": round(float((src[idx] == "listed").mean()), 3), "partial": bool(Y == END // 12)}
    # Average curve: estimate the mean NEW reviews at each age using every product observable at that age, then add them up.
    # (Averaging cumulative totals over a population that shrinks with age would let the curve dip.)
    inc, n_o = [], []
    for a_ in range(36):
        obs = om >= a_
        n_o.append(int(obs.sum()))
        inc.append(float(M[obs, a_].mean()) if obs.sum() >= 30 else None)
    mean_c, run = [], 0.0
    for v in inc:
        if v is None:
            mean_c.append(None); continue
        run += v; mean_c.append(round(run, 2))
    # Typical (median) curve: a FIXED set of products observed for 36 months, so every age compares the same products
    fixed = om >= 35
    med_c = [float(np.median(C[fixed, a_])) if fixed.sum() >= 30 else None for a_ in range(36)]
    row["curve"] = {"mean": mean_c, "median": med_c, "n": n_o, "fixed_n": int(fixed.sum())}
    mask12 = om >= 11
    if mask12.sum() >= 30:
        f12 = C[mask12, 11]
        row["first12"] = {"n": int(mask12.sum()), "mean": round(float(f12.mean()), 2), "median": float(np.median(f12)),
                          "hit": {str(t): round(float((f12 >= t).mean()), 4) for t in HIT}}
        # percentile of each product's first-year reviews within its launch-year cohort (ties share the mean rank)
        ranks = pd.Series(f12).rank(pct=True, method="average").to_numpy()
        for pi, p12, v in zip(idx[mask12], ranks, f12):
            pc_rows.append((m["parent_asin"].iloc[pi], int(v), round(float(p12), 3)))
    est = mask12 & (C[:, 11] >= 10)                                   # "established": 10+ reviews in year one
    surv = {}
    for a in (24, 36, 48):
        sel = est & (om >= a)
        if sel.sum() >= 30:
            surv[str(a)] = {"n": int(sel.sum()), "active": round(float((M[sel, a - 5:a + 1].sum(1) >= 1).mean()), 4)}
    row["survival"] = surv
    # time to peak, judged over the SAME window (first 36 months) for every cohort so recent launches are not penalised for having
    # been observed for less time. Products with 50+ reviews in their first 36 months only.
    pk, climbing, nn = [], 0, 0
    for k in np.where((om >= 35) & (C[:, 35] >= 50))[0]:
        v = M[k, :36].astype(float)
        sm = np.convolve(v, np.ones(3) / 3, mode="same")
        a_ = int(np.argmax(sm)); nn += 1
        if a_ >= 30:
            climbing += 1                                      # still building at the end of the window
        pk.append(a_)
    if nn >= 30:
        row["peak"] = {"n": nn, "still_climbing": round(climbing / nn, 3), "median": pct(pk, 50), "q1": pct(pk, 25), "q3": pct(pk, 75), "hist": np.bincount(pk, minlength=36).tolist()}
    ry = rv[(rv["p"].isin(idx)) & (rv["age"] < 12)]
    if len(ry) > 100:
        row["first12_quality"] = {"rating": round(float(ry["rating"].mean()), 3), "neg": round(float(ry["neg"].mean()), 4), "reviews": int(len(ry))}
    cohorts.append(row)

# ---------------------------------------------------------------- where the reviews come from, by year
def share(df):
    t = df.groupby("bucket").agg(n=("rating", "size"), sales=("sales", "sum"), rating=("rating", "mean"), neg=("neg", "mean"))
    tot_n, tot_s = t["n"].sum(), t["sales"].sum()
    return {b: {"orders": round(float(t.at[b, "n"] / tot_n), 4), "sales": round(float(t.at[b, "sales"] / tot_s), 4) if tot_s else 0,
                "rating": round(float(t.at[b, "rating"]), 3), "neg": round(float(t.at[b, "neg"]), 4), "n": int(t.at[b, "n"])} for b in t.index}


by_year = []
for y in range(2013, END // 12):                       # complete calendar years only; the partial year sits inside the 12-month window
    d = rv[rv["year"] == y]
    if len(d) > 200:
        by_year.append({"label": str(y), "year": y, "partial": False, **{"b": share(d)}})
last12 = rv[rv["month"] > END - 12]
by_year.append({"label": "Year to Mar 2023", "year": END // 12, "partial": False, "latest": True, "b": share(last12)})

# ---------------------------------------------------------------- types and brands: dependence on new products
def group_table(col, labels, min_launch=20, top=None):
    out = []
    ro = last12.copy(); ro[col] = m[col].to_numpy()[ro["p"]]
    launches = np.where(ok & (L >= END - 47) & (L <= END - 11))[0]               # launched 1-4 years before the end: a full first year is observable
    lf = pd.DataFrame({"p": launches, col: m[col].to_numpy()[launches], "f12": cum[launches, 11]})
    for key in labels:
        d = ro[ro[col] == key]
        if len(d) < 300:
            continue
        new24 = d["age"] < 24
        e = {"key": key, "reviews": int(len(d)), "new24_share": round(float(new24.mean()), 4), "new12_share": round(float((d["age"] < 12).mean()), 4),
             "rating_new": round(float(d.loc[new24, "rating"].mean()), 3) if new24.sum() >= 30 else None,
             "rating_old": round(float(d.loc[~new24, "rating"].mean()), 3) if (~new24).sum() >= 30 else None}
        lx = lf[lf[col] == key]
        if len(lx) >= min_launch:
            e["launches"] = int(len(lx)); e["hit50"] = round(float((lx["f12"] >= 50).mean()), 4); e["median_first12"] = float(lx["f12"].median())
        out.append(e)
    out.sort(key=lambda x: -x["reviews"])
    return out[:top] if top else out


types = group_table("type", [t for t in m["type"].value_counts().index if t != "Other"])
brands = group_table("brand", [b for b in m[m["brand"] != "Unknown"]["brand"].value_counts().head(20).index], top=15)

# ---------------------------------------------------------------- product-level file for the explorer
prod = pd.DataFrame({"parent_asin": m["parent_asin"], "cy": cy, "launch_idx": L, "launch_src": src, "obs_max": obs_max})
pcdf = pd.DataFrame(pc_rows, columns=["parent_asin", "f12", "p12"])
prod = prod.merge(pcdf, on="parent_asin", how="left")
prod.to_csv(data / "product_cohort.csv.gz", index=False)

latest = by_year[-1]["b"]; early = next(x for x in by_year if x["year"] == 2016)["b"]
report["new12_share_latest"] = latest.get("new", {}).get("orders"); report["new12_share_2016"] = early.get("new", {}).get("orders")
out = {"meta": {"end": lastyear(END), "first_cohort": FIRST_COHORT, "hit_thresholds": list(HIT), "legacy_label": f"Before {FIRST_COHORT}", "report": report,
                "buckets": {"new": "launched within 12 months", "mid": "1 to 3 years since launch", "old": "3+ years since launch"}},
       "cohorts": cohorts, "by_year": by_year, "types": types, "brands": brands}
(ROOT / "web" / "cohorts.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
print(json.dumps(report, indent=1))
print(f"cohorts={len(cohorts)} types={len(types)} brands={len(brands)} size={(ROOT / 'web' / 'cohorts.json').stat().st_size / 1e3:.0f} KB")
print(pd.DataFrame([{"year": c["year"], "launched": c["launched"], "median@12": c.get("first12", {}).get("median"), "hit50": c.get("first12", {}).get("hit", {}).get("50"),
                     "surv24": c["survival"].get("24", {}).get("active"), "peak_med": c.get("peak", {}).get("median"), "rating12": c.get("first12_quality", {}).get("rating")} for c in cohorts]).to_string(index=False))
