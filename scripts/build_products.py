"""Build the product master table: one clean row per product, with missing values filled and every fill flagged.

What gets filled, and how (nothing is filled silently; each fill has a *_src column):
  brand        store -> details.Brand -> details.Manufacturer            (copying fields that already exist)
  product type the product's own category path; if absent, predicted from the title (validated classifier)
  price        observed list price; if absent, estimated from type, brand, weight, pack size and title text
               with a stacked model that is validated on products whose price IS known (see imputation report)

Output:
  data/products_master.csv.gz       (not committed, large)
  data/imputation_report.json       (committed: how good the fills are)

Usage: python scripts/build_products.py data_raw data
"""
import json
import re
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_predict
from sklearn.preprocessing import OrdinalEncoder

warnings.filterwarnings("ignore")
raw, out = Path(sys.argv[1]), Path(sys.argv[2])
rng = 7

meta = pd.read_json(raw / "meta_Appliances.jsonl", lines=True)
meta = meta.drop_duplicates("parent_asin").reset_index(drop=True)
n = len(meta)
det = meta["details"].apply(lambda d: d if isinstance(d, dict) else {})
cats = meta["categories"].apply(lambda c: c if isinstance(c, list) else [])
report = {"products": int(n)}


def clean_text(s):
    return re.sub(r"\s+", " ", str(s)).strip()


# ---------------------------------------------------------------- brand
store = meta["store"].where(meta["store"].astype(str).str.strip().ne(""), None)
d_brand = det.apply(lambda d: d.get("Brand")); d_manu = det.apply(lambda d: d.get("Manufacturer"))
brand = store.copy(); brand_src = pd.Series(np.where(store.notna(), "store", None), index=meta.index)
for name, col in (("details.Brand", d_brand), ("details.Manufacturer", d_manu)):
    fill = brand.isna() & col.notna()
    brand[fill] = col[fill]; brand_src[fill] = name
brand = brand.apply(lambda b: clean_text(b) if isinstance(b, str) else None)
brand = brand.where(brand.isin(["", "N/A", "n/a", "None", "Unknown"]) == False, None)
report["brand_missing_before"] = round(float(store.isna().mean()), 4)
report["brand_missing_after"] = round(float(brand.isna().mean()), 4)
brand = brand.fillna("Unknown"); brand_src = brand_src.fillna("none")

# ---------------------------------------------------------------- product type from the category path
l2 = cats.apply(lambda c: c[1] if len(c) > 1 else None)
l3 = cats.apply(lambda c: c[2] if len(c) > 2 else None)
deepest = cats.apply(lambda c: c[min(len(c), 3) - 1] if len(c) > 1 else None)       # level 3 if present, else level 2
is_parts = cats.apply(lambda c: any(("Parts" in x or "Accessories" in x) for x in c))
ptype = deepest.copy(); ptype_src = pd.Series(np.where(ptype.notna(), "category path", None), index=meta.index)

# titles of products with no category path: predict their type from the title (validated on known ones)
tv_t = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=60000, sublinear_tf=True)
Xt = tv_t.fit_transform(meta["title"].fillna(""))
known = ptype.notna() & (ptype.map(ptype.value_counts()) >= 20)
clf = LogisticRegression(max_iter=300, C=8.0)
acc = None
if known.sum() > 500:
    skf = StratifiedKFold(5, shuffle=True, random_state=rng)
    pred_cv = cross_val_predict(clf, Xt[known.values], ptype[known], cv=skf)
    acc = float((pred_cv == ptype[known]).mean())
    clf.fit(Xt[known.values], ptype[known])
    miss = ptype.isna()
    if miss.any():
        ptype[miss] = clf.predict(Xt[miss.values]); ptype_src[miss] = "predicted from title"
        is_parts[miss] = ptype[miss].str.contains("Parts|Accessor", regex=True)
report["type_missing_before"] = round(float(deepest.isna().mean()), 4)
report["type_classifier_cv_accuracy"] = None if acc is None else round(acc, 4)
ptype = ptype.fillna("Other"); ptype_src = ptype_src.fillna("none")
# tiny types are folded into "Other" so every type is analysable
vc = ptype.value_counts(); ptype = ptype.where(ptype.map(vc) >= 30, "Other")

# ---------------------------------------------------------------- launch date, sales rank, size features
def parse_date(x):
    try:
        return pd.to_datetime(x, errors="coerce")
    except Exception:
        return pd.NaT


launch = pd.to_datetime(det.apply(lambda d: d.get("Date First Available")), errors="coerce")
launch = launch.where((launch >= "1995-01-01") & (launch <= "2023-12-31"))


def bsr(d):
    r = d.get("Best Sellers Rank")
    if isinstance(r, dict) and r:
        k = list(r)[-1]
        return k, r[k]
    return None, None


b = det.apply(bsr)
bsr_name = b.apply(lambda x: x[0]); bsr_rank = pd.to_numeric(b.apply(lambda x: x[1]), errors="coerce")


def weight_oz(d):
    for key in ("Item Weight", "Package Weight", "Unit Weight"):
        v = d.get(key)
        if isinstance(v, str):
            m = re.match(r"\s*([\d.,]+)\s*(ounce|oz|pound|lb|gram|g|kilogram|kg)", v.lower())
            if m:
                try:
                    x = float(m.group(1).replace(",", ""))
                except ValueError:
                    continue
                return x * {"ounce": 1, "oz": 1, "pound": 16, "lb": 16, "gram": 0.035274, "g": 0.035274, "kilogram": 35.274, "kg": 35.274}[m.group(2)]
    return np.nan


def pack_qty(d):
    v = d.get("Item Package Quantity") or d.get("Number of Items")
    try:
        return float(str(v).split()[0])
    except Exception:
        return np.nan


wt = det.apply(weight_oz); pq = det.apply(pack_qty)

# ---------------------------------------------------------------- price imputation
price = pd.to_numeric(meta["price"], errors="coerce")
price = price.where(price > 0)
known_p = price.notna()
y = np.log(price)
report["price_missing_products_before"] = round(float((~known_p).mean()), 4)

# stage 1: ridge on title + brand + type text (out-of-fold predictions become a feature for stage 2)
txt = (meta["title"].fillna("") + " " + brand + " " + ptype.fillna("")).str.lower()
tv = TfidfVectorizer(ngram_range=(1, 2), min_df=4, max_features=80000, sublinear_tf=True)
Xp = tv.fit_transform(txt)
kf = KFold(5, shuffle=True, random_state=rng)
ridge = Ridge(alpha=1.2)
oof = np.full(n, np.nan)
oof[known_p.values] = cross_val_predict(ridge, Xp[known_p.values], y[known_p], cv=kf)
ridge.fit(Xp[known_p.values], y[known_p])
oof[~known_p.values] = ridge.predict(Xp[~known_p.values])

# stage 2: gradient boosting on structured features + the ridge prediction
brand_top = brand.where(brand.isin(brand[brand != "Unknown"].value_counts().head(200).index), "other")   # the booster allows <=255 categories
feat = pd.DataFrame({
    "type": ptype, "l2": l2.fillna("none"), "brand": brand_top, "main": meta["main_category"].fillna("none"),
    "is_parts": is_parts.astype(int), "log_w": np.log1p(wt), "pack": pq, "ridge": oof,
    "log_rn": np.log1p(meta["rating_number"].fillna(0)), "avg_rating": meta["average_rating"],
    "n_feat": meta["features"].apply(lambda f: len(f) if isinstance(f, list) else 0),
    "title_len": meta["title"].fillna("").str.len(), "n_img": meta["images"].apply(lambda f: len(f) if isinstance(f, list) else 0),
    "launch_year": launch.dt.year,
})
catcols = ["type", "l2", "brand", "main"]
enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
feat[catcols] = enc.fit_transform(feat[catcols].astype(str))
mask = [c in catcols for c in feat.columns]
gb = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=20,
                                   categorical_features=mask, random_state=rng, l2_regularization=1.0)
oof2 = cross_val_predict(gb, feat[known_p.values], y[known_p], cv=KFold(5, shuffle=True, random_state=rng + 1))
gb.fit(feat[known_p.values], y[known_p])
pred_log = np.where(known_p, y, np.nan)
pred_log[~known_p.values] = gb.predict(feat[~known_p.values])

# honest validation: errors of the out-of-fold predictions on products whose price is KNOWN
yk = y[known_p].to_numpy(); resid = yk - oof2
rn_k = meta["rating_number"][known_p].to_numpy().astype(float)
ape = np.abs(np.exp(oof2) / np.exp(yk) - 1)
smear_raw = float(np.mean(np.exp(resid)))                  # Duan smearing: turns a median forecast into a mean forecast
# calibrate so that, over the held-out known prices, estimated value summed over reviews matches the true value
bias_all = float((rn_k * np.exp(oof2) * smear_raw).sum() / (rn_k * np.exp(yk)).sum() - 1)
smear = smear_raw / (1 + bias_all)
r2 = 1 - np.sum(resid ** 2) / np.sum((yk - yk.mean()) ** 2)
q10, q90 = np.quantile(resid, [0.10, 0.90])
cover = float(np.mean((resid >= q10) & (resid <= q90)))
# error when prices are summed over groups of products (what the sales proxy actually uses)
grp = (feat.loc[known_p.values, "brand"].astype(int).astype(str) + "|" + feat.loc[known_p.values, "type"].astype(int).astype(str))
dfv = pd.DataFrame({"g": grp.values, "w": rn_k, "true": np.exp(yk), "est": np.exp(oof2) * smear})
agg = dfv.assign(t=dfv.w * dfv.true, e=dfv.w * dfv.est).groupby("g")[["t", "e"]].sum()
agg = agg[dfv.groupby("g").size() >= 10]
group_err = np.abs(agg.e / agg.t - 1)
# is the model equally good for old and new products? (matters because old products lose their listed price more often)
cohort = pd.cut(launch[known_p].dt.year.fillna(0), [-1, 0, 2014, 2016, 2018, 2020, 2023], labels=["unknown", "to 2014", "2015-16", "2017-18", "2019-20", "2021-23"])
est_k = np.exp(oof2) * smear
by_cohort = {}
for c in cohort.cat.categories:
    sel = (cohort == c).to_numpy()
    if sel.sum() >= 30:
        by_cohort[str(c)] = {"products": int(sel.sum()),
                             "bias_of_review_weighted_total": round(float((rn_k[sel] * est_k[sel]).sum() / (rn_k[sel] * np.exp(yk[sel])).sum() - 1), 3),
                             "median_abs_pct_error": round(float(np.median(np.abs(est_k[sel] / np.exp(yk[sel]) - 1))), 3)}
report["price_model_by_launch_cohort"] = by_cohort
report["price_model"] = {
    "trained_on_products": int(known_p.sum()), "r2_log_price": round(float(r2), 3),
    "median_abs_pct_error_per_product": round(float(np.median(ape)), 3),
    "share_within_25pct": round(float(np.mean(ape <= 0.25)), 3),
    "review_weighted_median_abs_pct_error": round(float(np.median(np.repeat(ape, np.maximum(1, rn_k.astype(int) // 50)))), 3),
    "smearing_factor_raw": round(smear_raw, 3), "calibration_bias_removed": round(bias_all, 4), "smearing_factor": round(smear, 3), "interval80_log": [round(float(q10), 3), round(float(q90), 3)],
    "group_level": {"groups_tested": int(len(agg)), "median_abs_error_of_group_total": round(float(group_err.median()), 3),
                    "p90_abs_error_of_group_total": round(float(group_err.quantile(0.9)), 3),
                    "bias_of_total": round(float(agg.e.sum() / agg.t.sum() - 1), 4)},
}
price_est = np.exp(pred_log) * smear
price_final = np.where(known_p, price, price_est)
price_lo = np.where(known_p, price, np.exp(pred_log + q10) * smear)
price_hi = np.where(known_p, price, np.exp(pred_log + q90) * smear)

master = pd.DataFrame({
    "parent_asin": meta["parent_asin"], "title": meta["title"].fillna("").apply(clean_text), "brand": brand, "brand_src": brand_src,
    "type": ptype, "type_src": ptype_src, "l2": l2.fillna(""), "is_parts": is_parts.astype(int),
    "price_obs": price, "price": np.round(price_final, 2), "price_lo": np.round(price_lo, 2), "price_hi": np.round(price_hi, 2),
    "price_src": np.where(known_p, "observed", "estimated"), "launch": launch.dt.strftime("%Y-%m"),
    "bsr_name": bsr_name, "bsr_rank": bsr_rank, "rating_number": meta["rating_number"], "avg_rating": meta["average_rating"],
})
master.to_csv(out / "products_master.csv.gz", index=False)
report["price_missing_products_after"] = int(master["price"].isna().sum())
report["price_estimated_products"] = int((master["price_src"] == "estimated").sum())
report["price_range_check"] = {"min": float(master["price"].min()), "median": float(master["price"].median()), "max": float(master["price"].max())}
report["types"] = int(master["type"].nunique())
(out / "imputation_report.json").write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
